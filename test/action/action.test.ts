import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import type { CheckResult } from "../../src/runtime/index.js";
import { runAction } from "../../src/action/index.js";

interface ToolkitLog {
  errors: string[];
  warnings: string[];
  failures: string[];
  infos: string[];
  summaries: string[];
  codeBlocks: string[];
}

const result = (findings: CheckResult["findings"] = []): CheckResult => ({
  findings,
  identityDiffs: [],
  notices: [
    "Changed-file comparison is unavailable because no base ref was supplied.",
  ],
  suites: [
    {
      name: "unit",
      executed: findings.length === 0 ? 10 : 0,
      skipped: 0,
      tests: [],
    },
  ],
});

const importActionLibrary = async (): Promise<{
  code: number | null;
  stderr: string;
}> => {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", "import('./build/src/action/index.js')"],
    {
      cwd: process.cwd(),
      env: { ...process.env, GITHUB_ACTIONS: "true" },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, stderr };
};

const toolkit = (
  inputs: Record<string, string> = {},
): { toolkit: Parameters<typeof runAction>[0]["core"]; log: ToolkitLog } => {
  const log: ToolkitLog = {
    errors: [],
    warnings: [],
    failures: [],
    infos: [],
    summaries: [],
    codeBlocks: [],
  };
  const fake = {
    getInput: (name: string) =>
      inputs[name] ?? (name === "config" ? ".exevra.yml" : "enforce"),
    error: (message: string) => log.errors.push(message),
    warning: (message: string) => log.warnings.push(message),
    info: (message: string) => log.infos.push(message),
    setFailed: (message: string) => log.failures.push(message),
    summary: {
      addRaw: (message: string) => {
        log.summaries.push(message);
        return { write: async () => undefined };
      },
      addCodeBlock: (message: string) => {
        log.codeBlocks.push(message);
        return { write: async () => undefined };
      },
    },
  };
  return {
    toolkit: fake as unknown as Parameters<typeof runAction>[0]["core"],
    log,
  };
};

test("defaults action inputs and leaves base comparison unavailable outside pull requests", async () => {
  const { toolkit: core, log } = toolkit();
  let options: unknown;
  await runAction({
    core,
    eventName: "push",
    eventPayload: {},
    check: async (value) => {
      options = value;
      return result();
    },
  });
  assert.deepEqual(options, { configPath: ".exevra.yml" });
  assert.deepEqual(log.failures, []);
  assert.match(log.codeBlocks[0] ?? "", /^EXEVRA PASSED/m);
});

test("importing the Action library does not execute it in a GitHub Actions environment", async () => {
  const imported = await importActionLibrary();
  assert.equal(imported.code, 0);
  assert.equal(imported.stderr, "");
});

test("forwards the pull request base SHA to runtime checking", async () => {
  const { toolkit: core } = toolkit({ config: "config/exevra.yml" });
  let options: unknown;
  await runAction({
    core,
    eventName: "pull_request",
    eventPayload: {
      pull_request: {
        base: { sha: "0123456789abcdef0123456789abcdef01234567" },
      },
    },
    check: async (value) => {
      options = value;
      return result();
    },
  });
  assert.deepEqual(options, {
    configPath: "config/exevra.yml",
    baseRef: "0123456789abcdef0123456789abcdef01234567",
  });
});

test("enforce mode annotates findings, writes the shared summary, and fails", async () => {
  const { toolkit: core, log } = toolkit();
  await runAction({
    core,
    eventName: "pull_request",
    eventPayload: {
      pull_request: {
        base: { sha: "0123456789abcdef0123456789abcdef01234567" },
      },
    },
    check: async () =>
      result([
        {
          code: "NO_TESTS_EXECUTED",
          severity: "error",
          suite: "unit",
          baseExecuted: 10,
          headExecuted: 0,
          message: "No tests executed.",
          remediation: "Restore test discovery.",
        },
      ]),
  });
  assert.match(log.errors[0] ?? "", /NO_TESTS_EXECUTED/);
  assert.match(log.codeBlocks[0] ?? "", /^EXEVRA BLOCKED/m);
  assert.deepEqual(log.failures, ["EXEVRA BLOCKED"]);
});

