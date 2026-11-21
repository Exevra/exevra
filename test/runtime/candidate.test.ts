import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import test from "node:test";
import { record } from "../../src/runtime/record.js";
import { proposeBaseline, acceptBaseline } from "../../src/runtime/candidate.js";

test("candidate review records once and rejects stale or changed candidates", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-candidate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, ".exevra.yml");
  const runCounter = `${root}-runs`;
  t.after(() => rm(runCounter, { force: true }));
  await writeFile(configPath, JSON.stringify({ version: 1, baseline: "baseline.json", command: "node runner.mjs", reports: ["report.xml"], policy: { default: { min_executed: 1, max_drop_percent: 0 } } }));
  await writeFile(join(root, "runner.mjs"), `import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(runCounter)}, '1');
mkdirSync('node_modules/.vite', { recursive: true });
appendFileSync('node_modules/.vite/cache', '1');
writeFileSync('report.xml', '<testsuite name="unit"><testcase name="one"/>' + (existsSync('more') ? '<testcase name="two"/>' : '') + '</testsuite>');`);
  await record({ configPath });
  const previous = await readFile(join(root, "baseline.json"), "utf8");
  await writeFile(join(root, "more"), "");
  await writeFile(join(root, ".gitignore"), "ignored-test.txt\n");
  await writeFile(join(root, "ignored-test.txt"), "original");
  await symlink("runner.mjs", join(root, "runner-link.mjs"));
  const candidate = await proposeBaseline({ configPath });
  assert.equal(candidate.changes.suites[0]?.current?.executed, 2);
  assert.ok(candidate.findings.some((finding) => finding.code === "TEST_IDENTITIES_CHANGED"));
  assert.equal(await readFile(join(root, "baseline.json"), "utf8"), previous);
  await assert.rejects(acceptBaseline({ configPath, fingerprint: "0".repeat(64) }), /fingerprint/);
  await writeFile(configPath, (await readFile(configPath, "utf8")) + "\n");
  await assert.rejects(acceptBaseline({ configPath, fingerprint: candidate.fingerprint }), /configuration.*changed/);
  await writeFile(configPath, (await readFile(configPath, "utf8")).trimEnd());
  await writeFile(join(root, "baseline.json"), previous + " ");
  await assert.rejects(acceptBaseline({ configPath, fingerprint: candidate.fingerprint }), /baseline changed/);
  await writeFile(join(root, "baseline.json"), previous);
  const candidatePath = join(root, "baseline.json.candidate");
  const contents = await readFile(candidatePath, "utf8");
  await writeFile(candidatePath, contents + " ");
  await assert.rejects(acceptBaseline({ configPath, fingerprint: candidate.fingerprint }), /fingerprint/);
  await writeFile(candidatePath, contents);
  await assert.rejects(proposeBaseline({ configPath }), /candidate already exists/);
  const runner = await readFile(join(root, "runner.mjs"), "utf8");
  await writeFile(join(root, "runner.mjs"), runner + "\n// changed");
  await assert.rejects(acceptBaseline({ configPath, fingerprint: candidate.fingerprint }), /project files changed/);
  await writeFile(join(root, "runner.mjs"), runner);
  await writeFile(join(root, "new-test.mjs"), "new test");
  await assert.rejects(acceptBaseline({ configPath, fingerprint: candidate.fingerprint }), /project files changed/);
  await rm(join(root, "new-test.mjs"));
  await writeFile(join(root, "ignored-test.txt"), "changed");
  await assert.rejects(acceptBaseline({ configPath, fingerprint: candidate.fingerprint }), /project files changed/);
  await writeFile(join(root, "ignored-test.txt"), "original");
  await acceptBaseline({ configPath, fingerprint: candidate.fingerprint });
  assert.equal(JSON.parse(await readFile(join(root, "baseline.json"), "utf8")).suites[0].executed, 2);
  assert.equal(await readFile(runCounter, "utf8"), "11");
});

test("proposal tracks files reached through an external symlink", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-candidate-external-"));
  const outside = await mkdtemp(join(tmpdir(), "exevra-candidate-outside-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  const configPath = join(root, ".exevra.yml");
  await writeFile(configPath, JSON.stringify({ version: 1, baseline: "baseline.json", command: "node runner.mjs", reports: ["report.xml"], policy: { default: { min_executed: 1, max_drop_percent: 0 } } }));
  await writeFile(join(root, "runner.mjs"), `import { writeFileSync } from 'node:fs'; writeFileSync('report.xml', '<testsuite name="unit"><testcase name="one"/></testsuite>');`);
  await record({ configPath });
  await writeFile(join(outside, "tests.mjs"), "test");
  await mkdir(join(root, ".venv", "bin"), { recursive: true });
  await symlink(join(outside, "tests.mjs"), join(root, ".venv", "bin", "python3"));
  const candidate = await proposeBaseline({ configPath });
  await writeFile(join(outside, "tests.mjs"), "changed");
  await assert.rejects(acceptBaseline({ configPath, fingerprint: candidate.fingerprint }), /project files changed/);
});

test("proposal rejects source files changed during the test command", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-during-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, ".exevra.yml");
  await writeFile(configPath, JSON.stringify({ version: 1, baseline: "baseline.json", command: "node runner.mjs", reports: ["report.xml"], policy: { default: { min_executed: 1, max_drop_percent: 0 } } }));
  await writeFile(join(root, "test-source"), "old");
  await writeFile(join(root, "runner.mjs"), `import { existsSync, writeFileSync } from 'node:fs'; writeFileSync('report.xml', '<testsuite name="unit"><testcase name="one"/></testsuite>'); if (existsSync('change')) writeFileSync('test-source', 'new');`);
  await record({ configPath });
  await writeFile(join(root, "change"), "");
  await assert.rejects(proposeBaseline({ configPath }), /project files changed during/);
  await assert.rejects(readFile(join(root, "baseline.json.candidate")));
});

