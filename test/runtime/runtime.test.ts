import assert from "node:assert/strict";
import {
  cp,
  chmod,
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
import { JunitParseError, loadConfig } from "../../src/core/index.js";
import {
  check,
  doctor,
  diff,
  aggregate,
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
import {
  expandConfiguredReportPaths,
  loadAggregatedReports,
  loadConfiguredReports,
} from "../../src/runtime/reports.js";

const fixture = join(process.cwd(), "test", "fixtures", "project");

const project = async (prefix = "exevra-runtime-"): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await cp(fixture, root, { recursive: true });
  return root;
};

const mode = (root: string, value: string) =>
  writeFile(join(root, "runner-config.json"), JSON.stringify({ mode: value }));

const writeAggregationConfig = async (
  root: string,
  shards: readonly string[] = ["unit-jdk17", "unit-jdk21"],
) =>
  writeFile(
    join(root, ".exevra.yml"),
    `${await readFile(join(root, ".exevra.yml"), "utf8")}
aggregation:
  root: artifacts/shards
  shards:
${shards.map((shard) => `    - ${shard}`).join("\n")}
  reports:
    - target/surefire-reports/TEST-*.xml
`,
  );

const writeShardReport = async (
  root: string,
  shard: string,
  testNames: readonly string[],
  skipped = false,
) => {
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
    `<testsuite name="unit">${testNames
      .map(
        (name) =>
          `<testcase classname="unit" name="${name}">${skipped ? "<skipped/>" : ""}</testcase>`,
      )
      .join("")}</testsuite>`,
  );
};

const writeMavenPom = async (
  root: string,
  path: string,
  body: string,
): Promise<void> => {
  const pomPath = join(root, path, "pom.xml");
  await mkdir(dirname(pomPath), { recursive: true });
  await writeFile(
    pomPath,
    `<project xmlns="http://maven.apache.org/POM/4.0.0">${body}</project>`,
  );
};

const mavenConfig = () =>
  loadConfig({
    version: 1,
    baseline: ".exevra/baseline.json",
    command: "mvn verify",
    reports: [
      "target/surefire-reports/TEST-*.xml",
      "target/failsafe-reports/TEST-*.xml",
    ],
    maven: { modules: "auto" },
    policy: { default: { min_executed: 1, max_drop_percent: 0 } },
  });

const writeMavenFilterConfig = async (
  root: string,
  filterPolicy: "off" | "warn" | "enforce",
  command: string,
  reports = ["target/surefire-reports/TEST-*.xml"],
) =>
  writeFile(
    join(root, ".exevra.yml"),
    JSON.stringify({
      version: 1,
      baseline: ".exevra/baseline.json",
      command,
      reports,
      maven: { modules: "auto", filter_policy: filterPolicy },
      policy: { default: { min_executed: 1, max_drop_percent: 0 } },
    }),
  );

const mavenFilterCommand = (sentinel: string): string =>
  `node -e "require('node:fs').writeFileSync('${sentinel}', 'ran')" && node tools/fake-junit-command.mjs target/surefire-reports/TEST-unit.xml -Dtest=SecretTest`;

test("aggregate combines shards without running or cleaning configured command reports", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await record({ configPath: join(root, ".exevra.yml"), write: true });
  await writeAggregationConfig(root);
  await writeFile(
    join(root, ".exevra.yml"),
    (await readFile(join(root, ".exevra.yml"), "utf8")).replace(
      "command: node tools/fake-junit-command.mjs artifacts/junit.xml",
      "command: node -e \"require('node:fs').writeFileSync('command-invoked', 'yes')\"",
    ),
  );
  await writeFile(join(root, "artifacts", "junit.xml"), "keep");
  await writeShardReport(root, "unit-jdk17", ["test-1", "test-2", "test-3", "test-4", "test-5"]);
  await writeShardReport(root, "unit-jdk21", ["test-6", "test-7", "test-8", "test-9", "test-10"]);

  const result = await aggregate({ configPath: join(root, ".exevra.yml") });

  assert.deepEqual(result.findings, []);
  assert.equal(result.suites[0]?.executed, 10);
  assert.equal(await readFile(join(root, "artifacts", "junit.xml"), "utf8"), "keep");
  await assert.rejects(readFile(join(root, "command-invoked"), "utf8"), {
    code: "ENOENT",
  });
  assert.deepEqual(result.notices, [
    "Changed-file comparison is unavailable for aggregate checks.",
  ]);
});

