import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { loadConfig } from "../../src/core/index.js";
import {
  check,
  changedFiles,
  initialize,
  record,
  resolveInRoot,
  RuntimeError,
  validateBaseRef,
} from "../../src/runtime/index.js";
import {
  cleanReports,
  runConfiguredCommand,
} from "../../src/runtime/command.js";
import { loadAggregatedReports } from "../../src/runtime/reports.js";

const fixture = join(process.cwd(), "test", "fixtures", "project");

const project = async (prefix = "exevra-runtime-"): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await cp(fixture, root, { recursive: true });
  return root;
};

const mode = (root: string, value: string) =>
  writeFile(join(root, "runner-config.json"), JSON.stringify({ mode: value }));

test("loadAggregatedReports groups explicit shard reports deterministically", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [shard, testName] of [
    ["unit-jdk17", "jdk17"],
    ["unit-jdk21", "jdk21"],
  ]) {
    const path = join(
      root,
      "artifacts",
      "shards",
      shard,
      "target",
      "surefire-reports",
      "TEST-unit.xml",
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `<testsuite name="unit"><testcase classname="unit" name="${testName}"/></testsuite>`,
    );
  }

  const result = await loadAggregatedReports(root, {
    root: "artifacts/shards",
    shards: ["unit-jdk21", "unit-jdk17"],
    reports: ["target/surefire-reports/TEST-*.xml"],
  });

  assert.deepEqual(result.missingShards, []);
  assert.deepEqual(result.missingReports, []);
  assert.deepEqual(
    result.shards.map((shard) => shard.shard),
    ["unit-jdk17", "unit-jdk21"],
  );
  assert.deepEqual(
    result.shards.map((shard) =>
      shard.reportPaths.map((path) => relative(root, path)),
    ),
    [
      ["artifacts/shards/unit-jdk17/target/surefire-reports/TEST-unit.xml"],
      ["artifacts/shards/unit-jdk21/target/surefire-reports/TEST-unit.xml"],
    ],
  );
  assert.equal(
    result.shards.flatMap((shard) => shard.suites).reduce(
      (total, suite) => total + suite.executed,
      0,
    ),
    2,
  );
});

test("loadAggregatedReports records missing shards and report patterns", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "artifacts", "shards", "unit-empty"), {
    recursive: true,
  });

  const result = await loadAggregatedReports(root, {
    root: "artifacts/shards",
    shards: ["unit-missing", "unit-empty"],
    reports: ["target/surefire-reports/TEST-*.xml"],
  });

  assert.deepEqual(result.shards.map((shard) => shard.shard), ["unit-empty"]);
  assert.deepEqual(result.missingShards, ["unit-missing"]);
  assert.deepEqual(result.missingReports, [
    "artifacts/shards/unit-empty/target/surefire-reports/TEST-*.xml",
  ]);
});

test("loadAggregatedReports rejects a symlinked shard report parent", async (t) => {
  const root = await project();
  const outside = await mkdtemp(join(tmpdir(), "exevra-outside-"));
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]),
  );
  await mkdir(join(root, "artifacts", "shards", "unit-jdk17"), {
    recursive: true,
  });
  await symlink(
    outside,
    join(root, "artifacts", "shards", "unit-jdk17", "target"),
  );

  await assert.rejects(
    loadAggregatedReports(root, {
      root: "artifacts/shards",
      shards: ["unit-jdk17"],
      reports: ["target/surefire-reports/TEST-*.xml"],
    }),
    RuntimeError,
  );
});

test("initialize writes a validated JUnit config and records its first baseline", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra.yml"));
  await rm(join(root, ".exevra"), { recursive: true, force: true });

  const result = await initialize({
    configPath: join(root, ".exevra.yml"),
    command: "node tools/fake-junit-command.mjs artifacts/junit.xml && true",
    reportPath: "artifacts/junit.xml",
  });

  const config = loadConfig(await readFile(join(root, ".exevra.yml"), "utf8"));
  assert.equal(config.command, "node tools/fake-junit-command.mjs artifacts/junit.xml && true");
  assert.deepEqual(config.reports, ["artifacts/junit.xml"]);
  assert.equal(config.policy.default.identity, "warn");
  assert.equal(config.policy.default.identityDetails, "counts");
  assert.equal(result.record.suites[0]?.executed, 10);
});

