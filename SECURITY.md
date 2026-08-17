# Security

## Reporting a vulnerability

Email **security@workerkit.ai**.
Please do not open public issues for security reports.

This document covers the CLI specifically. For the platform, see the
[Security Overview](https://workerkit.ai/security), [Privacy Policy](https://workerkit.ai/privacy),
and [Terms of Service](https://workerkit.ai/terms).

## How the CLI handles your credential

- `wk auth login` obtains a **manager key** approved in the browser by an account admin. The key
  is delivered only to the terminal that started the login (the browser never displays it), and it
  appears immediately in your dashboard's manager-key list, where it can be revoked at any time.
- The key is stored in your **OS keychain** (Windows Credential Manager, macOS Keychain, or the
  Secret Service on Linux) when one is available. Without a keychain it falls back to a file under
  your user config directory, written with owner-only permissions on POSIX systems.
- `WK_MANAGER_KEY` (environment variable) always takes precedence and is never written to disk.
- The CLI never logs the key; debug traces redact `pe_mgr_` material.

## What the CLI renders

API responses can contain text produced by AI workers. Everything rendered to a terminal is
stripped of escape sequences, control characters, and bidirectional-override characters.
`--json` output is byte-faithful by design, because it is meant for pipes, not terminals.

## Telemetry

None. Nothing about your usage is collected or reported. The only version signal WorkerKit
receives is the CLI's `User-Agent` header on requests you already made.

For completeness, the CLI makes exactly one outbound request that is not an API call: at most once
every 24 hours it fetches its own public package document from `registry.npmjs.org` to tell you a
newer version exists. It is anonymous, sends no credential or identifier, runs only on an
interactive terminal, and is skipped entirely under `CI`, `WK_NO_UPDATE_CHECK`, `--json`, and
`--plain`.