test("aggregate returns collection findings before evaluation", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeAggregationConfig(root, ["unit-empty", "unit-missing"]);
  await writeShardReport(root, "unit-empty", ["skipped"], true);

  const result = await aggregate({ configPath: join(root, ".exevra.yml") });

  assert.deepEqual(
    result.findings.map((finding) => finding.code),
    ["SHARD_MISSING", "SHARD_NO_TESTS_EXECUTED"],
  );
  assert.equal(result.suites[0]?.skipped, 1);
  assert.deepEqual(result.identityDiffs, []);
});

test("aggregate reports a missing shard report pattern", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeAggregationConfig(root, ["unit-empty"]);
  await mkdir(join(root, "artifacts", "shards", "unit-empty"), {
    recursive: true,
  });

  const result = await aggregate({ configPath: join(root, ".exevra.yml") });

  assert.deepEqual(result.findings.map((finding) => finding.code), [
    "REPORT_MISSING",
  ]);
  assert.match(result.findings[0]!.message, /unit-empty\/target\/surefire-reports/);
});

test("aggregate passes combined observations to suite-drop and identity evaluation", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await record({ configPath: join(root, ".exevra.yml"), write: true });
  await writeAggregationConfig(root);
  await writeShardReport(root, "unit-jdk17", ["test-1", "test-2", "test-3", "test-4", "test-5"]);
  await writeShardReport(root, "unit-jdk21", ["test-6", "test-7", "test-8", "renamed-test"]);

  const result = await aggregate({ configPath: join(root, ".exevra.yml") });

  assert.ok(result.findings.some((finding) => finding.code === "TEST_IDENTITIES_CHANGED"));
  assert.ok(result.findings.some((finding) => finding.code === "SUITE_DROP_EXCEEDED"));
});

test("aggregate requires an aggregation configuration", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    aggregate({ configPath: join(root, ".exevra.yml") }),
    /aggregation configuration is required/,
  );
});

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

test("loadConfiguredReports collects either standard report family per Maven module", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeMavenPom(
    root,
    ".",
    "<packaging>pom</packaging><modules><module>service</module><module>integration</module></modules>",
  );
  await writeMavenPom(root, "service", "<packaging>jar</packaging>");
  await writeMavenPom(root, "integration", "<packaging>jar</packaging>");
  const surefire = join(
    root,
    "service",
    "target",
    "surefire-reports",
    "TEST-service.xml",
  );
  const failsafe = join(
    root,
    "integration",
    "target",
    "failsafe-reports",
    "TEST-integration.xml",
  );
  await mkdir(dirname(surefire), { recursive: true });
  await mkdir(dirname(failsafe), { recursive: true });
  await writeFile(surefire, '<testsuite name="service"><testcase name="unit"/></testsuite>');
  await writeFile(failsafe, '<testsuite name="integration"><testcase name="smoke"/></testsuite>');

  const result = await loadConfiguredReports(root, mavenConfig());

  assert.deepEqual(result.missingReports, []);
  assert.deepEqual(result.unreadableReports, []);
  assert.deepEqual(result.suites.map((suite) => suite.name), ["integration", "service"]);
  assert.deepEqual(
    result.reportPaths.map((path) => relative(root, path)),
    [
      "integration/target/failsafe-reports/TEST-integration.xml",
      "service/target/surefire-reports/TEST-service.xml",
    ],
  );
});

test("loadConfiguredReports reports a Maven module with neither report family", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeMavenPom(
    root,
    ".",
    "<packaging>pom</packaging><modules><module>service</module></modules>",
  );
  await writeMavenPom(root, "service", "<packaging>jar</packaging>");
  await mkdir(join(root, "service", "src", "test", "java"), {
    recursive: true,
  });
  await writeFile(
    join(root, "service", "src", "test", "java", "ServiceTest.java"),
    "class ServiceTest {}",
  );

  const result = await loadConfiguredReports(root, mavenConfig());

  assert.deepEqual(result.suites, []);
  assert.deepEqual(result.unreadableReports, []);
  assert.deepEqual(result.missingReports, [
    "service/target/failsafe-reports/TEST-*.xml or service/target/surefire-reports/TEST-*.xml",
  ]);
});