test("initialize refuses to replace an existing configuration", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, ".exevra.yml"), "keep");

  await assert.rejects(
    initialize({
      configPath: join(root, ".exevra.yml"),
      command: "node tools/fake-junit-command.mjs artifacts/junit.xml",
      reportPath: "artifacts/junit.xml",
    }),
    /configuration already exists/,
  );
  assert.equal(await readFile(join(root, ".exevra.yml"), "utf8"), "keep");
});

test("initialize rejects an escaping report before writing configuration", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra.yml"));

  await assert.rejects(
    initialize({
      configPath: join(root, ".exevra.yml"),
      command: "node tools/fake-junit-command.mjs artifacts/junit.xml",
      reportPath: "../outside.xml",
    }),
    /reports\[0\] must be a relative path within the configuration root/,
  );
  assert.equal((await readdir(root)).includes(".exevra.yml"), false);
});

test("initialize rejects every reserved path collision before invoking the command", async (t) => {
  const collisions = [
    {
      configPath: ".exevra.yml",
      reportPath: ".exevra.yml",
      message: "initialization paths overlap: report and configuration",
    },
    {
      configPath: ".exevra.yml",
      reportPath: ".EXEVRA.YML",
      message: "initialization paths overlap: report and configuration",
    },
    {
      configPath: ".caf\u00e9.yml",
      reportPath: ".cafe\u0301.yml",
      message:
        "initialization configuration path must use ASCII characters only",
    },
    {
      configPath: ".exevra.yml",
      reportPath: ".exevra.yml/report.xml",
      message: "initialization paths overlap: report and configuration",
    },
    {
      configPath: ".exevra.yml",
      reportPath: ".exevra",
      message: "initialization paths overlap: report and baseline",
    },
    {
      configPath: ".exevra.yml",
      reportPath: ".exevra/baseline.json",
      message: "initialization paths overlap: report and baseline",
    },
    {
      configPath: ".exevra.yml",
      reportPath: ".exevra/baseline.json/report.xml",
      message: "initialization paths overlap: report and baseline",
    },
    {
      configPath: ".exevra/baseline.json",
      reportPath: "artifacts/junit.xml",
      message: "initialization paths overlap: configuration and baseline",
    },
  ] as const;

  for (const collision of collisions) {
    await t.test(
      `${collision.configPath} versus ${collision.reportPath}`,
      async (t) => {
        const root = await project();
        t.after(() => rm(root, { recursive: true, force: true }));
        await rm(join(root, ".exevra.yml"), { force: true });
        await rm(join(root, ".exevra"), { recursive: true, force: true });
        await mkdir(dirname(join(root, collision.configPath)), {
          recursive: true,
        });

        const nestedConfig = collision.configPath.includes("/");
        const command = nestedConfig
          ? 'node -e "require(\'node:fs\').writeFileSync(\'../command-invoked\', \'yes\')" && node ../tools/fake-junit-command.mjs artifacts/junit.xml'
          : `node -e "require('node:fs').writeFileSync('command-invoked', 'yes')" && node tools/fake-junit-command.mjs ${collision.reportPath}`;
        const absoluteConfig = join(root, collision.configPath);
        const configRoot = dirname(absoluteConfig);
        const absoluteBaseline = join(
          configRoot,
          ".exevra",
          "baseline.json",
        );
        const absoluteReport = join(configRoot, collision.reportPath);

        await assert.rejects(
          initialize({
            configPath: absoluteConfig,
            command,
            reportPath: collision.reportPath,
          }),
          {
            name: "RuntimeError",
            message: collision.message,
          },
        );
        await assert.rejects(readFile(absoluteConfig, "utf8"), {
          code: "ENOENT",
        });
        await assert.rejects(readFile(absoluteBaseline, "utf8"), {
          code: "ENOENT",
        });
        await assert.rejects(readFile(absoluteReport, "utf8"), {
          code: "ENOENT",
        });
        await assert.rejects(readFile(join(root, "command-invoked"), "utf8"), {
          code: "ENOENT",
        });
      },
    );
  }
});

