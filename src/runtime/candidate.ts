import { createHash } from "node:crypto";
import { fstatSync } from "node:fs";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { compareBaseline, evaluate, loadBaseline, serializeBaseline, type BaselineDiff, type Finding } from "../core/index.js";
import { loadRuntimeConfig } from "./load.js";
import type { IdentityDiff } from "../core/identity.js";
import { assertSafeInRootPath, resolveInRoot, RuntimeError } from "./paths.js";
import { atomicWriteBaseline, record } from "./record.js";
import { expandConfiguredReportPaths } from "./reports.js";

const fingerprint = (value: string): string => createHash("sha256").update(value).digest("hex");

const within = (directory: string, path: string): boolean => {
  const relation = relative(directory, path);
  return relation === "" || (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
};

const canonicalPath = async (path: string): Promise<string> => {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return join(await canonicalPath(dirname(path)), basename(path));
  }
};

const projectSnapshot = async (root: string, candidatePath: string, redirected: Set<string> = new Set(), captureOutput = false, generated: readonly string[] = []): Promise<Map<string, string>> => {
  const files = new Map<string, string>();
  const visited = new Set<string>();
  const generatedPaths = await Promise.all(generated.map((directory) => canonicalPath(resolveInRoot(root, directory))));
  const outputs = captureOutput ? [1, 2].flatMap((fd) => { try { const stat = fstatSync(fd); return stat.isFile() ? [stat] : []; } catch { return []; } }) : [];
  const visit = async (path: string, name: string): Promise<void> => {
    if (generated.some((directory) => name === `./${directory}` || name.startsWith(`./${directory}/`))) return;
    if (path === candidatePath || path === join(root, ".git") || path.endsWith(`${sep}__pycache__`) || path.endsWith(`${sep}.pytest_cache`) || path.endsWith(`${sep}node_modules${sep}.vite`)) return;
    const entry = await lstat(path);
    if (entry.isFile() && outputs.some((output) => output.dev === entry.dev && output.ino === entry.ino)) {
      redirected.add(name);
      return;
    }
    if (redirected.has(name)) return;
    if (entry.isSymbolicLink()) {
      files.set(name, fingerprint(`link:${entry.mode}:${await readlink(path)}`));
      const target = await realpath(path);
      const relation = relative(root, target);
      if ((relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) && !(await lstat(target)).isFile())
        throw new RuntimeError(`cannot verify project files through an external directory symlink: ${path}`);
      if (generatedPaths.some((directory) => within(directory, target))) return;
      await visit(target, `${name}/target`);
    } else if (entry.isDirectory()) {
      const canonical = await realpath(path);
      if (generatedPaths.some((directory) => within(directory, canonical))) return;
      if (visited.has(canonical)) return;
      visited.add(canonical);
      for (const child of (await readdir(path)).sort()) await visit(join(path, child), `${name}/${child}`);
    } else if (entry.isFile()) {
      const content = await readFile(path);
      const after = await lstat(path);
      if (after.size !== entry.size || after.mtimeMs !== entry.mtimeMs || after.ino !== entry.ino)
        throw new RuntimeError(`project file changed during snapshot: ${path}`);
      files.set(name, createHash("sha256").update(`${entry.mode}:`).update(content).digest("hex"));
    } else throw new RuntimeError(`cannot verify project file: ${path}`);
  };
  await visit(root, ".");
  return files;
};

const snapshotFingerprint = (files: Map<string, string>, excluded: readonly string[]): string =>
  fingerprint(JSON.stringify([...files].filter(([name]) => !excluded.includes(name)).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)));

