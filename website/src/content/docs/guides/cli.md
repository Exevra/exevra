---
title: CLI
description: Install the CLI, then initialize, record, check, doctor, diff, or aggregate a baseline from the command line.
---

Install the CLI as a development dependency in the repository you want to protect.

```sh
npm install --save-dev @exevra-dev/cli@0.4.0
```

Run `npx exevra --help` (or `npx exevra -h`) to print the available commands and their options.

## Choose a command

| Goal | Command | Runs tests? | Writes config or baseline? |
| --- | --- | --- | --- |
| Enforce the reviewed contract in CI | `check` | Yes; clears configured reports first | No |
| Diagnose where execution integrity failed | `doctor` | Yes; uses the same execution path as `check` | No |
| Review an intentional change before accepting it | `diff` | Yes; refreshes reports like `check` | No |
| Create or explicitly replace the baseline | `record` | Yes | Baseline only; use `--write` to replace an existing one |
| Evaluate downloaded matrix or shard reports | `aggregate` | No; reads downloaded reports only | No |

The usual workflow is: initialize and record a baseline, run `check` in CI, use `doctor` to diagnose failures, and use `diff` before accepting an intentional change with `record --write`. For matrix jobs, download the reports first and run `aggregate` in the collector job.

## Framework support

Exevra does not call framework APIs. It runs your configured POSIX command and evaluates the fresh JUnit XML reports it produces. See the [supported frameworks reference](../reference/supported-frameworks/) for built-in setup and explicit reporter or converter configuration.

## Initialize a JUnit project

In a Node project with `package.json` and a `test` script, the zero-argument form detects the package manager, recognizes common Node test frameworks, and creates the first baseline:

```sh
npx exevra init
```

Vitest projects are configured by appending JUnit reporter flags to the generated Exevra command. Existing JUnit output flags are reused when an explicit output path is present. A JUnit reporter without an output path is rejected because Exevra needs a file to verify. `package.json` is never edited. If Exevra cannot identify a safe JUnit output, it explains the missing setup; use the explicit form below.

The `npx exevra init --command` form supports JUnit XML only. It writes `.exevra.yml`, runs the test command, and creates the first baseline. It never overwrites an existing configuration.

For v0, `init` accepts ASCII characters only in the configuration filename, report path, and generated baseline path. The containing workspace directory may use non-ASCII characters.

For Maven projects using standard Surefire and/or Failsafe report directories, use `npx exevra init --maven`. It runs `mvn verify` and reads those directories for the root and recursively declared child modules. Root-only and multi-module configurations include `maven: { modules: auto, filter_policy: warn }`; custom report directories, profiles, and property expansion are outside this setup path.

For Gradle multi-project builds using standard JUnit XML output, use `npx exevra init --gradle`. It runs `gradle test` and reads `build/test-results/test/TEST-*.xml` for every project declared by `settings.gradle` or `settings.gradle.kts`. If no settings file is present, the root project is checked as a single project. Missing or unreadable child-project reports are reported as integrity findings.

### Maven test-filter policy

In a Maven-marked configuration, Exevra detects these seven flag families in the configured command: `-Dtest`, `-Dit.test`, `-Dgroups`, `-DexcludedGroups`, `-DskipTests`, `-Dmaven.test.skip`, and `-DskipITs`. `maven.filter_policy` defaults to `warn` and accepts `off`, `warn`, or `enforce`.

`warn` emits `TEST_FILTERED`, then cleans reports, runs the command, and evaluates fresh reports. `enforce` emits an error before cleanup or execution. `off` emits no filter finding. A successful `record` still writes a baseline subject to its normal `--write` rule and exits `0` for a warning; an error finding, including an enforced filter, exits `2`.

Detection accepts `=value`, a separate value, or no value where applicable, but output contains flag names only. It is lexical and conservative rather than a complete Bash or Maven parser, so shell expansion, aliases, profiles, properties, plugins, and custom report configuration are not resolved.

```sh
npx exevra init \
  --command "npm test -- --reporter=junit --outputFile=artifacts/junit.xml" \
  --report artifacts/junit.xml
```

If the first test run fails, produces no valid JUnit report, or reports zero executed tests, `.exevra.yml` remains, but `.exevra/baseline.json` is not created. Fix the test command, then create the baseline from that configuration.

```sh
npx exevra record --config .exevra.yml
```

## Record or update a baseline

`record` runs the configured command, reads fresh reports, and creates a schema-v1 baseline. It refuses to replace an existing file unless you explicitly pass `--write`.

```sh
npx exevra record --config .exevra.yml
npx exevra record --config .exevra.yml --write
```

Use `--write` only after reviewing an intended execution-contract change. See [Baselines](../baselines/) for the review workflow.

`check` runs the command again and compares fresh reports with the committed baseline.
It uses `.exevra.yml` by default; `--config` is only needed for a nonstandard path.

```sh
npx exevra check
npx exevra check --config .exevra.yml --mode advisory
npx exevra check --config .exevra.yml --format json
npx exevra check --config .exevra.yml --format github-actions
```

`--mode enforce` is the default. It returns exit code 1 when at least one error finding exists. `--mode advisory` returns 0 even for error findings. Warning-only findings remain visible and do not fail enforce mode. `record` returns 0 when it records successfully, including with warning findings; it returns 2 for an invalid invocation, an operational failure, or an error finding. `check` returns 2 for an invalid invocation or an operational failure, such as unreadable configuration. Successful commands return 0.

`check --base-ref <ref>` compares watched paths against that Git ref. Without a base ref, the command reports that changed-file comparison is unavailable.

`doctor` reruns the configured command through the same execution path as `check`, may clean the configured reports before collecting fresh ones, and summarizes whether configuration loading, execution intent, command execution, report collection, baseline availability, and the final integrity evaluation all succeeded.

```sh
npx exevra doctor
npx exevra doctor --config .exevra.yml
npx exevra doctor --format json
npx exevra doctor --format github-actions
```

It accepts `--config` and `--format` only. `doctor` never writes `.exevra.yml` or `.exevra/baseline.json`. Every format omits raw command text, selector values, test identifiers, and report contents. It returns `0` when the staged diagnosis is clean or warning-only, `1` when an execution-integrity error blocks evaluation, and `2` for an invalid invocation or operational failure.

`diff` reruns the configured command, refreshes the configured reports the same way as `check`, and prints the safe baseline delta without writing `.exevra.yml` or `.exevra/baseline.json`.

```sh
npx exevra diff
npx exevra diff --config .exevra.yml --mode advisory
npx exevra diff --config .exevra.yml --format json
npx exevra diff --config .exevra.yml --format github-actions
```

The delta is intentionally narrow: `command changed: yes|no`, `reports changed: yes|no`, and per-suite added, removed, or executed/skipped count changes. Raw command text, report contents, and test selector values are excluded from every format. `diff` returns `1` for error findings in enforce mode, `0` in advisory mode or when no error findings exist, and `2` for an invalid invocation or operational failure.

## Aggregate downloaded shard reports

`aggregate` reads the explicit shard artifacts configured under `aggregation`, combines their JUnit suites, and evaluates the existing baseline. It never runs `command` or deletes report files.

```sh
npx exevra aggregate --config .exevra.yml
npx exevra aggregate --config .exevra.yml --mode advisory
npx exevra aggregate --config .exevra.yml --format json
npx exevra aggregate --config .exevra.yml --format github-actions
```

It accepts `--config`, `--mode`, and `--format`; it does not accept `--base-ref`. Missing shard evidence is an error finding in enforce mode. See [Matrix and shard aggregation](./matrix-aggregation/) for the required artifact layout and CI examples.
