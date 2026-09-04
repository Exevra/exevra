---
title: Configuration
description: Define the version-1 command, reports, watched paths, and suite policies.
---

`.exevra.yml` must be a version-1 YAML object. The configuration file itself cannot be a symlink. Every `baseline`, `reports`, `watched`, and aggregation path is a non-empty relative path within the configuration root: absolute paths, `..`, backslashes, NUL bytes, and paths that resolve outside that root are rejected.

```yaml
version: 1
baseline: .exevra/baseline.json
command: npm test -- --reporter=junit --outputFile=artifacts/junit.xml
reports:
  - artifacts/junit.xml
watched:
  - package.json
  - package-lock.json
policy:
  default:
    min_executed: 1
    max_drop_percent: 0
    identity: warn
    identity_details: counts
  protected_suites:
    - name: stable unit tests
      match: "^unit$"
      min_executed: 1
      max_drop_percent: 0
      identity: enforce
      identity_details: names
```

For a Maven root-only or multi-module project, `init --maven` adds this marker:

```yaml
maven:
  modules: auto
  filter_policy: warn
```

`version` must be `1`. `baseline` is the JSON baseline path. `command` is a non-empty Bash command. `reports` is a non-empty list of unique JUnit XML paths or filename patterns. A pattern may contain `*` in its filename, not its directory, and every matched XML file is checked. Literal report paths must be produced on every run. If all report entries are patterns, at least one must match; this lets `init --maven` work for Surefire-only, Failsafe-only, and combined Maven projects. `watched` is an optional list of paths matched as globs when a base ref is available.

`policy.default` is required. Its `min_executed` is a non-negative integer and `max_drop_percent` is a number from 0 through 100. `identity` accepts `off`, `warn`, or `enforce` and defaults to `warn`; `identity_details` accepts `counts` or `names` and defaults to `counts`.

`policy.protected_suites` is optional. Every item needs a non-empty `name`, a valid regular-expression `match`, and the same policy fields as `default`. Exevra selects the first protected-suite policy whose regular expression matches a suite name; otherwise it uses `default`.

When `maven.modules` is `auto`, Exevra follows literal `<module>` declarations from `pom.xml` files, recursively visits declared child POMs, and expands the configured standard Surefire/Failsafe report patterns in each non-aggregator module. A root-only project is represented by the same Maven marker and is checked as one module. A module may produce either report family or both. Modules without Maven test source files or current-build compiled test classes are not required to produce a report; a test-bearing module producing neither report family yields `REPORT_MISSING`. A matched report that cannot be read yields `REPORT_UNREADABLE`. Profiles, properties, parent inheritance, and custom report directories are not evaluated. Source detection recognizes common JVM test-source extensions under `src/test`; compiled `.class` files under `target/test-classes` from the current build also mark a module as test-bearing, and a direct non-profile `testOutputDirectory` declaration keeps it report-bearing.

`maven.filter_policy` controls lexical detection of test selection and skip flags in the configured command. It defaults to `warn` when omitted and accepts `off`, `warn`, or `enforce`. The seven supported flag families are `-Dtest`, `-Dit.test`, `-Dgroups`, `-DexcludedGroups`, `-DskipTests`, `-Dmaven.test.skip`, and `-DskipITs`. With `warn`, Exevra reports `TEST_FILTERED` and continues through report cleanup, command execution, and fresh-report evaluation. With `enforce`, it reports an error and stops after loading the configuration, before cleanup or execution. With `off`, it emits no filter finding.

The detector recognizes `=value`, a following value, and value-less flags where applicable at lexical token-like boundaries. Findings contain only the matched flag names; selector values and test names are never included. This is not complete Bash or Maven parsing and does not resolve shell expansion, aliases, profiles, properties, plugins, or custom Maven configuration. Non-Maven configurations are unchanged.

For Gradle multi-project builds, `gradle.modules: auto` reads literal project declarations from `settings.gradle` or `settings.gradle.kts` and expands each configured report path relative to every included project. Standard onboarding uses `build/test-results/test/TEST-*.xml`. Custom project directories assigned with `project(...).projectDir = file(...)` are supported. A missing or unreadable project report is retained as `REPORT_MISSING` or `REPORT_UNREADABLE`; a project with no settings file uses the root-only behavior. Maven and Gradle markers cannot be configured together.

```yaml
gradle:
  modules: auto
```

## Aggregation

The `aggregation` configuration and `aggregate` command are part of the `0.2.0` release.

`aggregation` is optional and is used only by `aggregate`. It needs a relative `root`, a non-empty list of unique `shards`, and a non-empty list of shard-relative JUnit `reports`. A shard is one directory name: it cannot contain a separator, `.`, `..`, or NUL.

```yaml
aggregation:
  root: artifacts/shards
  shards:
    - unit-jdk17
    - unit-jdk21
  reports:
    - target/surefire-reports/TEST-*.xml
```

The collector expects each artifact under `aggregation.root/<shard>`, and applies each aggregation report pattern relative to that directory. The top-level `reports` remain the contract for `check` and `record`; `aggregate` does not run `command`, clear reports, or use `watched` paths. See [Matrix and shard aggregation](../../guides/matrix-aggregation/) for the CI workflow.

Read [Identity drift](../identity-drift/) before using `names`.
