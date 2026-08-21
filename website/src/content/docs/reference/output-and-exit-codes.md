---
title: Output and exit codes
description: Select text, JSON, or GitHub Actions output and interpret outcomes.
---

`check` supports three formats. `text` is the default and includes the final outcome, findings, remediation, notices, and opted-in identity names. `json` writes the outcome, safe findings, notices, and suite execution summaries. `github-actions` writes workflow-command annotations for safe findings and notices.

```sh
node build/src/cli/index.js check --config .exevra.yml --format text
node build/src/cli/index.js check --config .exevra.yml --format json
node build/src/cli/index.js check --config .exevra.yml --format github-actions
```

The text and GitHub Actions formats report one of `EXEVRA PASSED`, `EXEVRA PASSED WITH WARNINGS`, or `EXEVRA BLOCKED`. JSON uses `passed`, `passed_with_warnings`, or `blocked`.

Exit code `0` means the command completed without blocking errors, or that `--mode advisory` was selected. Exit code `1` means `check --mode enforce` found at least one error. Exit code `2` means invalid CLI arguments or an operational failure. `record` uses `0` for a successful recording and `2` for invalid invocation, operational failure, or findings.

Raw identity names are excluded from JSON and GitHub Actions format. See [Identity drift](../identity-drift/) for the text and job-summary boundary.
