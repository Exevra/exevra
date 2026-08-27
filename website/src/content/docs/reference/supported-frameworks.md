---
title: Supported frameworks
description: Test frameworks that Exevra can verify through JUnit XML reports.
---

Exevra is JUnit XML based, not tied to one test framework. It runs the configured POSIX command, reads the fresh reports it produces, and compares them with the reviewed baseline.

## Built-in setup

These integrations have Exevra setup paths that discover the runner and configure or locate its standard reports:

| Ecosystem | Setup |
| --- | --- |
| Vitest | `npx exevra init` adds JUnit reporter flags without editing `package.json` |
| Maven Surefire/Failsafe | `npx exevra init --maven` reads the standard report directories |

## Explicit JUnit configuration

Other ecosystems work when their JUnit reporter or converter is configured explicitly:

| Ecosystem | JUnit output | Setup |
| --- | --- | --- |
| Jest | `jest-junit` | Explicit command/config |
| Playwright | JUnit reporter | Explicit command/config |
| Mocha | `mocha-junit-reporter` | Explicit command/config |
| Cypress | JUnit reporter/plugin | Explicit command/config |
| pytest | `--junitxml` | Explicit command/config |
| Gradle, Kotlin, and JUnit | Gradle test XML | Explicit report path |
| Go test | `go-junit-report` or equivalent | Explicit converter |
| .NET xUnit/NUnit/MSTest | JUnit-compatible logger | Explicit logger/config |
| PHPUnit | `--log-junit` | Explicit command/config |
| RSpec | JUnit formatter | Explicit formatter/config |

This is a compatibility contract, not a framework whitelist. If a runner does not emit JUnit XML, add its reporter or a converter, then point `reports` at the generated file or pattern. Exevra does not call framework APIs, and it currently requires a POSIX/Bash runtime.
