import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const root = process.cwd();
const run = (command: string, args: string[], cwd: string, env = process.env) =>
  spawnSync(command, args, { cwd, env, encoding: "utf8" });

test("npm version updates current Action examples across consecutive releases", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "exevra-version-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const paths = ["README.md", "website/src/content/docs/guides/github-action.md", "website/src/content/docs/guides/upgrading.md", "scripts/sync-release-version.mjs"];
  for (const path of paths) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    cpSync(join(root, path), join(dir, path));
  }
  const history = join(dir, "website/src/content/docs/reference/releases.md");
  mkdirSync(dirname(history), { recursive: true });
  writeFileSync(history, "## v0.4.4\n\nHistorical notes.\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "version-test", version: "0.4.4", scripts: { version: "node scripts/sync-release-version.mjs" } }));
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ name: "version-test", version: "0.4.4", lockfileVersion: 3, packages: { "": { name: "version-test", version: "0.4.4" } } }));
  for (const version of ["0.4.5", "0.4.6"]) {
    const result = run("npm", ["version", "patch", "--no-git-tag-version"], dir);
    assert.equal(result.status, 0, result.stderr);
    for (const path of paths.slice(0, 3)) assert.match(readFileSync(join(dir, path), "utf8"), new RegExp(`Exevra/exevra@v${version.replaceAll(".", "\\.")}`));
    assert.equal(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version, version);
    const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
    assert.equal(lock.version, version);
    assert.equal(lock.packages[""].version, version);
    assert.equal(readFileSync(history, "utf8"), "## v0.4.4\n\nHistorical notes.\n");
  }
  const before = readFileSync(join(dir, "README.md"), "utf8");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "not-a-version" }));
  assert.notEqual(run(process.execPath, ["scripts/sync-release-version.mjs"], dir).status, 0);
  assert.equal(readFileSync(join(dir, "README.md"), "utf8"), before);
});

test("release workflow handles changed versions, repeats, and conflicting tags", (t) => {
  const workflow = parse(readFileSync(join(root, ".github/workflows/publish.yml"), "utf8"));
  const step = workflow.jobs.release.steps.find((item: { name?: string }) => item.name === "Create release for a version change");
  const dir = mkdtempSync(join(tmpdir(), "exevra-release-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => {
    const result = run("git", args, dir);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  writeFileSync(join(dir, "package.json"), '{"version":"0.4.4"}');
  git("add", "package.json"); git("commit", "-qm", "old");
  const previous = git("rev-parse", "HEAD");
  writeFileSync(join(dir, "package.json"), '{"version":"0.4.5"}');
  git("commit", "-qam", "new");
  const current = git("rev-parse", "HEAD");
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin/gh"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GH_LOG"\n[ "$1 $2" = "release view" ] && exit 1\nexit 0\n', { mode: 0o755 });
  const log = join(dir, "gh.log");
  const env = { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, GH_LOG: log, PREVIOUS_SHA: previous, GITHUB_SHA: current };
  let result = run("bash", ["-e", "-c", step.run], dir, env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(log, "utf8"), /release create v0\.4\.5 --target/);
  rmSync(log);
  git("tag", "v0.4.5", current);
  writeFileSync(join(dir, "bin/gh"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GH_LOG"\nexit 0\n', { mode: 0o755 });
  result = run("bash", ["-e", "-c", step.run], dir, env);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(readFileSync(log, "utf8"), /release create/);
  rmSync(log);
  git("tag", "-d", "v0.4.5");
  result = run("bash", ["-e", "-c", step.run], dir, { ...env, PREVIOUS_SHA: current });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(log), false);
  git("tag", "v0.4.5", previous);
  result = run("bash", ["-e", "-c", step.run], dir, env);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(log), false);
});