test("initialize rejects non-ASCII role paths before creating files or invoking the command", async (t) => {
  const cases = [
    {
      configPath: ".s.yml",
      reportPath: ".\u017f.yml",
      role: "report",
    },
    {
      configPath: ".\u00df.yml",
      reportPath: ".ss.yml",
      role: "configuration",
    },
  ] as const;

  for (const testCase of cases) {
    await t.test(
      `${testCase.configPath} versus ${testCase.reportPath}`,
      async (t) => {
        const root = await project();
        t.after(() => rm(root, { recursive: true, force: true }));
        await rm(join(root, ".exevra"), { recursive: true, force: true });
        const absoluteConfig = join(root, testCase.configPath);
        const command = `node -e "require('node:fs').writeFileSync('command-invoked', 'yes')" && node tools/fake-junit-command.mjs ${testCase.reportPath}`;

        await assert.rejects(
          initialize({
            configPath: absoluteConfig,
            command,
            reportPath: testCase.reportPath,
          }),
          {
            name: "RuntimeError",
            message: `initialization ${testCase.role} path must use ASCII characters only`,
          },
        );
        for (const path of [
          absoluteConfig,
          join(root, testCase.reportPath),
          join(root, ".exevra", "baseline.json"),
          join(root, "command-invoked"),
        ]) {
          await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" });
        }
      },
    );
  }
});

test("initialize allows ASCII role paths inside a non-ASCII workspace root", async (t) => {
  const root = await project("ex\u00e9vra-runtime-");
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra.yml"), { force: true });
  await rm(join(root, ".exevra"), { recursive: true, force: true });

  const result = await initialize({
    configPath: join(root, ".exevra.yml"),
    command: "node tools/fake-junit-command.mjs artifacts/junit.xml",
    reportPath: "artifacts/junit.xml",
  });

  assert.equal(result.record.suites[0]?.executed, 10);
  await readFile(join(root, ".exevra.yml"), "utf8");
  await readFile(join(root, ".exevra", "baseline.json"), "utf8");
});

test("initialize accepts a report path whose prefix only resembles the config role", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra.yml"), { force: true });
  await rm(join(root, ".exevra"), { recursive: true, force: true });

  const result = await initialize({
    configPath: join(root, ".exevra.yml"),
    command:
      "node tools/fake-junit-command.mjs .exevra.yml-not-a-role",
    reportPath: ".exevra.yml-not-a-role",
  });

  assert.equal(result.record.suites[0]?.executed, 10);
  assert.deepEqual(
    loadConfig(await readFile(join(root, ".exevra.yml"), "utf8")).reports,
    [".exevra.yml-not-a-role"],
  );
  assert.match(
    await readFile(join(root, ".exevra.yml-not-a-role"), "utf8"),
    /<testsuite/,
  );
  await readFile(join(root, ".exevra", "baseline.json"), "utf8");
});

test("initialize refuses a symlinked configuration without touching its target", async (t) => {
  const root = await project();
  const outside = await mkdtemp(join(tmpdir(), "exevra-outside-"));
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]),
  );
  const outsideConfig = join(outside, ".exevra.yml");
  await writeFile(outsideConfig, "keep");
  await rm(join(root, ".exevra.yml"));
  await symlink(outsideConfig, join(root, ".exevra.yml"));

  await assert.rejects(
    initialize({
      configPath: join(root, ".exevra.yml"),
      command: "node tools/fake-junit-command.mjs artifacts/junit.xml",
      reportPath: "artifacts/junit.xml",
    }),
    /configuration already exists/,
  );
  assert.equal(await readFile(outsideConfig, "utf8"), "keep");
});

