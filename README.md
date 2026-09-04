<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="website/src/assets/exevra-folded-trace-dark.svg">
    <img src="website/src/assets/exevra-folded-trace.svg" width="96" alt="Exevra Folded Trace">
  </picture>
</p>

<h1 align="center">EXEVRA</h1>

<p align="center">
  <a href="https://github.com/Exevra/exevra/actions/workflows/ci.yml"><img src="https://github.com/Exevra/exevra/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://www.npmjs.com/package/@exevra-dev/cli"><img src="https://img.shields.io/npm/v/%40exevra-dev%2Fcli.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

<p align="center"><strong>Prove your test run.</strong></p>

Exevra checks that a passing CI command ran the tests your repository expects. It compares fresh JUnit XML reports with a reviewed baseline, then flags missing reports, zero execution, suite-count drops, and test-identity drift.

## Get started

See every command and option with `npx exevra --help` (or `npx exevra -h`).

Install Exevra in the repository you want to protect:

```sh
npm install --save-dev @exevra-dev/cli@0.4.1
```

For a Node project with a `test` script, initialize without wiring reporter flags by hand:

```sh
npx exevra init
```

Exevra detects the package manager and framework, safely configures JUnit output for Vitest, and records the first baseline without editing `package.json`. If the reporter cannot be detected or configured, use the explicit form below.

For an explicit JUnit-producing command:

```sh
npx exevra init \
  --command "npm test -- --reporter=junit --outputFile=artifacts/junit.xml" \
  --report artifacts/junit.xml
```

For a Maven project using standard Surefire and/or Failsafe report directories:

```sh
npx exevra init --maven
```

This runs `mvn verify` and reads standard `TEST-*.xml` reports from either directory in the root and declared child modules. Modules without Maven test source files or current-build compiled test classes are not required to produce a report; a direct `testOutputDirectory` declaration keeps a module report-bearing. Root-only and multi-module configs record `maven: { modules: auto, filter_policy: warn }`; custom report directories are not parsed.

Maven filter detection applies to that marker. Exevra checks the configured command for these seven flag families: `-Dtest`, `-Dit.test`, `-Dgroups`, `-DexcludedGroups`, `-DskipTests`, `-Dmaven.test.skip`, and `-DskipITs`. The default `maven.filter_policy` is `warn`; it also accepts `off` and `enforce`:

- `warn` reports `TEST_FILTERED`, then cleans configured reports, runs the command, and evaluates fresh reports. A successful `record` still writes a valid baseline subject to its normal `--write` rule and exits successfully.
- `enforce` reports `TEST_FILTERED` as an error before report cleanup or command execution. `record` does not write a baseline and exits with code `2`.
- `off` suppresses this finding.

The finding contains flag names only. `=value`, separate flag values, and value-less flags are detected where the command text has a token-like boundary, but selector values and test names are discarded. This is a conservative lexical check, not complete Bash or Maven parsing: shell expansion, aliases, profiles, properties, plugins, and custom report configuration are not resolved.

Run the check locally or in CI:

```sh
npx exevra check
```

Inspect the configured execution contract without writing configuration or baseline files:

```sh
npx exevra doctor
```

`doctor` runs the configured command once through the existing check path, may clean configured reports before collecting fresh ones, and never writes `.exevra.yml` or `.exevra/baseline.json`. It supports `--config` and `--format text|json|github-actions`, reports the fixed stages `configuration`, `execution intent`, `test command`, `reports`, `baseline`, and `evaluation`, returns exit code `0` for a clean or warning result, `1` for a blocking integrity result, and `2` for an invalid invocation or operational failure. Every format stays privacy-safe by omitting raw command text, selector values, test identifiers, and report contents.

Exevra dogfoods this workflow in its own CI: the repository runs `exevra check --format github-actions` against the committed `.exevra.yml` and JUnit baseline before the coverage gate. The self-check runs the test suite once through `test:junit`, verifies the generated report without recursively invoking Exevra, and appends the result to the GitHub job summary.

