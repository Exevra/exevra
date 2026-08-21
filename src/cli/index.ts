#!/usr/bin/env node
import { relative } from "node:path";
import {
  renderGitHubActions,
  renderJson,
  renderText,
} from "../core/index.js";
import {
  check,
  initialize,
  record,
  type CheckResult,
} from "../runtime/index.js";

type Mode = "enforce" | "advisory";
type Format = "text" | "json" | "github-actions";

interface RecordInvocation {
  command: "record";
  configPath: string;
  write: boolean;
}

interface InitInvocation {
  command: "init";
  configPath: string;
  testCommand: string;
  reportPath: string;
}

interface CheckInvocation {
  command: "check";
  configPath: string;
  baseRef?: string;
  mode: Mode;
  format: Format;
}

type Invocation = InitInvocation | RecordInvocation | CheckInvocation;

class InvocationError extends Error {}

const optionValue = (
  arguments_: readonly string[],
  index: number,
  option: string,
): string => {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new InvocationError(`${option} requires a value`);
  return value;
};

const parse = (arguments_: readonly string[]): Invocation => {
  const command = arguments_[0];
  if (command !== "init" && command !== "record" && command !== "check")
    throw new InvocationError("expected init, record, or check");
  const values = new Map<string, string>();
  let write = false;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--write" && command === "record") {
      if (write) throw new InvocationError("--write may be supplied once");
      write = true;
      continue;
    }
    const allowed =
      command === "init"
        ? new Set(["--config", "--command", "--report"])
        : command === "record"
        ? new Set(["--config"])
        : new Set(["--config", "--base-ref", "--mode", "--format"]);
    if (!allowed.has(argument))
      throw new InvocationError(`unsupported option: ${argument}`);
    if (values.has(argument))
      throw new InvocationError(`${argument} may be supplied once`);
    values.set(argument, optionValue(arguments_, index, argument));
    index += 1;
  }
  const configPath = values.get("--config") ?? ".exevra.yml";
  if (command === "init") {
    const testCommand = values.get("--command");
    if (testCommand === undefined)
      throw new InvocationError("--command is required for init");
    const reportPath = values.get("--report");
    if (reportPath === undefined)
      throw new InvocationError("--report is required for init");
    return { command, configPath, testCommand, reportPath };
  }
  if (command === "record") return { command, configPath, write };
  const mode = values.get("--mode") ?? "enforce";
  const format = values.get("--format") ?? "text";
  if (mode !== "enforce" && mode !== "advisory")
    throw new InvocationError("--mode must be enforce or advisory");
  if (format !== "text" && format !== "json" && format !== "github-actions")
    throw new InvocationError("--format must be text, json, or github-actions");
  return {
    command,
    configPath,
    baseRef: values.get("--base-ref"),
    mode,
    format,
  };
};

const render = (format: Format, result: CheckResult): string => {
  if (format === "json") return renderJson(result);
  if (format === "github-actions") return renderGitHubActions(result);
  return renderText(result, { identityDiffs: result.identityDiffs });
};

export const main = async (
  arguments_: readonly string[] = process.argv.slice(2),
): Promise<number> => {
  let invocation: Invocation;
  try {
    invocation = parse(arguments_);
  } catch (error) {
    process.stderr.write(`Invalid invocation: ${(error as Error).message}\n`);
    return 2;
  }
  try {
    if (invocation.command === "init") {
      const result = await initialize({
        configPath: invocation.configPath,
        command: invocation.testCommand,
        reportPath: invocation.reportPath,
      });
      process.stdout.write(
        `Created config: ${invocation.configPath}\n` +
          `Created baseline: ${relative(process.cwd(), result.baselinePath)}\n` +
          `Next: exevra check --config ${invocation.configPath}\n`,
      );
      return 0;
    }
    if (invocation.command === "record") {
      const result = await record({
        configPath: invocation.configPath,
        write: invocation.write,
      });
      process.stdout.write(
        renderText({ findings: result.findings, suites: result.suites }),
      );
      return result.findings.length === 0 ? 0 : 2;
    }
    const result = await check({
      configPath: invocation.configPath,
      baseRef: invocation.baseRef,
    });
    process.stdout.write(render(invocation.format, result));
    return (
      invocation.mode === "advisory" ||
      !result.findings.some((finding) => finding.severity === "error")
    )
      ? 0
      : 1;
  } catch (error) {
    process.stderr.write(`Operational error: ${(error as Error).message}\n`);
    return 2;
  }
};

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`Operational error: ${(error as Error).message}\n`);
      process.exitCode = 2;
    });
}