test("loadConfiguredReports ignores Maven modules without test sources", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeMavenPom(
    root,
    ".",
    "<packaging>pom</packaging><modules><module>build-parent</module></modules>",
  );
  await writeMavenPom(root, "build-parent", "<packaging>jar</packaging>");

  const result = await loadConfiguredReports(root, mavenConfig());

  assert.deepEqual(result.suites, []);
  assert.deepEqual(result.missingReports, []);
  assert.deepEqual(result.unreadableReports, []);
});

test("loadConfiguredReports requires reports for compiled custom Maven test sources", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeMavenPom(
    root,
    ".",
    "<packaging>pom</packaging><modules><module>service</module></modules>",
  );
  await writeMavenPom(
    root,
    "service",
    "<packaging>jar</packaging><build><testOutputDirectory>target/custom-test-classes</testOutputDirectory></build>",
  );

  const result = await loadConfiguredReports(root, mavenConfig());

  assert.deepEqual(result.missingReports, [
    "service/target/failsafe-reports/TEST-*.xml or service/target/surefire-reports/TEST-*.xml",
  ]);
});

test("loadConfiguredReports ignores stale compiled Maven test classes", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeMavenPom(
    root,
    ".",
    "<packaging>pom</packaging><modules><module>service</module></modules>",
  );
  await writeMavenPom(root, "service", "<packaging>jar</packaging>");
  const classDirectory = join(
    root,
    "service",
    "target",
    "test-classes",
    "com",
    "example",
  );
  await mkdir(classDirectory, {
    recursive: true,
  });
  await writeFile(
    join(classDirectory, "OldTest.class"),
    "stale",
  );

  const result = await loadConfiguredReports(
    root,
    mavenConfig(),
    Date.now() + 1,
  );

  assert.deepEqual(result.missingReports, []);
});

test("loadConfiguredReports reports unreadable Maven report files", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeMavenPom(
    root,
    ".",
    "<packaging>pom</packaging><modules><module>service</module></modules>",
  );
  await writeMavenPom(root, "service", "<packaging>jar</packaging>");
  const report = join(
    root,
    "service",
    "target",
    "surefire-reports",
    "TEST-service.xml",
  );
  await mkdir(dirname(report), { recursive: true });
  await writeFile(report, '<testsuite name="service"><testcase name="unit"/></testsuite>');
  await chmod(report, 0o000);
  try {
    const result = await loadConfiguredReports(root, mavenConfig());
    assert.deepEqual(result.missingReports, []);
    assert.deepEqual(result.unreadableReports, [
      "service/target/surefire-reports/TEST-service.xml",
    ]);
  } finally {
    await chmod(report, 0o600);
  }
});

test("loadConfiguredReports rejects symlinked Maven report files", async (t) => {
  const root = await project();
  const outside = await mkdtemp(join(tmpdir(), "exevra-runtime-outside-"));
  t.after(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  });
  await writeMavenPom(
    root,
    ".",
    "<packaging>pom</packaging><modules><module>service</module></modules>",
  );
  await writeMavenPom(root, "service", "<packaging>jar</packaging>");
  const target = join(outside, "TEST-service.xml");
  await writeFile(target, '<testsuite name="service"><testcase name="unit"/></testsuite>');
  const report = join(
    root,
    "service",
    "target",
    "surefire-reports",
    "TEST-service.xml",
  );
  await mkdir(dirname(report), { recursive: true });
  await symlink(target, report);

  await assert.rejects(
    loadConfiguredReports(root, mavenConfig()),
    (error: unknown) =>
      error instanceof RuntimeError &&
      error.message ===
        "configured report path is a symlink and will not be read: service/target/surefire-reports/TEST-service.xml",
  );
});

test("loadConfiguredReports preserves malformed Maven JUnit errors", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeMavenPom(
    root,
    ".",
    "<packaging>pom</packaging><modules><module>service</module></modules>",
  );
  await writeMavenPom(root, "service", "<packaging>jar</packaging>");
  const report = join(
    root,
    "service",
    "target",
    "failsafe-reports",
    "TEST-service.xml",
  );
  await mkdir(dirname(report), { recursive: true });
  await writeFile(report, "<testsuite>");

  await assert.rejects(
    loadConfiguredReports(root, mavenConfig()),
    (error: unknown) => error instanceof JunitParseError,
  );
});