test("initialize rejects a symlinked report parent before writing configuration", async (t) => {
  const root = await project();
  const outside = await mkdtemp(join(tmpdir(), "exevra-outside-"));
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]),
  );
  await rm(join(root, ".exevra.yml"));
  await rm(join(root, ".exevra"), { recursive: true, force: true });
  await writeFile(join(outside, "keep.txt"), "keep");
  await symlink(outside, join(root, "artifacts"));

  await assert.rejects(
    initialize({
      configPath: join(root, ".exevra.yml"),
      command: "node tools/fake-junit-command.mjs artifacts/junit.xml",
      reportPath: "artifacts/junit.xml",
    }),
    /configured path contains a symlink/,
  );
  assert.equal((await readdir(root)).includes(".exevra.yml"), false);
  assert.equal((await readdir(root)).includes(".exevra"), false);
  assert.deepEqual(await readdir(outside), ["keep.txt"]);
  assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "keep");
});

test("initialize rejects a symlinked baseline parent before writing configuration", async (t) => {
  const root = await project();
  const outside = await mkdtemp(join(tmpdir(), "exevra-outside-"));
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]),
  );
  await rm(join(root, ".exevra.yml"));
  await rm(join(root, ".exevra"), { recursive: true, force: true });
  await writeFile(join(outside, "keep.txt"), "keep");
  await symlink(outside, join(root, ".exevra"));

  await assert.rejects(
    initialize({
      configPath: join(root, ".exevra.yml"),
      command: "node tools/fake-junit-command.mjs artifacts/junit.xml",
      reportPath: "artifacts/junit.xml",
    }),
    /configured path contains a symlink/,
  );
  assert.equal((await readdir(root)).includes(".exevra.yml"), false);
  assert.deepEqual(await readdir(outside), ["keep.txt"]);
});

test("initialize retains config without a baseline for every first-record failure", async (t) => {
  for (const { failureMode, findingCode } of [
    { failureMode: "fail-command", findingCode: "TEST_COMMAND_FAILED" },
    { failureMode: "no-report", findingCode: "REPORT_MISSING" },
    { failureMode: "invalid-report" },
    { failureMode: "zero" },
  ]) {
    await t.test(failureMode, async (t) => {
      const root = await project();
      t.after(() => rm(root, { recursive: true, force: true }));
      await rm(join(root, ".exevra.yml"));
      await rm(join(root, ".exevra"), { recursive: true, force: true });
      await mode(root, failureMode);

      await assert.rejects(
        initialize({
          configPath: join(root, ".exevra.yml"),
          command: "node tools/fake-junit-command.mjs artifacts/junit.xml",
          reportPath: "artifacts/junit.xml",
        }),
        (error: unknown) =>
          error instanceof Error &&
          (findingCode === undefined ||
            (error instanceof RuntimeError &&
              error.message.includes(findingCode))),
      );
      await readFile(join(root, ".exevra.yml"), "utf8");
      await assert.rejects(
        readFile(join(root, ".exevra", "baseline.json"), "utf8"),
        { code: "ENOENT" },
      );
    });
  }
});

test("initialize replaces malformed JUnit parser details with a stable code", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra.yml"), { force: true });
  await rm(join(root, ".exevra"), { recursive: true, force: true });
  await mode(root, "invalid-report");

  await assert.rejects(
    initialize({
      configPath: join(root, ".exevra.yml"),
      command: "node tools/fake-junit-command.mjs artifacts/junit.xml",
      reportPath: "artifacts/junit.xml",
    }),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeError);
      assert.equal(
        error.message,
        "initial baseline recording failed: REPORT_INVALID",
      );
      assert.doesNotMatch(error.message, /SECRET_TOKEN_ABC/);
      return true;
    },
  );
});

test("check accepts a fresh report with an advisory legacy identity warning", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await check({ configPath: join(root, ".exevra.yml") });
  assert.deepEqual(
    result.findings.map(({ code, severity }) => ({ code, severity })),
    [{ code: "TEST_IDENTITIES_CHANGED", severity: "warning" }],
  );
  assert.equal(result.suites[0]?.executed, 10);
});

