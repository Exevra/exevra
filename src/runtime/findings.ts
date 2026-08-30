import type { Finding, MavenFilterPolicy } from "../core/model.js";
import { mavenFilterFinding } from "./maven.js";
import type { ReportCollection } from "./reports.js";

export const mavenFilterFindings = (
  command: string,
  policy: MavenFilterPolicy,
): Finding[] => {
  const finding = mavenFilterFinding(command, policy);
  return finding === undefined ? [] : [finding];
};

export const buildReportFindings = (
  reports: Pick<ReportCollection, "missingReports" | "unreadableReports">,
): Finding[] => [
  ...reports.missingReports.map((path) => ({
    code: "REPORT_MISSING" as const,
    severity: "error" as const,
    message: `Required report was not produced: ${path}`,
    remediation: "Configure the test command to write every required JUnit report.",
  })),
  ...reports.unreadableReports.map((path) => ({
    code: "REPORT_UNREADABLE" as const,
    severity: "error" as const,
    message: `Required report could not be read: ${path}`,
    remediation:
      "Ensure the generated JUnit report is readable before evaluating test execution.",
  })),
];
