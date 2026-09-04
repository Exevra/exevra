---
title: Output and exit codes
description: Select text, JSON, or GitHub Actions output and interpret outcomes.
---

References to `aggregate` describe the `0.2.0` release.

`check`, `doctor`, `diff`, and `aggregate` support three formats. `text` is the default and includes the final outcome plus either findings, safe diff sections, remediation, notices, and opted-in identity names, or the fixed doctor stage summary. `json` writes the outcome plus either safe findings, notices, suite execution summaries, and safe diff fields, or the ordered doctor checks. `github-actions` writes workflow-command annotations for safe findings, notices, diff lines, or doctor stage lines and appends an escaped job summary when GitHub sets `GITHUB_STEP_SUMMARY`.

Maven filter findings use the normal renderer paths. `TEST_FILTERED` includes only the detected flag names; selector values, test names, and raw command text are excluded from text, JSON, GitHub Actions, and Action summary output. `doctor` likewise stays narrow: it reports only the fixed stages `configuration`, `execution intent`, `test command`, `reports`, `baseline`, and `evaluation`. `diff` keeps the baseline delta narrow: it exposes only `command changed`, `reports changed`, and suite added, removed, or executed/skipped count changes.

```sh
node build/src/cli/index.js check --config .exevra.yml --format text
node build/src/cli/index.js check --config .exevra.yml --format json
node build/src/cli/index.js check --config .exevra.yml --format github-actions
node build/src/cli/index.js doctor --config .exevra.yml --format text
node build/src/cli/index.js doctor --config .exevra.yml --format json
node build/src/cli/index.js doctor --config .exevra.yml --format github-actions
node build/src/cli/index.js diff --config .exevra.yml --format text
node build/src/cli/index.js diff --config .exevra.yml --format json
node build/src/cli/index.js diff --config .exevra.yml --format github-actions
node build/src/cli/index.js aggregate --config .exevra.yml --format text
```

The text and GitHub Actions formats report one of `EXEVRA PASSED`, `EXEVRA PASSED WITH WARNINGS`, or `EXEVRA BLOCKED`. JSON uses `passed`, `passed_with_warnings`, or `blocked`.

Exit code `0` means the command completed without blocking errors, or that `--mode advisory` was selected. Exit code `1` means `check`, `doctor`, `diff`, or `aggregate` found at least one blocking execution-integrity error. Exit code `2` means invalid CLI arguments or an operational failure. `record` uses `0` for a successful recording, including a `TEST_FILTERED` warning, and `2` for invalid invocation, operational failure, or an error finding such as an enforced filter. A warning policy therefore still records the baseline when otherwise permitted by the normal `--write` rule; an enforced filter stops before execution and baseline writing.

For `aggregate`, missing configured shard directories produce `SHARD_MISSING`, missing reports in present shards produce `REPORT_MISSING`, and shards with no non-skipped tests produce `SHARD_NO_TESTS_EXECUTED`. Maven checks use `REPORT_MISSING` when a test-bearing module produces neither standard report family and `REPORT_UNREADABLE` when a matched report cannot be read. These are error findings. Malformed reports and unsafe paths are operational errors. Aggregate checks always include a notice that changed-file comparison is unavailable.

Raw identity names are excluded from JSON and GitHub Actions format. Raw command values, selector values, test identifiers, and report contents are excluded from every format. See [Identity drift](../identity-drift/) for the text and job-summary boundary.