test("explicit generated directories do not hide source changes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-generated-output-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, ".exevra.yml");
  await writeFile(configPath, JSON.stringify({ version: 1, baseline: "baseline.json", command: "node runner.mjs", reports: ["report.xml"], policy: { default: { min_executed: 1, max_drop_percent: 0 } } }));
  await writeFile(join(root, "source.test"), "original");
  await writeFile(join(root, "runner.mjs"), `import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'; mkdirSync('build/generated', {recursive:true}); appendFileSync('build/generated/state', '1'); writeFileSync('report.xml', '<testsuite name="unit"><testcase name="one"/></testsuite>'); if(existsSync('mutate')) writeFileSync('source.test', 'changed');`);
  await record({ configPath });
  await assert.rejects(proposeBaseline({ configPath }), /project files changed during/);
  const proposal = await proposeBaseline({ configPath, excludeGenerated: ["build/generated"] });
  await writeFile(join(root, "source.test"), "edited after review");
  await assert.rejects(acceptBaseline({ configPath, fingerprint: proposal.fingerprint }), /project files changed/);
  await writeFile(join(root, "source.test"), "original");
  await writeFile(join(root, "build/generated/state"), "changed output");
  await acceptBaseline({ configPath, fingerprint: proposal.fingerprint });
});

test("generated exclusions also cover directory symlink aliases", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-generated-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, ".exevra.yml");
  await writeFile(configPath, JSON.stringify({ version: 1, baseline: "baseline.json", command: "node runner.mjs", reports: ["report.xml"], policy: { default: { min_executed: 1, max_drop_percent: 0 } } }));
  await writeFile(join(root, "runner.mjs"), `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'; mkdirSync('build/generated/nested', {recursive:true}); appendFileSync('build/generated/nested/state', '1'); writeFileSync('report.xml', '<testsuite name="unit"><testcase name="one"/></testsuite>');`);
  await record({ configPath });
  await symlink("build/generated", join(root, "alias"));
  await symlink("build/generated/nested", join(root, "nested-alias"));
  const proposal = await proposeBaseline({ configPath, excludeGenerated: ["build/generated"] });
  const runner = await readFile(join(root, "runner.mjs"), "utf8");
  await writeFile(join(root, "runner.mjs"), "changed source");
  await assert.rejects(acceptBaseline({ configPath, fingerprint: proposal.fingerprint }), /project files changed/);
  await writeFile(join(root, "runner.mjs"), runner);
  await acceptBaseline({ configPath, fingerprint: proposal.fingerprint });
});

test("generated exclusions resolve case aliases on case-insensitive filesystems", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-generated-case-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "Build", "Generated"), { recursive: true });
  await writeFile(join(root, "Build", "Generated", "probe"), "x");
  try { await readFile(join(root, "build", "generated", "probe")); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return t.skip("filesystem is case-sensitive");
    throw error;
  }
  const configPath = join(root, ".exevra.yml");
  await writeFile(configPath, JSON.stringify({ version: 1, baseline: "baseline.json", command: "node runner.mjs", reports: ["report.xml"], policy: { default: { min_executed: 1, max_drop_percent: 0 } } }));
  await writeFile(join(root, "runner.mjs"), `import { appendFileSync, writeFileSync } from 'node:fs'; appendFileSync('Build/Generated/state', '1'); writeFileSync('report.xml', '<testsuite name="unit"><testcase name="one"/></testsuite>');`);
  await record({ configPath });
  const proposal = await proposeBaseline({ configPath, excludeGenerated: ["build/generated"] });
  await acceptBaseline({ configPath, fingerprint: proposal.fingerprint });
  await mkdir(join(root, ".Exevra"));
  await writeFile(configPath, JSON.stringify({ version: 1, baseline: ".Exevra/baseline.json", command: "true", reports: ["report.xml"], policy: { default: { min_executed: 1, max_drop_percent: 0 } } }));
  await assert.rejects(proposeBaseline({ configPath, excludeGenerated: [".exevra"] }), /cannot contain/);
});

