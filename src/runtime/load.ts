import { readFile } from "node:fs/promises";
import { loadConfig, type Baseline, type Config } from "../core/index.js";
import {
  assertSafeInRootPath,
  configRootFor,
  resolveInRoot,
  RuntimeError,
} from "./paths.js";

export interface LoadedRuntimeConfig {
  configPath: string;
  root: string;
  config: Config;
  baselinePath: string;
  reportPaths: string[];
}

export const loadRuntimeConfig = async (
  configPath: string,
): Promise<LoadedRuntimeConfig> => {
  const location = await configRootFor(configPath);
  let text: string;
  try {
    text = await readFile(location.configPath, "utf8");
  } catch {
    throw new RuntimeError(
      `unable to read configuration: ${location.configPath}`,
    );
  }
  const config = loadConfig(text);
  return {
    ...location,
    config,
    baselinePath: resolveInRoot(location.root, config.baseline),
    reportPaths: config.reports.map((report) =>
      resolveInRoot(location.root, report),
    ),
  };
};

export const readBaselineIfPresent = async (
  root: string,
  path: string,
): Promise<Baseline | undefined> => {
  await assertSafeInRootPath(root, path);
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new RuntimeError(`unable to read baseline: ${path}`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(source);
  } catch {
    throw new RuntimeError(`invalid baseline JSON: ${path}`);
  }
  if (
    typeof decoded === "object" &&
    decoded !== null &&
    !Array.isArray(decoded) &&
    (decoded as { schemaVersion?: unknown }).schemaVersion !== 1
  ) {
    return {
      schemaVersion: (decoded as { schemaVersion: number }).schemaVersion,
      generatedAt: "",
      command: "",
      reports: [],
      suites: [],
    };
  }
  const { loadBaseline } = await import("../core/index.js");
  return loadBaseline(decoded);
};
