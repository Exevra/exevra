---
title: Generic CI and Jenkins
description: Run the Exevra CLI in Jenkins or any POSIX-based CI system.
---

Exevra's CLI runs in any CI system that can check out the repository, run Node 22 or later, and execute Bash. You do not need a Jenkins plugin or a hosted Exevra service.

## Install the CLI

Add Exevra to the target repository's development dependencies. Commit the resulting lockfile so CI installs the reviewed version.

```sh
npm install --save-dev @exevra-dev/cli@0.4.1
```

The CI job runs the command in `.exevra.yml`. That command must create fresh JUnit XML for every literal entry under `reports`; filename patterns read every matching XML file and require at least one match when the configuration uses patterns only.

## Basic CI step

Install the project's locked dependencies, then run the locally installed binary:

```sh
npm ci
npx exevra check --config .exevra.yml
```

Commit `.exevra.yml` and the reviewed `.exevra/baseline.json` before adding this step. Use `record` locally when you first create the baseline or intentionally change its execution contract. See [Baselines](./baselines/) for the review workflow.

The default `enforce` mode exits with code 1 for error findings, including `REPORT_MISSING`. It exits with code 2 for an invalid invocation or an operational error, such as malformed XML or unreadable configuration. Either code fails a normal CI shell step. See [Output and exit codes](../reference/output-and-exit-codes/) for the complete behavior.

## Jenkins Pipeline

This declarative pipeline runs Exevra on a POSIX Jenkins agent and publishes the JUnit report after the stage finishes. Jenkins runs its [JUnit step](https://www.jenkins.io/doc/pipeline/tour/tests-and-artifacts/) in `post { always { ... } }` even when Exevra fails, so it can retain the test report for diagnosis.

```groovy
pipeline {
  agent any

  stages {
    stage('Test execution integrity') {
      steps {
        sh '''
          npm ci
          npx exevra check --config .exevra.yml
        '''
      }
      post {
        always {
          junit 'artifacts/junit.xml'
        }
      }
    }
  }
}
```

Change `artifacts/junit.xml` in the Jenkins `junit` step if your `reports` path in `.exevra.yml` differs. The report is written by the configured command, not by the Jenkins pipeline itself.

`npx` resolves the `exevra` binary from the project's installed dependencies. It does not need a global install.

## Watched-file comparison

Exevra can compare watched paths against a Git base ref when that ref exists in the checkout. Fetch the ref first, then pass it to `check`:

```sh
git fetch origin main:refs/remotes/origin/main
npx exevra check --config .exevra.yml --base-ref origin/main
```

Use the base branch for your project instead of `main` when it differs. Without `--base-ref`, Exevra still checks the fresh JUnit report and baseline, then reports that changed-file comparison was unavailable.

## CI boundaries

The CLI prints normal text by default. Use `--format json` when another system needs structured output. GitHub Actions has an additional adapter for annotations and job summaries, but the underlying check is the same.

v0 requires a POSIX environment because it runs the configured test command through Bash. Windows Jenkins agents are not supported yet. The configured command is not sandboxed, so treat it with the same review and credential boundaries as any other repository command in CI.