test("generated exclusions do not merge distinct directories on case-sensitive filesystems", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-generated-distinct-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "Build"));
  try { await mkdir(join(root, "build")); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return t.skip("filesystem is case-insensitive");
    throw error;
  }
  await mkdir(join(root, "Build", "Generated"));
  await mkdir(join(root, "build", "generated"));
  const configPath = join(root, ".exevra.yml");
  await writeFile(configPath, JSON.stringify({ version: 1, baseline: "baseline.json", command: "node runner.mjs", reports: ["report.xml"], policy: { default: { min_executed: 1, max_drop_percent: 0 } } }));
  await writeFile(join(root, "runner.mjs"), `import { appendFileSync, writeFileSync } from 'node:fs'; appendFileSync('Build/Generated/source', '1'); writeFileSync('report.xml', '<testsuite name="unit"><testcase name="one"/></testsuite>');`);
  await record({ configPath });
  await assert.rejects(proposeBaseline({ configPath, excludeGenerated: ["build/generated"] }), /project files changed during/);
});

test("generated exclusions reject escapes and protected files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-generated-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, ".exevra.yml");
  await writeFile(configPath, JSON.stringify({ version: 1, baseline: ".exevra/baseline.json", command: "true", reports: ["report.xml"], policy: { default: { min_executed: 1, max_drop_percent: 0 } } }));
  await assert.rejects(proposeBaseline({ configPath, excludeGenerated: ["../outside"] }), /relative directory/);
  await assert.rejects(proposeBaseline({ configPath, excludeGenerated: [".exevra"] }), /cannot contain/);
  await assert.rejects(proposeBaseline({ configPath, excludeGenerated: ["."] }), /escapes/);
});

test("redirected proposal output can be reviewed and accepted", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-review-output-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, ".exevra.yml");
  await writeFile(configPath, JSON.stringify({ version: 1, baseline: "baseline.json", command: "node runner.mjs", reports: ["report.xml"], policy: { default: { min_executed: 1, max_drop_percent: 0 } } }));
  await writeFile(join(root, "runner.mjs"), `import { writeFileSync } from 'node:fs'; writeFileSync('report.xml', '<testsuite name="unit"><testcase name="one"/></testsuite>');`);
  await record({ configPath });
  const cli = join(process.cwd(), "build/src/cli/index.js");
  const output = openSync(join(root, "review.txt"), "w");
  const proposed = spawnSync(process.execPath, [cli, "propose"], { cwd: root, stdio: ["ignore", output, "pipe"], encoding: "utf8" });
  closeSync(output);
  assert.equal(proposed.status, 0, proposed.stderr);
  const fingerprint = /Candidate fingerprint: ([0-9a-f]{64})/.exec(await readFile(join(root, "review.txt"), "utf8"))?.[1];
  assert.ok(fingerprint);
  const accepted = spawnSync(process.execPath, [cli, "accept", "--fingerprint", fingerprint], { cwd: root, encoding: "utf8" });
  assert.equal(accepted.status, 0, accepted.stderr);
});

test("CLI proposes and accepts the exact reviewed candidate", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-candidate-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, ".exevra.yml");
  await writeFile(configPath, JSON.stringify({ version: 1, baseline: "baseline.json", command: "node runner.mjs", reports: ["report.xml"], policy: { default: { min_executed: 1, max_drop_percent: 0 } } }));
  await writeFile(join(root, "runner.mjs"), `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'; mkdirSync('build/generated', {recursive:true}); appendFileSync('build/generated/state', '1'); writeFileSync('report.xml', '<testsuite name="unit"><testcase name="one"/></testsuite>');`);
  await record({ configPath });
  const cli = join(process.cwd(), "build/src/cli/index.js");
  const proposal = spawnSync(process.execPath, [cli, "propose", "--exclude-generated", "build/generated", "--exclude-generated", "other-generated"], { cwd: root, encoding: "utf8" });
  assert.equal(proposal.status, 0, proposal.stderr);
  assert.match(proposal.stdout, /Excluded generated directory: build\/generated/);
  assert.match(proposal.stdout, /Excluded generated directory: other-generated/);
  const fingerprint = /Candidate fingerprint: ([0-9a-f]{64})/.exec(proposal.stdout)?.[1];
  assert.ok(fingerprint);
  const accepted = spawnSync(process.execPath, [cli, "accept", "--fingerprint", fingerprint], { cwd: root, encoding: "utf8" });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /candidate accepted/);
});

test("a failed command never writes a candidate or modifies the baseline", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-candidate-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, ".exevra.yml");
  await writeFile(configPath, JSON.stringify({ version: 1, baseline: "baseline.json", command: "node runner.mjs", reports: ["report.xml"], policy: { default: { min_executed: 1, max_drop_percent: 0 } } }));
  await writeFile(join(root, "runner.mjs"), `import { existsSync, writeFileSync } from 'node:fs'; if (existsSync('fail')) process.exit(1); writeFileSync('report.xml', '<testsuite name="unit"><testcase name="one"/></testsuite>');`);
  await record({ configPath });
  const baseline = await readFile(join(root, "baseline.json"), "utf8");
  await writeFile(join(root, "fail"), "");
  await assert.rejects(proposeBaseline({ configPath }), /test command or reports failed/);
  await assert.rejects(readFile(join(root, "baseline.json.candidate")));
  assert.equal(await readFile(join(root, "baseline.json"), "utf8"), baseline);
});
