export type FindingCode =
  | "REPORT_MISSING"
  | "SHARD_MISSING"
  | "SHARD_NO_TESTS_EXECUTED"
  | "NO_TESTS_EXECUTED"
  | "SUITE_BELOW_MINIMUM"
  | "SUITE_DROP_EXCEEDED"
  | "WATCHED_CONFIG_CHANGED_WITH_SIGNAL_DROP"
  | "TEST_IDENTITIES_CHANGED"
  | "BASELINE_MISSING"
  | "BASELINE_SCHEMA_UNSUPPORTED"
  | "TEST_COMMAND_FAILED";

export type TestStatus = "passed" | "skipped" | "failed" | "error";

export type IdentityPolicy = "off" | "warn" | "enforce";

export type IdentityDetailsPolicy = "counts" | "names";

export interface CanonicalTest {
  id: string;
  status: TestStatus;
}

export interface CanonicalSuite {
  name: string;
  tests: CanonicalTest[];
  executed: number;
  skipped: number;
}

export interface SuitePolicy {
  minExecuted: number;
  maxDropPercent: number;
  identity: IdentityPolicy;
  identityDetails: IdentityDetailsPolicy;
}

export interface ProtectedSuitePolicy extends SuitePolicy {
  name: string;
  match: string;
}

export interface AggregationConfig {
  root: string;
  shards: string[];
  reports: string[];
}

export interface Config {
  version: 1;
  baseline: string;
  command: string;
  reports: string[];
  watched: string[];
  aggregation?: AggregationConfig;
  policy: {
    default: SuitePolicy;
    protectedSuites: ProtectedSuitePolicy[];
  };
}

export interface BaselineSuite {
  name: string;
  executed: number;
  skipped: number;
  testIdsHash: string;
  testIdHashes?: string[];
  testIds?: string[];
}

export interface Baseline {
  schemaVersion: number;
  generatedAt: string;
  command: string;
  reports: string[];
  suites: BaselineSuite[];
}

export interface Finding {
  code: FindingCode;
  severity: "error" | "warning";
  suite?: string;
  baseExecuted?: number;
  headExecuted?: number;
  missingTestCount?: number;
  addedTestCount?: number;
  message: string;
  remediation: string;
}

export interface EvaluationResult {
  findings: Finding[];
}
