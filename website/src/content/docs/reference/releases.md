---
title: Releases
description: Track the implemented behavior in Exevra v0 releases.
---

## v0.2.0

Adds CI-neutral `exevra aggregate` for explicit matrix and shard report collection. The command reads already-downloaded JUnit artifacts, combines their suites, evaluates the existing baseline, and never reruns or cleans the configured test command. It supports text, JSON, and GitHub Actions output and reports missing shards, missing reports, and zero-test shards.

The npm package is made by `.github/workflows/publish.yml`, not by a local publish step. A push to `main` that changes `package.json` or `package-lock.json` triggers the workflow; it installs dependencies, runs `npm test`, typecheck, and bundle verification, skips versions already present on npm, and publishes new versions with npm trusted publishing.

## v0.1.2

Adds `exevra init --maven`, which runs `mvn verify` and configures standard Surefire and Failsafe `TEST-*.xml` report patterns. The directories are optional independently, so Maven projects with unit tests only, integration tests only, or both can initialize without custom configuration. Custom Maven report directories and `pom.xml` parsing remain unsupported.

Adds global `exevra --help` and `exevra -h` usage output.

## v0.1.1

Fixes CLI startup through package-manager bin symlinks. Installed `exevra` and `npx --package=@exevra-dev/cli exevra` now run the CLI instead of exiting silently.

## v0.1.0

`exevra init` creates an explicit JUnit execution contract in one step: it writes a new configuration, runs the supplied test command, and records the first baseline. It accepts only `--command`, `--report`, and an optional `--config`; it never overwrites an existing configuration.

Initialization rejects configuration, baseline, and report path collisions or unsafe symlinks before writing files or invoking the test command. To avoid Unicode filesystem aliases, v0 accepts ASCII characters only in the configuration filename and report path; the containing workspace directory may still use non-ASCII characters. If the first run fails, the configuration remains for correction, but no baseline is created.

This first release includes the local CLI and GitHub Action workflow: a configured Bash command, fresh JUnit XML reports, committed schema-v1 baselines, suite execution-count policy, watched-path signal checks, text/JSON/GitHub Actions output, advisory mode, and per-suite test-identity comparison.

New baselines store individual fingerprint multisets. `identity_details: counts` reports missing and added counts, while `identity_details: names` permits bounded readable identifiers only in CLI text and the Action job summary for explicitly configured suites.
