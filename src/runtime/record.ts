import { access, link, open, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  aggregateSuites,
  resolveSuitePolicy,
  serializeBaseline,
  testIdHashes,
  testIdsHash,
  type Baseline,
  type CanonicalSuite,
  type Finding,
} from "../core/index.js";
import { cleanReports, runConfiguredCommand } from "./command.js";
import { buildReportFindings, mavenFilterFindings } from "./findings.js";
import { loadRuntimeConfig } from "./load.js";
import { assertSafeInRootPath, RuntimeError } from "./paths.js";
import { expandConfiguredReportPaths, loadConfiguredReports } from "./reports.js";

export interface RecordOptions {
  configPath: string;
  write?: boolean;
  generatedAt?: string;
}
export interface RecordResult {
  baseline: Baseline;
  suites: CanonicalSuite[];
  findings: Finding[];
}

const atomicWriteBaseline = async (
  path: string,
  contents: string,
  overwrite: boolean,
): Promise<void> => {
  const temporary = `${path}.tmp-${randomUUID()}`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(contents, "utf8");
    await file.close();
    if (overwrite) await rename(temporary, path);
    else await link(temporary, path);
  } finally {
    await file.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
};

export const record = async ({
  configPath,
  write = false,
  generatedAt = new Date().toISOString(),
}: RecordOptions): Promise<RecordResult> => {
  const loaded = await loadRuntimeConfig(configPath);
  const filterFindings = loaded.config.maven
    ? mavenFilterFindings(
        loaded.config.command,
        loaded.config.maven.filterPolicy ?? "warn",
      )
    : [];
  if (filterFindings.some(({ severity }) => severity === "error"))
    return {
      baseline: undefined as never,
      suites: [],
      findings: filterFindings,
    };
  const findings = filterFindings;
  await assertSafeInRootPath(loaded.root, loaded.baselinePath, true);
  const existingReportPaths = await expandConfiguredReportPaths(
    loaded.root,
    loaded.config,
  );
  if (!write) {
    try {
      await access(loaded.baselinePath, constants.F_OK);
      throw new RuntimeError(
        `baseline already exists: ${loaded.baselinePath}; pass explicit write permission to overwrite it`,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await cleanReports(existingReportPaths);
  const commandStartedAt = Date.now();
  const command = await runConfiguredCommand(
    loaded.root,
    loaded.config.command,
  );
  if (command.finding)
    return {
      baseline: undefined as never,
      suites: [],
      findings: [...findings, command.finding],
    };
  const reports = await loadConfiguredReports(
    loaded.root,
    loaded.config,
    commandStartedAt,
  );
  const reportFindings = buildReportFindings(reports);
  if (reportFindings.length > 0)
    return {
      baseline: undefined as never,
      suites: [],
      findings: [...findings, ...reportFindings],
    };
  const suites = reports.suites;
  if (suites.reduce((total, suite) => total + suite.executed, 0) === 0)
    throw new RuntimeError("cannot record a baseline with zero executed tests");
  const baseline: Baseline = {
    schemaVersion: 1,
    generatedAt,
    command: loaded.config.command,
    reports: loaded.config.reports,
    suites: aggregateSuites(suites).map((suite) => {
      const policy = resolveSuitePolicy(loaded.config, suite.name);
      return {
        name: suite.name,
        executed: suite.executed,
        skipped: suite.skipped,
        testIdsHash: testIdsHash(suite.tests),
        testIdHashes: testIdHashes(suite.tests),
        ...(policy.identityDetails === "names"
          ? { testIds: suite.tests.map((test) => test.id).sort() }
          : {}),
      };
    }),
  };
  await assertSafeInRootPath(loaded.root, loaded.baselinePath, true);
  await atomicWriteBaseline(
    loaded.baselinePath,
    serializeBaseline(baseline),
    write,
  );
  return { baseline, suites, findings };
};
