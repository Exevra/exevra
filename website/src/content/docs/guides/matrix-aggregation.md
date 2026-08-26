---
title: Matrix and shard aggregation
description: Check downloaded JUnit artifacts without running tests again.
---

Matrix aggregation is included in `@exevra-dev/cli@0.3.0` (introduced in `0.2.0`).

Use `aggregate` when test shards run in separate CI jobs. Your CI provider uploads each shard's JUnit reports; a collector job downloads them into the configured layout, then Exevra evaluates their combined suites against the existing baseline.

Exevra does not call a provider API, download artifacts, infer matrix values, run `command`, or clean report files in this mode. The collector is CI-neutral: artifact transfer remains the workflow's responsibility.

## Configure the expected shards

Keep the normal baseline, command, reports, and policy. Add `aggregation` with one artifact root, explicit shard IDs, and report paths relative to each shard.

```yaml
version: 1
baseline: .exevra/baseline.json
command: mvn verify
reports:
  - target/surefire-reports/TEST-*.xml
aggregation:
  root: artifacts/shards
  shards:
    - unit-jdk17
    - unit-jdk21
  reports:
    - target/surefire-reports/TEST-*.xml
policy:
  default:
    min_executed: 1
    max_drop_percent: 0
```

After download, the collector workspace must contain this layout:

```text
artifacts/shards/
  unit-jdk17/
    target/surefire-reports/TEST-*.xml
  unit-jdk21/
    target/surefire-reports/TEST-*.xml
```

`aggregation.root`, its report paths, and every shard ID are validated as safe relative paths. A shard ID is one directory name, not a path.

## Collect the reports

The generic sequence is:

1. Run tests in each shard job and upload its JUnit report directory as an artifact.
2. In one collector job, download each named artifact into `aggregation.root/<shard>`.
3. Run `exevra aggregate` from the configuration root.

```sh
npx exevra aggregate --config .exevra.yml
npx exevra aggregate --config .exevra.yml --mode advisory
npx exevra aggregate --config .exevra.yml --format json
npx exevra aggregate --config .exevra.yml --format github-actions
```

`enforce` is the default mode. `text` is the default format. The command has no `--base-ref` because changed-file comparison is unavailable for aggregate checks.

## GitHub Actions example

The matrix job uploads only the report directory. The collector downloads each artifact into the configured shard directory, then runs the installed CLI.

```yaml
jobs:
  tests:
    strategy:
      matrix:
        shard: [unit-jdk17, unit-jdk21]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - run: mvn verify
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: exevra-${{ matrix.shard }}
          path: target/surefire-reports

  collect:
    needs: tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
      - run: npm ci
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0
        with:
          name: exevra-unit-jdk17
          path: artifacts/shards/unit-jdk17/target/surefire-reports
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0
        with:
          name: exevra-unit-jdk21
          path: artifacts/shards/unit-jdk21/target/surefire-reports
      - run: npx exevra aggregate --config .exevra.yml --format github-actions
```

Use the shard IDs and artifact destinations from your configuration. This is a CLI step, not the Exevra Action: the Action runs `command`, while `aggregate` deliberately does not.

## Incomplete evidence

Every configured shard directory and report pattern is required. A missing shard produces `SHARD_MISSING`; a missing report in a present shard produces `REPORT_MISSING`; and a shard containing only skipped tests produces `SHARD_NO_TESTS_EXECUTED`. These are error findings, so `enforce` exits 1 before baseline evaluation. Malformed XML and unsafe paths are operational errors and exit 2.

When every shard is present and has executed tests, Exevra combines their suites and applies the usual baseline, count, drop, and identity checks. See [Configuration](../reference/configuration/) and [Output and exit codes](../reference/output-and-exit-codes/) for the full contract.
