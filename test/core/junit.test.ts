import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregateSuites,
  JunitParseError,
  parseJunit,
  testIdHash,
  testIdHashes,
} from "../../src/core/junit.js";

const fixture = async (name: string) =>
  readFile(
    new URL(`../../../test/fixtures/junit/${name}`, import.meta.url),
    "utf8",
  );

test("parses executed and skipped test cases into stable identifiers", async () => {
  const suites = parseJunit(
    await fixture("single-suite.xml"),
    "single-suite.xml",
  );
  assert.equal(suites[0]?.name, "unit");
  assert.equal(suites[0]?.executed, 2);
  assert.equal(suites[0]?.skipped, 1);
  assert.deepEqual(
    suites[0]?.tests.map((item) => item.id),
    ["math\u001fadds", "math\u001fskips", "math\u001fsubtracts"],
  );
});

test("recursively retains nested direct suites and counts failed cases as executed", async () => {
  const nested = parseJunit(await fixture("nested-suites.xml"), "nested.xml");
  assert.deepEqual(
    nested.map((suite) => suite.name),
    ["integration", "unit"],
  );
  const statuses = parseJunit(
    await fixture("skipped-and-failed.xml"),
    "status.xml",
  )[0]?.tests.map((item) => item.status);
  assert.deepEqual(statuses, ["skipped", "failed", "error"]);
});

test("retains duplicate identifiers and rejects malformed or DTD XML as typed errors", async () => {
  assert.equal(
    parseJunit(await fixture("duplicate-identifiers.xml"), "duplicates.xml")[0]
      ?.executed,
    2,
  );
  await assert.rejects(
    fixture("malformed.xml").then((xml) =>
      Promise.resolve(parseJunit(xml, "broken.xml")),
    ),
    JunitParseError,
  );
  assert.throws(
    () => parseJunit('<!DOCTYPE testsuite><testsuite name="unit"/>', "dtd.xml"),
    JunitParseError,
  );
});

test("accepts empty and all-skipped suites", async () => {
  assert.equal(
    parseJunit(await fixture("empty-suite.xml"), "empty.xml")[0]?.executed,
    0,
  );
  const allSkipped = parseJunit(
    await fixture("all-skipped.xml"),
    "all-skipped.xml",
  )[0];
  assert.deepEqual(
    [allSkipped?.tests.length, allSkipped?.skipped, allSkipped?.executed],
    [2, 2, 0],
  );
});

test("keeps a testcase skipped when a later failure element is present", async () => {
  const suite = parseJunit(
    await fixture("skipped-then-failed.xml"),
    "skipped-then-failed.xml",
  )[0];
  assert.deepEqual(
    suite?.tests.map((item) => item.status),
    ["skipped"],
  );
  assert.deepEqual([suite?.executed, suite?.skipped], [0, 1]);
});

test("aggregates same-named suites from separate report observations", () => {
  const combined = aggregateSuites([
    parseJunit(
      '<testsuite name="unit"><testcase classname="a" name="one"/></testsuite>',
      "one.xml",
    )[0]!,
    parseJunit(
      '<testsuite name="unit"><testcase classname="a" name="two"><skipped/></testcase></testsuite>',
      "two.xml",
    )[0]!,
  ]);
  assert.deepEqual(
    combined.map((suite) => [
      suite.name,
      suite.executed,
      suite.skipped,
      suite.tests.length,
    ]),
    [["unit", 1, 1, 2]],
  );
});

test("fingerprints individual test identifiers as a sorted duplicate-preserving multiset", () => {
  const one = "math\u001fadds";
  const two = "math\u001fsubtracts";
  const oneHash = testIdHash(one);
  const twoHash = testIdHash(two);

  assert.equal(
    oneHash,
    "sha256:0e5b3f3eb3b4a40e713e757baf79d7e836563548ff18d8378bdec559671230d3",
  );
  assert.equal(testIdHash(one), oneHash);
  assert.deepEqual(
    testIdHashes([
      { id: two, status: "passed" },
      { id: one, status: "passed" },
      { id: one, status: "skipped" },
    ]),
    [oneHash, oneHash, twoHash].sort(),
  );
});
