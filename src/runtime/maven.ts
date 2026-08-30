import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { SaxesParser } from "saxes";
import type { Finding, MavenFilterPolicy } from "../core/model.js";
import { assertSafeInRootPath, resolveInRoot, RuntimeError } from "./paths.js";

const mavenFilterPattern =
  /(?:^|[\s"'`;|&()<>])(-Dtest|-Dit\.test|-Dgroups|-DexcludedGroups|-DskipTests|-Dmaven\.test\.skip|-DskipITs)(?=$|[\s="'`;|&()<>])/g;

export const detectMavenFilters = (command: string): string[] => [
  ...new Set(
    Array.from(command.matchAll(mavenFilterPattern), (match) => match[1]),
  ),
].sort();

export const mavenFilterFinding = (
  command: string,
  policy: MavenFilterPolicy,
): Finding | undefined => {
  const flags = detectMavenFilters(command);
  if (policy === "off" || flags.length === 0) return undefined;
  return {
    code: "TEST_FILTERED",
    severity: policy === "enforce" ? "error" : "warning",
    message: `Maven test-selection flags detected in the configured command: ${flags.join(", ")}.`,
    remediation:
      "Remove the flags for a full test run, or explicitly set maven.filter_policy: off after reviewing the intended test scope.",
  };
};

export interface MavenModule {
  path: string;
  pomPath: string;
  aggregator: boolean;
}

interface ParsedPom {
  modules: string[];
  packaging: string;
}

const relativeModulePath = (root: string, path: string): string => {
  const value = relative(root, path).split(sep).join("/");
  return value === "" ? "." : value;
};

const parsePom = (source: string, pomPath: string): ParsedPom => {
  const parser = new SaxesParser({
    fileName: pomPath,
    position: true,
    defaultXMLVersion: "1.0",
    forceXMLVersion: true,
  });
  const stack: string[] = [];
  const modules: string[] = [];
  let packaging = "";
  let packagingText: string | undefined;
  let moduleText: string | undefined;
  let failure: RuntimeError | undefined;

  parser.on("doctype", () => {
    failure ??= new RuntimeError(
      `unable to parse Maven POM ${pomPath}: DOCTYPE declarations are not allowed`,
    );
  });
  parser.on("error", (error) => {
    failure ??= new RuntimeError(
      `unable to parse Maven POM ${pomPath}: ${error.message}`,
    );
  });
  parser.on("opentag", (tag) => {
    const parent = stack.at(-1);
    if (tag.name === "packaging" && stack.length === 1 && parent === "project")
      packagingText = "";
    if (tag.name === "module" && stack.length === 2 && parent === "modules")
      moduleText = "";
    stack.push(tag.name);
  });
  parser.on("text", (text) => {
    if (stack.at(-1) === "packaging" && packagingText !== undefined)
      packagingText += text;
    if (stack.at(-1) === "module" && moduleText !== undefined)
      moduleText += text;
  });
  parser.on("closetag", (tag) => {
    if (tag.name === "packaging" && packagingText !== undefined) {
      packaging = packagingText.trim();
      packagingText = undefined;
    }
    if (tag.name === "module" && moduleText !== undefined) {
      const value = moduleText.trim();
      if (value === "")
        failure ??= new RuntimeError(
          `unable to parse Maven POM ${pomPath}: module must not be empty`,
        );
      else modules.push(value);
      moduleText = undefined;
    }
    stack.pop();
  });

  try {
    parser.write(source).close();
  } catch (error) {
    failure ??= new RuntimeError(
      `unable to parse Maven POM ${pomPath}: ${
        error instanceof Error ? error.message : "unknown parser error"
      }`,
    );
  }
  if (failure) throw failure;
  return { modules, packaging: packaging || "jar" };
};

const readPom = async (
  path: string,
  required: boolean,
  displayPath = path,
): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" && !required) return undefined;
    if (code === "ENOENT")
      throw new RuntimeError(`Maven module POM is missing: ${displayPath}`);
    throw new RuntimeError(`unable to read Maven module POM: ${displayPath}`);
  }
};

export const discoverMavenModules = async (
  root: string,
): Promise<MavenModule[]> => {
  const rootPath = resolve(root);
  const rootPom = join(rootPath, "pom.xml");
  const rootSource = await readPom(rootPom, false, "pom.xml");
  if (rootSource === undefined)
    return [{ path: ".", pomPath: "pom.xml", aggregator: false }];

  const modules: MavenModule[] = [];
  const visited = new Set<string>();

  const visit = async (
    moduleRoot: string,
    modulePom: string,
    source: string,
    isRoot: boolean,
  ): Promise<void> => {
    await assertSafeInRootPath(rootPath, modulePom);
    const canonicalRoot = await realpath(moduleRoot);
    if (visited.has(canonicalRoot)) return;
    visited.add(canonicalRoot);

    const parsed = parsePom(source, relativeModulePath(rootPath, modulePom));
    const aggregator = parsed.packaging === "pom";
    if (!isRoot || !aggregator)
      modules.push({
        path: relativeModulePath(rootPath, moduleRoot),
        pomPath: relativeModulePath(rootPath, modulePom),
        aggregator,
      });

    for (const declaredModule of parsed.modules) {
      const childRoot = resolve(moduleRoot, declaredModule);
      const childRelative = relativeModulePath(rootPath, childRoot);
      const safeChildRoot = resolveInRoot(rootPath, childRelative);
      await assertSafeInRootPath(rootPath, safeChildRoot);
      let childEntry;
      try {
        childEntry = await lstat(safeChildRoot);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new RuntimeError(
            `Maven module directory is missing: ${childRelative}`,
          );
        throw error;
      }
      if (childEntry.isSymbolicLink())
        throw new RuntimeError(
          `Maven module directory is a symlink: ${childRelative}`,
        );
      if (!childEntry.isDirectory())
        throw new RuntimeError(
          `Maven module path is not a directory: ${childRelative}`,
        );
      const childPom = join(safeChildRoot, "pom.xml");
      const childSource = await readPom(
        childPom,
        true,
        `${childRelative}/pom.xml`,
      );
      await visit(safeChildRoot, childPom, childSource!, false);
    }
  };

  await visit(rootPath, rootPom, rootSource, true);
  return modules
    .filter((module) => module.path !== "." || !module.aggregator)
    .sort((left, right) => left.path.localeCompare(right.path));
};
