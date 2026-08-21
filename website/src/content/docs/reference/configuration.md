---
title: Configuration
description: Define the version-1 command, reports, watched paths, and suite policies.
---

`.exevra.yml` must be a version-1 YAML object. The configuration file itself cannot be a symlink. Every `baseline`, `reports`, and `watched` path is a non-empty relative path within the configuration root: absolute paths, `..`, backslashes, NUL bytes, and paths that resolve outside that root are rejected.

```yaml
version: 1
baseline: .exevra/baseline.json
command: npm test -- --reporter=junit --outputFile=artifacts/junit.xml
reports:
  - artifacts/junit.xml
watched:
  - package.json
  - package-lock.json
policy:
  default:
    min_executed: 1
    max_drop_percent: 0
    identity: warn
    identity_details: counts
  protected_suites:
    - name: stable unit tests
      match: "^unit$"
      min_executed: 1
      max_drop_percent: 0
      identity: enforce
      identity_details: names
```

`version` must be `1`. `baseline` is the JSON baseline path. `command` is a non-empty Bash command. `reports` is a non-empty list of unique JUnit XML paths. `watched` is an optional list of paths matched as globs when a base ref is available.

`policy.default` is required. Its `min_executed` is a non-negative integer and `max_drop_percent` is a number from 0 through 100. `identity` accepts `off`, `warn`, or `enforce` and defaults to `warn`; `identity_details` accepts `counts` or `names` and defaults to `counts`.

`policy.protected_suites` is optional. Every item needs a non-empty `name`, a valid regular-expression `match`, and the same policy fields as `default`. Exevra selects the first protected-suite policy whose regular expression matches a suite name; otherwise it uses `default`.

Read [Identity drift](../identity-drift/) before using `names`.
