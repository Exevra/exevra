import type {
  Baseline,
  CanonicalSuite,
  Config,
  EvaluationResult,
  Finding,
} from "./model.js";
import { aggregateSuites, testIdHashes, testIdsHash } from "./junit.js";
import {
  multisetDifference,
  resolveSuitePolicy,
  type IdentityDiff,
} from "./identity.js";

export interface EvaluationInput {
  config: Config;
  baseline?: Baseline;
  currentSuites: CanonicalSuite[];
  changedPaths?: string[];
}

const finding = (
  code: Finding["code"],
  message: string,
  extra: Partial<Finding> = {},
): Finding => ({
  code,
  severity: "error",
  message,
  remediation: "Review the configured test execution policy and baseline.",
  ...extra,
});
const matches = (pattern: string, path: string): boolean =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  ).test(path);

export const evaluate = ({
  config,
  baseline,
  currentSuites,
  changedPaths = [],
}: EvaluationInput): EvaluationResult => {
  if (!baseline)
    return {
      findings: [
        finding("BASELINE_MISSING", "No baseline is available.", {
          remediation:
            "Create and review a schema-v1 baseline before checking execution.",
        }),
      ],
      identityDiffs: [],
    };
  if (baseline.schemaVersion !== 1)
    return {
      findings: [
        finding(
          "BASELINE_SCHEMA_UNSUPPORTED",
          `Baseline schema version ${baseline.schemaVersion} is unsupported.`,
          {
            remediation:
              "Regenerate the baseline with a supported Exevra version.",
          },
        ),
      ],
      identityDiffs: [],
    };
  const findings: Finding[] = [];
  const identityDiffs: IdentityDiff[] = [];
  const normalizedSuites = aggregateSuites(currentSuites);
  const current = new Map(normalizedSuites.map((suite) => [suite.name, suite]));
  const base = new Map(baseline.suites.map((suite) => [suite.name, suite]));
  const names = [...new Set([...current.keys(), ...base.keys()])].sort();
  const totalExecuted = normalizedSuites.reduce(
    (total, suite) => total + suite.executed,
    0,
  );
  if (totalExecuted === 0)
    findings.push(
      finding("NO_TESTS_EXECUTED", "No non-skipped tests were executed.", {
        remediation: "Check test discovery and the configured report output.",
      }),
    );
  for (const name of names) {
    const currentSuite = current.get(name);
    const baselineSuite = base.get(name);
    const headExecuted = currentSuite?.executed ?? 0;
    const baseExecuted = baselineSuite?.executed ?? 0;
    const rule = resolveSuitePolicy(config, name);
    if (headExecuted < rule.minExecuted)
      findings.push(
        finding(
          "SUITE_BELOW_MINIMUM",
          `Suite ${name} executed ${headExecuted}; minimum is ${rule.minExecuted}.`,
          { suite: name, baseExecuted, headExecuted },
        ),
      );
    const drop =
      baseExecuted > 0
        ? Math.max(0, ((baseExecuted - headExecuted) / baseExecuted) * 100)
        : 0;
    if (drop > rule.maxDropPercent)
      findings.push(
        finding(
          "SUITE_DROP_EXCEEDED",
          `Suite ${name} executed ${baseExecuted} -> ${headExecuted}, a ${drop}% drop.`,
          { suite: name, baseExecuted, headExecuted },
        ),
      );
    if (
      currentSuite &&
      baselineSuite &&
      rule.identity !== "off" &&
      testIdsHash(currentSuite.tests) !== baselineSuite.testIdsHash
    ) {
      const hashDiff = baselineSuite.testIdHashes
        ? multisetDifference(
            baselineSuite.testIdHashes,
            testIdHashes(currentSuite.tests),
          )
        : undefined;
      const includeNames =
        rule.identityDetails === "names" && baselineSuite.testIds !== undefined;
      if (includeNames) {
        const names = multisetDifference(
          baselineSuite.testIds!,
          currentSuite.tests.map((test) => test.id),
        );
        identityDiffs.push({
          suite: name,
          missingTestIds: names.missing,
          addedTestIds: names.added,
        });
      }
      findings.push(
        finding(
          "TEST_IDENTITIES_CHANGED",
          `Test identities changed in suite ${name}.`,
          {
            severity: rule.identity === "enforce" ? "error" : "warning",
            suite: name,
            baseExecuted,
            headExecuted,
            ...(hashDiff === undefined
              ? {}
              : {
                  missingTestCount: hashDiff.missing.length,
                  addedTestCount: hashDiff.added.length,
                }),
            remediation:
              !baselineSuite.testIdHashes ||
              (rule.identityDetails === "names" && !baselineSuite.testIds)
                ? "Re-record the baseline to enable identity-difference details."
                : "Review the suite's test identities and update the baseline if the change is intended.",
          },
        ),
      );
    }
  }
  const signalBreach = findings.some(
    (item) =>
      item.code === "SUITE_BELOW_MINIMUM" ||
      item.code === "SUITE_DROP_EXCEEDED",
  );
  if (
    signalBreach &&
    changedPaths.some((path) =>
      config.watched.some((pattern) => matches(pattern, path)),
    )
  )
    findings.push(
      finding(
        "WATCHED_CONFIG_CHANGED_WITH_SIGNAL_DROP",
        "A watched configuration path changed while execution signal dropped.",
        {
          remediation:
            "Review the configuration change and the suite execution delta together.",
        },
      ),
    );
  return { findings, identityDiffs };
};

export type { EvaluationResult } from "./model.js";
