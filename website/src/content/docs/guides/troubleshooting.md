---
title: Troubleshooting
description: Diagnose common failures from configured commands, reports, and baselines.
---

Exevra removes configured literal reports and files matched by configured report patterns before invoking the configured command. Start with the finding code and inspect the command, report location, and committed contract.

| Finding or notice | What to check |
| --- | --- |
| `REPORT_MISSING` | Ensure the command writes every configured literal JUnit XML file on every run, or at least one configured filename pattern matches. Paths must be relative to the config root. |
| `NO_TESTS_EXECUTED` | Check runner discovery, filters, and skipped tests. A baseline cannot be recorded with zero executed tests. |
| `TEST_COMMAND_FAILED` | Fix the configured Bash command and its test failure before Exevra can evaluate reports. |
| `init` rejects a path before running tests | Use ASCII characters only in the configuration filename and report path. The workspace directory itself may use non-ASCII characters. |
| `BASELINE_MISSING` or schema error | Create or regenerate a supported schema-v1 baseline, review it, and commit it. |
| Suite minimum or drop finding | Inspect the changed test selection and policy. Re-record only if the change is intentional and reviewed. |
| Changed-file comparison unavailable | Provide `--base-ref` to the CLI, or use a pull-request workflow with full checkout history. |
| `TEST_IDENTITIES_CHANGED` | Review the suite change and identity policy. A legacy baseline needs a reviewed re-record for missing and added counts; a names policy may need a re-record before it can show names. |

If the command or report list differs from the baseline, Exevra emits a notice. When execution signal also drops, a command change produces an error finding and watched configuration changes can produce `WATCHED_CONFIG_CHANGED_WITH_SIGNAL_DROP`.

Read [Configuration](../../reference/configuration/) before changing policy values.
