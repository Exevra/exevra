import type { CanonicalSuite, Finding, IdentityDiff } from "../core/index.js";
import { evaluate } from "../core/index.js";
import {
  cleanReports,
  missingReports,
  runConfiguredCommand,
} from "./command.js";
import { changedFiles } from "./git.js";
import { loadRuntimeConfig, readBaselineIfPresent } from "./load.js";
import { loadReports } from "./reports.js";
import { assertSafeInRootPath } from "./paths.js";

export interface CheckOptions {
  configPath: string;
  baseRef?: string;
  changedPaths?: string[];
}
export interface CheckResult {
  findings: Finding[];
  identityDiffs: IdentityDiff[];
  suites: CanonicalSuite[];
  notices: string[];
}
const reportFinding = (path: string): Finding => ({
  code: "REPORT_MISSING",
  severity: "error",
  message: `Required report was not produced: ${path}`,
  remediation:
    "Configure the test command to write every required JUnit report.",
});

export const check = async ({
  configPath,
  baseRef,
  changedPaths,
}: CheckOptions): Promise<CheckResult> => {
  const loaded = await loadRuntimeConfig(configPath);
  const notices: string[] = [];
  for (const reportPath of loaded.reportPaths)
    await assertSafeInRootPath(loaded.root, reportPath);
  await cleanReports(loaded.reportPaths);
  const command = await runConfiguredCommand(
    loaded.root,
    loaded.config.command,
  );
  if (command.finding)
    return { findings: [command.finding], identityDiffs: [], suites: [], notices };
  const missing = await missingReports(loaded.reportPaths);
  if (missing.length > 0)
    return {
      findings: missing.map(reportFinding),
      identityDiffs: [],
      suites: [],
      notices,
    };
  for (const reportPath of loaded.reportPaths)
    await assertSafeInRootPath(loaded.root, reportPath);
  const suites = await loadReports(loaded.root, loaded.config);
  const baseline = await readBaselineIfPresent(
    loaded.root,
    loaded.baselinePath,
  );
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
    findings: result.findings,
    identityDiffs: result.identityDiffs,
    suites,
    notices,
  };
};