test("expandConfiguredReportPaths preserves generic report expansion", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));

  const paths = await expandConfiguredReportPaths(
    root,
    loadConfig({
      version: 1,
      baseline: ".exevra/baseline.json",
      command: "npm test",
      reports: ["artifacts/junit.xml"],
      policy: { default: { min_executed: 1, max_drop_percent: 0 } },
    }),
  );

  assert.deepEqual(paths.map((path) => relative(root, path)), ["artifacts/junit.xml"]);
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

test("check warns and continues for Maven filters, while off and non-Maven stay silent", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra"), { recursive: true, force: true });
  await writeMavenFilterConfig(root, "warn", mavenFilterCommand("warn-sentinel"));

  const warning = await check({ configPath: join(root, ".exevra.yml") });

  assert.ok(
    warning.findings.some(
      ({ code, severity }) => code === "TEST_FILTERED" && severity === "warning",
    ),
  );
  assert.equal(warning.suites[0]?.executed, 10);
  assert.equal(await readFile(join(root, "warn-sentinel"), "utf8"), "ran");
  assert.doesNotMatch(warning.findings[0]!.message, /SecretTest/);

  await rm(join(root, ".exevra"), { recursive: true, force: true });
  await writeMavenFilterConfig(root, "off", mavenFilterCommand("off-sentinel"));
  const off = await check({ configPath: join(root, ".exevra.yml") });
  assert.equal(off.findings.some(({ code }) => code === "TEST_FILTERED"), false);
  assert.equal(await readFile(join(root, "off-sentinel"), "utf8"), "ran");

  await rm(join(root, ".exevra"), { recursive: true, force: true });
  await writeFile(
    join(root, ".exevra.yml"),
    JSON.stringify({
      version: 1,
      baseline: ".exevra/baseline.json",
      command: mavenFilterCommand("generic-sentinel").replace(
        "target/surefire-reports/TEST-unit.xml",
        "artifacts/junit.xml",
      ),
      reports: ["artifacts/junit.xml"],
      policy: { default: { min_executed: 1, max_drop_percent: 0 } },
    }),
  );
  const generic = await check({ configPath: join(root, ".exevra.yml") });
  assert.equal(
    generic.findings.some(({ code }) => code === "TEST_FILTERED"),
    false,
  );
  assert.equal(await readFile(join(root, "generic-sentinel"), "utf8"), "ran");
  assert.equal(generic.suites[0]?.executed, 10);
});

test("check enforce returns before cleanup and command execution", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = join(root, "target", "surefire-reports", "TEST-stale.xml");
  await mkdir(dirname(report), { recursive: true });
  await writeFile(report, "stale");
  await writeMavenFilterConfig(root, "enforce", mavenFilterCommand("enforce-sentinel"));

  const result = await check({ configPath: join(root, ".exevra.yml") });

  assert.deepEqual(
    result.findings.map(({ code, severity }) => ({ code, severity })),
    [{ code: "TEST_FILTERED", severity: "error" }],
  );
  assert.equal(await readFile(report, "utf8"), "stale");
  await assert.rejects(readFile(join(root, "enforce-sentinel"), "utf8"), {
    code: "ENOENT",
  });
});

test("record returns Maven filter warnings with a schema-v1 baseline and enforces before execution", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra"), { recursive: true, force: true });
  await writeMavenFilterConfig(root, "warn", mavenFilterCommand("record-warn-sentinel"));

  const warning = await record({
    configPath: join(root, ".exevra.yml"),
    write: true,
  });

  assert.deepEqual(
    warning.findings.map(({ code, severity }) => ({ code, severity })),
    [{ code: "TEST_FILTERED", severity: "warning" }],
  );
  assert.equal(
    JSON.parse(
      await readFile(join(root, ".exevra", "baseline.json"), "utf8"),
    ).schemaVersion,
    1,
  );

  await rm(join(root, ".exevra"), { recursive: true, force: true });
  const report = join(root, "target", "surefire-reports", "TEST-stale.xml");
  await mkdir(dirname(report), { recursive: true });
  await writeFile(report, "stale");
  await writeMavenFilterConfig(root, "enforce", mavenFilterCommand("record-enforce-sentinel"));
  const enforced = await record({
    configPath: join(root, ".exevra.yml"),
    write: true,
  });

  assert.deepEqual(
    enforced.findings.map(({ code, severity }) => ({ code, severity })),
    [{ code: "TEST_FILTERED", severity: "error" }],
  );
  assert.equal(await readFile(report, "utf8"), "stale");
  await assert.rejects(readFile(join(root, "record-enforce-sentinel"), "utf8"), {
    code: "ENOENT",
  });
});

