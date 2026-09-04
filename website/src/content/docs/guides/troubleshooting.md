---
title: Troubleshooting
description: Diagnose common failures from configured commands, reports, and baselines.
---

Exevra removes configured literal reports and files matched by configured report patterns before invoking the configured command. Start with the finding code and inspect the command, report location, and committed contract.

| Finding or notice | What to check |
| --- | --- |
| `REPORT_MISSING` | Ensure the command writes every configured literal JUnit XML file on every run, or at least one configured filename pattern matches. Paths must be relative to the config root. |
| `REPORT_UNREADABLE` | Check permissions on the matched JUnit XML file or report directory. In Maven and Gradle auto-discovery, the finding includes the module-relative report path. |
| `TEST_FILTERED` | Review the seven Maven flags (`-Dtest`, `-Dit.test`, `-Dgroups`, `-DexcludedGroups`, `-DskipTests`, `-Dmaven.test.skip`, and `-DskipITs`) in the configured command. `warn` continues after reporting; `enforce` stops before report cleanup and command execution; `off` suppresses the finding. Only flag names are shown, not selector values. |
| `NO_TESTS_EXECUTED` | Check runner discovery, filters, and skipped tests. A baseline cannot be recorded with zero executed tests. |
| `TEST_COMMAND_FAILED` | Fix the configured Bash command and its test failure before Exevra can evaluate reports. |
| `init` rejects a path before running tests | Use ASCII characters only in the configuration filename and report path. The workspace directory itself may use non-ASCII characters. |
| `BASELINE_MISSING` or schema error | Create or regenerate a supported schema-v1 baseline, review it, and commit it. |
| Suite minimum or drop finding | Inspect the changed test selection and policy. Re-record only if the change is intentional and reviewed. |
| Changed-file comparison unavailable | Provide `--base-ref` to the CLI, or use a pull-request workflow with full checkout history. |
| `TEST_IDENTITIES_CHANGED` | Review the suite change and identity policy. A legacy baseline needs a reviewed re-record for missing and added counts; a names policy may need a re-record before it can show names. |

If the command or report list differs from the baseline, Exevra emits a notice. When execution signal also drops, a command change produces an error finding and watched configuration changes can produce `WATCHED_CONFIG_CHANGED_WITH_SIGNAL_DROP`.

Read [Configuration](../../reference/configuration/) before changing policy values.

Maven filter detection is lexical and conservative. It does not fully parse Bash or Maven, resolve shell expansion or aliases, or inspect profiles, properties, plugins, custom report directories, or report contents.

## Missing module reports

Auto-discovery expects standard report locations for each discovered test-bearing build project. Build-only Maven modules without Maven test source files or current-build compiled test classes are exempt. A direct non-profile Maven `testOutputDirectory` declaration keeps a module report-bearing. For a Maven module named `api`, look for reports under `api/target/surefire-reports/` or `api/target/failsafe-reports/`. For a Gradle project named `app`, look for `app/build/test-results/test/TEST-*.xml`.

Run the build and inspect the expected locations:

```sh
mvn verify                 # Maven
./gradlew test             # Gradle
npx exevra doctor
```

If a discovered test-bearing module produces neither expected report family, Exevra reports `REPORT_MISSING`. Check that the module is declared in the Maven `pom.xml` or Gradle `settings.gradle`/`settings.gradle.kts`, that the test task runs, and that its JUnit reporter is enabled. Auto-discovery does not infer custom report directories; use an explicit report configuration for those projects.

## Unreadable module reports

`REPORT_UNREADABLE` means Exevra found a matched report or report directory but could not read it. Confirm the module-relative path shown by the finding and check permissions from the configuration root:

```sh
test -r api/target/surefire-reports/TEST-api.xml
test -r app/build/test-results/test/TEST-app.xml
npx exevra doctor
```

Fix the build or workspace permissions, then rerun the command. Do not copy a stale report into the missing location: Exevra clears configured reports before `check` and collects fresh evidence.

## Maven filter policies

If the configured Maven command contains a selector or skip flag such as `-Dtest=ApiTest` or `-DskipTests`, Exevra reports `TEST_FILTERED`. Choose the policy that matches the intent:

```yaml
maven:
  modules: auto
  filter_policy: enforce
```

- `warn` reports the filter and continues. Use it when the narrowed run is intentional but should remain visible.
- `enforce` reports an error before report cleanup or command execution. Use it when CI must reject filtered runs.
- `off` suppresses the finding. The command may still run a filtered test set, so this removes the guard rather than changing Maven behavior.

For an accidental filter, remove the selector or skip flag from the configured command. For an intentional filter, document the decision and choose `warn` or `off` explicitly; choose `enforce` when filtered runs must be prevented.
