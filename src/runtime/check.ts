import type {
  BaselineDiff,
  CanonicalSuite,
  CheckResult,
  Finding,
} from "../core/index.js";
import { compareBaseline, evaluate } from "../core/index.js";
import { cleanReports, runConfiguredCommand } from "./command.js";
import { buildReportFindings, mavenFilterFindings } from "./findings.js";
import { changedFiles } from "./git.js";
import { loadRuntimeConfig, readBaselineIfPresent } from "./load.js";
import { expandConfiguredReportPaths, loadConfiguredReports } from "./reports.js";

export interface CheckOptions {
  configPath: string;
  baseRef?: string;
  changedPaths?: string[];
  suppressCommandOutput?: boolean;
}
export interface DiffResult extends CheckResult {
  changes?: BaselineDiff;
}
interface CheckSnapshot extends CheckResult {
  config: Awaited<ReturnType<typeof loadRuntimeConfig>>["config"];
  baseline: Awaited<ReturnType<typeof readBaselineIfPresent>>;
}
interface RunCheckContext {
  loaded?: Awaited<ReturnType<typeof loadRuntimeConfig>>;
  baselineBeforeCommand?: boolean;
}
const runCheck = async ({
  configPath,
  baseRef,
  changedPaths,
  suppressCommandOutput,
}: CheckOptions, context: RunCheckContext = {}): Promise<CheckSnapshot> => {
  const loaded = context.loaded ?? (await loadRuntimeConfig(configPath));
  const notices: string[] = [];
  const filterFindings = loaded.config.maven
    ? mavenFilterFindings(
        loaded.config.command,
        loaded.config.maven.filterPolicy ?? "warn",
      )
    : [];
  if (filterFindings.some(({ severity }) => severity === "error"))
    return {
      findings: filterFindings,
      identityDiffs: [],
      suites: [],
      notices,
      config: loaded.config,
      baseline: undefined,
    };
  const findings = filterFindings;
  const baselineBeforeCommand = context.baselineBeforeCommand
    ? await readBaselineIfPresent(loaded.root, loaded.baselinePath)
    : undefined;
  await cleanReports(
    await expandConfiguredReportPaths(loaded.root, loaded.config),
  );
  const command = await runConfiguredCommand(
    loaded.root,
    loaded.config.command,
    suppressCommandOutput,
  );
  if (command.finding)
    return {
      findings: [...findings, command.finding],
      identityDiffs: [],
      suites: [],
      notices,
      config: loaded.config,
      baseline: undefined,
    };
  const reports = await loadConfiguredReports(loaded.root, loaded.config);
  const reportFindings = buildReportFindings(reports);
  if (reportFindings.length > 0)
    return {
      findings: [...findings, ...reportFindings],
      identityDiffs: [],
      suites: [],
      notices,
      config: loaded.config,
      baseline: undefined,
    };
  const suites = reports.suites;
  const baseline = context.baselineBeforeCommand
    ? baselineBeforeCommand
    : await readBaselineIfPresent(loaded.root, loaded.baselinePath);
  let paths = changedPaths;
  if (paths === undefined && baseRef !== undefined)
    paths = await changedFiles(loaded.root, baseRef);
  if (paths === undefined)
    notices.push(
      "Changed-file comparison is unavailable because no base ref was supplied.",
    );
  const sortedReports = (reports: readonly string[]) => [...reports].sort();
  if (
    baseline &&
    (baseline.command !== loaded.config.command ||
      JSON.stringify(sortedReports(baseline.reports)) !==
        JSON.stringify(sortedReports(loaded.config.reports)))
  )
    notices.push(
      "The current command or report configuration differs from the reviewed baseline.",
    );
  const result = evaluate({
    config: loaded.config,
    baseline,
    currentSuites: suites,
    changedPaths: paths ?? [],
  });
  const signalBreach = result.findings.some(
    (finding) =>
      finding.code === "SUITE_BELOW_MINIMUM" ||
      finding.code === "SUITE_DROP_EXCEEDED",
  );
  if (
    signalBreach &&
    baseline?.command !== loaded.config.command &&
    !result.findings.some(
      (finding) => finding.code === "WATCHED_CONFIG_CHANGED_WITH_SIGNAL_DROP",
    )
  ) {
    result.findings.push({
      code: "WATCHED_CONFIG_CHANGED_WITH_SIGNAL_DROP",
      severity: "error",
      message: "The configured command changed while execution signal dropped.",
      remediation:
        "Review the command change and suite execution delta together.",
    });
  }
  return {
    findings: [...findings, ...result.findings],
    identityDiffs: result.identityDiffs,
    suites,
    notices,
    config: loaded.config,
    baseline,
  };
};

export const check = async (options: CheckOptions): Promise<CheckResult> => {
  const { config: _config, baseline: _baseline, ...result } = await runCheck(
    options,
  );
  return result;
};

export const diff = async (options: CheckOptions): Promise<DiffResult> => {
  const loaded = await loadRuntimeConfig(options.configPath);
  const { config, ...result } = await runCheck(options, {
    loaded,
    baselineBeforeCommand: true,
  });
  if (result.suites.length === 0) return result;
  const baseline = result.baseline;
  if (!baseline || baseline.schemaVersion !== 1) return result;
  return {
    ...result,
    changes: compareBaseline(baseline, result.suites, config),
  };
};

export type { CheckResult };
