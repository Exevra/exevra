import assert from "node:assert/strict";
import test from "node:test";
import { CoreValidationError, loadConfig } from "../../src/core/config.js";
import type { Config, IdentityDetailsPolicy } from "../../src/core/model.js";

const valid = {
  version: 1,
  baseline: ".exevra/baseline.json",
  command: "npm test",
  reports: ["artifacts/junit.xml"],
  watched: ["package.json"],
  policy: { default: { min_executed: 1, max_drop_percent: 2 } },
};

test("loads and normalizes a YAML configuration string", () => {
  const config = loadConfig(
    `version: 1\nbaseline: .exevra/baseline.json\ncommand: npm test\nreports: [artifacts/junit.xml]\npolicy:\n  default:\n    min_executed: 1\n    max_drop_percent: 2\n`,
  );
  assert.equal(config.version, 1);
  assert.deepEqual(config.watched, []);
});

test("defaults and parses identity policy", () => {
  assert.equal(loadConfig(valid).policy.default.identity, "warn");
  assert.equal(
    loadConfig({
      ...valid,
      policy: {
        default: {
          min_executed: 1,
          max_drop_percent: 2,
          identity: "off",
        },
      },
    }).policy.default.identity,
    "off",
  );
  assert.equal(
    loadConfig({
      ...valid,
      policy: {
        default: {
          min_executed: 1,
          max_drop_percent: 2,
          identity: "enforce",
        },
      },
    }).policy.default.identity,
    "enforce",
  );
});

test("defaults and parses identity detail policy", () => {
  assert.equal(loadConfig(valid).policy.default.identityDetails, "counts");
  assert.equal(
    loadConfig({
      ...valid,
      policy: {
        default: {
          min_executed: 1,
          max_drop_percent: 2,
          identity_details: "names",
        },
      },
    }).policy.default.identityDetails,
    "names",
  );
  assert.equal(
    loadConfig({
      ...valid,
      policy: {
        default: { min_executed: 1, max_drop_percent: 2 },
        protected_suites: [
          {
            name: "unit",
            match: "^unit$",
            min_executed: 1,
            max_drop_percent: 2,
            identity_details: "names",
          },
        ],
      },
    }).policy.protectedSuites[0]?.identityDetails,
    "names",
  );
});

test("makes identity details total on manually constructed configurations", () => {
  const config: Config = {
    version: 1,
    baseline: ".exevra/baseline.json",
    command: "npm test",
    reports: ["junit.xml"],
    watched: [],
    policy: {
      default: {
        minExecuted: 1,
        maxDropPercent: 0,
        identity: "warn",
        identityDetails: "counts",
      },
      protectedSuites: [],
    },
  };
  const identityDetails: IdentityDetailsPolicy =
    config.policy.default.identityDetails;
  assert.equal(identityDetails, "counts");
});

test("rejects invalid identity detail policy values", () => {
  assert.throws(
    () =>
      loadConfig({
        ...valid,
        policy: {
          default: {
            min_executed: 1,
            max_drop_percent: 2,
            identity_details: "hashes",
          },
        },
      }),
    (error: unknown) =>
      error instanceof CoreValidationError &&
      error.message.includes("identity_details must be counts or names"),
  );
});

test("allows protected suites to override the default identity policy", () => {
  const config = loadConfig({
    ...valid,
    policy: {
      default: {
        min_executed: 1,
        max_drop_percent: 2,
        identity: "off",
      },
      protected_suites: [
        {
          name: "unit",
          match: "^unit$",
          min_executed: 1,
          max_drop_percent: 2,
          identity: "enforce",
        },
      ],
    },
  });
  assert.equal(config.policy.protectedSuites[0]?.identity, "enforce");
});

test("rejects invalid identity policy values", () => {
  assert.throws(
    () =>
      loadConfig({
        ...valid,
        policy: {
          default: {
            min_executed: 1,
            max_drop_percent: 2,
            identity: "block",
          },
        },
      }),
    (error: unknown) =>
      error instanceof CoreValidationError &&
      error.message.includes("identity must be off, warn, or enforce"),
  );
});

test("rejects invalid policy bounds and protected-suite patterns", () => {
  assert.throws(
    () =>
      loadConfig({
        ...valid,
        policy: { default: { min_executed: -1, max_drop_percent: 101 } },
      }),
    CoreValidationError,
  );
  assert.throws(
    () =>
      loadConfig({
        ...valid,
        policy: {
          ...valid.policy,
          protected_suites: [
            { name: "bad", match: "(", min_executed: 1, max_drop_percent: 0 },
          ],
        },
      }),
    CoreValidationError,
  );
});

test("rejects report paths that escape the configuration root", () => {
  assert.throws(
    () => loadConfig({ ...valid, reports: ["../junit.xml"] }),
    /reports\[0\]/,
  );
});

test("rejects duplicate normalized reports and invalid literal paths", () => {
  assert.throws(
    () =>
      loadConfig({
        ...valid,
        reports: ["artifacts//junit.xml", "artifacts/junit.xml"],
      }),
    /duplicate report path/,
  );
  assert.throws(() => loadConfig({ ...valid, reports: ["."] }), /reports\[0\]/);
  assert.throws(
    () => loadConfig({ ...valid, baseline: "bad\u0000path" }),
    /baseline/,
  );
});
