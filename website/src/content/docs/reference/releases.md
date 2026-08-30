---
title: Releases
description: Track the implemented behavior in Exevra v0 releases.
---

## v0.4.0

Adds read-only execution review with `exevra diff` and staged diagnostics with `exevra doctor`. `diff` compares a fresh run with the reviewed baseline without writing configuration or baseline files. `doctor` reports configuration, execution intent, command, reports, baseline, and evaluation stages. Both support text, JSON, and GitHub Actions output.

Adds first-class Gradle onboarding with `exevra init --gradle`, including standard JUnit report discovery for root and declared multi-project builds. Missing or unreadable project reports remain visible as integrity findings.

Extends Maven onboarding to recursively discover declared modules and collect standard Surefire and Failsafe reports per module, including either report family when present. Missing or unreadable module evidence is reported instead of being silently ignored.

Adds Maven test-filter integrity checks for `-Dtest`, `-Dit.test`, `-Dgroups`, `-DexcludedGroups`, `-DskipTests`, `-Dmaven.test.skip`, and `-DskipITs`. The `off`, `warn`, and `enforce` policies make intentional filtering explicit without exposing selector values.

Hardens every output path—including GitHub Action annotations and job summaries—to omit raw commands, selector values, test identifiers, and report contents. The repository now dogfoods Exevra in CI, enforces coverage thresholds, verifies the generated Action bundle, and validates the published package from an empty consumer.

See [Upgrade to v0.4.0](../guides/upgrading/) for the migration checklist from v0.3.1.

## v0.3.1

Refreshes the bundled GitHub Action with `@vercel/ncc` 0.45.0. The release keeps the existing CLI and Action behavior while updating the generated Node 24 bundle and its build tooling.

## v0.3.0

Adds zero-argument `exevra init` for Node projects. It detects the package manager, common test frameworks, and existing JUnit output from `package.json`; Vitest projects receive safe JUnit reporter flags in the generated Exevra command without changing `package.json`. Projects that need unsupported reporter configuration receive an explicit fallback error.

The release CI validates the integration against real Vitest, Jest with `jest-junit`, and Playwright projects. Jest and Playwright remain explicit-configuration integrations; the zero-argument setup path is intentionally limited to reporter configurations Exevra can prove safe.

## v0.2.0

Adds CI-neutral `exevra aggregate` for explicit matrix and shard report collection. The command reads already-downloaded JUnit artifacts, combines their suites, evaluates the existing baseline, and never reruns or cleans the configured test command. It supports text, JSON, and GitHub Actions output and reports missing shards, missing reports, and zero-test shards.

## v0.1.2

Adds `exevra init --maven`, which runs `mvn verify` and configures standard Surefire and Failsafe `TEST-*.xml` report patterns. The directories are optional independently, so Maven projects with unit tests only, integration tests only, or both can initialize without custom configuration. Multi-module projects use literal `<module>` declarations from `pom.xml`; profiles, properties, plugins, and custom Maven report directories remain unsupported.

Adds global `exevra --help` and `exevra -h` usage output.

## v0.1.1

Fixes CLI startup through package-manager bin symlinks. Installed `exevra` and `npx --package=@exevra-dev/cli exevra` now run the CLI instead of exiting silently.

## v0.1.0

`exevra init` creates an explicit JUnit execution contract in one step: it writes a new configuration, runs the supplied test command, and records the first baseline. It accepts only `--command`, `--report`, and an optional `--config`; it never overwrites an existing configuration.

Initialization rejects configuration, baseline, and report path collisions or unsafe symlinks before writing files or invoking the test command. To avoid Unicode filesystem aliases, v0 accepts ASCII characters only in the configuration filename and report path; the containing workspace directory may still use non-ASCII characters. If the first run fails, the configuration remains for correction, but no baseline is created.

This first release includes the local CLI and GitHub Action workflow: a configured Bash command, fresh JUnit XML reports, committed schema-v1 baselines, suite execution-count policy, watched-path signal checks, text/JSON/GitHub Actions output, advisory mode, and per-suite test-identity comparison.

New baselines store individual fingerprint multisets. `identity_details: counts` reports missing and added counts, while `identity_details: names` permits bounded readable identifiers only in CLI text and the Action job summary for explicitly configured suites.
