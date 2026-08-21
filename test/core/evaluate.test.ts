import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/core/config.js";
import { evaluate } from "../../src/core/evaluate.js";
import { testIdHashes, testIdsHash } from "../../src/core/junit.js";
import type { Baseline, Config, CanonicalSuite } from "../../src/core/model.js";

const config: Config = {
  version: 1,
  baseline: ".exevra/baseline.json",
  command: "npm test",
  reports: ["junit.xml"],
  watched: ["runner-config.json"],
  policy: {
    default: {
      minExecuted: 1,
      maxDropPercent: 0,
      identity: "off",
      identityDetails: "counts",
    },
    protectedSuites: [],
  },
};
const suites = (name: string, executed: number): CanonicalSuite[] => [
  { name, executed, skipped: 0, tests: [] },
];
const baseline = (executed: number, name = "unit"): Baseline => ({
  schemaVersion: 1,
  generatedAt: "2026-08-11T00:00:00.000Z",
  command: "npm test",
  reports: ["junit.xml"],
  suites: [
    { name, executed, skipped: 0, testIdsHash: `sha256:${"a".repeat(64)}` },
  ],
});
const codes = (input: Parameters<typeof evaluate>[0]) =>
  evaluate(input).findings.map((finding) => finding.code);
const identityConfig = (
  identity?: "off" | "warn" | "enforce",
  identityDetails?: "counts" | "names",
): Config =>
  loadConfig({
    version: 1,
    baseline: ".exevra/baseline.json",
    command: "npm test",
    reports: ["junit.xml"],
    policy: {
      default: {
        min_executed: 1,
        max_drop_percent: 0,
        ...(identity === undefined ? {} : { identity }),
        ...(identityDetails === undefined
          ? {}
          : { identity_details: identityDetails }),
      },
    },
  });
const protectedIdentityConfig = (
  identity: "off" | "warn" | "enforce",
  protectedIdentity: "off" | "warn" | "enforce",
): Config =>
  loadConfig({
    version: 1,
    baseline: ".exevra/baseline.json",
    command: "npm test",
    reports: ["junit.xml"],
    policy: {
      default: {
        min_executed: 1,
        max_drop_percent: 0,
        identity,
      },
      protected_suites: [
        {
          name: "unit",
          match: "^unit$",
          min_executed: 1,
          max_drop_percent: 0,
          identity: protectedIdentity,
        },
      ],
    },
  });
const identitySuite = (ids: string[]): CanonicalSuite[] => [
  {
    name: "unit",
    tests: ids.map((id) => ({ id, status: "passed" })),
    executed: ids.length,
    skipped: 0,
  },
];
const identityBaseline = (ids: string[]): Baseline => ({
  schemaVersion: 1,
  generatedAt: "2026-08-11T00:00:00.000Z",
  command: "npm test",
  reports: ["junit.xml"],
  suites: [
    {
      name: "unit",
      executed: ids.length,
      skipped: 0,
      testIdsHash: testIdsHash(
        ids.map((id) => ({ id, status: "passed" as const })),
      ),
    },
  ],
});
const detailedIdentityBaseline = (
  ids: string[],
  includeNames = false,
): Baseline => ({
  schemaVersion: 1,
  generatedAt: "2026-08-11T00:00:00.000Z",
  command: "npm test",
  reports: ["junit.xml"],
  suites: [
    {
      name: "unit",
      executed: ids.length,
      skipped: 0,
      testIdsHash: testIdsHash(
        ids.map((id) => ({ id, status: "passed" as const })),
      ),
      testIdHashes: testIdHashes(
        ids.map((id) => ({ id, status: "passed" as const })),
      ),
      ...(includeNames ? { testIds: [...ids].sort() } : {}),
    },
  ],
});
const codeAndSeverity = (input: Parameters<typeof evaluate>[0]) =>
  evaluate(input).findings.map((finding) => [
    finding.code,
    finding.severity,
  ]);

test("passes a conforming suite and reports independent zero execution", () => {
  assert.deepEqual(
    codes({
      config,
      baseline: baseline(10),
      currentSuites: suites("unit", 10),
    }),
    [],
  );
  assert.deepEqual(
    codes({ config, baseline: baseline(10), currentSuites: suites("unit", 0) }),
    ["NO_TESTS_EXECUTED", "SUITE_BELOW_MINIMUM", "SUITE_DROP_EXCEEDED"],
  );
});

