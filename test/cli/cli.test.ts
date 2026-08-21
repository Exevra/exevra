import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const fixture = join(process.cwd(), "test", "fixtures", "project");
const packageManifest = JSON.parse(
  await readFile(join(process.cwd(), "package.json"), "utf8"),
) as { bin: { exevra: string } };
const cli = join(process.cwd(), packageManifest.bin.exevra);

const project = async (prefix = "exevra-cli-"): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await cp(fixture, root, { recursive: true });
  return root;
};

const run = async (
  root: string,
  ...arguments_: string[]
): Promise<{ code: number; stdout: string; stderr: string }> => {
  try {
    const result = await execute(process.execPath, [cli, ...arguments_], {
      cwd: root,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as Error & {
      code: number;
      stdout: string;
      stderr: string;
    };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
};

test("compiled CLI initializes config and baseline once", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra.yml"), { force: true });
  await rm(join(root, ".exevra"), { recursive: true, force: true });

  const initialized = await run(
    root,
    "init",
    "--command",
    "node tools/fake-junit-command.mjs artifacts/junit.xml",
    "--report",
    "artifacts/junit.xml",
  );
  assert.equal(initialized.code, 0);
  assert.equal(
    initialized.stdout,
    "Created config: .exevra.yml\n" +
      "Created baseline: .exevra/baseline.json\n" +
      "Next: exevra check --config .exevra.yml\n",
  );
  const originalConfig = await readFile(join(root, ".exevra.yml"), "utf8");
  await readFile(join(root, ".exevra", "baseline.json"), "utf8");

  const repeated = await run(
    root,
    "init",
    "--command",
    "node tools/fake-junit-command.mjs artifacts/junit.xml",
    "--report",
    "artifacts/junit.xml",
  );
  assert.equal(repeated.code, 2);
  assert.match(repeated.stderr, /configuration already exists/);
  assert.equal(
    await readFile(join(root, ".exevra.yml"), "utf8"),
    originalConfig,
  );
});

test("compiled CLI reports a custom-config baseline path", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra.yml"), { force: true });
  await rm(join(root, ".exevra"), { recursive: true, force: true });
  await mkdir(join(root, "config"), { recursive: true });

  const initialized = await run(
    root,
    "init",
    "--config",
    "config/.exevra.yml",
    "--command",
    "cd .. && node tools/fake-junit-command.mjs config/artifacts/junit.xml",
    "--report",
    "artifacts/junit.xml",
  );

  assert.equal(initialized.code, 0);
  assert.equal(
    initialized.stdout,
    "Created config: config/.exevra.yml\n" +
      "Created baseline: config/.exevra/baseline.json\n" +
      "Next: exevra check --config config/.exevra.yml\n",
  );
});

test("compiled CLI rejects every reserved init path collision without JUnit output", async (t) => {
  const collisions = [
    { configPath: ".exevra.yml", reportPath: ".exevra.yml" },
    { configPath: ".exevra.yml", reportPath: ".EXEVRA.YML" },
    { configPath: ".caf\u00e9.yml", reportPath: ".cafe\u0301.yml" },
    {
      configPath: ".exevra.yml",
      reportPath: ".exevra.yml/report.xml",
    },
    { configPath: ".exevra.yml", reportPath: ".exevra" },
    {
      configPath: ".exevra.yml",
      reportPath: ".exevra/baseline.json",
    },
    {
      configPath: ".exevra.yml",
      reportPath: ".exevra/baseline.json/report.xml",
    },
    {
      configPath: ".exevra/baseline.json",
      reportPath: "artifacts/junit.xml",
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
        const initialized = await run(
          root,
          "init",
          "--config",
          collision.configPath,
          "--command",
          command,
          "--report",
          collision.reportPath,
        );

        assert.equal(initialized.code, 2);
        assert.match(initialized.stderr, /^Operational error:/);
        assert.doesNotMatch(initialized.stderr, /<testsuite|SECRET_TOKEN_ABC/);
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

test("compiled CLI rejects non-ASCII init role paths before creating files", async (t) => {
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
        const initialized = await run(
          root,
          "init",
          "--config",
          testCase.configPath,
          "--command",
          command,
          "--report",
          testCase.reportPath,
        );

        assert.equal(initialized.code, 2);
        assert.equal(
          initialized.stderr,
          `Operational error: initialization ${testCase.role} path must use ASCII characters only\n`,
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

test("compiled CLI allows ASCII role paths inside a non-ASCII workspace root", async (t) => {
  const root = await project("ex\u00e9vra-cli-");
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra.yml"), { force: true });
  await rm(join(root, ".exevra"), { recursive: true, force: true });

  const initialized = await run(
    root,
    "init",
    "--command",
    "node tools/fake-junit-command.mjs artifacts/junit.xml",
    "--report",
    "artifacts/junit.xml",
  );

  assert.equal(initialized.code, 0);
  await readFile(join(root, ".exevra.yml"), "utf8");
  await readFile(join(root, ".exevra", "baseline.json"), "utf8");
});

test("compiled CLI accepts a report path whose prefix only resembles the config role", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra.yml"), { force: true });
  await rm(join(root, ".exevra"), { recursive: true, force: true });

  const initialized = await run(
    root,
    "init",
    "--command",
    "node tools/fake-junit-command.mjs .exevra.yml-not-a-role",
    "--report",
    ".exevra.yml-not-a-role",
  );

  assert.equal(initialized.code, 0);
  assert.equal(
    initialized.stdout,
    "Created config: .exevra.yml\n" +
      "Created baseline: .exevra/baseline.json\n" +
      "Next: exevra check --config .exevra.yml\n",
  );
  assert.match(
    await readFile(join(root, ".exevra.yml"), "utf8"),
    /\.exevra\.yml-not-a-role/,
  );
  assert.match(
    await readFile(join(root, ".exevra.yml-not-a-role"), "utf8"),
    /<testsuite/,
  );
  await readFile(join(root, ".exevra", "baseline.json"), "utf8");
});

test("compiled CLI normalizes every first-record failure as an operational error", async (t) => {
  for (const failureMode of [
    "fail-command",
    "no-report",
    "invalid-report",
    "zero",
  ]) {
    await t.test(failureMode, async (t) => {
      const root = await project();
      t.after(() => rm(root, { recursive: true, force: true }));
      await rm(join(root, ".exevra.yml"), { force: true });
      await rm(join(root, ".exevra"), { recursive: true, force: true });
      await writeFile(
        join(root, "runner-config.json"),
        JSON.stringify({ mode: failureMode }),
      );

      const initialized = await run(
        root,
        "init",
        "--command",
        "node tools/fake-junit-command.mjs artifacts/junit.xml",
        "--report",
        "artifacts/junit.xml",
      );

      assert.equal(initialized.code, 2);
      assert.match(initialized.stderr, /^Operational error:/);
      if (failureMode === "invalid-report") {
        assert.match(initialized.stderr, /REPORT_INVALID/);
        assert.doesNotMatch(initialized.stderr, /SECRET_TOKEN_ABC/);
      }
      await readFile(join(root, ".exevra.yml"), "utf8");
      await assert.rejects(
        readFile(join(root, ".exevra", "baseline.json"), "utf8"),
        { code: "ENOENT" },
      );
    });
  }
});

test("compiled CLI rejects invalid init invocations", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const arguments_ of [
    ["init"],
    ["init", "--command", "value"],
    ["init", "--report", "artifacts/junit.xml"],
    ["init", "--command", "value", "--command", "value"],
    [
      "init",
      "--report",
      "artifacts/junit.xml",
      "--report",
      "artifacts/junit.xml",
    ],
    ["init", "--write"],
  ]) {
    const result = await run(root, ...arguments_);
    assert.equal(result.code, 2, arguments_.join(" "));
    assert.match(result.stderr, /Invalid invocation/);
  }
});

test("compiled CLI records a baseline only with explicit overwrite permission", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra"), { recursive: true, force: true });
  assert.equal((await run(root, "record", "--config", ".exevra.yml")).code, 0);
  const refused = await run(root, "record", "--config", ".exevra.yml");
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /already exists/);
  assert.equal(
    (await run(root, "record", "--config", ".exevra.yml", "--write")).code,
    0,
  );
});

test("compiled CLI treats record command and report failures as operational errors", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra"), { recursive: true, force: true });
  await writeFile(
    join(root, "runner-config.json"),
    JSON.stringify({ mode: "fail-command" }),
  );
  assert.equal((await run(root, "record")).code, 2);
  await writeFile(
    join(root, "runner-config.json"),
    JSON.stringify({ mode: "no-report" }),
  );
  assert.equal((await run(root, "record")).code, 2);
});

test("compiled CLI reports pass, enforcement, advisory, and output formats", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const pass = await run(root, "check");
  assert.equal(pass.code, 0);
  assert.match(pass.stdout, /^EXEVRA PASSED WITH WARNINGS/m);

  await writeFile(
    join(root, "runner-config.json"),
    JSON.stringify({ mode: "zero" }),
  );
  const blocked = await run(root, "check");
  assert.equal(blocked.code, 1);
  assert.match(blocked.stdout, /^EXEVRA BLOCKED/m);
  assert.match(blocked.stdout, /unit: 10 -> 0/);

  const advisory = await run(
    root,
    "check",
    "--config",
    ".exevra.yml",
    "--mode",
    "advisory",
  );
  assert.equal(advisory.code, 0);
  assert.match(advisory.stdout, /^EXEVRA BLOCKED/m);

  const json = await run(
    root,
    "check",
    "--config",
    ".exevra.yml",
    "--format",
    "json",
  );
  assert.equal(json.code, 1);
  assert.equal(JSON.parse(json.stdout).outcome, "blocked");
  assert.doesNotMatch(json.stdout, /test-1/);

  const githubActions = await run(
    root,
    "check",
    "--config",
    ".exevra.yml",
    "--format",
    "github-actions",
  );
  assert.equal(githubActions.code, 1);
  assert.match(
    githubActions.stdout,
    /::error title=EXEVRA NO_TESTS_EXECUTED::/,
  );
  assert.match(githubActions.stdout, /unit: 10 -> 0/);
});

test("compiled CLI keeps warning identity drift advisory but enforces identity policy", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const baseline = await run(root, "record", "--write");
  assert.equal(baseline.code, 0);
  await writeFile(
    join(root, "runner-config.json"),
    JSON.stringify({ mode: "identity-shift" }),
  );

  const warning = await run(root, "check");
  assert.equal(warning.code, 0);
  assert.match(warning.stdout, /^EXEVRA PASSED WITH WARNINGS/m);
  assert.match(warning.stdout, /TEST_IDENTITIES_CHANGED/);
  assert.doesNotMatch(warning.stdout, /test-10|renamed-test/);

  const config = join(root, "identity-enforce.yml");
  await writeFile(
    config,
    (await readFile(join(root, ".exevra.yml"), "utf8")).replace(
      "max_drop_percent: 0",
      "max_drop_percent: 0\n    identity: enforce",
    ),
  );
  const enforced = await run(root, "check", "--config", config);
  assert.equal(enforced.code, 1);
  assert.match(enforced.stdout, /^EXEVRA BLOCKED/m);
});

