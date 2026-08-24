import { open, lstat, realpath } from "node:fs/promises";
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

const generatedBaselinePath = ".exevra/baseline.json";

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