test("uses first matching protected policy for minimum and drop breaches", () => {
  const protectedConfig: Config = {
    ...config,
    policy: {
      ...config.policy,
      protectedSuites: [
        {
          name: "api",
          match: "^unit(?:[./:].*)?$",
          minExecuted: 10,
          maxDropPercent: 0,
          identity: "off",
          identityDetails: "counts",
        },
      ],
    },
  };
  assert.deepEqual(
    codes({
      config: protectedConfig,
      baseline: baseline(10, "unit/api"),
      currentSuites: suites("unit/api", 9),
    }),
    ["SUITE_BELOW_MINIMUM", "SUITE_DROP_EXCEEDED"],
  );
});

test("emits watched-config signal only with an execution breach", () => {
  assert.deepEqual(
    codes({
      config,
      baseline: baseline(10),
      currentSuites: suites("unit", 8),
      changedPaths: ["runner-config.json"],
    }),
    ["SUITE_DROP_EXCEEDED", "WATCHED_CONFIG_CHANGED_WITH_SIGNAL_DROP"],
  );
  assert.deepEqual(
    codes({
      config,
      baseline: baseline(10),
      currentSuites: suites("unit", 10),
      changedPaths: ["runner-config.json"],
    }),
    [],
  );
});

test("reports a missing or incompatible baseline before comparison", () => {
  assert.deepEqual(codes({ config, currentSuites: suites("unit", 10) }), [
    "BASELINE_MISSING",
  ]);
  assert.deepEqual(
    codes({
      config,
      baseline: { ...baseline(10), schemaVersion: 2 },
      currentSuites: suites("unit", 10),
    }),
    ["BASELINE_SCHEMA_UNSUPPORTED"],
  );
});

test("reports test identity drift at the configured severity", () => {
  const changed = identitySuite(["one", "three"]);
  const base = identityBaseline(["one", "two"]);
  assert.deepEqual(
    codeAndSeverity({
      config: identityConfig(),
      baseline: base,
      currentSuites: changed,
    }),
    [["TEST_IDENTITIES_CHANGED", "warning"]],
  );
  assert.deepEqual(
    codeAndSeverity({
      config: identityConfig("enforce"),
      baseline: base,
      currentSuites: changed,
    }),
    [["TEST_IDENTITIES_CHANGED", "error"]],
  );
  assert.deepEqual(
    codeAndSeverity({
      config: identityConfig("off"),
      baseline: base,
      currentSuites: changed,
    }),
    [],
  );
  assert.deepEqual(
    codeAndSeverity({
      config: identityConfig(),
      baseline: base,
      currentSuites: identitySuite(["one", "two"]),
    }),
    [],
  );
});

test("keeps suite drops as errors when test identities also change", () => {
  assert.deepEqual(
    codeAndSeverity({
      config: identityConfig(),
      baseline: identityBaseline(["one", "two"]),
      currentSuites: identitySuite(["one"]),
    }),
    [
      ["SUITE_DROP_EXCEEDED", "error"],
      ["TEST_IDENTITIES_CHANGED", "warning"],
    ],
  );
});

test("uses protected-suite identity overrides during evaluation", () => {
  const baseline = identityBaseline(["one", "two"]);
  const changed = identitySuite(["one", "three"]);
  assert.deepEqual(
    codeAndSeverity({
      config: protectedIdentityConfig("off", "enforce"),
      baseline,
      currentSuites: changed,
    }),
    [["TEST_IDENTITIES_CHANGED", "error"]],
  );
  assert.deepEqual(
    codeAndSeverity({
      config: protectedIdentityConfig("enforce", "off"),
      baseline,
      currentSuites: changed,
    }),
    [],
  );
});

test("does not expose test identifiers or hashes in identity findings", () => {
  const baseline = identityBaseline(["one", "two"]);
  const result = evaluate({
    config: identityConfig(),
    baseline,
    currentSuites: identitySuite(["one", "three"]),
  });
  const finding = result.findings.find(
    (item) => item.code === "TEST_IDENTITIES_CHANGED",
  );
  assert.ok(finding);
  assert.equal(finding.message.includes("one"), false);
  assert.equal(finding.message.includes("three"), false);
  assert.equal(finding.message.includes(baseline.suites[0]!.testIdsHash), false);
  assert.equal(finding.remediation.includes("one"), false);
  assert.equal(finding.remediation.includes("three"), false);
  assert.equal(
    finding.remediation.includes(baseline.suites[0]!.testIdsHash),
    false,
  );
});

