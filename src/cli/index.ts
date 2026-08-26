#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderGitHubActions,
  renderJson,
  renderText,
} from "../core/index.js";
import {
  aggregate,
  check,
  initialize,
  initializeNode,
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
  autoDetect: boolean;
  testCommand?: string;
  reportPaths?: string[];
}

interface HelpInvocation {
  command: "help";
}

interface CheckInvocation {
  command: "check";
  configPath: string;
  baseRef?: string;
  mode: Mode;
  format: Format;
}

interface AggregateInvocation {
  command: "aggregate";
  configPath: string;
  mode: Mode;
  format: Format;
}

type Invocation =
  | InitInvocation
  | RecordInvocation
  | CheckInvocation
  | AggregateInvocation
  | HelpInvocation;

class InvocationError extends Error {}

const usage =
  "Usage: exevra <command> [options]\n\n" +
  "Commands:\n" +
  "  init [--command <command> --report <path>]\n" +
  "  init --maven\n" +
  "  record [--config <path>] [--write]\n" +
  "  check [--config <path>] [--base-ref <ref>] [--mode enforce|advisory] [--format text|json|github-actions]\n" +
  "  aggregate [--config <path>] [--mode enforce|advisory] [--format text|json|github-actions]\n\n" +
  "Options:\n" +
  "  -h, --help  Show this help\n";

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
  if (arguments_.length === 1 && ["-h", "--help"].includes(arguments_[0]!))
    return { command: "help" };
  const command = arguments_[0];
  if (
    command !== "init" &&
    command !== "record" &&
    command !== "check" &&
    command !== "aggregate"
  )
    throw new InvocationError("expected init, record, check, or aggregate");
  const values = new Map<string, string>();
  let write = false;
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--write" && command === "record") {
      if (write) throw new InvocationError("--write may be supplied once");
      write = true;
      continue;
    }
    if (argument === "--maven" && command === "init") {
      if (values.has(argument)) throw new InvocationError("--maven may be supplied once");
      values.set(argument, "true");
      continue;
    }
    const allowed =
      command === "init"
        ? new Set(["--config", "--command", "--report", "--maven"])
        : command === "record"
        ? new Set(["--config"])
        : command === "check"
        ? new Set(["--config", "--base-ref", "--mode", "--format"])
        : new Set(["--config", "--mode", "--format"]);
    if (!allowed.has(argument))
      throw new InvocationError(`unsupported option: ${argument}`);
    if (values.has(argument))
      throw new InvocationError(`${argument} may be supplied once`);
    values.set(argument, optionValue(arguments_, index, argument));
    index += 1;
  }
  const configPath = values.get("--config") ?? ".exevra.yml";
  if (command === "init") {
    if (values.get("--maven") === "true") {
      if (values.has("--command") || values.has("--report"))
        throw new InvocationError("--maven cannot be combined with --command or --report");
      return {
        command,
        configPath,
        autoDetect: false,
        testCommand: "mvn verify",
        reportPaths: [
          "target/surefire-reports/TEST-*.xml",
          "target/failsafe-reports/TEST-*.xml",
        ],
      };
    }
    const testCommand = values.get("--command");
    if (testCommand === undefined && values.has("--report"))
      throw new InvocationError("--command is required for init");
    if (testCommand === undefined)
      return { command, configPath, autoDetect: true };
    const reportPath = values.get("--report");
    if (reportPath === undefined)
      throw new InvocationError("--report is required for init");
    return {
      command,
      configPath,
      autoDetect: false,
      testCommand,
      reportPaths: [reportPath],
    };
  }
  if (command === "record") return { command, configPath, write };
  const mode = values.get("--mode") ?? "enforce";
  const format = values.get("--format") ?? "text";
  if (mode !== "enforce" && mode !== "advisory")
    throw new InvocationError("--mode must be enforce or advisory");
  if (format !== "text" && format !== "json" && format !== "github-actions")
    throw new InvocationError("--format must be text, json, or github-actions");
  if (command === "aggregate") return { command, configPath, mode, format };
  return { command, configPath, baseRef: values.get("--base-ref"), mode, format };
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
    if (invocation.command === "help") {
      process.stdout.write(usage);
      return 0;
    }
    if (invocation.command === "init") {
      if (invocation.autoDetect) {
        const result = await initializeNode(invocation.configPath);
        process.stdout.write(
          "Exevra\n\n" +
            `✓ Detected ${result.framework}\n` +
            `✓ Test command: ${result.command}\n` +
            `✓ JUnit report: ${result.reportPath}\n` +
            `✓ Created config: ${invocation.configPath}\n` +
            `✓ Created baseline: ${relative(process.cwd(), result.baselinePath)}\n\n` +
            "Ready.\n\n" +
            "Run:\n  npx exevra check\n",
        );
        return 0;
      }
      const result = await initialize({
        configPath: invocation.configPath,
        command: invocation.testCommand!,
        reportPath: invocation.reportPaths!,
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
    if (invocation.command === "aggregate") {
      const result = await aggregate({ configPath: invocation.configPath });
      process.stdout.write(render(invocation.format, result));
      return (
        invocation.mode === "advisory" ||
        !result.findings.some((finding) => finding.severity === "error")
      )
        ? 0
        : 1;
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

const isEntrypoint = (): boolean => {
  const entry = process.argv[1];
  return (
    entry !== undefined &&
    realpathSync(entry) === fileURLToPath(import.meta.url)
  );
};

if (isEntrypoint()) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`Operational error: ${(error as Error).message}\n`);
      process.exitCode = 2;
    });
}
