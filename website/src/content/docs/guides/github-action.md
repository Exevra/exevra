---
title: GitHub Action
description: Run Exevra against fresh JUnit reports in a pull-request workflow.
---

Prepare the runner and test dependencies before Exevra runs. The Action receives the configuration path and mode, then runs the repository-configured command itself.

```yaml
name: Test execution integrity

on:
  pull_request:

permissions:
  contents: read

jobs:
  exevra:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
      - run: npm ci
      - uses: Exevra/exevra@v0.2.0
        with:
          config: .exevra.yml
          mode: enforce
```

`fetch-depth: 0` gives pull-request checks the base commit needed for watched-path comparison. `persist-credentials: false` prevents the repository command from inheriting checkout credentials. Exevra's Action runtime is Node 24; the example sets Node 22 for the repository command and dependencies.

Use a versioned release such as `Exevra/exevra@v0.2.0`. Use `uses: ./` only when testing a checked-out copy of Exevra itself.

In `enforce` mode, error findings fail the Action. Warning findings produce annotations without failing it. `advisory` keeps all findings nonblocking. The Action adds an escaped text summary and does not require a write token or call the GitHub API.

## Matrix jobs

The `aggregate` CLI collector is included in `@exevra-dev/cli@0.2.0`; use it after matrix jobs have uploaded and downloaded their reports.

The Action runs the configured command, so use the CLI collector after matrix jobs have uploaded and downloaded their JUnit artifacts. `aggregate` never runs or cleans `command`; it reads only the explicit artifact layout from `aggregation`.

See [Matrix and shard aggregation](./matrix-aggregation/) for a complete matrix upload/download example and the required missing-shard behavior.
