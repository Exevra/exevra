import { renderText, type Finding } from "../core/index.js";
import { renderGitHubSummary } from "../cli/summary.js";
import type { CheckOptions, CheckResult } from "../runtime/index.js";

export interface ActionCore {
  getInput(name: string): string;
  error(message: string): void;
  warning(message: string): void;
  setFailed(message: string): void;
  summary: {
    addRaw(message: string): { write(): Promise<unknown> };
    addCodeBlock(
      message: string,
      language?: string,
    ): { write(): Promise<unknown> };
  };
}

export interface ActionDependencies {
  core: ActionCore;
  eventName: string | undefined;
  eventPayload: unknown;
  check: (options: CheckOptions) => Promise<CheckResult>;
}

const findingText = (finding: Finding): string =>
  renderText({ findings: [finding] }).trim();

const baseRefFor = (
  eventName: string | undefined,
  payload: unknown,
): string | undefined => {
  if (eventName !== "pull_request") return undefined;
  const baseRef = (payload as { pull_request?: { base?: { sha?: unknown } } })
    ?.pull_request?.base?.sha;
  if (typeof baseRef !== "string" || baseRef.length === 0)
    throw new Error("Pull request event payload has no base SHA.");
  return baseRef;
};

const modeFor = (value: string): "enforce" | "advisory" => {
  if (value === "enforce" || value === "advisory") return value;
  throw new Error(`Invalid mode: ${value}. Expected enforce or advisory.`);
};

export const runAction = async ({
  core,
  eventName,
  eventPayload,
  check,
}: ActionDependencies): Promise<void> => {
  try {
    const mode = modeFor(core.getInput("mode"));
    const baseRef = baseRefFor(eventName, eventPayload);
    const checked = await check({
      configPath: core.getInput("config"),
      ...(baseRef === undefined ? {} : { baseRef }),
    });
    const summary = renderGitHubSummary(checked, {
      identityDiffs: checked.identityDiffs,
      advisory: mode === "advisory",
    });
    for (const finding of checked.findings) {
      if (mode === "advisory" || finding.severity === "warning")
        core.warning(findingText(finding));
      else core.error(findingText(finding));
    }
    await core.summary.addRaw(summary).write();
    if (
      mode === "enforce" &&
      checked.findings.some((finding) => finding.severity === "error")
    )
      core.setFailed("EXEVRA BLOCKED");
  } catch (error) {
    const message = `Operational error: ${error instanceof Error ? error.message : String(error)}`;
    core.error(message);
    core.setFailed(message);
  }
};
