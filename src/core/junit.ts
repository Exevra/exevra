import { createHash } from "node:crypto";
import { SaxesParser } from "saxes";
import type { CanonicalSuite, CanonicalTest, TestStatus } from "./model.js";

export class JunitParseError extends Error {
  constructor(
    readonly reportPath: string,
    message: string,
  ) {
    super(`invalid JUnit XML in ${reportPath}: ${message}`);
    this.name = "JunitParseError";
  }
}

type MutableSuite = {
  name: string;
  tests: CanonicalTest[];
  hasNestedSuites: boolean;
};
type ActiveCase = { suite: MutableSuite; id: string; status: TestStatus };

export const testIdHash = (id: string): string =>
  `sha256:${createHash("sha256").update(id).digest("hex")}`;

export const testIdHashes = (tests: readonly CanonicalTest[]): string[] =>
  tests.map((test) => testIdHash(test.id)).sort();

export const testIdsHash = (tests: readonly CanonicalTest[]): string =>
  `sha256:${createHash("sha256")
    .update(
      tests
        .map((test) => test.id)
        .sort()
        .join("\n"),
    )
    .digest("hex")}`;

export const aggregateSuites = (
  observations: readonly CanonicalSuite[],
): CanonicalSuite[] => {
  const suites = new Map<string, CanonicalSuite>();
  for (const suite of observations) {
    const previous = suites.get(suite.name);
    suites.set(
      suite.name,
      previous
        ? {
            name: suite.name,
            tests: [...previous.tests, ...suite.tests],
            executed: previous.executed + suite.executed,
            skipped: previous.skipped + suite.skipped,
          }
        : { ...suite, tests: [...suite.tests] },
    );
  }
  return [...suites.values()].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
};

export const parseJunit = (
  xml: string,
  reportPath: string,
): CanonicalSuite[] => {
  const suites = new Map<string, MutableSuite>();
  const suiteStack: MutableSuite[] = [];
  const caseStack: ActiveCase[] = [];
  let failure: JunitParseError | undefined;
  const parser = new SaxesParser({
    fileName: reportPath,
    position: true,
    defaultXMLVersion: "1.0",
    forceXMLVersion: true,
  });
  parser.on("doctype", () => {
    failure = new JunitParseError(
      reportPath,
      "DOCTYPE declarations are not allowed",
    );
  });
  parser.on("error", (error) => {
    failure ??= new JunitParseError(reportPath, error.message);
  });
  parser.on("opentag", (tag) => {
    if (tag.name === "testsuite") {
      const name =
        typeof tag.attributes.name === "string" && tag.attributes.name !== ""
          ? tag.attributes.name
          : "(unnamed suite)";
      const parent = suiteStack.at(-1);
      if (parent) parent.hasNestedSuites = true;
      const suite = suites.get(name) ?? {
        name,
        tests: [],
        hasNestedSuites: false,
      };
      suites.set(name, suite);
      suiteStack.push(suite);
    } else if (tag.name === "testcase") {
      const suite = suiteStack.at(-1);
      if (!suite) {
        failure ??= new JunitParseError(
          reportPath,
          "testcase is not inside a testsuite",
        );
        return;
      }
      const classname =
        typeof tag.attributes.classname === "string"
          ? tag.attributes.classname
          : "";
      const name =
        typeof tag.attributes.name === "string" ? tag.attributes.name : "";
      caseStack.push({
        suite,
        id: `${classname}\u001f${name}`,
        status: "passed",
      });
    } else if (tag.name === "skipped" && caseStack.at(-1)) {
      caseStack.at(-1)!.status = "skipped";
    } else if (
      tag.name === "failure" &&
      caseStack.at(-1) &&
      caseStack.at(-1)!.status !== "skipped"
    ) {
      caseStack.at(-1)!.status = "failed";
    } else if (
      tag.name === "error" &&
      caseStack.at(-1) &&
      caseStack.at(-1)!.status !== "skipped"
    ) {
      caseStack.at(-1)!.status = "error";
    }
  });
  parser.on("closetag", (tag) => {
    if (tag.name === "testcase") {
      const current = caseStack.pop();
      if (current)
        current.suite.tests.push({ id: current.id, status: current.status });
    } else if (tag.name === "testsuite") suiteStack.pop();
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    failure ??= new JunitParseError(
      reportPath,
      error instanceof Error ? error.message : "unknown parser error",
    );
  }
  if (failure) throw failure;
  return aggregateSuites(
    [...suites.values()]
      .filter((suite) => suite.tests.length > 0 || !suite.hasNestedSuites)
      .map((suite) => ({
        name: suite.name,
        tests: suite.tests,
        executed: suite.tests.filter((test) => test.status !== "skipped")
          .length,
        skipped: suite.tests.filter((test) => test.status === "skipped").length,
      })),
  );
};
