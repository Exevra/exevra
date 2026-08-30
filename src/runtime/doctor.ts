import type {
  DoctorCheck,
  DoctorResult,
  Finding,
} from "../core/index.js";
import { check, type CheckOptions, type CheckResult } from "./check.js";

const hasCode = (findings: readonly Finding[], code: Finding["code"]): boolean =>
  findings.some((finding) => finding.code === code);

const findByCode = (
  findings: readonly Finding[],
  code: Finding["code"],
): Finding | undefined => findings.find((finding) => finding.code === code);

const blockedBeforeCommand = (findings: readonly Finding[]): boolean =>
  findByCode(findings, "TEST_FILTERED")?.severity === "error";

const blockedBeforeReports = (findings: readonly Finding[]): boolean =>
  blockedBeforeCommand(findings) || hasCode(findings, "TEST_COMMAND_FAILED");

const blockedBeforeBaseline = (findings: readonly Finding[]): boolean =>
  blockedBeforeReports(findings) ||
  hasCode(findings, "REPORT_MISSING") ||
  hasCode(findings, "REPORT_UNREADABLE");

const stageFindingCodes: Finding["code"][] = [
  "TEST_FILTERED",
  "TEST_COMMAND_FAILED",
  "REPORT_MISSING",
  "REPORT_UNREADABLE",
  "BASELINE_MISSING",
  "BASELINE_SCHEMA_UNSUPPORTED",
];

const checkFor = (
  result: CheckResult,
  name: DoctorCheck["name"],
  checks: readonly DoctorCheck[],
): DoctorCheck => {
  const { findings } = result;
  switch (name) {
    case "configuration":
      return {
        name,
        status: "passed",
        message: "Configuration loaded and paths are valid.",
      };
    case "execution intent": {
      const filter = findByCode(findings, "TEST_FILTERED");
      return {
        name,
        status:
          filter?.severity === "error"
            ? "failed"
            : filter?.severity === "warning"
              ? "warning"
              : "passed",
        message:
          filter === undefined
            ? "Execution intent is safe to evaluate."
            : "Execution intent uses test-selection filters.",
      };
    }
    case "test command":
      return {
        name,
        status: blockedBeforeCommand(findings)
          ? "skipped"
          : hasCode(findings, "TEST_COMMAND_FAILED")
            ? "failed"
            : "passed",
        message: blockedBeforeCommand(findings)
          ? "The configured test command was not run."
          : hasCode(findings, "TEST_COMMAND_FAILED")
            ? "The configured test command did not complete successfully."
            : "The configured test command completed.",
      };
    case "reports":
      return {
        name,
        status: blockedBeforeReports(findings)
          ? "skipped"
          : hasCode(findings, "REPORT_MISSING") ||
              hasCode(findings, "REPORT_UNREADABLE")
            ? "failed"
            : "passed",
        message: blockedBeforeReports(findings)
          ? "Test report collection did not run."
          : hasCode(findings, "REPORT_MISSING") ||
              hasCode(findings, "REPORT_UNREADABLE")
            ? "Required test reports were not produced or could not be read."
            : "Required test reports were collected.",
      };
    case "baseline":
      return {
        name,
        status: blockedBeforeBaseline(findings)
          ? "skipped"
          : hasCode(findings, "BASELINE_MISSING") ||
              hasCode(findings, "BASELINE_SCHEMA_UNSUPPORTED")
            ? "failed"
            : "passed",
        message: blockedBeforeBaseline(findings)
          ? "Baseline evaluation did not run."
          : hasCode(findings, "BASELINE_MISSING")
            ? "No reviewed baseline is available."
            : hasCode(findings, "BASELINE_SCHEMA_UNSUPPORTED")
              ? "The reviewed baseline schema is unsupported."
              : "A reviewed baseline is available.",
      };
    case "evaluation": {
      if (checks.some((item) => item.status === "failed" || item.status === "skipped"))
        return {
          name,
          status: "skipped",
          message: "Execution evaluation did not run.",
        };
      const remaining = findings.filter(
        (finding: Finding) => !stageFindingCodes.includes(finding.code),
      );
      return {
        name,
        status: remaining.some((finding: Finding) => finding.severity === "error")
          ? "failed"
          : remaining.some((finding: Finding) => finding.severity === "warning")
            ? "warning"
            : "passed",
        message: remaining.some((finding: Finding) => finding.severity === "error")
          ? "Execution evaluation found blocking issues."
          : remaining.some((finding: Finding) => finding.severity === "warning")
            ? "Execution evaluation found advisory issues."
            : "Execution evaluation passed.",
      };
    }
  }
};

const orderedNames: DoctorCheck["name"][] = [
  "configuration",
  "execution intent",
  "test command",
  "reports",
  "baseline",
  "evaluation",
];

export const doctor = async (options: CheckOptions): Promise<DoctorResult> => {
  const result = await check({ ...options, suppressCommandOutput: true });
  const checks: DoctorCheck[] = [];
  for (const name of orderedNames) checks.push(checkFor(result, name, checks));
  return { ...result, checks };
};

export type { CheckOptions };
