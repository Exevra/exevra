# Security Policy

## Supported versions

Security fixes are considered for the latest release and the current development line. Older releases are not supported.

## Reporting a vulnerability

Do not report potential vulnerabilities in a public issue or discussion. Use [GitHub's private vulnerability reporting form](https://github.com/Exevra/exevra/security/advisories/new) instead. If GitHub does not offer the form, contact a maintainer through GitHub without including exploit details and ask for a private reporting channel.

When a private channel exists, include affected files or versions, reproduction steps, impact, and any proposed mitigation. Maintainers should acknowledge reports, assess impact, and coordinate disclosure before publishing details.

## Scope notes

Exevra executes a repository-configured command and parses JUnit XML supplied by that command. It is not a sandbox, a secret scanner, or a protection against pull requests that may edit or remove their own workflow or policy. Repository owners must enforce their own workflow and branch-protection boundaries.