test("compiled CLI renders opted-in identity names only in text format", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const namesConfig = join(root, "identity-names.yml");
  await writeFile(
    namesConfig,
    (await readFile(join(root, ".exevra.yml"), "utf8")).replace(
      "max_drop_percent: 0",
      "max_drop_percent: 0\n    identity_details: names",
    ),
  );
  assert.equal(
    (await run(root, "record", "--config", namesConfig, "--write")).code,
    0,
  );
  await writeFile(
    join(root, "runner-config.json"),
    JSON.stringify({ mode: "identity-shift" }),
  );

  const text = await run(root, "check", "--config", namesConfig);
  assert.equal(text.code, 0);
  assert.match(text.stdout, /"unit\\u001ftest-10"/);
  assert.match(text.stdout, /"unit\\u001frenamed-test"/);

  const json = await run(
    root,
    "check",
    "--config",
    namesConfig,
    "--format",
    "json",
  );
  assert.equal(json.code, 0);
  assert.deepEqual(
    [
      JSON.parse(json.stdout).findings[0]?.missingTestCount,
      JSON.parse(json.stdout).findings[0]?.addedTestCount,
    ],
    [1, 1],
  );
  assert.doesNotMatch(json.stdout, /test-10|renamed-test/);

  const githubActions = await run(
    root,
    "check",
    "--config",
    namesConfig,
    "--format",
    "github-actions",
  );
  assert.equal(githubActions.code, 0);
  assert.doesNotMatch(githubActions.stdout, /test-10|renamed-test/);
});

