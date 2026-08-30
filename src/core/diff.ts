import { aggregateSuites } from "./junit.js";
import type {
  Baseline,
  BaselineDiff,
  CanonicalSuite,
  Config,
  SuiteChange,
} from "./model.js";

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sameCounts = (
  left: { executed: number; skipped: number },
  right: { executed: number; skipped: number },
): boolean => left.executed === right.executed && left.skipped === right.skipped;

const suiteChange = (
  name: string,
  kind: SuiteChange["kind"],
  baseline: { executed: number; skipped: number } | undefined,
  current: { executed: number; skipped: number } | undefined,
): SuiteChange => ({
  name,
  kind,
  ...(baseline === undefined ? {} : { baseline }),
  ...(current === undefined ? {} : { current }),
});

export const compareBaseline = (
  baseline: Baseline,
  currentSuites: readonly CanonicalSuite[],
  config: Config,
): BaselineDiff => {
  const current = aggregateSuites(currentSuites);
  const currentByName = new Map(current.map((suite) => [suite.name, suite]));
  const baselineByName = new Map(baseline.suites.map((suite) => [suite.name, suite]));
  const names = [...new Set([...baselineByName.keys(), ...currentByName.keys()])].sort(compareText);
  const suites: SuiteChange[] = [];

  for (const name of names) {
    const currentSuite = currentByName.get(name);
    const baselineSuite = baselineByName.get(name);
    if (baselineSuite === undefined && currentSuite !== undefined) {
      suites.push(
        suiteChange(
          name,
          "added",
          undefined,
          { executed: currentSuite.executed, skipped: currentSuite.skipped },
        ),
      );
      continue;
    }
    if (currentSuite === undefined && baselineSuite !== undefined) {
      suites.push(
        suiteChange(
          name,
          "removed",
          { executed: baselineSuite.executed, skipped: baselineSuite.skipped },
          undefined,
        ),
      );
      continue;
    }
    if (
      baselineSuite !== undefined &&
      currentSuite !== undefined &&
      !sameCounts(baselineSuite, currentSuite)
    ) {
      suites.push(
        suiteChange(
          name,
          "changed",
          { executed: baselineSuite.executed, skipped: baselineSuite.skipped },
          { executed: currentSuite.executed, skipped: currentSuite.skipped },
        ),
      );
    }
  }

  const sortedBaselineReports = [...baseline.reports].sort(compareText);
  const sortedConfigReports = [...config.reports].sort(compareText);

  return {
    suites,
    commandChanged: baseline.command !== config.command,
    reportsChanged:
      sortedBaselineReports.length !== sortedConfigReports.length ||
      sortedBaselineReports.some(
        (report, index) => report !== sortedConfigReports[index],
      ),
  };
};