test("identity count baseline reports exact missing and added counts", () => {
  const alpha = "unit.alpha\u001fone";
  const beta = "unit.beta\u001ftwo";
  const gamma = "unit.gamma\u001fthree";
  const delta = "unit.delta\u001ffour";
  const result = evaluate({
    config: identityConfig("warn", "counts"),
    baseline: detailedIdentityBaseline([alpha, beta]),
    currentSuites: identitySuite([alpha, gamma, delta]),
  });
  const finding = result.findings.find(
    (item) => item.code === "TEST_IDENTITIES_CHANGED",
  );

  assert.deepEqual(
    [finding?.missingTestCount, finding?.addedTestCount],
    [1, 2],
  );
  assert.deepEqual(Reflect.get(result, "identityDiffs"), []);
});

test("duplicate identity values use multiset arithmetic", () => {
  const alpha = "unit.alpha\u001fone";
  const beta = "unit.beta\u001ftwo";
  const result = evaluate({
    config: identityConfig("warn", "counts"),
    baseline: detailedIdentityBaseline([alpha, alpha, beta]),
    currentSuites: identitySuite([alpha, beta, beta]),
  });
  const finding = result.findings.find(
    (item) => item.code === "TEST_IDENTITIES_CHANGED",
  );

  assert.deepEqual(
    [finding?.missingTestCount, finding?.addedTestCount],
    [1, 1],
  );
});

test("legacy identity baseline asks the user to re-record without counts", () => {
  const result = evaluate({
    config: identityConfig(),
    baseline: identityBaseline(["unit.alpha\u001fone", "unit.beta\u001ftwo"]),
    currentSuites: identitySuite([
      "unit.alpha\u001fone",
      "unit.gamma\u001fthree",
    ]),
  });
  const finding = result.findings.find(
    (item) => item.code === "TEST_IDENTITIES_CHANGED",
  );

  assert.deepEqual(
    [finding?.missingTestCount, finding?.addedTestCount],
    [undefined, undefined],
  );
  assert.match(finding?.remediation ?? "", /re-record/i);
});

test("identity names baseline keeps sorted raw differences internal", () => {
  const alpha = "unit.alpha\u001fone";
  const beta = "unit.beta\u001ftwo";
  const gamma = "unit.gamma\u001fthree";
  const delta = "unit.delta\u001ffour";
  const result = evaluate({
    config: identityConfig("warn", "names"),
    baseline: detailedIdentityBaseline([gamma, alpha, beta], true),
    currentSuites: identitySuite([delta, alpha]),
  });

  assert.deepEqual(Reflect.get(result, "identityDiffs"), [
    {
      suite: "unit",
      missingTestIds: [beta, gamma],
      addedTestIds: [delta],
    },
  ]);
});

test("identity names policy keeps a count baseline count-only until re-recorded", () => {
  const result = evaluate({
    config: identityConfig("warn", "names"),
    baseline: detailedIdentityBaseline(
      ["unit.alpha\u001fone", "unit.beta\u001ftwo"],
    ),
    currentSuites: identitySuite([
      "unit.alpha\u001fone",
      "unit.gamma\u001fthree",
    ]),
  });
  const finding = result.findings.find(
    (item) => item.code === "TEST_IDENTITIES_CHANGED",
  );

  assert.deepEqual(
    [finding?.missingTestCount, finding?.addedTestCount],
    [1, 1],
  );
  assert.match(finding?.remediation ?? "", /re-record/i);
  assert.deepEqual(Reflect.get(result, "identityDiffs"), []);
});

test("protected suite detail policy overrides the default", () => {
  const alpha = "unit.alpha\u001fone";
  const beta = "unit.beta\u001ftwo";
  const gamma = "unit.gamma\u001fthree";
  const result = evaluate({
    config: loadConfig({
      version: 1,
      baseline: ".exevra/baseline.json",
      command: "npm test",
      reports: ["junit.xml"],
      policy: {
        default: {
          min_executed: 1,
          max_drop_percent: 0,
          identity_details: "counts",
        },
        protected_suites: [
          {
            name: "unit names",
            match: "^unit$",
            min_executed: 1,
            max_drop_percent: 0,
            identity_details: "names",
          },
        ],
      },
    }),
    baseline: detailedIdentityBaseline([alpha, beta], true),
    currentSuites: identitySuite([alpha, gamma]),
  });

  assert.deepEqual(Reflect.get(result, "identityDiffs"), [
    {
      suite: "unit",
      missingTestIds: [beta],
      addedTestIds: [gamma],
    },
  ]);
});
