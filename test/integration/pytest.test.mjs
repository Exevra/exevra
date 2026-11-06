import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const cli = resolve("build/src/cli/index.js");

test("pytest initialization records real parametrized and skipped tests and detects a reduced run", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-pytest-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "test_sample.py"), `import os
import pytest

@pytest.mark.parametrize("value", [1, 2])
def test_parameterized(value):
    assert value > 0

@pytest.mark.skip(reason="not implemented")
def test_skipped():
    pass

@pytest.mark.skipif(os.getenv("SKIP_ONE") == "1", reason="simulates a missing test")
def test_optional():
    assert True
`);
  const run = async (args, extraEnv = {}) => {
    try {
      const result = await execute(process.execPath, [cli, ...args], {
        cwd: root,
        env: { ...process.env, PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1", ...extraEnv },
      });
      return { code: 0, ...result };
    } catch (error) {
      return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }
  };
  const init = await run(["init", "--pytest"]);
  assert.equal(init.code, 0, init.stderr);
  const baseline = JSON.parse(await readFile(join(root, ".exevra/baseline.json"), "utf8"));
  assert.equal(baseline.suites.reduce((sum, suite) => sum + suite.executed, 0), 3);
  assert.equal(baseline.suites.reduce((sum, suite) => sum + suite.skipped, 0), 1);
  const check = await run(["check"]);
  assert.equal(check.code, 0, check.stderr);
  const reduced = await run(["check"], { SKIP_ONE: "1" });
  assert.equal(reduced.code, 1, reduced.stderr);
  assert.match(reduced.stdout, /SUITE_DROP_EXCEEDED/);
});

test("pytest initialization does not record a baseline when tests fail", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-pytest-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "test_failure.py"), "def test_failure():\n    assert False\n");
  await assert.rejects(execute(process.execPath, [cli, "init", "--pytest"], {
    cwd: root,
    env: { ...process.env, PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1" },
  }), (error) => error.code === 2);
  await assert.rejects(readFile(join(root, ".exevra/baseline.json")), { code: "ENOENT" });
});

test("pytest initialization accepts a custom pytest invocation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "exevra-pytest-command-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "test_sample.py"), "def test_pass():\n    assert True\n");
  const options = { cwd: root, env: { ...process.env, PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1" } };
  await execute(process.execPath, [cli, "init", "--pytest", "--command", "python3 -m pytest -q"], options);
  await execute(process.execPath, [cli, "check"], options);
});
