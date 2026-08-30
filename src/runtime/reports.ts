import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, dirname, relative, sep } from "node:path";
import {
  aggregateSuites,
  type AggregationConfig,
  type Config,
  parseJunit,
  type CanonicalSuite,
} from "../core/index.js";
import { missingReports } from "./command.js";
import { discoverGradleModules, type GradleModule } from "./gradle.js";
import { discoverMavenModules, type MavenModule } from "./maven.js";
import { assertSafeInRootPath, resolveInRoot, RuntimeError } from "./paths.js";

export interface ShardReportSet {
  shard: string;
  reportPaths: string[];
  suites: CanonicalSuite[];
}

export interface AggregatedReportLoad {
  shards: ShardReportSet[];
  missingShards: string[];
  missingReports: string[];
}

export interface ReportCollection {
  reportPaths: string[];
  suites: CanonicalSuite[];
  missingReports: string[];
  unreadableReports: string[];
}

const pattern = (value: string): RegExp =>
  new RegExp(
    `^${value
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );

const relativeRootPath = (root: string, path: string): string => {
  const value = relative(root, path).split(sep).join("/");
  return value === "" ? "." : value;
};

export const expandReportPaths = async (
  root: string,
  reports: readonly string[],
  rejectSymlinks = false,
  diagnosticRoot = root,
  onUnreadableDirectory?: (path: string) => void,
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
      for (const entry of entries.sort((left, right) =>
        left.name.localeCompare(right.name),
      )) {
        if (!pattern(basename(report)).test(entry.name)) continue;
        if (rejectSymlinks && entry.isSymbolicLink())
          throw new RuntimeError(
            `configured report path is a symlink and will not be read: ${relativeRootPath(diagnosticRoot, resolveInRoot(root, `${directory}/${entry.name}`))}`,
          );
        if (!entry.isFile()) continue;
        const path = resolveInRoot(root, `${directory}/${entry.name}`);
        await assertSafeInRootPath(root, path);
        paths.push(path);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      if ((code === "EACCES" || code === "EPERM") && onUnreadableDirectory) {
        onUnreadableDirectory(relativeRootPath(diagnosticRoot, directoryPath));
        continue;
      }
      throw error;
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

type BuildModule = Pick<MavenModule | GradleModule, "path" | "aggregator">;

const moduleRootFor = (root: string, module: BuildModule): string =>
  module.path === "." ? root : resolveInRoot(root, module.path);

const moduleReportPaths = async (
  root: string,
  config: Config,
  modules: readonly BuildModule[],
): Promise<string[]> => {
  const paths: string[] = [];
  for (const module of modules) {
    if (module.aggregator) continue;
    const moduleRoot = moduleRootFor(root, module);
    for (const report of config.reports)
      paths.push(
        ...(await expandReportPaths(
          moduleRoot,
          [report],
          true,
          root,
          () => undefined,
        )),
      );
  }
  return [...new Set(paths)].sort();
};

const loadBuildReports = async (
  root: string,
  config: Config,
  modules: readonly BuildModule[],
): Promise<ReportCollection> => {
  const reportPaths: string[] = [];
  const observations: CanonicalSuite[] = [];
  const missing: string[] = [];
  const unreadable: string[] = [];
  for (const module of modules) {
    if (module.aggregator) continue;
    const moduleRoot = moduleRootFor(root, module);
    let matched = false;
    let unreadableDirectory = false;
    const expected: string[] = [];
    for (const report of config.reports) {
      const expectedPath = relativeRootPath(root, resolveInRoot(moduleRoot, report));
      expected.push(expectedPath);
      for (const path of await expandReportPaths(
        moduleRoot,
        [report],
        true,
        root,
        () => {
          unreadableDirectory = true;
          unreadable.push(expectedPath);
        },
      )) {
        matched = true;
        reportPaths.push(path);
        try {
          observations.push(
            ...parseJunit(await readFile(path, "utf8"), relative(root, path)),
          );
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EACCES" || code === "EPERM")
            unreadable.push(relativeRootPath(root, path));
          else throw error;
        }
      }
    }
    if (!matched && !unreadableDirectory)
      missing.push([...expected].sort().join(" or "));
  }
  return {
    reportPaths: [...new Set(reportPaths)].sort(),
    suites: aggregateSuites(observations),
    missingReports: missing.sort(),
    unreadableReports: [...new Set(unreadable)].sort(),
  };
};

export const expandConfiguredReportPaths = async (
  root: string,
  config: Config,
): Promise<string[]> => {
  if (config.maven)
    return moduleReportPaths(root, config, await discoverMavenModules(root));
  if (config.gradle)
    return moduleReportPaths(root, config, await discoverGradleModules(root));
  return expandReportPaths(root, config.reports);
};

export const loadConfiguredReports = async (
  root: string,
  config: Config,
): Promise<ReportCollection> => {
  if (config.maven)
    return loadBuildReports(root, config, await discoverMavenModules(root));
  if (config.gradle)
    return loadBuildReports(root, config, await discoverGradleModules(root));
  const reportPaths = await expandReportPaths(root, config.reports);
  const missing = [
    ...(await missingReports(reportPaths)),
    ...(await missingReportPatterns(root, config.reports)),
  ];
  return {
    reportPaths,
    suites: missing.length === 0 ? await loadReports(root, config.reports) : [],
    missingReports: missing,
    unreadableReports: [],
  };
};

export const loadAggregatedReports = async (
  root: string,
  aggregation: AggregationConfig,
): Promise<AggregatedReportLoad> => {
  const aggregationRoot = resolveInRoot(root, aggregation.root);
  await assertSafeInRootPath(root, aggregationRoot);
  const shards: ShardReportSet[] = [];
  const missingShards: string[] = [];
  const missingReports: string[] = [];

  for (const shard of [...aggregation.shards].sort()) {
    const shardRoot = resolveInRoot(aggregationRoot, shard);
    await assertSafeInRootPath(root, shardRoot);
    try {
      if (!(await lstat(shardRoot)).isDirectory())
        throw new Error(`configured shard is not a directory: ${shardRoot}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        missingShards.push(shard);
        continue;
      }
      throw error;
    }

    const reportPaths: string[] = [];
    const observations: CanonicalSuite[] = [];
    for (const report of [...aggregation.reports].sort()) {
      let matched = false;
      for (const path of await expandReportPaths(shardRoot, [report])) {
        try {
          observations.push(
            ...parseJunit(await readFile(path, "utf8"), relative(shardRoot, path)),
          );
          reportPaths.push(path);
          matched = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      if (!matched)
        missingReports.push(relative(root, resolveInRoot(shardRoot, report)));
    }
    shards.push({
      shard,
      reportPaths: reportPaths.sort(),
      suites: aggregateSuites(observations),
    });
  }

  return {
    shards,
    missingShards: missingShards.sort(),
    missingReports: missingReports.sort(),
  };
};
