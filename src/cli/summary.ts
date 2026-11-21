import type { RenderInput } from "../core/index.js";
import type { IdentityDiff } from "../core/identity.js";

const escapeHtml = (value: string): string => value
  .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface GitHubSummaryOptions { identityDiffs?: readonly IdentityDiff[]; advisory?: boolean; }

const descriptions: Record<string, string> = {
  REPORT_MISSING: "A required report is missing.", REPORT_UNREADABLE: "A required report could not be read.",
  SHARD_MISSING: "A required shard is missing.", SHARD_NO_TESTS_EXECUTED: "A shard executed no tests.",
  NO_TESTS_EXECUTED: "No tests were executed.", SUITE_BELOW_MINIMUM: "A suite ran fewer tests than its minimum.",
  SUITE_DROP_EXCEEDED: "A suite ran fewer tests than its baseline allows.", TEST_IDENTITIES_CHANGED: "Test identities changed.",
  BASELINE_MISSING: "No reviewed baseline is available.", BASELINE_SCHEMA_UNSUPPORTED: "The baseline version is unsupported.",
  WATCHED_CONFIG_CHANGED_WITH_SIGNAL_DROP: "Configuration changed while test execution dropped.",
  TEST_COMMAND_FAILED: "The configured test command failed.", TEST_FILTERED: "Test-selection flags were detected.",
};

export const renderGitHubSummary = (input: RenderInput, options: GitHubSummaryOptions = {}): string => {
  const status = input.findings.some(({ severity }) => severity === "error") ? (options.advisory ? "EXEVRA ADVISORY — NOT BLOCKING" : "EXEVRA BLOCKED") : input.findings.length ? "EXEVRA PASSED WITH WARNINGS" : "EXEVRA PASSED";
  const lines = ["## Exevra", "", '<img src="https://raw.githubusercontent.com/Exevra/exevra/main/website/src/assets/exevra-folded-trace.png" alt="Exevra logo" width="64" />', "", `### ${status}`, ""];
  if (input.checks) {
    lines.push("### Checks", "", ...input.checks.map(({ name, status }) => `- ${escapeHtml(name)}: **${escapeHtml(status)}**`), "");
    return lines.join("\n");
  }
  if (input.suites?.length) {
    const executed = input.suites.reduce((sum, suite) => sum + suite.executed, 0);
    const skipped = input.suites.reduce((sum, suite) => sum + suite.skipped, 0);
    lines.push(`**${executed} tests executed** · ${skipped} skipped · ${input.suites.length} suites`, "");
  }
  if (input.findings.length) {
    lines.push("### Needs attention", "");
    for (const finding of input.findings) {
      const counts = finding.missingTestCount === undefined || finding.addedTestCount === undefined ? "" : ` (${finding.missingTestCount} missing, ${finding.addedTestCount} added)`;
      lines.push(`- **${escapeHtml(finding.code)}** (${finding.severity === "error" && !options.advisory ? "blocked" : "warning"}): ${descriptions[finding.code] ?? "Review this finding."}${counts}`);
    }
    lines.push("", "Review the findings and run `exevra diff` before updating the baseline.", "");
  }
  if (input.suiteComparisons?.length) {
    lines.push("### Suite comparison", "", "<table><thead><tr><th>Suite</th><th>Baseline</th><th>This run</th><th>Change</th><th>Status</th></tr></thead><tbody>");
    for (const suite of input.suiteComparisons) {
      const delta = suite.baseline === null || suite.current === null ? "—" : `${suite.current - suite.baseline > 0 ? "+" : ""}${suite.current - suite.baseline}`;
      const findings = input.findings.filter((finding) => finding.suite === suite.name);
      const state = findings.some(({ severity }) => severity === "error") && !options.advisory ? "Blocked" : findings.length ? "Warning" : suite.baseline === null ? "Added" : suite.current === null ? "Removed" : "Passed";
      lines.push(`<tr><td>${escapeHtml(suite.name)}</td><td>${suite.baseline ?? "—"}</td><td>${suite.current ?? "—"}</td><td>${delta}</td><td>${state}</td></tr>`);
    }
    lines.push("</tbody></table>", "");
  }
  if (input.changes) lines.push(`Baseline comparison: ${input.changes.suites.length} suite changes.`, "");
  for (const diff of options.identityDiffs ?? []) {
    const show = (ids: readonly string[]) => ids.slice().sort().slice(0, 20).map((id) => escapeHtml(JSON.stringify(id))).join(", ");
    lines.push(`<p><strong>Test identities: ${escapeHtml(diff.suite)}</strong><br>Missing: ${show(diff.missingTestIds)}<br>Added: ${show(diff.addedTestIds)}</p>`);
  }
  if (input.notices?.length) {
    const safeNotices = new Set([
      "The current command or report configuration differs from the reviewed baseline.",
      "Changed-file comparison is unavailable because no base ref was supplied.",
      "Changed-file comparison is unavailable for aggregate checks.",
    ]);
    lines.push("### Notices", "", "<ul>");
    for (const notice of input.notices) lines.push(`<li>${safeNotices.has(notice) ? escapeHtml(notice) : "Additional notice available in the CLI output."}</li>`);
    lines.push("</ul>", "");
  }
  return lines.join("\n") + "\n";
};