test("initialize emits a root-only Maven marker with the default filter policy", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra.yml"), { force: true });
  await rm(join(root, ".exevra"), { recursive: true, force: true });

  const result = await initialize({
    configPath: join(root, ".exevra.yml"),
    command: "node tools/fake-junit-command.mjs target/surefire-reports/TEST-unit.xml",
    reportPath: [
      "target/surefire-reports/TEST-*.xml",
      "target/failsafe-reports/TEST-*.xml",
    ],
    maven: true,
  });

  const source = await readFile(join(root, ".exevra.yml"), "utf8");
  assert.match(source, /maven:\n  modules: auto\n  filter_policy: warn/);
  assert.deepEqual(loadConfig(source).maven, {
    modules: "auto",
    filterPolicy: "warn",
  });
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

test("doctor reports all successful stages in a stable order", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await record({
    configPath: join(root, ".exevra.yml"),
    write: true,
    generatedAt: "2026-08-12T00:00:00.000Z",
  });
  await writeFile(
    join(root, ".exevra.yml"),
    JSON.stringify({
      version: 1,
      baseline: ".exevra/baseline.json",
      command:
        `node -e "require('node:fs').appendFileSync('command-count.txt', '1')"` +
        " && node tools/fake-junit-command.mjs artifacts/junit.xml",
      reports: ["artifacts/junit.xml"],
      watched: ["runner-config.json"],
      policy: { default: { min_executed: 1, max_drop_percent: 0 } },
    }),
  );

  const result = await doctor({ configPath: join(root, ".exevra.yml") });

  assert.deepEqual(
    result.checks.map(({ name, status }) => ({ name, status })),
    [
      { name: "configuration", status: "passed" },
      { name: "execution intent", status: "passed" },
      { name: "test command", status: "passed" },
      { name: "reports", status: "passed" },
      { name: "baseline", status: "passed" },
      { name: "evaluation", status: "passed" },
    ],
  );
  assert.deepEqual(result.findings, []);
  assert.equal(await readFile(join(root, "command-count.txt"), "utf8"), "1");
  for (const { message } of result.checks) {
    assert.doesNotMatch(message, /command-count\.txt|fake-junit-command|artifacts\/junit\.xml/);
  }
});

test("doctor preserves the existing filter preflight and skips later stages", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeMavenFilterConfig(
    root,
    "enforce",
    mavenFilterCommand("doctor-filter-sentinel"),
  );
  const result = await doctor({ configPath: join(root, ".exevra.yml") });
  assert.equal(result.checks[1]?.status, "failed");
  assert.deepEqual(
    result.checks.slice(2).map(({ status }) => status),
    ["skipped", "skipped", "skipped", "skipped"],
  );
  assert.deepEqual(
    result.findings.map(({ code, severity }) => ({ code, severity })),
    [{ code: "TEST_FILTERED", severity: "error" }],
  );
  await assert.rejects(readFile(join(root, "doctor-filter-sentinel")));
});

test("doctor reports a missing report without leaking report paths", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mode(root, "no-report");

  const checked = await check({ configPath: join(root, ".exevra.yml") });
  const result = await doctor({ configPath: join(root, ".exevra.yml") });

  assert.deepEqual(result.findings, checked.findings);
  assert.deepEqual(result.checks[3], {
    name: "reports",
    status: "failed",
    message: "Required test reports were not produced or could not be read.",
  });
  assert.equal(result.checks[4]?.status, "skipped");
  assert.equal(result.checks[5]?.status, "skipped");
  assert.doesNotMatch(
    result.checks[3]?.message ?? "",
    /artifacts\/junit\.xml/,
  );
});

test("doctor reports a missing baseline after successful report collection", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, ".exevra", "baseline.json"));

  const checked = await check({ configPath: join(root, ".exevra.yml") });
  const result = await doctor({ configPath: join(root, ".exevra.yml") });

  assert.deepEqual(result.findings, checked.findings);
  assert.deepEqual(result.checks[4], {
    name: "baseline",
    status: "failed",
    message: "No reviewed baseline is available.",
  });
  assert.equal(result.checks[5]?.status, "skipped");
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

