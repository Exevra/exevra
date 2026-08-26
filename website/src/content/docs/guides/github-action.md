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
      - uses: Exevra/exevra@v0.1.2
        with:
          config: .exevra.yml
          mode: enforce
```

`fetch-depth: 0` gives pull-request checks the base commit needed for watched-path comparison. `persist-credentials: false` prevents the repository command from inheriting checkout credentials. Exevra's Action runtime is Node 24; the example sets Node 22 for the repository command and dependencies.

`Exevra/exevra@v0.1.2` is the versioned release tag. The public Action can be used from any repository. Use `uses: ./` only when testing a checked-out copy of Exevra itself.

In `enforce` mode, error findings fail the Action. Warning findings produce annotations without failing it. `advisory` keeps all findings nonblocking. The Action adds an escaped text summary and does not require a write token or call the GitHub API.

## Matrix jobs

> **Unreleased:** The `aggregate` CLI collector is source-only and is not included in `@exevra-dev/cli@0.1.2` or `Exevra/exevra@v0.1.2`.

The Action runs the configured command, so use the CLI collector after matrix jobs have uploaded and downloaded their JUnit artifacts. `aggregate` never runs or cleans `command`; it reads only the explicit artifact layout from `aggregation`.

See [Matrix and shard aggregation](./matrix-aggregation/) for a complete matrix upload/download example and the required missing-shard behavior.
