import assert from "node:assert/strict";
import test from "node:test";
import {
  renderGitHubActions,
  renderJson,
  renderText,
} from "../../src/core/index.js";

const blocked = {
  findings: [
    {
      code: "NO_TESTS_EXECUTED" as const,
      severity: "error" as const,
      suite: "unit",
      baseExecuted: 10,
      headExecuted: 0,
      message: "No tests executed.",
      remediation: "Restore test discovery.",
    },
  ],
  notices: [
    "Changed-file comparison is unavailable because no base ref was supplied.",
  ],
  suites: [
    {
      name: "unit",
      executed: 0,
      skipped: 0,
      tests: [{ id: "private-test-id", status: "passed" as const }],
    },
  ],
};

test("renderers present blocked findings without test identifiers or raw report data", () => {
  const text = renderText(blocked);
  assert.match(text, /^EXEVRA BLOCKED/m);
  assert.match(text, /unit: 10 -> 0/);
  assert.match(text, /Restore test discovery/);

  const json = renderJson(blocked);
  assert.deepEqual(JSON.parse(json), {
    outcome: "blocked",
    findings: [
      {
        code: "NO_TESTS_EXECUTED",
        severity: "error",
        suite: "unit",
        baseExecuted: 10,
        headExecuted: 0,
        message: "No tests executed.",
        remediation: "Restore test discovery.",
      },
    ],
    notices: [
      "Changed-file comparison is unavailable because no base ref was supplied.",
    ],
    suites: [{ name: "unit", executed: 0, skipped: 0 }],
  });
  assert.doesNotMatch(json, /private-test-id/);
  assert.doesNotMatch(text, /private-test-id|<testsuite/);

  const githubActions = renderGitHubActions(blocked);
  assert.match(githubActions, /^EXEVRA BLOCKED/m);
  assert.match(githubActions, /::error title=EXEVRA NO_TESTS_EXECUTED::/);
  assert.match(githubActions, /unit: 10 -> 0/);
  assert.doesNotMatch(githubActions, /private-test-id|<testsuite/);
});

test("renderers present a passing outcome", () => {
  const input = {
    findings: [],
    notices: [],
    suites: [{ name: "unit", executed: 10, skipped: 0, tests: [] }],
  };
  assert.match(renderText(input), /^EXEVRA PASSED/m);
  assert.equal(JSON.parse(renderJson(input)).outcome, "passed");
  assert.match(renderGitHubActions(input), /^EXEVRA PASSED/m);
});

test("renderers preserve aggregate findings in every output contract", () => {
  const input = {
    findings: [
      {
        code: "SHARD_MISSING" as const,
        severity: "error" as const,
        message: "Required shard artifact directory is missing: unit-jdk21",
        remediation: "Download every configured shard artifact before aggregating reports.",
      },
    ],
    suites: [],
  };

  assert.match(renderText(input), /SHARD_MISSING/);
  assert.equal(JSON.parse(renderJson(input)).findings[0].code, "SHARD_MISSING");
  assert.match(
    renderGitHubActions(input),
    /::error title=EXEVRA SHARD_MISSING::/,
  );
});

test("renderers present warning-only identity drift without blocking", () => {
  const warning = {
    code: "TEST_IDENTITIES_CHANGED" as const,
    severity: "warning" as const,
    suite: "unit",
    baseExecuted: 10,
    headExecuted: 10,
    message: "Test identities changed in suite unit.",
    remediation:
      "Review the suite's test identities and update the baseline if the change is intended.",
  };
  assert.match(renderText({ findings: [warning] }), /^EXEVRA PASSED WITH WARNINGS/m);
  assert.equal(
    JSON.parse(renderJson({ findings: [warning] })).outcome,
    "passed_with_warnings",
  );
  assert.match(
    renderGitHubActions({ findings: [warning] }),
    /::warning title=EXEVRA TEST_IDENTITIES_CHANGED::/,
  );
});

test("identity names render as bounded, sorted, JSON-escaped text details only", () => {
  const missingTestIds = Array.from(
    { length: 22 },
    (_, index) => `missing-${String(21 - index).padStart(2, "0")}\u001f`,
  );
  const addedTestIds = Array.from(
    { length: 22 },
    (_, index) => `added-${String(21 - index).padStart(2, "0")}\u0007`,
  );
  const input = {
    findings: [
      {
        code: "TEST_IDENTITIES_CHANGED" as const,
        severity: "warning" as const,
        suite: "unit",
        baseExecuted: 22,
        headExecuted: 22,
        missingTestCount: 22,
        addedTestCount: 22,
        message: "Test identities changed in suite unit.",
        remediation: "Review the suite's test identities.",
      },
    ],
  };
  const identityDiffs = [{ suite: "unit", missingTestIds, addedTestIds }];
  const text = renderText(input, { identityDiffs });

  assert.match(text, /22 missing, 22 added/);
  assert.match(text, /"missing-00\\u001f"/);
  assert.match(text, /"missing-19\\u001f"/);
  assert.match(text, /missing.*and 2 more/s);
  assert.match(text, /"added-00\\u0007"/);
  assert.match(text, /"added-19\\u0007"/);
  assert.match(text, /added.*and 2 more/s);
  assert.doesNotMatch(text, /missing-20|missing-21|added-20|added-21/);

  const json = renderJson(input);
  assert.deepEqual(JSON.parse(json).findings[0], input.findings[0]);
  assert.doesNotMatch(json, /missing-|added-|\\u001f|\\u0007/);

  const githubActions = renderGitHubActions(input);
  assert.match(githubActions, /22 missing, 22 added/);
  assert.doesNotMatch(githubActions, /missing-|added-|\\u001f|\\u0007/);
});

test("renderers order output deterministically and escape workflow commands", () => {
  const findings = [
    {
      code: "SUITE_DROP_EXCEEDED" as const,
      severity: "error" as const,
      suite: "zeta",
      message: "z%",
      remediation: "z",
    },
    {
      code: "NO_TESTS_EXECUTED" as const,
      severity: "error" as const,
      suite: "alpha",
      message: "a\nnext",
      remediation: "a",
    },
  ];
  const forward = { findings, notices: ["zeta", "alpha"], suites: [] };
  const reversed = {
    findings: [...findings].reverse(),
    notices: ["alpha", "zeta"],
    suites: [],
  };
  assert.equal(renderJson(forward), renderJson(reversed));
  const githubActions = renderGitHubActions(forward);
  assert.match(githubActions, /a%0Anext/);
  assert.match(githubActions, /z%25/);
});
