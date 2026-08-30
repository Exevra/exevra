import { lstat, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { Finding } from "../core/index.js";
import { RuntimeError } from "./paths.js";

const commandFinding = (exitCode: number | null): Finding => ({
  code: "TEST_COMMAND_FAILED",
  severity: "error",
  message: `Configured test command failed with exit code ${exitCode ?? "unknown"}.`,
  remediation: "Fix the test command failure before evaluating test execution.",
});

export const cleanReports = async (
  reportPaths: readonly string[],
): Promise<void> => {
  for (const path of reportPaths) {
    try {
      const entry = await lstat(path);
      if (entry.isSymbolicLink())
        throw new RuntimeError(
          `configured report path is a symlink and will not be removed: ${path}`,
        );
      if (entry.isDirectory())
        throw new RuntimeError(
          `configured report path is a directory and will not be removed: ${path}`,
        );
      await rm(path, { force: false });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
};

export const runConfiguredCommand = async (
  root: string,
  command: string,
  suppressOutput = false,
): Promise<{ finding?: Finding }> =>
  new Promise((resolveResult, reject) => {
    const child = spawn("bash", ["-e", "-o", "pipefail", "-c", command], {
      cwd: root,
      shell: false,
      stdio: suppressOutput ? "ignore" : "inherit",
    });
    child.once("error", (error) =>
      reject(
        new RuntimeError(
          `unable to execute configured test command: ${error.message}`,
        ),
      ),
    );
    child.once("close", (code) =>
      resolveResult(code === 0 ? {} : { finding: commandFinding(code) }),
    );
  });

export const missingReports = async (
  reportPaths: readonly string[],
): Promise<string[]> => {
  const missing: string[] = [];
  for (const path of reportPaths) {
    try {
      if (!(await stat(path)).isFile()) missing.push(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        missing.push(path);
      else throw error;
    }
  }
  return missing;
};
