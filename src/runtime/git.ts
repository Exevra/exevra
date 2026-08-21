import { spawn } from "node:child_process";
import { RuntimeError } from "./paths.js";

export const validateBaseRef = (baseRef: string): void => {
  if (
    baseRef === "" ||
    baseRef.startsWith("-") ||
    /[\u0000-\u001f\u007f~^:{}?*\[\]\\]/.test(baseRef) ||
    baseRef.includes("..") ||
    baseRef.includes("@")
  ) {
    throw new RuntimeError(`invalid Git base ref: ${baseRef}`);
  }
};

export const changedFiles = async (
  root: string,
  baseRef: string,
): Promise<string[]> => {
  validateBaseRef(baseRef);
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      "git",
      ["diff", "--name-only", `${baseRef}...HEAD`, "--"],
      { cwd: root, shell: false },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk;
    });
    child.once("error", (error) =>
      reject(new RuntimeError(`unable to run Git diff: ${error.message}`)),
    );
    child.once("close", (code) => {
      if (code !== 0)
        reject(
          new RuntimeError(
            `Git diff failed for base ref ${baseRef}: ${stderr.trim() || `exit ${code}`}`,
          ),
        );
      else resolveResult(stdout.split("\n").filter(Boolean));
    });
  });
};
