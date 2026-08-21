---
title: Security boundary
description: Understand the trusted command and the limits of an execution-integrity gate.
---

The `command` in `.exevra.yml` is a trusted input. Exevra executes it with Bash in the normal security context of the local machine or CI job; it is not sandboxed. Review the command and its dependencies as you would any other executable CI step.

Exevra is not a protection against authors who can edit or remove the workflow, configuration, command, baseline, or policy that define its gate. Use branch protection or rulesets and independently review those files. A watched-file change alone does not block a run; it becomes a finding only when execution signal also drops.

JUnit XML is untrusted input. Exevra avoids rendering raw XML and keeps raw test identifiers out of the default baseline and machine-facing output, but it is not a substitute for secret scanning, dependency controls, sandboxing, or a test-quality review.

Read the repository's [security policy](https://github.com/Exevra/exevra/blob/main/SECURITY.md) for disclosure guidance.
