# Changelog

All notable changes to `@workerkit/cli` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the package adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-08-17

### Added

- Homebrew install path: `brew install workerkit/tap/wk` via the new
  [workerkit/homebrew-tap](https://github.com/workerkit/homebrew-tap).
- This changelog now ships in the npm package.

### Changed

- Releases are published through npm trusted publishing (OIDC from GitHub
  Actions), so this and every future version carries a provenance attestation
  linking the tarball to the commit and workflow that built it.
- `@workerkit/core` dependency updated to 0.1.3 (identical behavior; that
  release moved core itself onto trusted publishing).

### Fixed

- `wk update` on a Homebrew install upgraded a formula name that does not
  exist (`workerkit/tap/wk-cli`); the formula is `workerkit/tap/wk`.

## [0.1.0] - 2026-08-17

### Added

- Initial release.
- Browser-approved sign-in (`wk auth login`): the CLI shows a user code, an
  account admin approves it at workerkit.ai and picks the key's scopes, and the
  freshly minted manager key is collected over a one-time poll. The key is
  never rendered in the browser; credentials go to the OS keychain with a
  `0600` file fallback.
- The full management surface, bound to the shared `@workerkit/core` tool
  descriptors: workers, runs (including `runs tail`), memory, schedules,
  instruction, kit search/install, publishers.
- `--json` (byte-faithful machine output), `--plain` (agent-friendly text),
  documented exit codes, and terminal-escape/bidi sanitization of all
  server-supplied text.
