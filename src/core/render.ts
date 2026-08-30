import type {
  BaselineDiff,
  CanonicalSuite,
  DoctorCheck,
  Finding,
  SuiteChange,
} from "./model.js";
import type { IdentityDiff } from "./identity.js";

export interface RenderInput {
  findings: readonly Finding[];
  notices?: readonly string[];
  suites?: readonly CanonicalSuite[];
  changes?: BaselineDiff;
  checks?: readonly DoctorCheck[];
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

const orderedChanges = (changes: readonly SuiteChange[]): SuiteChange[] =>
  [...changes].sort(
    (left, right) =>
      compare(left.name, right.name) || compare(left.kind, right.kind),
  );

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

const suiteChangeLine = (change: SuiteChange): string => {
  if (change.kind === "added")
    return `suite added: ${change.name} (${change.current!.executed} executed, ${change.current!.skipped} skipped)`;
  if (change.kind === "removed")
    return `suite removed: ${change.name} (${change.baseline!.executed} executed, ${change.baseline!.skipped} skipped)`;
  return (
    `suite changed: ${change.name} (` +
    `${change.baseline!.executed} -> ${change.current!.executed} executed, ` +
    `${change.baseline!.skipped} -> ${change.current!.skipped} skipped)`
  );
};

const diffLines = (changes?: BaselineDiff): string[] => {
  if (changes === undefined) return [];
  return [
    "DIFF",
    `command changed: ${changes.commandChanged ? "yes" : "no"}`,
    `reports changed: ${changes.reportsChanged ? "yes" : "no"}`,
    ...orderedChanges(changes.suites).map(suiteChangeLine),
  ];
};

const doctorMessage = (check: DoctorCheck): string => {
  if (check.name === "baseline" && check.status === "passed")
    return "A compatible baseline is available.";
  if (check.name === "evaluation" && check.status === "passed")
    return "Existing execution-integrity rules passed.";
  if (check.name === "evaluation" && check.status === "failed")
    return "Existing execution-integrity rules failed.";
  return check.message;
};

const doctorLines = (checks?: readonly DoctorCheck[]): string[] => {
  if (checks === undefined) return [];
  return [
    "DOCTOR",
    ...checks.map(
      (check) =>
        `${check.name}: ${check.status} - ${doctorMessage(check)}`,
    ),
  ];
};

export const renderText = (
  input: RenderInput,
  options: TextRenderOptions = {},
): string => {
  const lines = [outcomeText(input)];
  if (input.checks !== undefined)
    return `${[...lines, ...doctorLines(input.checks)].join("\n")}\n`;
  for (const finding of orderedFindings(input.findings))
    lines.push(findingLine(finding));
  for (const line of diffLines(input.changes))
    lines.push(line);
  for (const detail of identityDetailLines(options.identityDiffs ?? []))
    lines.push(detail);
  for (const notice of [...(input.notices ?? [])].sort(compare))
    lines.push(`NOTICE: ${notice}`);
  return `${lines.join("\n")}\n`;
};

export const renderJson = (input: RenderInput): string =>
  JSON.stringify(
    input.checks === undefined
      ? {
          outcome: outcome(input),
          findings: orderedFindings(input.findings),
          notices: [...(input.notices ?? [])].sort(compare),
          suites: orderedSuites(input.suites ?? []),
          ...(input.changes === undefined
            ? {}
            : {
                changes: {
                  commandChanged: input.changes.commandChanged,
                  reportsChanged: input.changes.reportsChanged,
                  suites: orderedChanges(input.changes.suites),
                },
              }),
        }
      : { outcome: outcome(input), checks: input.checks },
    null,
    2,
  ) + "\n";

const escapeWorkflowCommand = (value: string): string =>
  value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

export const renderGitHubActions = (input: RenderInput): string => {
  const lines = [outcomeText(input)];
  if (input.checks !== undefined) {
    for (const line of doctorLines(input.checks))
      lines.push(
        `::notice title=EXEVRA DOCTOR::${escapeWorkflowCommand(line)}`,
      );
    return `${lines.join("\n")}\n`;
  }
  for (const finding of orderedFindings(input.findings)) {
    lines.push(
      `::${finding.severity} title=EXEVRA ${finding.code}::${escapeWorkflowCommand(findingLine(finding))}`,
    );
  }
  for (const notice of [...(input.notices ?? [])].sort(compare))
    lines.push(
      `::warning title=EXEVRA NOTICE::${escapeWorkflowCommand(notice)}`,
    );
  for (const line of diffLines(input.changes))
    lines.push(
      `::notice title=EXEVRA DIFF::${escapeWorkflowCommand(line)}`,
    );
  return `${lines.join("\n")}\n`;
};
