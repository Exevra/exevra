import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

export const configRootFor = async (
  configPath: string,
): Promise<{ configPath: string; root: string }> => {
  const absoluteConfigPath = resolve(configPath);
  let configEntry;
  try {
    configEntry = await lstat(absoluteConfigPath);
  } catch {
    throw new RuntimeError(
      `configuration file does not exist: ${absoluteConfigPath}`,
    );
  }
  if (configEntry.isSymbolicLink())
    throw new RuntimeError(
      `configuration file must not be a symlink: ${absoluteConfigPath}`,
    );
  return {
    configPath: absoluteConfigPath,
    root: await realpath(dirname(absoluteConfigPath)),
  };
};

export const assertSafeInRootPath = async (
  root: string,
  path: string,
  createParents = false,
): Promise<void> => {
  const relation = relative(root, path);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  )
    throw new RuntimeError(
      `configured path escapes the configuration root: ${path}`,
    );
  const segments = relation.split(sep);
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]!);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink())
        throw new RuntimeError(
          `configured path contains a symlink: ${current}`,
        );
      if (index < segments.length - 1 && !entry.isDirectory())
        throw new RuntimeError(
          `configured path has a non-directory parent: ${current}`,
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!createParents || index === segments.length - 1) return;
      try {
        await mkdir(current);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST")
          throw mkdirError;
      }
      const created = await lstat(current);
      if (created.isSymbolicLink() || !created.isDirectory())
        throw new RuntimeError(
          `configured path contains an unsafe parent: ${current}`,
        );
    }
  }
};

export const resolveInRoot = (root: string, configuredPath: string): string => {
  if (isAbsolute(configuredPath))
    throw new RuntimeError(
      `configured path must be relative: ${configuredPath}`,
    );
  const candidate = resolve(root, configuredPath);
  const relation = relative(root, candidate);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new RuntimeError(
      `configured path escapes the configuration root: ${configuredPath}`,
    );
  }
  return candidate;
};