test("enforce mode reports warning identity drift without failing", async () => {
  const { toolkit: core, log } = toolkit();
  await runAction({
    core,
    eventName: "push",
    eventPayload: {},
    check: async () =>
      result([
        {
          code: "TEST_IDENTITIES_CHANGED",
          severity: "warning",
          suite: "unit",
          baseExecuted: 10,
          headExecuted: 10,
          message: "Test identities changed in suite unit.",
          remediation:
            "Review the suite's test identities and update the baseline if the change is intended.",
        },
      ]),
  });
  assert.match(log.warnings[0] ?? "", /TEST_IDENTITIES_CHANGED/);
  assert.deepEqual(log.errors, []);
  assert.deepEqual(log.failures, []);
  assert.match(log.codeBlocks[0] ?? "", /^EXEVRA PASSED WITH WARNINGS/m);
});

test("advisory mode keeps findings visible without failing", async () => {
  const { toolkit: core, log } = toolkit({ mode: "advisory" });
  await runAction({
    core,
    eventName: "push",
    eventPayload: {},
    check: async () =>
      result([
        {
          code: "SUITE_DROP_EXCEEDED",
          severity: "error",
          suite: "unit",
          baseExecuted: 10,
          headExecuted: 8,
          message: "Suite execution dropped.",
          remediation: "Review the change.",
        },
      ]),
  });
  assert.match(log.warnings[0] ?? "", /SUITE_DROP_EXCEEDED/);
  assert.deepEqual(log.failures, []);
});

test("operational errors fail regardless of mode", async () => {
  const { toolkit: core, log } = toolkit({ mode: "advisory" });
  await runAction({
    core,
    eventName: "push",
    eventPayload: {},
    check: async () => {
      throw new Error("invalid config");
    },
  });
  assert.deepEqual(log.failures, ["Operational error: invalid config"]);
  assert.match(log.errors[0] ?? "", /Operational error/);
});

test("invalid mode and malformed pull request payload fail as operational errors", async () => {
  for (const [inputs, eventPayload, expected] of [
    [{ mode: "block" }, {}, /Invalid mode: block/],
    [{}, {}, /no base SHA/],
    [{}, { pull_request: { base: { sha: 42 } } }, /no base SHA/],
  ] as const) {
    const { toolkit: core, log } = toolkit(inputs);
    await runAction({
      core,
      eventName: "pull_request",
      eventPayload,
      check: async () => result(),
    });
    assert.match(log.failures[0] ?? "", expected);
  }
});

test("renders report-controlled finding content as an escaped literal summary code block", async () => {
  const { toolkit: core, log } = toolkit();
  await runAction({
    core,
    eventName: "push",
    eventPayload: {},
    check: async () =>
      result([
        {
          code: "SUITE_BELOW_MINIMUM",
          severity: "error",
          suite: "</code><h1>not a heading</h1>",
          message: "# **not markdown** <script>not script</script>",
          remediation: "Use `literal` remediation.",
        },
      ]),
  });
  assert.equal(log.summaries.length, 0);
  assert.match(
    log.codeBlocks[0] ?? "",
    /&lt;\/code&gt;&lt;h1&gt;not a heading&lt;\/h1&gt;/,
  );
  assert.match(
    log.codeBlocks[0] ?? "",
    /# \*\*not markdown\*\* &lt;script&gt;not script&lt;\/script&gt;/,
  );
  assert.doesNotMatch(log.codeBlocks[0] ?? "", /<script>|<h1>|<\/code>/);
});

