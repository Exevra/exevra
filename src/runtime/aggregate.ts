import {
  aggregateSuites,
  evaluate,
  type Finding,
} from "../core/index.js";
import type { CheckResult } from "./check.js";
import { loadRuntimeConfig, readBaselineIfPresent } from "./load.js";
import { RuntimeError } from "./paths.js";
import { loadAggregatedReports } from "./reports.js";

export interface AggregateOptions {
  configPath: string;
}

const shardFinding = (shard: string): Finding => ({
  code: "SHARD_MISSING",
  severity: "error",
  message: `Required shard artifact directory is missing: ${shard}`,
  remediation: "Download every configured shard artifact before aggregating reports.",
});

const reportFinding = (path: string): Finding => ({
  code: "REPORT_MISSING",
  severity: "error",
  message: `Required shard report was not found: ${path}`,
  remediation: "Configure every shard to upload the required JUnit reports.",
});

const zeroExecutionFinding = (shard: string): Finding => ({
  code: "SHARD_NO_TESTS_EXECUTED",
  severity: "error",
  message: `Shard executed no non-skipped tests: ${shard}`,
  remediation: "Check test discovery and the shard's uploaded JUnit reports.",
});

export const aggregate = async ({
  configPath,
}: AggregateOptions): Promise<CheckResult> => {
  const loaded = await loadRuntimeConfig(configPath);
  const aggregation = loaded.config.aggregation;
  if (!aggregation)
    throw new RuntimeError("aggregation configuration is required for aggregate checks");

  const reports = await loadAggregatedReports(loaded.root, aggregation);
  const suites = aggregateSuites(
    reports.shards.flatMap((shard) => shard.suites),
  );
  const findings: Finding[] = [
    ...reports.missingShards.map((shard) =>
      shardFinding(`${aggregation.root}/${shard}`),
    ),
    ...reports.missingReports.map(reportFinding),
    ...reports.shards
      .filter(
        (shard) =>
          shard.reportPaths.length > 0 &&
          shard.suites.reduce((total, suite) => total + suite.executed, 0) === 0,
      )
      .map((shard) => zeroExecutionFinding(shard.shard)),
  ];
  const notices = [
    "Changed-file comparison is unavailable for aggregate checks.",
  ];
  if (findings.length > 0)
    return { findings, identityDiffs: [], suites, notices };

  const baseline = await readBaselineIfPresent(loaded.root, loaded.baselinePath);
  const result = evaluate({
    config: loaded.config,
    baseline,
    currentSuites: suites,
    changedPaths: [],
  });
  return { ...result, suites, notices };
};
