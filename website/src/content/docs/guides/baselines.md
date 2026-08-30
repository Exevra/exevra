---
title: Baselines
description: Review and deliberately update the committed execution contract.
---

The baseline records the configured command, report paths, suite counts, and test-identity information from a known-good run. Commit it with `.exevra.yml`; together they are the reviewable execution contract.

Create a new baseline with `record`. Re-record only when a reviewer has accepted the execution change.

```sh
node build/src/cli/index.js diff --config .exevra.yml
node build/src/cli/index.js record --config .exevra.yml --write
git diff -- .exevra.yml .exevra/baseline.json
```

`diff` runs the configured command, refreshes the configured reports, and shows a safe delta against the committed baseline. It reports only command/report change booleans plus suite added, removed, or executed/skipped count changes. It never rewrites `.exevra.yml` or `.exevra/baseline.json`, and it never exposes raw command text, report contents, or selector values.

Use `record --write` only after a reviewer has accepted that delta.

New baselines store sorted per-test SHA-256 fingerprint multisets. This makes missing and added identity counts available while preserving duplicate identifiers. Existing schema-v1 baselines without those fingerprints remain valid, but identity drift stays generic until a reviewed `record --write` enriches them.

`identity_details: names` stores readable canonical identifiers only for suites with that effective policy. Moving a suite from `counts` to `names` needs another reviewed re-record before removed names can be shown. See [Identity drift](../../reference/identity-drift/) before opting in.

Do not treat a baseline update as evidence that a change is safe. Review the command, report paths, policy, generated suite data, and the code that can affect test discovery.
