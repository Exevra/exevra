---
title: Identity drift
description: Compare suite test identities while controlling enforcement and detail exposure.
---

For a suite present in both the baseline and current JUnit reports, Exevra compares a deterministic aggregate test-identity hash. `identity: off` disables that comparison, `warn` emits a warning, and `enforce` emits an error. Omitted `identity` is `warn`. Count and minimum policies still govern suites that exist only on one side.

`identity_details: counts` is the default. New baselines contain a sorted multiset of per-test SHA-256 fingerprints, so Exevra can report missing and added counts. Duplicate canonical identifiers remain duplicated in this comparison. The fingerprints are non-secret: someone who can guess an identifier can test a guess.

`identity_details: names` additionally records a sorted multiset of raw canonical identifiers for that effective suite policy. Use it only where committing those identifiers is acceptable. If the baseline does not yet contain fingerprints or names, identity drift remains valid but generic or count-only until a reviewed re-record.

When names are available, text output sorts them, JSON-string-escapes each name, and shows at most 20 missing and 20 added names for a suite. Each list reports how many additional names were omitted. Names never enter JSON output, GitHub Actions annotations, or ordinary Action logs. The Action exposes opted-in names only in its escaped job-summary code block.

See [Baselines](../../guides/baselines/) for the required re-record workflow.
