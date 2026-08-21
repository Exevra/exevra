import { CoreValidationError } from "./config.js";
import { testIdHashes as fingerprintTestIds } from "./junit.js";
import type { Baseline, BaselineSuite } from "./model.js";

type InputRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is InputRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value === "")
    throw new CoreValidationError(`${field} must be a non-empty string`);
  return value;
};
const count = (value: unknown, field: string): number => {
  if (!Number.isInteger(value) || (value as number) < 0)
    throw new CoreValidationError(`${field} must be a non-negative integer`);
  return value as number;
};
const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
const sortedStrings = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value))
    throw new CoreValidationError(`${field} must be an array`);
  const values = value.map((item, index) => {
    if (typeof item !== "string")
      throw new CoreValidationError(`${field}[${index}] must be a string`);
    return item;
  });
  if (values.some((item, index) => index > 0 && compareText(values[index - 1]!, item) > 0))
    throw new CoreValidationError(`${field} must be sorted`);
  return values;
};
const hash = (value: unknown, field: string): string => {
  const valueText = text(value, field);
  if (!/^sha256:[0-9a-f]{64}$/.test(valueText))
    throw new CoreValidationError(`${field} must be a SHA-256 hash`);
  return valueText;
};
const sortedHashes = (value: unknown, field: string): string[] => {
  const values = sortedStrings(value, field).map((item, index) =>
    hash(item, `${field}[${index}]`),
  );
  return values;
};

export const loadBaseline = (source: string | unknown): Baseline => {
  let value: unknown = source;
  if (typeof source === "string") {
    try {
      value = JSON.parse(source);
    } catch {
      throw new CoreValidationError("invalid baseline JSON");
    }
  }
  if (!isRecord(value))
    throw new CoreValidationError("baseline must be an object");
  if (value.schemaVersion !== 1)
    throw new CoreValidationError("baseline schema version is unsupported");
  if (!Array.isArray(value.reports))
    throw new CoreValidationError("baseline reports must be an array");
  if (!Array.isArray(value.suites))
    throw new CoreValidationError("baseline suites must be an array");
  const suites: BaselineSuite[] = value.suites.map((suite, index) => {
    if (!isRecord(suite))
      throw new CoreValidationError(`suites[${index}] must be an object`);
    const testIdsHash = hash(suite.testIdsHash, `suites[${index}].testIdsHash`);
    const testIdHashes =
      suite.testIdHashes === undefined
        ? undefined
        : sortedHashes(suite.testIdHashes, `suites[${index}].testIdHashes`);
    const testIds =
      suite.testIds === undefined
        ? undefined
        : (() => {
            if (testIdHashes === undefined)
              throw new CoreValidationError(
                `suites[${index}].testIds requires testIdHashes`,
              );
            const ids = sortedStrings(suite.testIds, `suites[${index}].testIds`);
            if (ids.length !== testIdHashes.length)
              throw new CoreValidationError(
                `suites[${index}].testIds must have the same length as testIdHashes`,
              );
            if (
              fingerprintTestIds(
                ids.map((id) => ({ id, status: "passed" })),
              ).some((fingerprint, fingerprintIndex) =>
                fingerprint !== testIdHashes[fingerprintIndex],
              )
            )
              throw new CoreValidationError(
                `suites[${index}].testIds must match testIdHashes`,
              );
            return ids;
          })();
    return {
      name: text(suite.name, `suites[${index}].name`),
      executed: count(suite.executed, `suites[${index}].executed`),
      skipped: count(suite.skipped, `suites[${index}].skipped`),
      testIdsHash,
      ...(testIdHashes === undefined ? {} : { testIdHashes }),
      ...(testIds === undefined ? {} : { testIds }),
    };
  });
  if (new Set(suites.map((suite) => suite.name)).size !== suites.length)
    throw new CoreValidationError(
      "baseline must not contain a duplicate suite name",
    );
  return {
    schemaVersion: 1,
    generatedAt: text(value.generatedAt, "generatedAt"),
    command: text(value.command, "command"),
    reports: value.reports.map((item, index) =>
      text(item, `reports[${index}]`),
    ),
    suites,
  };
};

export const serializeBaseline = (
  source: Omit<Baseline, "schemaVersion"> | Baseline,
): string => {
  const baseline = loadBaseline({ ...source, schemaVersion: 1 });
  return `${JSON.stringify({ ...baseline, reports: [...baseline.reports].sort(compareText), suites: [...baseline.suites].sort((left, right) => compareText(left.name, right.name)) }, null, 2)}\n`;
};
