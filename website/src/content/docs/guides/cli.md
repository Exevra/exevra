---
title: CLI
description: Install the CLI, then initialize, record, check, or aggregate a baseline from the command line.
---

Install the CLI as a development dependency in the repository you want to protect.

```sh
npm install --save-dev @exevra-dev/cli@0.1.2
```

Run `npx exevra --help` (or `npx exevra -h`) to print the available commands and their options.

## Initialize a JUnit project

The `npx exevra init --command` form supports JUnit XML only. It writes `.exevra.yml`, runs the test command, and creates the first baseline. It never overwrites an existing configuration.

For v0, `init` accepts ASCII characters only in the configuration filename, report path, and generated baseline path. The containing workspace directory may use non-ASCII characters.

For Maven projects using standard Surefire and/or Failsafe report directories, use `npx exevra init --maven`. It runs `mvn verify` and reads `target/surefire-reports/TEST-*.xml` and `target/failsafe-reports/TEST-*.xml` when present; it does not parse custom Maven report directories.

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

```sh
npx exevra check --config .exevra.yml
npx exevra check --config .exevra.yml --mode advisory
npx exevra check --config .exevra.yml --format json
npx exevra check --config .exevra.yml --format github-actions
```

`--mode enforce` is the default. It returns exit code 1 when at least one error finding exists. `--mode advisory` returns 0 even for error findings. Warning-only findings remain visible and do not fail enforce mode. `record` and `check` return 2 for an invalid invocation or an operational failure, such as unreadable configuration; `record` also returns 2 if it finishes with findings. Successful commands return 0.

`check --base-ref <ref>` compares watched paths against that Git ref. Without a base ref, the command reports that changed-file comparison is unavailable.

## Aggregate downloaded shard reports

`aggregate` reads the explicit shard artifacts configured under `aggregation`, combines their JUnit suites, and evaluates the existing baseline. It never runs `command` or deletes report files.

```sh
npx exevra aggregate --config .exevra.yml
npx exevra aggregate --config .exevra.yml --mode advisory
npx exevra aggregate --config .exevra.yml --format json
npx exevra aggregate --config .exevra.yml --format github-actions
```

It accepts `--config`, `--mode`, and `--format`; it does not accept `--base-ref`. Missing shard evidence is an error finding in enforce mode. See [Matrix and shard aggregation](./matrix-aggregation/) for the required artifact layout and CI examples.
