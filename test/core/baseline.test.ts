import assert from "node:assert/strict";
import test from "node:test";
import { loadBaseline, serializeBaseline } from "../../src/core/baseline.js";
import { CoreValidationError } from "../../src/core/config.js";

test("serializes equivalent suites in deterministic name order", () => {
  const value = serializeBaseline({
    generatedAt: "2026-08-11T00:00:00.000Z",
    command: "npm test",
    reports: ["b.xml", "a.xml"],
    suites: [
      {
        name: "z",
        executed: 2,
        skipped: 0,
        testIdsHash: `sha256:${"f".repeat(64)}`,
      },
      {
        name: "a",
        executed: 1,
        skipped: 1,
        testIdsHash: `sha256:${"a".repeat(64)}`,
      },
    ],
  });
  assert.equal(value, serializeBaseline(JSON.parse(value)));
  assert.ok(value.indexOf('"a"') < value.indexOf('"z"'));
});

test("loads JSON strings and rejects unsupported baseline schema versions", () => {
  const baseline = loadBaseline(
    '{"schemaVersion":1,"generatedAt":"2026-08-11T00:00:00.000Z","command":"npm test","reports":["junit.xml"],"suites":[]}',
  );
  assert.equal(baseline.schemaVersion, 1);
  assert.throws(
    () => loadBaseline({ ...baseline, schemaVersion: 2 }),
    CoreValidationError,
  );
});

test("round-trips enriched schema-v1 baseline identity details", () => {
  const hashAlpha =
    "sha256:4ce07c7ae6addcfae646818bae5f959c9f90d79cc789445af2836b130ad37298";
  const hashBeta =
    "sha256:4c3759860a01f9582f22b76f3f6b470682410a2deb01eb07b99fe2cd37bf4faf";
  const baseline = loadBaseline({
    schemaVersion: 1,
    generatedAt: "2026-08-11T00:00:00.000Z",
    command: "npm test",
    reports: ["junit.xml"],
    suites: [
      {
        name: "unit",
        executed: 3,
        skipped: 0,
        testIdsHash: `sha256:${"f".repeat(64)}`,
        testIdHashes: [hashBeta, hashAlpha, hashAlpha],
        testIds: ["alpha\u001fone", "alpha\u001fone", "beta\u001ftwo"],
      },
    ],
  });

  assert.deepEqual(baseline.suites[0]?.testIdHashes, [
    hashBeta,
    hashAlpha,
    hashAlpha,
  ]);
  assert.deepEqual(baseline.suites[0]?.testIds, [
    "alpha\u001fone",
    "alpha\u001fone",
    "beta\u001ftwo",
  ]);
  assert.deepEqual(
    loadBaseline(serializeBaseline(baseline)).suites[0]?.testIdHashes,
    [hashBeta, hashAlpha, hashAlpha],
  );
});

test("accepts legacy schema-v1 baselines without identity details", () => {
  const baseline = loadBaseline({
    schemaVersion: 1,
    generatedAt: "2026-08-11T00:00:00.000Z",
    command: "npm test",
    reports: ["junit.xml"],
    suites: [
      {
        name: "unit",
        executed: 1,
        skipped: 0,
        testIdsHash: `sha256:${"a".repeat(64)}`,
      },
    ],
  });
  assert.equal(baseline.suites[0]?.testIdHashes, undefined);
  assert.equal(baseline.suites[0]?.testIds, undefined);
});

test("rejects invalid testIdHashes and testIds identity details", () => {
  const suite = {
    name: "unit",
    executed: 2,
    skipped: 0,
    testIdsHash: `sha256:${"a".repeat(64)}`,
  };
  const baseline = {
    schemaVersion: 1,
    generatedAt: "2026-08-11T00:00:00.000Z",
    command: "npm test",
    reports: ["junit.xml"],
  };
  const hashA = `sha256:${"a".repeat(64)}`;
  const hashB = `sha256:${"b".repeat(64)}`;

  assert.throws(
    () => loadBaseline({ ...baseline, suites: [{ ...suite, testIdHashes: ["bad"] }] }),
    /testIdHashes.*SHA-256 hash/,
  );
  assert.throws(
    () =>
      loadBaseline({
        ...baseline,
        suites: [{ ...suite, testIdHashes: [hashB, hashA] }],
      }),
    /testIdHashes.*sorted/,
  );
  assert.throws(
    () => loadBaseline({ ...baseline, suites: [{ ...suite, testIds: ["a"] }] }),
    /testIds.*testIdHashes/,
  );
  assert.throws(
    () =>
      loadBaseline({
        ...baseline,
        suites: [
          { ...suite, testIdHashes: [hashA], testIds: ["alpha", "beta"] },
        ],
      }),
    /testIds.*same length/,
  );
  assert.throws(
    () =>
      loadBaseline({
        ...baseline,
        suites: [
          { ...suite, testIdHashes: [hashA, hashB], testIds: ["beta", "alpha"] },
        ],
      }),
    /testIds.*sorted/,
  );
  assert.throws(
    () =>
      loadBaseline({
        ...baseline,
        suites: [{ ...suite, testIdHashes: [hashA], testIds: ["alpha"] }],
      }),
    /testIds.*testIdHashes/,
  );
});

test("rejects duplicate baseline suite names", () => {
  const suite = {
    name: "unit",
    executed: 1,
    skipped: 0,
    testIdsHash: `sha256:${"a".repeat(64)}`,
  };
  assert.throws(
    () =>
      loadBaseline({
        schemaVersion: 1,
        generatedAt: "2026-08-11T00:00:00.000Z",
        command: "npm test",
        reports: ["junit.xml"],
        suites: [suite, suite],
      }),
    /duplicate suite name/,
  );
});
