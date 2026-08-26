---
title: Exevra
description: Detect unexpected changes in fresh JUnit test execution.
template: splash
hero:
  title: '<span class="exevra-wordmark"><span class="exevra-wordmark__accent">EX</span>EVRA</span>'
  tagline: A green CI run is not enough. Prove that the tests your repository promised to execute actually ran.
  actions:
    - text: Get started
      link: ./getting-started/
    - text: View on GitHub
      link: https://github.com/Exevra/exevra
      variant: minimal
---

Exevra runs one configured test command, requires fresh JUnit XML reports, and compares suite execution with a reviewed baseline. It detects missing reports, zero execution, policy breaches, and test-identity drift.

By default, identity diagnosis keeps raw test names out of the baseline and ordinary output. It records opaque fingerprints and reports safe missing and added counts instead. Teams can explicitly opt in to readable names for a protected suite when that is appropriate for their repository.

The planned Exevra v0.2.0 release adds CI-neutral matrix aggregation for explicit downloaded JUnit shard artifacts. Exevra does not assess test quality, assertions, code correctness, or whether a change is safe. It has no hosted service, accounts, GitHub API calls, pull-request comments, or remote artifact lookup. The npm package and Action tag are produced by the release workflow after the versioned change reaches `main`.

Start with the [quick start](./getting-started/) to create and commit a baseline.
