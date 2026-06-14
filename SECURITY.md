# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security vulnerabilities.

Use GitHub's [private vulnerability reporting](https://github.com/jaingxyz/google-messages-app/security/advisories/new) on this repository instead. That channel notifies the maintainer privately and creates a draft advisory.

You can expect an initial response within ~7 days. Fix timelines depend on severity and reachability — this is a personal project, not a service.

## Scope

In scope:

- Code in `src/` that handles the paired session, message contents, recipient resolution, or input validation.
- Dependency vulnerabilities flagged by Dependabot or `npm audit`.

Out of scope:

- Vulnerabilities in Google Messages / Messages for web itself (report to Google).
- Vulnerabilities in Claude Desktop or other MCP clients (report to those vendors).
- Risks inherent to running browser automation against a service with no official API (see the README caveats).

## Notes on this project's threat model

- The persistent Chromium profile holds a live, paired Messages session. Anyone with
  read access to that profile directory can read and send your texts. Protect the host.
- This tool drives a web UI with no official API; it is for personal use of your own
  account. Do not use it for bulk/unauthorized messaging.

## Supported versions

Only the latest commit on `main` is supported. There are no maintained release branches.
