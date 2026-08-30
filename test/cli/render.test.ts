import assert from "node:assert/strict";
import test from "node:test";
import {
  renderGitHubActions,
  renderJson,
  renderText,
} from "../../src/core/index.js";
import { renderGitHubSummary } from "../../src/cli/summary.js";

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

const filtered = {
  findings: [
    {
      code: "TEST_FILTERED" as const,
      severity: "warning" as const,
      message:
        "Maven test-selection flags detected in the configured command: -Dgroups, -Dtest.",
      remediation:
        "Remove the flags for a full test run, or explicitly set maven.filter_policy: off after reviewing the intended test scope.",
    },
  ],
  notices: [],
  suites: [],
};

const doctor = {
  findings: [],
  notices: [],
  suites: [
    {
      name: "unit",
      executed: 10,
      skipped: 0,
      tests: [{ id: "private-test-id", status: "passed" as const }],
    },
  ],
  checks: [
    {
      name: "configuration" as const,
      status: "passed" as const,
      message: "Configuration loaded and paths are valid.",
    },
    {
      name: "execution intent" as const,
      status: "warning" as const,
      message:
        "The configured command contains a test-selection or skip flag.",
    },
    {
      name: "test command" as const,
      status: "passed" as const,
      message: "The configured test command completed.",
    },
    {
      name: "reports" as const,
      status: "passed" as const,
      message: "Required JUnit reports were collected.",
    },
    {
      name: "baseline" as const,
      status: "passed" as const,
      message: "A compatible baseline is available.",
    },
    {
      name: "evaluation" as const,
      status: "passed" as const,
      message: "Existing execution-integrity rules passed.",
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

test("renderers preserve unreadable report findings in every output format", () => {
  const finding = {
    code: "REPORT_UNREADABLE" as const,
    severity: "error" as const,
    message: "Required report could not be read: service/target/surefire-reports/TEST-unit.xml",
    remediation: "Ensure the generated JUnit report is readable before evaluating test execution.",
  };
  assert.match(renderText({ findings: [finding] }), /\[REPORT_UNREADABLE\]/);
  assert.match(renderJson({ findings: [finding] }), /"code": "REPORT_UNREADABLE"/);
  assert.match(renderGitHubActions({ findings: [finding] }), /EXEVRA REPORT_UNREADABLE/);
});

test("GitHub summaries keep finding details and test identities private", () => {
  const summary = renderGitHubSummary({
    findings: [
      {
        code: "REPORT_UNREADABLE",
        severity: "error",
        message: "<script>SECRET_REPORT</script>",
        remediation: "Review & restore.",
      },
    ],
    suites: [
      {
        name: "unit",
        executed: 0,
        skipped: 0,
        tests: [{ id: "secret-test-id", status: "passed" }],
      },
    ],
  });

  assert.match(summary, /^## Exevra\n\n<pre><code>/);
  assert.match(summary, /REPORT_UNREADABLE/);
  assert.equal(
    ["SECRET_REPORT", "Review", "<script>", "secret-test-id"].some((value) =>
      summary.includes(value),
    ),
    false,
  );
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

test("renderers expose Maven filter findings without selector details", () => {
  const text = renderText(filtered);
  const json = renderJson(filtered);
  const githubActions = renderGitHubActions(filtered);

  assert.match(text, /TEST_FILTERED/);
  assert.match(json, /\"code\": \"TEST_FILTERED\"/);
  assert.match(githubActions, /EXEVRA TEST_FILTERED/);
  assert.doesNotMatch(`${text}${json}${githubActions}`, /UserServiceTest|integration/);
  assert.doesNotMatch(
    `${text}${json}${githubActions}`,
    /mvn verify -Dtest=UserServiceTest -Dgroups integration/,
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

test("renderers include deterministic baseline changes only when provided", () => {
  const input = {
    findings: [
      {
        code: "SUITE_DROP_EXCEEDED" as const,
        severity: "error" as const,
        suite: "unit",
        baseExecuted: 10,
        headExecuted: 8,
        message:
          "Test execution dropped below the allowed threshold for suite unit.",
        remediation:
          "Review the recent changes to unit and update the baseline only if the reduction is intentional.",
      },
    ],
    notices: [],
    suites: [
      { name: "unit", executed: 8, skipped: 2, tests: [] },
      { name: "integration", executed: 2, skipped: 0, tests: [] },
    ],
    changes: {
      commandChanged: true,
      reportsChanged: false,
      suites: [
        {
          name: "unit",
          kind: "changed" as const,
          baseline: { executed: 10, skipped: 1 },
          current: { executed: 8, skipped: 2 },
        },
        {
          name: "integration",
          kind: "added" as const,
          current: { executed: 2, skipped: 0 },
        },
        {
          name: "legacy",
          kind: "removed" as const,
          baseline: { executed: 4, skipped: 0 },
        },
      ],
    },
  };

  assert.equal(
    renderText(input),
    "EXEVRA BLOCKED\n" +
      "[SUITE_DROP_EXCEEDED] unit: 10 -> 8 Test execution dropped below the allowed threshold for suite unit. Remediation: Review the recent changes to unit and update the baseline only if the reduction is intentional.\n" +
      "DIFF\n" +
      "command changed: yes\n" +
      "reports changed: no\n" +
      "suite added: integration (2 executed, 0 skipped)\n" +
      "suite removed: legacy (4 executed, 0 skipped)\n" +
      "suite changed: unit (10 -> 8 executed, 1 -> 2 skipped)\n",
  );

  assert.deepEqual(JSON.parse(renderJson(input)), {
    outcome: "blocked",
    findings: input.findings,
    notices: [],
    suites: [
      { name: "integration", executed: 2, skipped: 0 },
      { name: "unit", executed: 8, skipped: 2 },
    ],
    changes: {
      commandChanged: true,
      reportsChanged: false,
      suites: [
        {
          name: "integration",
          kind: "added",
          current: { executed: 2, skipped: 0 },
        },
        {
          name: "legacy",
          kind: "removed",
          baseline: { executed: 4, skipped: 0 },
        },
        {
          name: "unit",
          kind: "changed",
          baseline: { executed: 10, skipped: 1 },
          current: { executed: 8, skipped: 2 },
        },
      ],
    },
  });

  const githubActions = renderGitHubActions(input);
  assert.match(githubActions, /^EXEVRA BLOCKED/m);
  assert.match(
    githubActions,
    /::notice title=EXEVRA DIFF::command changed: yes/,
  );
  assert.match(
    githubActions,
    /::notice title=EXEVRA DIFF::suite changed: unit \(10 -> 8 executed, 1 -> 2 skipped\)/,
  );
  assert.doesNotMatch(
    githubActions,
    /recorded command|current command|artifacts\/junit|private-test-id|<testsuite/,
  );

  const withoutChanges = JSON.parse(
    renderJson({ findings: input.findings, notices: [], suites: input.suites }),
  ) as Record<string, unknown>;
  assert.equal("changes" in withoutChanges, false);
});

test("GitHub Actions renders existing notices before diff notices", () => {
  const output = renderGitHubActions({
    findings: [],
    notices: ["existing notice"],
    suites: [],
    changes: { commandChanged: false, reportsChanged: false, suites: [] },
  });

  assert.ok(
    output.indexOf("EXEVRA NOTICE") < output.indexOf("EXEVRA DIFF"),
  );
});

test("renderers include a fixed-order doctor section only when checks are present", () => {
  assert.equal(
    renderText(doctor),
    "EXEVRA PASSED\n" +
      "DOCTOR\n" +
      "configuration: passed - Configuration loaded and paths are valid.\n" +
      "execution intent: warning - The configured command contains a test-selection or skip flag.\n" +
      "test command: passed - The configured test command completed.\n" +
      "reports: passed - Required JUnit reports were collected.\n" +
      "baseline: passed - A compatible baseline is available.\n" +
      "evaluation: passed - Existing execution-integrity rules passed.\n",
  );

  assert.equal(
    "checks" in JSON.parse(renderJson({ findings: [], notices: [], suites: [] })),
    false,
  );
  assert.deepEqual(JSON.parse(renderJson(doctor)).checks, doctor.checks);

  const githubActions = renderGitHubActions(doctor);
  assert.match(githubActions, /::notice title=EXEVRA DOCTOR::DOCTOR/);
  assert.match(
    githubActions,
    /::notice title=EXEVRA DOCTOR::configuration: passed - Configuration loaded and paths are valid\./,
  );
  assert.match(
    githubActions,
    /::notice title=EXEVRA DOCTOR::execution intent: warning - The configured command contains a test-selection or skip flag\./,
  );
  assert.doesNotMatch(
    githubActions,
    /private-test-id|node tools\/fake-junit-command|<testsuite/,
  );
});

test("doctor renderers omit inherited findings and execution details", () => {
  const unsafeDoctor = {
    ...doctor,
    findings: [
      {
        code: "REPORT_UNREADABLE" as const,
        severity: "error" as const,
        message:
          "Required report could not be read: /private/project/artifacts/TEST-secret.xml",
        remediation: "Inspect /private/project/artifacts/TEST-secret.xml.",
      },
      {
        code: "TEST_FILTERED" as const,
        severity: "warning" as const,
        message: "node tools/run-tests.mjs --grep SecretTest",
        remediation: "Remove --grep SecretTest.",
      },
    ],
    notices: ["report content: SECRET_REPORT_CONTENT"],
    changes: {
      commandChanged: true,
      reportsChanged: true,
      suites: [],
    },
  };
  const forbidden =
    /node tools\/run-tests\.mjs|--grep|SecretTest|SECRET_REPORT_CONTENT|\/private\/project|TEST-secret/;

  const text = renderText(unsafeDoctor, {
    identityDiffs: [
      {
        suite: "unit",
        missingTestIds: ["secret-test-id"],
        addedTestIds: [],
      },
    ],
  });
  const json = renderJson(unsafeDoctor);
  const githubActions = renderGitHubActions(unsafeDoctor);

  assert.doesNotMatch(text, forbidden);
  assert.doesNotMatch(json, forbidden);
  assert.doesNotMatch(githubActions, forbidden);
  assert.deepEqual(Object.keys(JSON.parse(json)), ["outcome", "checks"]);
});
