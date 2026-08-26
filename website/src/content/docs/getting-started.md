---
title: Getting started
description: Install Exevra, initialize a JUnit baseline, and run the first check.
---

Use Node 22 or later. Exevra runs the command in your configuration through Bash on POSIX systems and reads the JUnit XML reports it produces.

Install the CLI as a development dependency in the repository you want to protect:

```sh
npm install --save-dev @exevra-dev/cli@0.2.0
```

Initialize Exevra with a test command that writes JUnit XML. The `npx exevra init --command` form supports JUnit XML only. It writes `.exevra.yml`, runs the command, and creates the first baseline. It never overwrites an existing configuration.

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

```sh
npx exevra check --config .exevra.yml
```

See the [CLI guide](../guides/cli/) for modes and output formats, configure the [GitHub Action](../guides/github-action/), or run Exevra in [Generic CI and Jenkins](../guides/generic-ci/).