test("check reports identity count details for same-count drift at the configured severity", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await record({
    configPath: join(root, ".exevra.yml"),
    write: true,
    generatedAt: "2026-08-12T00:00:00.000Z",
  });
  await mode(root, "identity-shift");

  const warning = await check({ configPath: join(root, ".exevra.yml") });
  assert.deepEqual(
    warning.findings.map(({ code, severity }) => ({ code, severity })),
    [{ code: "TEST_IDENTITIES_CHANGED", severity: "warning" }],
  );
  assert.deepEqual(
    [
      warning.findings[0]?.missingTestCount,
      warning.findings[0]?.addedTestCount,
    ],
    [1, 1],
  );

  const enforcedConfig = join(root, "identity-enforce.yml");
  await writeFile(
    enforcedConfig,
    (await readFile(join(root, ".exevra.yml"), "utf8")).replace(
      "max_drop_percent: 0",
      "max_drop_percent: 0\n    identity: enforce",
    ),
  );
  const enforced = await check({ configPath: enforcedConfig });
  assert.deepEqual(
    enforced.findings.map(({ code, severity }) => ({ code, severity })),
    [{ code: "TEST_IDENTITIES_CHANGED", severity: "error" }],
  );
});

test("record writes an identity count baseline without raw test IDs", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  await record({
    configPath: join(root, ".exevra.yml"),
    write: true,
    generatedAt: "2026-08-12T00:00:00.000Z",
  });
  const suite = JSON.parse(
    await readFile(join(root, ".exevra", "baseline.json"), "utf8"),
  ).suites[0];

  assert.equal(suite.testIdHashes.length, 10);
  assert.equal(Object.hasOwn(suite, "testIds"), false);
});

test("record writes raw IDs only for a matching identity names suite", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const namesConfig = join(root, "identity-names.yml");
  await writeFile(
    namesConfig,
    (await readFile(join(root, ".exevra.yml"), "utf8")).replace(
      "max_drop_percent: 0",
      "max_drop_percent: 0\n    identity_details: counts\n  protected_suites:\n    - name: unit names\n      match: ^unit$\n      min_executed: 1\n      max_drop_percent: 0\n      identity_details: names",
    ),
  );

  await record({
    configPath: namesConfig,
    write: true,
    generatedAt: "2026-08-12T00:00:00.000Z",
  });
  const suite = JSON.parse(
    await readFile(join(root, ".exevra", "baseline.json"), "utf8"),
  ).suites[0];

  assert.deepEqual(suite.testIds, [
    "unit\u001ftest-1",
    "unit\u001ftest-10",
    "unit\u001ftest-2",
    "unit\u001ftest-3",
    "unit\u001ftest-4",
    "unit\u001ftest-5",
    "unit\u001ftest-6",
    "unit\u001ftest-7",
    "unit\u001ftest-8",
    "unit\u001ftest-9",
  ]);
});

test("check blocks a zero-execution report", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mode(root, "zero");
  const result = await check({ configPath: join(root, ".exevra.yml") });
  assert.ok(
    result.findings.some((finding) => finding.code === "NO_TESTS_EXECUTED"),
  );
});

test("check reports a missing report after a successful command", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mode(root, "no-report");
  const result = await check({ configPath: join(root, ".exevra.yml") });
  assert.deepEqual(
    result.findings.map((finding) => finding.code),
    ["REPORT_MISSING"],
  );
});

test("check reports a nonzero test command without parsing reports", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mode(root, "fail-command");
  const result = await check({ configPath: join(root, ".exevra.yml") });
  assert.equal(result.findings[0]?.code, "TEST_COMMAND_FAILED");
  assert.match(result.findings[0]?.message ?? "", /23/);
});

test("check removes a stale configured report before executing", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "artifacts"), { recursive: true });
  await writeFile(
    join(root, "artifacts", "junit.xml"),
    '<testsuite name="unit"><testcase name="stale"/></testsuite>',
  );
  await mode(root, "no-report");
  const result = await check({ configPath: join(root, ".exevra.yml") });
  assert.equal(result.findings[0]?.code, "REPORT_MISSING");
});