Review an intended execution-contract change without rewriting the baseline:

```sh
npx exevra diff
```

`diff` runs the configured command again, refreshes the configured reports like `check`, and shows a safe baseline delta. It never writes `.exevra.yml` or `.exevra/baseline.json`; accept the change separately with `record --write` after review.

When an intentional change alters the execution contract, review it and update the baseline:

```sh
npx exevra record --config .exevra.yml --write
```

## Framework support

Exevra is JUnit XML based, not tied to one test framework. It runs the configured POSIX command, reads the fresh reports it produces, and compares them with the reviewed baseline.

Built-in setup:

- **Maven Surefire/Failsafe** — `npx exevra init --maven` detects the standard report directories in the root and declared child modules.
- **Gradle** — `npx exevra init --gradle` detects `build/test-results/test/TEST-*.xml` in the root and declared projects.
- **Vitest** — `npx exevra init` detects Vitest and adds its JUnit reporter flags without editing `package.json`.

Other ecosystems work when their JUnit reporter or converter is configured explicitly:

| Ecosystem | JUnit output | Setup level |
| --- | --- | --- |
| Jest | `jest-junit` | Explicit command/config |
| Playwright | JUnit reporter | Explicit command/config |
| Mocha | `mocha-junit-reporter` | Explicit command/config |
| Cypress | JUnit reporter/plugin | Explicit command/config |
| pytest | `--junitxml` | Explicit command/config |
| Go test | `go-junit-report` or equivalent | Explicit converter |
| .NET xUnit/NUnit/MSTest | JUnit-compatible logger | Explicit logger/config |
| PHPUnit | `--log-junit` | Explicit command/config |
| RSpec | JUnit formatter | Explicit formatter/config |

This list is illustrative, not a whitelist. A framework that cannot produce JUnit XML needs a reporter or converter before Exevra can evaluate it. The CLI currently runs on POSIX/Bash environments, and `doctor` uses the same configured POSIX command and report inputs as `check`.

See the [supported frameworks reference](https://exevra.github.io/exevra/reference/supported-frameworks/) for the canonical compatibility contract and setup details.

## Matrix and shard aggregation

For tests split across CI jobs, upload each shard's JUnit artifact and download it into an explicit `aggregation.root/<shard>` layout in one collector job. Then run:

```sh
npx exevra aggregate --config .exevra.yml
```

`aggregate` combines the downloaded reports and evaluates the existing baseline. It never runs or cleans the configured test command, and it does not integrate with a CI-provider API. See [Matrix and shard aggregation](https://exevra.github.io/exevra/guides/matrix-aggregation/) for the configuration and GitHub Actions example.

## GitHub Actions

Install your project dependencies before Exevra runs. It then executes the command in `.exevra.yml` and checks the reports it creates.

```yaml
name: Test execution integrity

on:
  pull_request:

permissions:
  contents: read

jobs:
  exevra:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
      - run: npm ci
      - uses: Exevra/exevra@v0.4.1
        with:
          config: .exevra.yml
          mode: enforce
```

The public Action can be used from any repository. It needs no write token and makes no GitHub API calls.

## See it work

[demo-spring-boot](https://github.com/Exevra/demo-spring-boot) starts with two passing JUnit suites. Its [broken test-discovery branch](https://github.com/Exevra/demo-spring-boot/tree/demo/broken-test-discovery) silently limits Maven Surefire to one class: Maven stays green, but Exevra blocks CI because an expected report is missing.

## What Exevra does not prove

Exevra checks execution integrity, not test quality, assertions, code correctness, or deployment safety. v0 supports JUnit XML on POSIX systems only. It runs your configured command with the normal permissions of the CI job, so protect changes to the workflow, configuration, and baseline.

## Documentation

The [documentation](https://exevra.github.io/exevra/) covers configuration, baseline review, `doctor`, identity privacy, output formats, matrix aggregation, GitHub Actions, and generic CI systems such as Jenkins.


## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE)