test("does not expose test identifiers or raw reports in Action annotations or summaries", async () => {
  const { toolkit: core, log } = toolkit();
  const checked = result([
    {
      code: "NO_TESTS_EXECUTED",
      severity: "error",
      suite: "unit",
      baseExecuted: 10,
      headExecuted: 0,
      message: "No tests executed.",
      remediation: "Restore test discovery.",
    },
  ]);
  checked.suites[0]!.tests.push({
    id: "private-test-identifier",
    status: "passed",
  });
  await runAction({
    core,
    eventName: "push",
    eventPayload: {},
    check: async () => checked,
  });
  const output = [...log.errors, ...log.codeBlocks].join("\n");
  assert.doesNotMatch(output, /private-test-identifier|<testsuite/);
  assert.match(output, /NO_TESTS_EXECUTED/);
});

test("renders opted-in identity names only in the escaped Action summary", async () => {
  const { toolkit: core, log } = toolkit();
  const checked = {
    ...result([
      {
        code: "TEST_IDENTITIES_CHANGED" as const,
        severity: "warning" as const,
        suite: "unit",
        baseExecuted: 1,
        headExecuted: 1,
        missingTestCount: 1,
        addedTestCount: 1,
        message: "Test identities changed in suite unit.",
        remediation: "Review the suite's test identities.",
      },
    ]),
    identityDiffs: [
      {
        suite: "unit",
        missingTestIds: ["unit\u001fremoved<name>"],
        addedTestIds: ["unit\u001fadded<name>"],
      },
    ],
  };
  await runAction({
    core,
    eventName: "push",
    eventPayload: {},
    check: async () => checked,
  });

  const logs = [
    ...log.errors,
    ...log.warnings,
    ...log.infos,
    ...log.summaries,
    ...log.failures,
  ].join("\n");
  assert.doesNotMatch(logs, /removed<name>|added<name>|\\u001f/);
  assert.match(
    log.codeBlocks[0] ?? "",
    /&quot;unit\\u001fremoved&lt;name&gt;&quot;/,
  );
  assert.match(
    log.codeBlocks[0] ?? "",
    /&quot;unit\\u001fadded&lt;name&gt;&quot;/,
  );

  const { toolkit: countCore, log: countLog } = toolkit();
  await runAction({
    core: countCore,
    eventName: "push",
    eventPayload: {},
    check: async () => result(checked.findings),
  });
  assert.doesNotMatch(
    countLog.codeBlocks[0] ?? "",
    /removed<name>|added<name>|\\u001f/,
  );
});

test("never sends report-derived workflow-command-looking text to raw Action logs", async () => {
  const { toolkit: core, log } = toolkit();
  await runAction({
    core,
    eventName: "push",
    eventPayload: {},
    check: async () =>
      result([
        {
          code: "SUITE_BELOW_MINIMUM",
          severity: "error",
          suite: "unit\n::error::injected",
          message: "Normal line\n::warning::injected",
          remediation: "Restore test execution.",
        },
      ]),
  });
  assert.deepEqual(log.infos, []);
});

test("published action metadata and committed bundle exist", async () => {
  const metadata = await readFile(join(process.cwd(), "action.yml"), "utf8");
  const action = parse(metadata) as {
    inputs: Record<string, { default: string }>;
    runs: { using: string; main: string };
  };
  assert.deepEqual(Object.keys(action.inputs), ["config", "mode"]);
  assert.deepEqual(action.inputs.config, {
    description: "Path to Exevra config",
    required: false,
    default: ".exevra.yml",
  });
  assert.deepEqual(action.inputs.mode, {
    description: "Whether findings block the Action",
    required: false,
    default: "enforce",
  });
  assert.deepEqual(action.runs, { using: "node24", main: "dist/index.js" });
  await readFile(join(process.cwd(), "dist", "index.js"), "utf8");
});

test("release package version is synchronized at 0.3.0", async () => {
  const manifest = JSON.parse(
    await readFile(join(process.cwd(), "package.json"), "utf8"),
  ) as { version: string };
  const lockfile = JSON.parse(
    await readFile(join(process.cwd(), "package-lock.json"), "utf8"),
  ) as { packages: Record<string, { version?: string }> };
  assert.equal(manifest.version, "0.3.0");
  assert.equal(lockfile.packages[""]?.version, "0.3.0");
});