test("compiled CLI rejects invalid invocations and operational failures with exit 2", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const invalid = await run(root, "check", "--mode", "invalid");
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /Invalid invocation/);
  const missing = await run(root, "check", "--config", "missing.yml");
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /Operational error/);
});

test("compiled CLI rejects duplicate and incomplete options", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const arguments_ of [
    ["record", "--config", ".exevra.yml", "--config", ".exevra.yml"],
    ["record", "--write", "--write"],
    ["record", "--config"],
    ["check", "--config"],
    ["check", "--base-ref"],
    ["check", "--mode"],
    ["check", "--format"],
  ]) {
    const result = await run(root, ...arguments_);
    assert.equal(result.code, 2, arguments_.join(" "));
    assert.match(result.stderr, /Invalid invocation/);
  }
});

test("compiled CLI forwards a valid base ref to runtime comparison", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await execute("git", ["init", "--quiet"], { cwd: root });
  await execute("git", ["config", "user.email", "test@example.invalid"], {
    cwd: root,
  });
  await execute("git", ["config", "user.name", "Exevra Test"], { cwd: root });
  await execute("git", ["add", "."], { cwd: root });
  await execute("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
  const result = await run(root, "check", "--base-ref", "HEAD");
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^EXEVRA PASSED WITH WARNINGS/m);
  assert.doesNotMatch(result.stdout, /Changed-file comparison is unavailable/);
});
