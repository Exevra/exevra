import { lstat, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { RuntimeError } from "./paths.js";

export interface GradleModule {
  path: string;
  projectPath: string;
  aggregator: boolean;
}

const relativeModulePath = (root: string, path: string): string => {
  const value = relative(root, path).split(sep).join("/");
  return value === "" ? "." : value;
};

const withoutComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const projectPathFor = (value: string): string =>
  value.startsWith(":") ? value : `:${value}`;

const modulePathFor = (projectPath: string): string =>
  projectPath
    .slice(1)
    .split(":")
    .filter(Boolean)
    .join("/");

const stringValues = (source: string): string[] =>
  [...source.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]!);

const includedProjects = (source: string): string[] => {
  const projects: string[] = [];
  const includePattern = /\binclude\s*(?:\(([^)]*)\)|([^\n;]+))/g;
  for (const match of source.matchAll(includePattern))
    projects.push(...stringValues(match[1] ?? match[2] ?? ""));
  return projects.map(projectPathFor);
};

const customProjectDirectories = (source: string): Map<string, string> => {
  const directories = new Map<string, string>();
  const pattern =
    /project\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\.projectDir\s*=\s*file\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(pattern))
    directories.set(projectPathFor(match[1]!), match[2]!);
  return directories;
};

const safeModuleRoot = (root: string, configuredPath: string): string => {
  const candidate = resolve(root, configuredPath);
  const relation = relative(root, candidate);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    resolve(root, relation) !== candidate
  )
    throw new RuntimeError(
      `Gradle module path escapes configuration root: ${configuredPath}`,
    );
  return candidate;
};

const assertModulePath = async (
  root: string,
  modulePath: string,
): Promise<string> => {
  const candidate = safeModuleRoot(root, modulePath);
  const parts = relative(root, candidate).split(sep).filter(Boolean);
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let entry;
    try {
      entry = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new RuntimeError(`Gradle module directory is missing: ${modulePath}`);
      throw new RuntimeError(`unable to read Gradle module directory: ${modulePath}`);
    }
    if (entry.isSymbolicLink())
      throw new RuntimeError(`Gradle module directory is a symlink: ${modulePath}`);
    if (index < parts.length - 1 && !entry.isDirectory())
      throw new RuntimeError(`Gradle module path is not a directory: ${modulePath}`);
  }
  if (parts.length === 0) return candidate;
  const entry = await lstat(candidate);
  if (!entry.isDirectory())
    throw new RuntimeError(`Gradle module path is not a directory: ${modulePath}`);
  return candidate;
};

const settingsSource = async (
  root: string,
): Promise<{ source: string; path: string } | undefined> => {
  for (const name of ["settings.gradle.kts", "settings.gradle"]) {
    try {
      return { source: await readFile(join(root, name), "utf8"), path: name };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new RuntimeError(`unable to read Gradle settings: ${name}`);
    }
  }
  return undefined;
};

export const discoverGradleModules = async (
  root: string,
): Promise<GradleModule[]> => {
  const rootPath = await realpath(resolve(root));
  const settings = await settingsSource(rootPath);
  if (settings === undefined)
    return [{ path: ".", projectPath: ":", aggregator: false }];

  const source = withoutComments(settings.source);
  const directories = customProjectDirectories(source);
  const visited = new Set<string>();
  const modules: GradleModule[] = [];
  for (const projectPath of includedProjects(source)) {
    const configuredPath = directories.get(projectPath) ?? modulePathFor(projectPath);
    const moduleRoot = await assertModulePath(rootPath, configuredPath);
    const canonicalRoot = await realpath(moduleRoot);
    if (visited.has(canonicalRoot)) continue;
    visited.add(canonicalRoot);
    modules.push({
      path: relativeModulePath(rootPath, moduleRoot),
      projectPath,
      aggregator: false,
    });
  }
  if (modules.length === 0)
    return [{ path: ".", projectPath: ":", aggregator: false }];
  return modules.sort((left, right) => left.path.localeCompare(right.path));
};
