---
title: Security boundary
description: Understand the trusted command and the limits of an execution-integrity gate.
---

The `command` in `.exevra.yml` is a trusted input. Exevra executes it with Bash in the normal security context of the local machine or CI job; it is not sandboxed. Review the command and its dependencies as you would any other executable CI step.

Exevra is not a protection against authors who can edit or remove the workflow, configuration, command, baseline, or policy that define its gate. Use branch protection or rulesets and independently review those files. A watched-file change alone does not block a run; it becomes a finding only when execution signal also drops.

JUnit XML is untrusted input. Exevra avoids rendering raw XML and keeps raw test identifiers out of the default baseline and machine-facing output, but it is not a substitute for secret scanning, dependency controls, sandboxing, or a test-quality review.

Read the repository's [security policy](https://github.com/Exevra/exevra/blob/main/SECURITY.md) for disclosure guidance.

## Documentation dependencies

The documentation is built from repository sources and deployed as static files to GitHub Pages. It does not run an Astro server or a shared HTTP response cache in production.

The website overrides `postcss-selector-parser` under `postcss-nested` to patched version 7.1.6 for [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf). Remove the override when the parent dependency supports the patched parser directly.

Astro also brings in `http-cache-semantics` 4.2.0, affected by [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp). This dependency remains unresolved: the advisory lists no patched version, and version 4.3.0 still permits the reported `max-stale` reuse of a shared response carrying `Set-Cookie`. Static deployment does not expose that shared-cache request path. Reassess this dependency before adding server rendering or a shared response cache.
