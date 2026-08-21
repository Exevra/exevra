import { readFile } from "node:fs/promises";
import {
  aggregateSuites,
  parseJunit,
  type CanonicalSuite,
  type Config,
} from "../core/index.js";
import { assertSafeInRootPath, resolveInRoot } from "./paths.js";

export const loadReports = async (
  root: string,
  config: Config,
): Promise<CanonicalSuite[]> => {
  const observations: CanonicalSuite[] = [];
  for (const report of config.reports) {
    const path = resolveInRoot(root, report);
    await assertSafeInRootPath(root, path);
    observations.push(...parseJunit(await readFile(path, "utf8"), report));
  }
  return aggregateSuites(observations);
};