test("record requires overwrite permission and never records zero execution", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    record({ configPath: join(root, ".exevra.yml") }),
    /already exists/,
  );
  assert.equal(
    JSON.parse(await readFile(join(root, ".exevra", "baseline.json"), "utf8"))
      .suites[0].executed,
    10,
  );
  await mode(root, "zero");
  await assert.rejects(
    record({ configPath: join(root, ".exevra.yml"), write: true }),
    /zero executed/,
  );
  await mode(root, "reduced");
  await record({
    configPath: join(root, ".exevra.yml"),
    write: true,
    generatedAt: "2026-08-12T00:00:00.000Z",
  });
  assert.equal(
    JSON.parse(await readFile(join(root, ".exevra", "baseline.json"), "utf8"))
      .suites[0].executed,
    8,
  );
  assert.ok(
    (await readdir(join(root, ".exevra"))).every(
      (entry) => !entry.includes(".tmp-"),
    ),
  );
  await rm(join(root, ".exevra"), { recursive: true, force: true });
  await record({
    configPath: join(root, ".exevra.yml"),
    generatedAt: "2026-08-12T00:00:00.000Z",
  });
  const baseline = JSON.parse(
    await readFile(join(root, ".exevra", "baseline.json"), "utf8"),
  );
  assert.equal(baseline.suites[0].executed, 8);
});

test("check emits the watched-change finding only with an execution signal breach", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mode(root, "reduced");
  const result = await check({
    configPath: join(root, ".exevra.yml"),
    changedPaths: ["runner-config.json"],
  });
  assert.ok(
    result.findings.some((finding) => finding.code === "SUITE_DROP_EXCEEDED"),
  );
  assert.ok(
    result.findings.some(
      (finding) => finding.code === "WATCHED_CONFIG_CHANGED_WITH_SIGNAL_DROP",
    ),
  );
});

test("record refuses symlinked baseline parents and baseline targets without touching outside files", async (t) => {
  const root = await project();
  const outside = await mkdtemp(join(tmpdir(), "exevra-outside-"));
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]),
  );
  const outsideBaseline = join(outside, "baseline.json");
  await writeFile(outsideBaseline, "outside");
  await rm(join(root, ".exevra"), { recursive: true, force: true });
  await symlink(outside, join(root, ".exevra"));
  await assert.rejects(
    record({ configPath: join(root, ".exevra.yml") }),
    RuntimeError,
  );
  assert.equal(await readFile(outsideBaseline, "utf8"), "outside");
  await rm(join(root, ".exevra"), { recursive: true, force: true });
  await mkdir(join(root, ".exevra"));
  await symlink(outsideBaseline, join(root, ".exevra", "baseline.json"));
  await assert.rejects(
    record({ configPath: join(root, ".exevra.yml"), write: true }),
    RuntimeError,
  );
  assert.equal(await readFile(outsideBaseline, "utf8"), "outside");
});

test("runtime path and cleanup guards reject escapes, directories, and report symlinks", async (t) => {
  const root = await project();
  const outside = await mkdtemp(join(tmpdir(), "exevra-outside-"));
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]),
  );
  assert.throws(() => resolveInRoot(root, "../outside.xml"), RuntimeError);
  const directoryReport = join(root, "artifacts", "junit.xml");
  await mkdir(directoryReport, { recursive: true });
  await assert.rejects(cleanReports([directoryReport]), RuntimeError);
  await rm(directoryReport, { recursive: true });
  const outsideReport = join(outside, "report.xml");
  await writeFile(outsideReport, "outside");
  await symlink(outsideReport, directoryReport);
  await assert.rejects(cleanReports([directoryReport]), RuntimeError);
  assert.equal(await readFile(outsideReport, "utf8"), "outside");
});

test("command runner uses Bash pipefail and Git rejects unsafe or unavailable refs", async () => {
  const command = await runConfiguredCommand(process.cwd(), "false | true");
  assert.equal(command.finding?.code, "TEST_COMMAND_FAILED");
  for (const ref of ["-bad", "a..b", "a^b", "a\nb"])
    assert.throws(() => validateBaseRef(ref), RuntimeError);
  await assert.rejects(
    changedFiles(process.cwd(), "not-a-real-exevra-ref"),
    RuntimeError,
  );
});
