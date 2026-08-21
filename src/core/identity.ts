import type { Config, EvaluationResult, SuitePolicy } from "./model.js";

export interface IdentityDiff {
  suite: string;
  missingTestIds: string[];
  addedTestIds: string[];
}

declare module "./model.js" {
  interface EvaluationResult {
    identityDiffs: IdentityDiff[];
  }
}

export const resolveSuitePolicy = (
  config: Config,
  suiteName: string,
): SuitePolicy =>
  config.policy.protectedSuites.find((item) =>
    new RegExp(item.match).test(suiteName),
  ) ?? config.policy.default;

export interface MultisetDifference {
  missing: string[];
  added: string[];
}

export const multisetDifference = (
  baseline: readonly string[],
  current: readonly string[],
): MultisetDifference => {
  const before = [...baseline].sort();
  const after = [...current].sort();
  const missing: string[] = [];
  const added: string[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length && afterIndex < after.length) {
    const previous = before[beforeIndex]!;
    const next = after[afterIndex]!;
    if (previous === next) {
      beforeIndex += 1;
      afterIndex += 1;
    } else if (previous < next) {
      missing.push(previous);
      beforeIndex += 1;
    } else {
      added.push(next);
      afterIndex += 1;
    }
  }
  missing.push(...before.slice(beforeIndex));
  added.push(...after.slice(afterIndex));
  return { missing, added };
};

export type { EvaluationResult };
