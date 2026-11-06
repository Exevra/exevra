---
title: Upgrade Exevra
description: Update Exevra and verify your execution contract.
---

Check the [release notes](../../reference/releases/) for compatibility and migration details before upgrading.

## Update the CLI and Action

Update the development dependency and lockfile:

```sh
npm install --save-dev @exevra-dev/cli@latest
```

If a workflow uses the GitHub Action, update its versioned reference:

```yaml
- uses: Exevra/exevra@v0.5.0
```

Keep `uses: ./` only for testing a checked-out copy of Exevra.

## Migrate protected-suite patterns

Version 0.5.0 uses RE2 to match protected-suite patterns safely. If your configuration has `policy.protected_suites`, review each pattern against your suite names and add `pattern_engine: re2` under `policy`. Lookaround assertions and backreferences are unsupported, and Unicode and whitespace matching can differ from earlier JavaScript matching. Configurations without protected suites need no marker.

Reports that refer to the same physical file through multiple paths are counted once per project or shard. If an earlier baseline counted such aliases more than once, review the corrected counts with `diff` and update the baseline only after confirming the intended test coverage.

Gradle discovery also reads reports from intermediate parent projects, such as `:services` when `:services:api` is included. Review newly detected suites with `diff`, then update the baseline after confirming their expected coverage.

```yaml
policy:
  pattern_engine: re2
  # Keep your existing default and protected_suites rules here.
```

## Adopt the new workflows

- Use `doctor` when a check fails and you need to identify the failing stage. It does not modify configuration or the baseline.
- Use `diff` to review an intentional execution-contract change, then run `record --write` only after approval.
- Use `aggregate` in a collector job when matrix or shard reports have already been downloaded.

```sh
npx exevra doctor
npx exevra diff
npx exevra record --write
```

## Build discovery changes

For Gradle multi-project builds that use standard JUnit output, initialize a new configuration with:

```sh
npx exevra init --gradle
```

Existing Maven configurations can opt into the explicit filter policy if they do not already have it:

```yaml
maven:
  modules: auto
  filter_policy: warn
```

Maven auto-discovery checks declared child modules and keeps missing or unreadable standard reports visible for test-bearing modules. If a project uses custom report locations, use explicit report paths instead of relying on auto-discovery.

## Verify the upgrade

Run the normal check and review any intentional baseline change before committing it:

```sh
npm ci
npx exevra check
npx exevra diff
```

Output remains privacy-safe in text, JSON, GitHub Actions, and Action job summaries. Raw commands, selector values, test identifiers, and report contents are not included by default.