test("diff returns baseline changes without mutating config or baseline and reuses check execution", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mode(root, "reduced");
  await writeFile(
    join(root, ".exevra.yml"),
    JSON.stringify({
      version: 1,
      baseline: ".exevra/baseline.json",
      command:
        `node -e "require('node:fs').appendFileSync('command-count.txt', '1')"` +
        " && node tools/fake-junit-command.mjs artifacts/fresh-junit.xml",
      reports: ["artifacts/fresh-junit.xml"],
      watched: ["runner-config.json"],
      policy: { default: { min_executed: 1, max_drop_percent: 0 } },
    }),
  );
  const configBefore = await readFile(join(root, ".exevra.yml"), "utf8");
  const baselineBefore = await readFile(
    join(root, ".exevra", "baseline.json"),
    "utf8",
  );

  const result = await diff({
    configPath: join(root, ".exevra.yml"),
    changedPaths: ["runner-config.json"],
  });

  assert.deepEqual(result.changes, {
    suites: [
      {
        name: "unit",
        kind: "changed",
        baseline: { executed: 10, skipped: 0 },
        current: { executed: 8, skipped: 0 },
      },
    ],
    commandChanged: true,
    reportsChanged: true,
  });
  assert.ok(
    result.findings.some((finding) => finding.code === "SUITE_DROP_EXCEEDED"),
  );
  assert.ok(
    result.findings.some(
      (finding) => finding.code === "WATCHED_CONFIG_CHANGED_WITH_SIGNAL_DROP",
    ),
  );
  assert.equal(
    await readFile(join(root, "command-count.txt"), "utf8"),
    "1",
  );
  assert.equal(await readFile(join(root, ".exevra.yml"), "utf8"), configBefore);
  assert.equal(
    await readFile(join(root, ".exevra", "baseline.json"), "utf8"),
    baselineBefore,
  );
});

test("diff omits changes for missing or unsupported baselines and missing reports", async (t) => {
  for (const setup of [
    async (root: string) => {
      await rm(join(root, ".exevra", "baseline.json"));
      return "BASELINE_MISSING";
    },
    async (root: string) => {
      await writeFile(
        join(root, ".exevra", "baseline.json"),
        JSON.stringify({ schemaVersion: 2 }),
      );
      return "BASELINE_SCHEMA_UNSUPPORTED";
    },
    async (root: string) => {
      await mode(root, "no-report");
      return "REPORT_MISSING";
    },
  ] as const) {
    const root = await project();
    t.after(() => rm(root, { recursive: true, force: true }));
    const expected = await setup(root);

    const result = await diff({ configPath: join(root, ".exevra.yml") });

    assert.equal("changes" in result, false);
    assert.ok(result.findings.some((finding) => finding.code === expected));
  }
});

test("diff applies Maven filter preflight before reading an invalid baseline", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sentinel = "diff-filter-sentinel";
  await writeMavenFilterConfig(root, "enforce", mavenFilterCommand(sentinel));
  await writeFile(join(root, ".exevra", "baseline.json"), "{not json");

  const result = await diff({ configPath: join(root, ".exevra.yml") });

  assert.ok(result.findings.some((finding) => finding.code === "TEST_FILTERED"));
  await assert.rejects(readFile(join(root, sentinel)));
});

test("diff uses the original baseline snapshot even if the command overwrites the baseline file", async (t) => {
  const root = await project();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mode(root, "reduced");
  await writeFile(
    join(root, ".exevra.yml"),
    JSON.stringify({
      version: 1,
      baseline: ".exevra/baseline.json",
      command:
        "node -e " +
        JSON.stringify(
          "const fs = require('node:fs');" +
            "fs.writeFileSync('.exevra/baseline.json', '{not json');",
        ) +
        " && node tools/fake-junit-command.mjs artifacts/fresh-junit.xml",
      reports: ["artifacts/fresh-junit.xml"],
      watched: ["runner-config.json"],
      policy: { default: { min_executed: 1, max_drop_percent: 0 } },
    }),
  );

  const result = await diff({ configPath: join(root, ".exevra.yml") });

  assert.deepEqual(result.changes, {
    suites: [
      {
        name: "unit",
        kind: "changed",
        baseline: { executed: 10, skipped: 0 },
        current: { executed: 8, skipped: 0 },
      },
    ],
    commandChanged: true,
    reportsChanged: true,
  });
  assert.ok(
    result.findings.some((finding) => finding.code === "SUITE_DROP_EXCEEDED"),
  );
  assert.equal(await readFile(join(root, ".exevra", "baseline.json"), "utf8"), "{not json");
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
