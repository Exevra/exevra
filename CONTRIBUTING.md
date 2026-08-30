# Contributing to Exevra

Thanks for helping improve a small, deterministic execution-integrity tool.

## Before opening a change

Keep the scope focused. Exevra validates whether configured test evidence ran; it does not judge test quality, generate tests, host data, or review code. Discuss a change that would expand that boundary before implementing it.

Use Node 22 or later, then run:

```sh
npm ci
npm test
npm run test:coverage
npm run typecheck
npm run verify:bundle
```

The Action bundle in `dist/` is generated from the Action source. When Action code changes, regenerate and include its matching bundle using `npm run bundle`; `verify:bundle` checks the result.

Add or update focused tests for behavior changes. Do not treat a local test run as evidence of a live GitHub Actions run; document that boundary when relevant.

## Pull requests

Explain the execution contract affected, include the checks you ran, and call out any configuration or baseline change. Baseline updates are normal reviewed changes, not an automatic bypass.

By contributing, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
