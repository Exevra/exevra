import { lstat, open, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { stringify } from "yaml";
import { loadConfig } from "../core/index.js";
import { record, type RecordResult } from "./record.js";
import {
  assertSafeInRootPath,
  resolveInRoot,
  RuntimeError,
} from "./paths.js";

export interface InitializeOptions {
  configPath: string;
  command: string;
  reportPath: string | string[];
}

export interface InitializeResult {
  configPath: string;
  baselinePath: string;
  record: RecordResult;
}

export interface NodeInitializationResult extends InitializeResult {
  command: string;
  framework: string;
  reportPath: string;
}

const generatedBaselinePath = ".exevra/baseline.json";
const defaultNodeReportPath = "artifacts/junit.xml";
const defaultVitestReportPath = ".vitest/junit/output.xml";
const junitDetectionError =
  "unable to detect a JUnit report from package.json scripts.test; add a JUnit reporter and rerun with --command/--report";

type PackageManifest = {
  packageManager?: unknown;
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

const packageManagerFor = async (
  root: string,
  manifest: PackageManifest,
): Promise<string> => {
  if (typeof manifest.packageManager === "string") {
    const declared = manifest.packageManager.split("@", 1)[0];
    if (["npm", "pnpm", "yarn", "bun"].includes(declared)) return declared;
  }
  for (const [lockfile, packageManager] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["package-lock.json", "npm"],
  ] as const) {
    if (await fileExists(join(root, lockfile))) return packageManager;
  }
  return "npm";
};

const frameworkFor = (
  manifest: PackageManifest,
  script: string,
): string => {
  const dependencies = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  const scriptFrameworks = [
    ["Vitest", /\bvitest\b/i],
    ["Jest", /\bjest\b/i],
    ["Playwright", /\bplaywright\b/i],
  ] as const;
  const fromScript = scriptFrameworks
    .filter(([, pattern]) => pattern.test(script))
    .map(([framework]) => framework);
  if (fromScript.length === 1) return fromScript[0]!;
  if (fromScript.length > 1) return "Node test runner";

  const dependencyFrameworks = [
    ["Vitest", dependencies.has("vitest")],
    ["Jest", dependencies.has("jest") || dependencies.has("@jest/globals")],
    ["Playwright", dependencies.has("@playwright/test")],
  ] as const;
  const fromDependencies = dependencyFrameworks
    .filter(([, present]) => present)
    .map(([framework]) => framework);
  if (fromDependencies.length === 1) return fromDependencies[0]!;
  return "Node test runner";
};

const outputPathFor = (script: string): string | undefined => {
  const match = /--(?:outputFile|output-file|junit-output|junitOutput)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(
    script,
  );
  return match?.slice(1).find((value) => value !== undefined);
};

const reportPathFor = (
  script: string,
  framework: string,
): string | undefined => {
  const reportPath = outputPathFor(script);
  const reporterArgument = /--reporters?(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/gi;
  const hasJunitReporter = [...script.matchAll(reporterArgument)].some((match) =>
    match
      .slice(1)
      .find((value) => value !== undefined)
      ?.match(/\bjunit\b/i),
  );
  if (!hasJunitReporter) {
    if (reportPath !== undefined) throw new RuntimeError(junitDetectionError);
    return undefined;
  }
  if (reportPath !== undefined) return reportPath;
  if (framework === "Vitest") return defaultVitestReportPath;
  throw new RuntimeError(junitDetectionError);
};

type DetectedNodeProject = {
  command: string;
  framework: string;
  packageManager: string;
  reportPath: string;
};

const detectNodeProject = async (
  root: string,
): Promise<DetectedNodeProject> => {
  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as PackageManifest;
  } catch {
    throw new RuntimeError(
      "unable to detect a Node project: package.json is missing or invalid",
    );
  }
  const script = manifest.scripts?.test;
  if (typeof script !== "string" || script.trim() === "")
    throw new RuntimeError(
      "unable to detect a Node test command: package.json scripts.test is missing",
    );
  const packageManager = await packageManagerFor(root, manifest);
  const framework = frameworkFor(manifest, script);
  const configuredReportPath = reportPathFor(script, framework);
  const reportPath = configuredReportPath ?? defaultNodeReportPath;
  const testCommand =
    packageManager === "bun" ? "bun run test" : `${packageManager} test`;
  if (configuredReportPath === undefined && framework !== "Vitest")
    throw new RuntimeError(junitDetectionError);
  return {
    command:
      configuredReportPath === undefined
        ? `${testCommand} -- --reporter=junit --outputFile=${defaultNodeReportPath}`
        : testCommand,
    framework,
    packageManager,
    reportPath,
  };
};

const assertAsciiRolePath = (
  role: "configuration" | "report" | "baseline",
  path: string,
): void => {
  if (/[^\x00-\x7f]/.test(path))
    throw new RuntimeError(
      `initialization ${role} path must use ASCII characters only`,
    );
};

const sourceFor = (command: string, reportPaths: string[]): string =>
  stringify(
    {
      version: 1,
      baseline: generatedBaselinePath,
      command,
      reports: reportPaths,
      policy: {
        default: {
          min_executed: 1,
          max_drop_percent: 0,
          identity: "warn",
          identity_details: "counts",
        },
      },
    },
    { lineWidth: 0 },
  );

const comparisonKey = (value: string): string =>
  value.normalize("NFC").toLowerCase();

const foldedPath = (path: string): string => comparisonKey(resolve(path));

const pathsOverlap = (left: string, right: string): boolean => {
  const foldedLeft = foldedPath(left);
  const foldedRight = foldedPath(right);
  return (
    foldedLeft === foldedRight ||
    foldedLeft.startsWith(`${foldedRight}${sep}`) ||
    foldedRight.startsWith(`${foldedLeft}${sep}`)
  );
};

const endsWithRolePath = (path: string, rolePath: string): boolean => {
  const folded = foldedPath(path);
  const foldedRole = comparisonKey(rolePath.split(/[\\/]+/).join(sep));
  return folded === foldedRole || folded.endsWith(`${sep}${foldedRole}`);
};

const rejectPathOverlap = (leftRole: string, rightRole: string): never => {
  throw new RuntimeError(
    `initialization paths overlap: ${leftRole} and ${rightRole}`,
  );
};

export const initialize = async ({
  configPath,
  command,
  reportPath,
}: InitializeOptions): Promise<InitializeResult> => {
  const reportPaths = Array.isArray(reportPath) ? reportPath : [reportPath];
  const targetName = basename(resolve(configPath));
  assertAsciiRolePath("configuration", targetName);
  for (const path of reportPaths) assertAsciiRolePath("report", path);
  assertAsciiRolePath("baseline", generatedBaselinePath);
  const source = sourceFor(command, reportPaths);
  const config = loadConfig(source);
  const root = await realpath(dirname(resolve(configPath)));
  const target = join(root, targetName);
  const baselinePath = resolveInRoot(root, config.baseline);
  const configuredReportPaths = config.reports.map((report) =>
    resolveInRoot(root, report),
  );
  if (
    pathsOverlap(target, baselinePath) ||
    endsWithRolePath(target, config.baseline)
  )
    rejectPathOverlap("configuration", "baseline");
  for (const path of configuredReportPaths) {
    if (pathsOverlap(path, target))
      rejectPathOverlap("report", "configuration");
    if (pathsOverlap(path, baselinePath))
      rejectPathOverlap("report", "baseline");
  }
  await assertSafeInRootPath(root, baselinePath);
  for (const path of configuredReportPaths)
    await assertSafeInRootPath(root, path);
  try {
    await lstat(target);
    throw new RuntimeError(`configuration already exists: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const file = await open(target, "wx", 0o600);
  try {
    await file.writeFile(source, "utf8");
  } finally {
    await file.close();
  }
  let recordResult: RecordResult;
  try {
    recordResult = await record({ configPath: target });
  } catch {
    throw new RuntimeError("initial baseline recording failed: REPORT_INVALID");
  }
  if (recordResult.findings.length > 0) {
    const codes = [
      ...new Set(recordResult.findings.map((finding) => finding.code)),
    ].sort();
    throw new RuntimeError(`initial baseline recording failed: ${codes.join(", ")}`);
  }
  return { configPath: target, baselinePath, record: recordResult };
};

export const initializeNode = async (
  configPath: string,
): Promise<NodeInitializationResult> => {
  const root = dirname(resolve(configPath));
  const detected = await detectNodeProject(root);
  const result = await initialize({
    configPath,
    command: detected.command,
    reportPath: detected.reportPath,
  });
  return {
    ...result,
    command: detected.command,
    framework: detected.framework,
    reportPath: detected.reportPath,
  };
};
