import assert from "node:assert/strict";
import test from "node:test";
import { compareBaseline } from "../../src/core/diff.js";
import type { Baseline, CanonicalSuite, Config } from "../../src/core/model.js";

const suite = (
  name: string,
  executed: number,
  skipped: number,
): CanonicalSuite => ({
  name,
  executed,
  skipped,
  tests: [],
});

const baseline: Baseline = {
  schemaVersion: 1,
  generatedAt: "2026-08-28T00:00:00.000Z",
  command: "recorded command",
  reports: ["reports/b.xml", "reports/a.xml"],
  suites: [
    { name: "removed", executed: 4, skipped: 0, testIdsHash: "sha256:" + "a".repeat(64) },
    { name: "changed", executed: 10, skipped: 1, testIdsHash: "sha256:" + "b".repeat(64) },
    { name: "same", executed: 3, skipped: 2, testIdsHash: "sha256:" + "c".repeat(64) },
  ],
};

const config: Config = {
  version: 1,
  baseline: "baseline.json",
  command: "current command",
  reports: ["reports/a.xml", "reports/b.xml"],
  watched: [],
  policy: {
    default: {
      minExecuted: 0,
      maxDropPercent: 100,
      identity: "off",
      identityDetails: "counts",
    },
    protectedSuites: [],
  },
};

test("compares sorted suite additions, removals, and count changes", () => {
  const result = compareBaseline(baseline, [
    suite("same", 3, 2),
    suite("added", 1, 0),
    suite("changed", 5, 2),
    suite("added", 1, 0),
  ], config);

  assert.deepEqual(result.suites, [
    { name: "added", kind: "added", current: { executed: 2, skipped: 0 } },
    {
      name: "changed",
      kind: "changed",
      baseline: { executed: 10, skipped: 1 },
      current: { executed: 5, skipped: 2 },
    },
    { name: "removed", kind: "removed", baseline: { executed: 4, skipped: 0 } },
  ]);
  assert.equal(result.commandChanged, true);
  assert.equal(result.reportsChanged, false);
  assert.equal(JSON.stringify(result).includes(config.command), false);
});

test("flags a skipped-count-only suite change", () => {
  const result = compareBaseline(
    { ...baseline, suites: [baseline.suites[2]] },
    [suite("same", 3, 3)],
    config,
  );

  assert.deepEqual(result.suites, [
    {
      name: "same",
      kind: "changed",
      baseline: { executed: 3, skipped: 2 },
      current: { executed: 3, skipped: 3 },
    },
  ]);
});

test("flags a changed normalized report set", () => {
  const result = compareBaseline(
    { ...baseline, reports: ["reports/a.xml", "reports/b.xml"] },
    [suite("same", 3, 2)],
    { ...config, reports: ["reports/a.xml", "reports/c.xml"] },
  );

  assert.equal(result.reportsChanged, true);
});

test("omits unchanged suites and returns stable booleans for identical config", () => {
  const result = compareBaseline(
    {
      ...baseline,
      command: config.command,
      reports: [...config.reports].reverse(),
      suites: [
        {
          name: "same",
          executed: 3,
          skipped: 2,
          testIdsHash: "sha256:" + "c".repeat(64),
        },
      ],
    },
    [suite("same", 3, 2)],
    config,
  );

  assert.deepEqual(result.suites, []);
  assert.equal(result.commandChanged, false);
  assert.equal(result.reportsChanged, false);
  assert.equal(JSON.stringify(result).includes(baseline.command), false);
});
