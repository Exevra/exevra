import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const fixture = resolve("test/fixtures/node/vitest");
const cli = resolve("build/src/cli/index.js");

test("pnpm Vitest initialization records a baseline and checks the real JUnit report", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-pnpm-vitest-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(fixture, "package.json"), join(root, "package.json"));
  await cp(join(fixture, "test"), join(root, "test"), { recursive: true });
  await symlink(join(fixture, "node_modules"), join(root, "node_modules"));
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await execute(process.execPath, [cli, "init"], { cwd: root });
  await execute(process.execPath, [cli, "check"], { cwd: root });
});

test("Vitest initialization explains a fully skipped suite before reporting readiness", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-vitest-skipped-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(fixture, "package.json"), join(root, "package.json"));
  await cp(join(fixture, "test"), join(root, "test"), { recursive: true });
  await symlink(join(fixture, "node_modules"), join(root, "node_modules"));
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeFile(join(root, "test", "skipped.test.js"), "import { it } from 'vitest'; it.skip('later', () => {});\n");
  await assert.rejects(execute(process.execPath, [cli, "init"], { cwd: root }), (error) => {
    assert.equal(error.code, 2);
    assert.match(error.stderr, /SUITE_BELOW_MINIMUM.*skipped\.test\.js/);
    assert.doesNotMatch(error.stdout, /Ready\./);
    return true;
  });
});
