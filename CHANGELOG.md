# Changelog

All notable changes to `@workerkit/cli` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the package adheres to [Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-09-12

### Added

Parity with `@workerkit/core` 0.3.2 — every one of its 88 descriptors is reachable.

- **Deployment.** `wk deploy <tokenId>` puts a worker on the hosted runtime, the step
  that makes an installed worker actually run (a worker with no deployment fires no
  schedule and `wk run` refuses it with `not_deployed`). `wk deployment
  list|get|update|remove` manages the deployment — model, ceilings, transcript retention,
  `--action pause|resume` — and `wk deployment models` is the priced picker.
- **Fleet health.** `wk fleet health`: the fleet's rot in one call — blocked workers,
  workers installed but never deployed, schedules the runtime is not picking up, runs
  waiting on an answer, and last runs that did not end clean.
- **Account usage.** `wk account usage`: plan, worker and hosted slots, the spendable
  wallet balance, the plan's request windows and settled spend — read before an
  install, a deploy or a run rather than discovering a 402.
- **Workers.** `wk workers delete` (permanent, takes sub-workers with it; `disable`
  stays the reversible stop), and `wk workers list` takes `--status`, `--deployed`,
  `--readiness` and `--q`, shows READY and DEPLOYED columns, and tells a filter that
  matched nothing apart from an empty account.
- **Runs.** `wk runs transcript` (the stored LLM process log, opt-in per deployment)
  and `wk runs bulk` (one prompt across up to 20 workers; not atomic, read `items[]`).

### Changed

- `@workerkit/core` dependency updated to 0.3.2. `wk runs list` / `wk runs feed` accept
  `--status awaitingInput`.

## [0.2.0] - 2026-09-10

### Added

Parity with `@workerkit/core` 0.3.0 — every one of its 77 descriptors is reachable.

- **About WorkerKit.** `wk about [--section index|why|operate|access|cost|start]`
  (anonymous): what WorkerKit is and when to use it, written for an agent — the
  request shapes that call for a worker, how a fleet is operated from an agent's
  seat, the access model, the money rules, and how to connect from each kind of
  host. The first command an agent driving this CLI should run.
- **Kit authoring.** `wk kit tools` (what a worker can do, app by app, with the
  operation key that unlocks each tool), `wk kit guide` and `wk kit vocabulary`
  (all anonymous), `wk kit validate`, `wk kit publish` (validate → confirm →
  publish; `--private` / `--public`), `wk kit replace`, `wk kit mine`, `wk kit
  scan`, `wk kit update`, `wk kit unpublish|relist|make-private|delete`,
  `wk publisher me|set`. Bodies come from `--file` or stdin. Publishing a
  private kit and installing it is how a worker is created from scratch.
- **Connected apps.** `wk apps list` (which apps the operator can use, in the
  kit vocabulary, and how to connect the rest), `wk apps connect <provider>`
  (the credential comes from `--field name=value`, `--credential`,
  `--credential-file`, stdin, or a hidden prompt — validated live, stored
  encrypted, never shown again), `wk apps disconnect`.
- **Model keys.** `wk model-keys list|set|delete` — the account's own
  model-provider API keys; `set` reads the key from `--key-file`, stdin or a
  hidden prompt.
- **Custom MCP servers.** `wk mcp-servers create <name> <url>` registers an MCP
  server as your own custom MCP app — the way to reach an app the platform does
  not offer — with its credential (from `--field`, `--credential`,
  `--credential-file`, stdin or a hidden prompt; `--account` stores one
  credential for every operator) and lists its tools; `wk mcp-servers
  set-tools <handle> <toolId...>` enables the tools a job needs, which publishes
  the server; `wk mcp-servers list|get|discover|delete`.
- **Workers.** `wk workers permissions`, `wk workers clone-preview|clone|clone-bulk`
  (new keys printed once), `wk workers budget|budget-set`.
- **Runs and fleet.** `wk runs feed`, `wk runs question|answer`, `wk fleet
  pulse|budget|budget-set`.
- **Deliveries.** `wk deliveries list|channels|create|update|rotate-secret|delete`
  (a webhook's signing secret is printed once, on create and on rotate).
- **Instruction history.** `wk instruction versions|version|restore`.
- `wk auth key-info`.

### Changed

- `@workerkit/core` dependency updated to 0.3.0.

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
