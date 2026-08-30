import { parseDocument } from "yaml";
import type {
  AggregationConfig,
  Config,
  GradleConfig,
  IdentityDetailsPolicy,
  IdentityPolicy,
  MavenConfig,
  MavenFilterPolicy,
  ProtectedSuitePolicy,
  SuitePolicy,
} from "./model.js";

export class CoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreValidationError";
  }
}

type InputRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is InputRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "")
    throw new CoreValidationError(`${field} must be a non-empty string`);
  return value;
};

const relativePath = (value: unknown, field: string): string => {
  const path = stringValue(value, field);
  if (
    path.startsWith("/") ||
    path.includes("\u0000") ||
    path.includes("\\") ||
    path.split("/").includes("..")
  )
    throw new CoreValidationError(
      `${field} must be a relative path within the configuration root`,
    );
  const normalized = path
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
  if (normalized === "")
    throw new CoreValidationError(
      `${field} must be a relative file path within the configuration root`,
    );
  return normalized;
};

const shard = (value: unknown, field: string): string => {
  const id = stringValue(value, field);
  if (
    id === "." ||
    id === ".." ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\u0000")
  )
    throw new CoreValidationError(`${field} must be a single shard ID`);
  return id;
};

const aggregation = (value: unknown): AggregationConfig => {
  if (!isRecord(value))
    throw new CoreValidationError("aggregation must be an object");
  if (!Array.isArray(value.shards) || value.shards.length === 0)
    throw new CoreValidationError("aggregation.shards must be a non-empty array");
  if (!Array.isArray(value.reports) || value.reports.length === 0)
    throw new CoreValidationError("aggregation.reports must be a non-empty array");
  const shards = value.shards.map((item, index) =>
    shard(item, `aggregation.shards[${index}]`),
  );
  if (new Set(shards).size !== shards.length)
    throw new CoreValidationError("aggregation.shards must not contain a duplicate shard ID");
  const reports = value.reports.map((item, index) =>
    relativePath(item, `aggregation.reports[${index}]`),
  );
  if (new Set(reports).size !== reports.length)
    throw new CoreValidationError(
      "aggregation.reports must not contain a duplicate report path",
    );
  return {
    root: relativePath(value.root, "aggregation.root"),
    shards,
    reports,
  };
};

const mavenConfig = (value: unknown): MavenConfig => {
  if (!isRecord(value))
    throw new CoreValidationError("maven must be an object");
  if (value.modules !== "auto")
    throw new CoreValidationError("maven.modules must be auto");
  const filterPolicy =
    value.filter_policy === undefined
      ? "warn"
      : (value.filter_policy as MavenFilterPolicy);
  if (filterPolicy !== "off" && filterPolicy !== "warn" && filterPolicy !== "enforce")
    throw new CoreValidationError(
      "maven.filter_policy must be off, warn, or enforce",
    );
  return { modules: "auto", filterPolicy };
};

const gradleConfig = (value: unknown): GradleConfig => {
  if (!isRecord(value))
    throw new CoreValidationError("gradle must be an object");
  if (value.modules !== "auto")
    throw new CoreValidationError("gradle.modules must be auto");
  return { modules: "auto" };
};

const policy = (value: unknown, field: string): SuitePolicy => {
  if (!isRecord(value))
    throw new CoreValidationError(`${field} must be an object`);
  const minExecuted = value.min_executed;
  const maxDropPercent = value.max_drop_percent;
  if (!Number.isInteger(minExecuted) || (minExecuted as number) < 0)
    throw new CoreValidationError(
      `${field}.min_executed must be a non-negative integer`,
    );
  if (
    typeof maxDropPercent !== "number" ||
    !Number.isFinite(maxDropPercent) ||
    maxDropPercent < 0 ||
    maxDropPercent > 100
  )
    throw new CoreValidationError(
      `${field}.max_drop_percent must be between 0 and 100`,
    );
  const identity =
    value.identity === undefined ? "warn" : (value.identity as IdentityPolicy);
  if (identity !== "off" && identity !== "warn" && identity !== "enforce")
    throw new CoreValidationError(
      `${field}.identity must be off, warn, or enforce`,
    );
  const identityDetails =
    value.identity_details === undefined
      ? "counts"
      : (value.identity_details as IdentityDetailsPolicy);
  if (identityDetails !== "counts" && identityDetails !== "names")
    throw new CoreValidationError(
      `${field}.identity_details must be counts or names`,
    );
  return {
    minExecuted: minExecuted as number,
    maxDropPercent,
    identity,
    identityDetails,
  };
};

const parseSource = (source: string | unknown): unknown => {
  if (typeof source !== "string") return source;
  const document = parseDocument(source, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0)
    throw new CoreValidationError(
      `invalid YAML configuration: ${document.errors[0]?.message ?? "unknown parse error"}`,
    );
  return document.toJS({ maxAliasCount: 0 });
};

export const loadConfig = (source: string | unknown): Config => {
  const value = parseSource(source);
  if (!isRecord(value))
    throw new CoreValidationError("configuration must be an object");
  if (value.version !== 1) throw new CoreValidationError("version must be 1");
  if (!Array.isArray(value.reports) || value.reports.length === 0)
    throw new CoreValidationError("reports must be a non-empty array");
  const reports = value.reports.map((item, index) =>
    relativePath(item, `reports[${index}]`),
  );
  if (new Set(reports).size !== reports.length)
    throw new CoreValidationError(
      "reports must not contain a duplicate report path",
    );
  const watched =
    value.watched === undefined
      ? []
      : Array.isArray(value.watched)
        ? value.watched.map((item, index) =>
            relativePath(item, `watched[${index}]`),
          )
        : (() => {
            throw new CoreValidationError("watched must be an array");
          })();
  if (!isRecord(value.policy))
    throw new CoreValidationError("policy must be an object");
  const protectedValues =
    value.policy.protected_suites === undefined
      ? []
      : value.policy.protected_suites;
  if (!Array.isArray(protectedValues))
    throw new CoreValidationError("policy.protected_suites must be an array");
  const protectedSuites: ProtectedSuitePolicy[] = protectedValues.map(
    (item, index) => {
      if (!isRecord(item))
        throw new CoreValidationError(
          `policy.protected_suites[${index}] must be an object`,
        );
      const match = stringValue(
        item.match,
        `policy.protected_suites[${index}].match`,
      );
      try {
        new RegExp(match);
      } catch {
        throw new CoreValidationError(
          `policy.protected_suites[${index}].match must be a valid regular expression`,
        );
      }
      return {
        name: stringValue(item.name, `policy.protected_suites[${index}].name`),
        match,
        ...policy(item, `policy.protected_suites[${index}]`),
      };
    },
  );
  if (value.maven !== undefined && value.gradle !== undefined)
    throw new CoreValidationError("maven and gradle cannot both be configured");
  return {
    version: 1,
    baseline: relativePath(value.baseline, "baseline"),
    command: stringValue(value.command, "command"),
    reports,
    watched,
    aggregation:
      value.aggregation === undefined ? undefined : aggregation(value.aggregation),
    maven: value.maven === undefined ? undefined : mavenConfig(value.maven),
    gradle: value.gradle === undefined ? undefined : gradleConfig(value.gradle),
    policy: {
      default: policy(value.policy.default, "policy.default"),
      protectedSuites,
    },
  };
};
