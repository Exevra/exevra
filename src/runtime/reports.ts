import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, relative } from "node:path";
import {
  aggregateSuites,
  parseJunit,
  type CanonicalSuite,
} from "../core/index.js";
import { assertSafeInRootPath, resolveInRoot } from "./paths.js";

const pattern = (value: string): RegExp =>
  new RegExp(
    `^${value
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );

export const expandReportPaths = async (
  root: string,
  reports: readonly string[],
): Promise<string[]> => {
  const paths: string[] = [];
  for (const report of reports) {
    if (!report.includes("*")) {
      const path = resolveInRoot(root, report);
      await assertSafeInRootPath(root, path);
      paths.push(path);
      continue;
    }
    const directory = dirname(report);
    if (directory.includes("*"))
      throw new Error("report wildcards are only supported in file names");
    const directoryPath = resolveInRoot(root, directory);
    await assertSafeInRootPath(root, directoryPath);
    try {
      const entries = await readdir(directoryPath, { withFileTypes: true });
      for (const entry of entries
        .filter((item) => item.isFile() && pattern(basename(report)).test(item.name))
        .sort((left, right) => left.name.localeCompare(right.name))) {
        const path = resolveInRoot(root, `${directory}/${entry.name}`);
        await assertSafeInRootPath(root, path);
        paths.push(path);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return paths;
};

export const missingReportPatterns = async (
  root: string,
  reports: readonly string[],
): Promise<string[]> => {
  const patterns = reports.filter((report) => report.includes("*"));
  if (patterns.length === 0) return [];
  return (await expandReportPaths(root, patterns)).length === 0 ? patterns : [];
};

export const loadReports = async (
  root: string,
  reports: readonly string[],
): Promise<CanonicalSuite[]> => {
  const observations: CanonicalSuite[] = [];
  for (const path of await expandReportPaths(root, reports)) {
    observations.push(
      ...parseJunit(await readFile(path, "utf8"), relative(root, path)),
    );
  }
  return aggregateSuites(observations);
};
