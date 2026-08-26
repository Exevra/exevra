---
title: Getting started
description: Install Exevra, initialize a JUnit baseline, and run the first check.
---

Use Node 22 or later. Exevra runs the command in your configuration through Bash on POSIX systems and reads the JUnit XML reports it produces.

Install the CLI as a development dependency in the repository you want to protect:

```sh
npm install --save-dev @exevra-dev/cli@0.2.0
```

For a Node project with a `package.json` test script, let Exevra detect the package manager, test framework, command, and JUnit output:

```sh
npx exevra init
```

Vitest projects without JUnit flags receive `--reporter=junit --outputFile=artifacts/junit.xml` in the generated Exevra command; Exevra does not edit `package.json`. Existing JUnit output flags are reused. Other frameworks need an explicit JUnit-producing command when Exevra cannot configure them safely.

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

This runs `mvn verify` and reads `target/surefire-reports/TEST-*.xml` and `target/failsafe-reports/TEST-*.xml` when present. Custom report directories are not detected.

For v0, `init` accepts ASCII characters only in the configuration filename and report path. Your workspace directory may use non-ASCII characters. This keeps configuration and report paths unambiguous on filesystems with Unicode aliases.

If the first test run fails, produces no valid JUnit report, or reports zero executed tests, `.exevra.yml` remains, but `.exevra/baseline.json` is not created. Fix the test command, then create the baseline from that configuration.

```sh
npx exevra record --config .exevra.yml
```

Run `check` in CI or locally. It clears configured report paths before it executes the command, so an old report cannot satisfy the check.
The conventional `.exevra.yml` path is used automatically; pass `--config` only for a different location.

```sh
npx exevra check
```

See the [CLI guide](../guides/cli/) for modes and output formats, configure the [GitHub Action](../guides/github-action/), or run Exevra in [Generic CI and Jenkins](../guides/generic-ci/).
