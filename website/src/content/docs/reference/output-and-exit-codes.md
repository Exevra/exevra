---
title: Output and exit codes
description: Select text, JSON, or GitHub Actions output and interpret outcomes.
---

> **Unreleased:** References to `aggregate` describe the source branch only. `@exevra-dev/cli@0.1.2` does not include that command.

`check` and `aggregate` support three formats. `text` is the default and includes the final outcome, findings, remediation, notices, and opted-in identity names. `json` writes the outcome, safe findings, notices, and suite execution summaries. `github-actions` writes workflow-command annotations for safe findings and notices.

```sh
node build/src/cli/index.js check --config .exevra.yml --format text
node build/src/cli/index.js check --config .exevra.yml --format json
node build/src/cli/index.js check --config .exevra.yml --format github-actions
node build/src/cli/index.js aggregate --config .exevra.yml --format text
```

The text and GitHub Actions formats report one of `EXEVRA PASSED`, `EXEVRA PASSED WITH WARNINGS`, or `EXEVRA BLOCKED`. JSON uses `passed`, `passed_with_warnings`, or `blocked`.

Exit code `0` means the command completed without blocking errors, or that `--mode advisory` was selected. Exit code `1` means `check` or `aggregate` in `--mode enforce` found at least one error. Exit code `2` means invalid CLI arguments or an operational failure. `record` uses `0` for a successful recording and `2` for invalid invocation, operational failure, or findings.

For `aggregate`, missing configured shard directories produce `SHARD_MISSING`, missing reports in present shards produce `REPORT_MISSING`, and shards with no non-skipped tests produce `SHARD_NO_TESTS_EXECUTED`. They are error findings. Malformed reports and unsafe paths are operational errors. Aggregate checks always include a notice that changed-file comparison is unavailable.

Raw identity names are excluded from JSON and GitHub Actions format. See [Identity drift](../identity-drift/) for the text and job-summary boundary.
