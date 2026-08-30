import type { RenderInput } from "../core/index.js";
import type { IdentityDiff } from "../core/identity.js";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const outcome = (input: RenderInput): string =>
  input.findings.some(({ severity }) => severity === "error")
    ? "EXEVRA BLOCKED"
    : input.findings.length > 0
      ? "EXEVRA PASSED WITH WARNINGS"
      : "EXEVRA PASSED";

const compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const identityList = (identifiers: readonly string[]): string => {
  const displayed = [...identifiers]
    .sort(compare)
    .slice(0, 20)
    .map((identifier) => JSON.stringify(identifier));
  const more = identifiers.length - displayed.length;
  return `${displayed.join(", ")}${more === 0 ? "" : ` and ${more} more`}`;
};

export interface GitHubSummaryOptions {
  identityDiffs?: readonly IdentityDiff[];
}

const renderGitHubSummaryBody = (
  input: RenderInput,
  options: GitHubSummaryOptions = {},
): string[] => {
  const lines = [outcome(input)];
  if (input.checks !== undefined) {
    lines.push("DOCTOR");
    lines.push(...input.checks.map(({ name, status }) => `${name}: ${status}`));
    return lines;
  }
  const findings = new Map<string, number>();
  for (const finding of input.findings) {
    const key = `${finding.code} (${finding.severity})`;
    findings.set(key, (findings.get(key) ?? 0) + 1);
  }
  for (const [finding, count] of [...findings].sort(([left], [right]) =>
    left.localeCompare(right),
  ))
    lines.push(`finding: ${finding} x${count}`);
  if (input.suites !== undefined)
    lines.push(
      `suites: ${input.suites.length}, executed: ${input.suites.reduce((total, suite) => total + suite.executed, 0)}, skipped: ${input.suites.reduce((total, suite) => total + suite.skipped, 0)}`,
    );
  if (input.changes !== undefined) {
    const changes = new Map<string, number>();
    for (const change of input.changes.suites)
      changes.set(change.kind, (changes.get(change.kind) ?? 0) + 1);
    lines.push(
      `suite changes: ${[...changes]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([kind, count]) => `${kind} ${count}`)
        .join(", ") || "none"}`,
    );
  }
  for (const diff of [...(options.identityDiffs ?? [])].sort((left, right) =>
    compare(left.suite, right.suite),
  ))
    lines.push(
      `[TEST_IDENTITIES_CHANGED] ${diff.suite} missing: ${identityList(diff.missingTestIds)}; added: ${identityList(diff.addedTestIds)}`,
    );
  if ((input.notices ?? []).length > 0)
    lines.push(`notices: ${input.notices!.length}`);
  return lines;
};

export const renderGitHubSummaryText = (
  input: RenderInput,
  options: GitHubSummaryOptions = {},
): string => renderGitHubSummaryBody(input, options).join("\n");

export const renderGitHubSummary = (
  input: RenderInput,
  options: GitHubSummaryOptions = {},
): string =>
  `## Exevra\n\n<pre><code>${escapeHtml(renderGitHubSummaryText(input, options))}</code></pre>\n`;
