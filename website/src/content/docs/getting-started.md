---
title: Getting started
description: Install Exevra, initialize a JUnit baseline, and run the first check.
---

Use Node 22 or later. Exevra runs the command in your configuration through Bash on POSIX systems and reads the JUnit XML reports it produces.

Install the CLI as a development dependency in the repository you want to protect:

```sh
npm install --save-dev @exevra-dev/cli@latest
```

For a Node project with a `package.json` test script, let Exevra detect the package manager, test framework, command, and JUnit output:

```sh
npx exevra init
```

Vitest projects without JUnit flags receive `--reporter=junit --outputFile=artifacts/junit.xml` in the generated Exevra command; Exevra does not edit `package.json`. Existing JUnit output flags are reused when an explicit output path is present. A JUnit reporter without an output path is rejected because Exevra needs a file to verify. Other frameworks need an explicit JUnit-producing command when Exevra cannot configure them safely.

The command writes `.exevra.yml`, runs the test command, and creates the first baseline. It never overwrites an existing configuration.

For an explicit command, use:

```sh
npx exevra init \
  --command "npm test -- --reporter=junit --outputFile=artifacts/junit.xml" \
  --report artifacts/junit.xml
```

For Maven projects that use the standard Surefire and/or Failsafe report directories, run:

```sh
npx exevra init --maven
```

This runs `mvn verify` and reads `target/surefire-reports/TEST-*.xml` and `target/failsafe-reports/TEST-*.xml` from the root and declared child modules when present. Root-only and multi-module projects record `maven: { modules: auto, filter_policy: warn }` in `.exevra.yml`; custom report directories and Maven profile/property expansion are not detected.

For Maven-marked configurations, Exevra checks the command for `-Dtest`, `-Dit.test`, `-Dgroups`, `-DexcludedGroups`, `-DskipTests`, `-Dmaven.test.skip`, and `-DskipITs`. The default `maven.filter_policy` is `warn`; `off` suppresses the finding and `enforce` blocks before report cleanup or command execution. With `warn`, Exevra reports `TEST_FILTERED`, then continues with cleanup, command execution, and report evaluation. It can detect `=value`, separate values, and value-less flags at lexical token-like boundaries, but reports flag names only—not selector values or test names.

For Gradle multi-project builds that use standard JUnit XML output, run:

```sh
npx exevra init --gradle
```

This runs `gradle test` and reads `build/test-results/test/TEST-*.xml` for the root project and every project declared by `settings.gradle` or `settings.gradle.kts`. A project without a settings file uses root-only behavior. Custom project directories assigned with `project(...).projectDir = file(...)` are supported; custom report locations are not inferred. Missing or unreadable project reports remain visible as integrity findings.

For pytest, install pytest in your Python environment and run:

```sh
npx exevra init --pytest
```

This uses `python3 -m pytest --junitxml=artifacts/junit.xml`. For a different environment, pass a pytest invocation without JUnit flags, such as `npx exevra init --pytest --command "poetry run pytest"`. Exevra appends the report option; use the explicit `--command` and `--report` form for a different report path.

For v0, `init` accepts ASCII characters only in the configuration filename and report path. Your workspace directory may use non-ASCII characters. This keeps configuration and report paths unambiguous on filesystems with Unicode aliases.

If the first test run fails, produces no valid JUnit report, or reports zero executed tests, `.exevra.yml` remains, but `.exevra/baseline.json` is not created. Fix the test command, then create the baseline from that configuration.

If the baseline is recorded but a suite violates the generated policy, initialization reports the affected suite and keeps both files. Review the suite and its policy, then run `npx exevra check`; do not lower the minimum without reviewing why the suite did not execute. If a baseline already exists before initialization, Exevra leaves it untouched and does not create a new configuration.

```sh
npx exevra record --config .exevra.yml
```

Run `check` in CI or locally. It clears configured report paths before it executes the command, so an old report cannot satisfy the check.
The conventional `.exevra.yml` path is used automatically; pass `--config` only for a different location.

```sh
npx exevra check
```

See the [CLI guide](../guides/cli/) for modes and output formats, configure the [GitHub Action](../guides/github-action/), or run Exevra in [Generic CI and Jenkins](../guides/generic-ci/).
