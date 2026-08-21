import type { CanonicalSuite, Finding } from "./model.js";
import type { IdentityDiff } from "./identity.js";

export interface RenderInput {
  findings: readonly Finding[];
  notices?: readonly string[];
  suites?: readonly CanonicalSuite[];
}

export interface TextRenderOptions {
  identityDiffs?: readonly IdentityDiff[];
}

type RenderedSuite = Pick<CanonicalSuite, "name" | "executed" | "skipped">;

const compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const orderedFindings = (findings: readonly Finding[]): Finding[] =>
  [...findings].sort(
    (left, right) =>
      compare(left.code, right.code) ||
      compare(left.suite ?? "", right.suite ?? "") ||
      compare(left.message, right.message),
  );

const orderedSuites = (suites: readonly CanonicalSuite[]): RenderedSuite[] =>
  suites
    .map(({ name, executed, skipped }) => ({ name, executed, skipped }))
    .sort((left, right) => compare(left.name, right.name));

const outcome = (
  input: RenderInput,
): "passed" | "passed_with_warnings" | "blocked" =>
  input.findings.some((finding) => finding.severity === "error")
    ? "blocked"
    : input.findings.length > 0
      ? "passed_with_warnings"
      : "passed";

const outcomeText = (input: RenderInput): string => {
  const value = outcome(input);
  if (value === "blocked") return "EXEVRA BLOCKED";
  return value === "passed_with_warnings"
    ? "EXEVRA PASSED WITH WARNINGS"
    : "EXEVRA PASSED";
};

const findingLine = (finding: Finding): string => {
  const delta =
    finding.suite === undefined
      ? ""
      : ` ${finding.suite}${finding.baseExecuted === undefined || finding.headExecuted === undefined ? "" : `: ${finding.baseExecuted} -> ${finding.headExecuted}`}`;
  const identityCounts =
    finding.missingTestCount === undefined || finding.addedTestCount === undefined
      ? ""
      : ` ${finding.missingTestCount} missing, ${finding.addedTestCount} added`;
  return `[${finding.code}]${delta}${identityCounts} ${finding.message} Remediation: ${finding.remediation}`;
};

const identityList = (identifiers: readonly string[]): string => {
  const sorted = [...identifiers].sort(compare);
  const displayed = sorted.slice(0, 20).map((identifier) => JSON.stringify(identifier));
  const more = sorted.length - displayed.length;
  return `${displayed.join(", ")}${more === 0 ? "" : ` and ${more} more`}`;
};

const identityDetailLines = (
  identityDiffs: readonly IdentityDiff[],
): string[] =>
  [...identityDiffs]
    .sort((left, right) => compare(left.suite, right.suite))
    .map(
      (diff) =>
        `[TEST_IDENTITIES_CHANGED] ${diff.suite} missing: ${identityList(diff.missingTestIds)}; added: ${identityList(diff.addedTestIds)}`,
    );

export const renderText = (
  input: RenderInput,
  options: TextRenderOptions = {},
): string => {
  const lines = [outcomeText(input)];
  for (const finding of orderedFindings(input.findings))
    lines.push(findingLine(finding));
  for (const detail of identityDetailLines(options.identityDiffs ?? []))
    lines.push(detail);
  for (const notice of [...(input.notices ?? [])].sort(compare))
    lines.push(`NOTICE: ${notice}`);
  return `${lines.join("\n")}\n`;
};

export const renderJson = (input: RenderInput): string =>
  JSON.stringify(
    {
      outcome: outcome(input),
      findings: orderedFindings(input.findings),
      notices: [...(input.notices ?? [])].sort(compare),
      suites: orderedSuites(input.suites ?? []),
    },
    null,
    2,
  ) + "\n";

const escapeWorkflowCommand = (value: string): string =>
  value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

export const renderGitHubActions = (input: RenderInput): string => {
  const lines = [outcomeText(input)];
  for (const finding of orderedFindings(input.findings)) {
    lines.push(
      `::${finding.severity} title=EXEVRA ${finding.code}::${escapeWorkflowCommand(findingLine(finding))}`,
    );
  }
  for (const notice of [...(input.notices ?? [])].sort(compare))
    lines.push(
      `::warning title=EXEVRA NOTICE::${escapeWorkflowCommand(notice)}`,
    );
  return `${lines.join("\n")}\n`;
};