const generatedDirectories = async (root: string, paths: readonly string[], protectedPaths: readonly string[]): Promise<string[]> => {
  const result = new Set<string>();
  for (const path of paths) {
    if (!path || path.includes("\0") || path.includes("\\") || path.split("/").includes("..") || isAbsolute(path))
      throw new RuntimeError("generated output must be a relative directory within the configuration root");
    const target = resolveInRoot(root, path);
    const canonicalTarget = await canonicalPath(target);
    const canonicalProtected = await Promise.all(protectedPaths.map(canonicalPath));
    if (canonicalProtected.some((protectedPath) => within(canonicalTarget, protectedPath)))
      throw new RuntimeError("generated output cannot contain the configuration, baseline, or candidate");
    await assertSafeInRootPath(root, target);
    try {
      if (!(await lstat(target)).isDirectory()) throw new RuntimeError(`generated output is not a directory: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    result.add(relative(root, canonicalTarget).split(sep).join("/"));
  }
  return [...result].sort();
};

export const proposeBaseline = async ({ configPath, excludeGenerated = [] }: { configPath: string; excludeGenerated?: string[] }): Promise<{ fingerprint: string; changes: BaselineDiff; findings: Finding[]; identityDiffs: IdentityDiff[] }> => {
  const loaded = await loadRuntimeConfig(configPath);
  const candidatePath = `${loaded.baselinePath}.candidate`;
  const generated = await generatedDirectories(loaded.root, excludeGenerated, [loaded.configPath, loaded.baselinePath, candidatePath]);
  await assertSafeInRootPath(loaded.root, candidatePath, true);
  try {
    await lstat(candidatePath);
    throw new RuntimeError("candidate already exists; review or remove it before proposing another");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const configSource = await readFile(loaded.configPath, "utf8");
  await assertSafeInRootPath(loaded.root, loaded.baselinePath);
  let baselineSource: string;
  try { baselineSource = await readFile(loaded.baselinePath, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new RuntimeError("a reviewed baseline is required before proposing changes"); throw error; }
  const baseline = loadBaseline(baselineSource);
  const redirected = new Set<string>();
  const beforeReports = await expandConfiguredReportPaths(loaded.root, loaded.config);
  const before = await projectSnapshot(loaded.root, candidatePath, redirected, true, generated);
  const result = await record({ configPath, write: true, prepare: true });
  if (result.findings.some((finding) => finding.severity === "error") || !result.baseline)
    throw new RuntimeError("cannot propose a baseline because the test command or reports failed");
  if (await readFile(loaded.configPath, "utf8") !== configSource || await readFile(loaded.baselinePath, "utf8") !== baselineSource)
    throw new RuntimeError("configuration or baseline changed during the test run");
  const afterReports = await expandConfiguredReportPaths(loaded.root, loaded.config);
  const after = await projectSnapshot(loaded.root, candidatePath, redirected, true, generated);
  const excluded = [...new Set([...redirected, ...beforeReports.map((path) => `./${relative(loaded.root, path)}`), ...afterReports.map((path) => `./${relative(loaded.root, path)}`)])].sort();
  const projectHash = snapshotFingerprint(after, excluded);
  if (snapshotFingerprint(before, excluded) !== projectHash)
    throw new RuntimeError("project files changed during the test run; create a fresh proposal");
  const source = JSON.stringify({ configHash: fingerprint(configSource), baselineHash: fingerprint(baselineSource), projectHash, excluded, generated, baseline: result.baseline }, null, 2) + "\n";
  await assertSafeInRootPath(loaded.root, candidatePath, true);
  await atomicWriteBaseline(candidatePath, source, false);
  const evaluation = evaluate({ config: loaded.config, baseline, currentSuites: result.suites });
  return { fingerprint: fingerprint(source), changes: compareBaseline(baseline, result.suites, loaded.config), findings: [...result.findings, ...evaluation.findings], identityDiffs: evaluation.identityDiffs };
};

export const acceptBaseline = async ({ configPath, fingerprint: expected }: { configPath: string; fingerprint: string }): Promise<void> => {
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new RuntimeError("candidate fingerprint must be a SHA-256 hex digest");
  const loaded = await loadRuntimeConfig(configPath);
  const candidatePath = `${loaded.baselinePath}.candidate`;
  await assertSafeInRootPath(loaded.root, candidatePath);
  const source = await readFile(candidatePath, "utf8");
  if (fingerprint(source) !== expected) throw new RuntimeError("candidate fingerprint does not match the reviewed candidate");
  let candidate: { configHash: string; baselineHash: string; projectHash?: string; excluded?: string[]; generated?: string[]; baseline: unknown };
  try { candidate = JSON.parse(source); } catch { throw new RuntimeError("invalid candidate JSON"); }
  if (!candidate || typeof candidate !== "object") throw new RuntimeError("invalid candidate JSON");
  if (fingerprint(await readFile(loaded.configPath, "utf8")) !== candidate.configHash) throw new RuntimeError("configuration changed since candidate review");
  await assertSafeInRootPath(loaded.root, loaded.baselinePath);
  if (fingerprint(await readFile(loaded.baselinePath, "utf8")) !== candidate.baselineHash) throw new RuntimeError("baseline changed since candidate review");
  if (!candidate.projectHash || !Array.isArray(candidate.excluded) || !candidate.excluded.every((value) => typeof value === "string") || !Array.isArray(candidate.generated) || !candidate.generated.every((value) => typeof value === "string"))
    throw new RuntimeError("candidate has no valid freshness information; create a fresh proposal");
  const generated = await generatedDirectories(loaded.root, candidate.generated, [loaded.configPath, loaded.baselinePath, candidatePath]);
  if (snapshotFingerprint(await projectSnapshot(loaded.root, candidatePath, new Set(candidate.excluded), false, generated), candidate.excluded) !== candidate.projectHash)
    throw new RuntimeError("project files changed since candidate review; create a fresh proposal");
  const baseline = loadBaseline(candidate.baseline);
  await atomicWriteBaseline(loaded.baselinePath, serializeBaseline(baseline), true);
};