test("release workflows and documentation pin current v7 GitHub Actions", async () => {
  const files = [
    ".github/workflows/ci.yml",
    ".github/workflows/action-fixture.yml",
    "README.md",
  ];
  for (const path of files) {
    const content = await readFile(join(process.cwd(), path), "utf8");
    assert.match(
      content,
      /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/,
    );
    assert.match(
      content,
      /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/,
    );
  }
});

test("npm publish metadata step executes with a missing package version", async (t) => {
  const workflow = parse(
    await readFile(join(process.cwd(), ".github/workflows/publish.yml"), "utf8"),
  ) as {
    jobs: { publish: { steps: { id?: string; run?: string }[] } };
  };
  const script = workflow.jobs.publish.steps.find(
    (step) => step.id === "package",
  )?.run;
  if (script === undefined) assert.fail("missing package metadata step");

  const root = await mkdtemp(join(tmpdir(), "exevra-publish-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin);
  const npm = join(bin, "npm");
  await writeFile(npm, "#!/usr/bin/env bash\nexit 1\n");
  await chmod(npm, 0o755);
  const output = join(root, "github-output");
  const child = spawn("bash", ["-e"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GITHUB_OUTPUT: output,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    },
    stdio: ["pipe", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdin.end(script);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 0, stderr);
  assert.equal(await readFile(output, "utf8"), "published=false\n");
});

test("npm publish verifies Node framework integrations first", async () => {
  const workflow = parse(
    await readFile(join(process.cwd(), ".github/workflows/publish.yml"), "utf8"),
  ) as {
    jobs: {
      publish: {
        steps: {
          name?: string;
          run?: string;
          uses?: string;
          with?: Record<string, string>;
          "working-directory"?: string;
        }[];
      };
    };
  };
  const steps = workflow.jobs.publish.steps;
  const publishIndex = steps.findIndex((step) => step.run?.trim() === "npm publish");
  assert.notEqual(publishIndex, -1, "missing npm publish step");
  for (const fixture of ["vitest", "jest", "playwright"]) {
    const step = steps.find(
      (candidate) =>
        candidate.uses === "./.github/actions/node-integration" &&
        candidate.with?.fixture === `test/fixtures/node/${fixture}`,
    );
    assert.ok(step, `missing ${fixture} integration step`);
    assert.equal(
      step.with?.init_mode,
      fixture === "vitest" ? "auto" : "explicit",
    );
    assert.ok(steps.indexOf(step) < publishIndex, `${fixture} runs after publish`);
  }
});

test("Node integration workflows share the composite fixture verification", async () => {
  const action = await readFile(
    join(process.cwd(), ".github/actions/node-integration/action.yml"),
    "utf8",
  );
  assert.match(action, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(action, /npm test/);
  assert.match(action, /init/);
  assert.match(action, /check/);
});

test("npm publish smoke-tests the packed CLI before publishing", async () => {
  const workflow = parse(
    await readFile(join(process.cwd(), ".github/workflows/publish.yml"), "utf8"),
  ) as {
    jobs: {
      publish: {
        steps: {
          name?: string;
          run?: string;
        }[];
      };
    };
  };
  const steps = workflow.jobs.publish.steps;
  const publishIndex = steps.findIndex((step) => step.run?.trim() === "npm publish");
  assert.notEqual(publishIndex, -1, "missing npm publish step");
  const packageStep = steps.find((step) => step.name === "Verify packed npm package");
  assert.ok(packageStep, "missing packed npm package verification step");
  assert.match(packageStep.run ?? "", /npm pack/);
  assert.match(packageStep.run ?? "", /npm install/);
  assert.match(packageStep.run ?? "", /node_modules\/\.bin\/exevra/);
  assert.match(packageStep.run ?? "", /--help/);
  assert.ok(steps.indexOf(packageStep) < publishIndex, "package verification runs after publish");
});
