---
title: Upgrade to v0.4.1
description: Move from Exevra v0.4.0 to the v0.4.1 command and configuration surface.
---

Exevra v0.4.1 is compatible with existing version-1 `.exevra.yml` files and schema-version-1 baselines. No migration is required. Maven auto-discovery now exempts modules without test sources or current-build compiled test classes from missing-report findings.

## Update the CLI and Action

Update the development dependency and lockfile:

```sh
npm install --save-dev @exevra-dev/cli@0.4.1
```

If a workflow uses the GitHub Action, update its versioned reference:

```yaml
- uses: Exevra/exevra@v0.4.1
```

Keep `uses: ./` only for testing a checked-out copy of Exevra.

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
