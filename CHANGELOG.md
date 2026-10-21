# Changelog

All notable changes to `@workerkit/cli` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the package adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.4] - 2026-10-21

Requires `@workerkit/core` 0.3.19.

### Added

- `wk api-apps` lists, reads, creates, updates, validates and previews account-private API apps and publishes, reads or revokes their immutable versions. Definition requests use `--file` or stdin. Updates require the reviewed revision; authoring requires a live account Admin and `managePrivateApiApps`.
- `wk workers bindings <tokenId>` and `wk workers bindings-set <tokenId> --worker-bindings '<json>'` read and set a worker's grants to call other workers: one atomic alias map fills, re-points or clears grants, a declared kit slot supplies its own operations and tools, and `null` clears an alias. Writes need the `manageAppsAndWorkers` scope.
- `wk workers permissions-set <tokenId> --apps '<json>'` replaces a worker's app set in the vocabulary `wk workers permissions` prints (account Admin; apps left out are switched off), with optional `--contact-allow-all`, `--blocked-sender-categories`, `--timeframe-past-days`, `--timeframe-future-days` and `--max-child-tokens`. Needs the `manageAppsAndWorkers` scope.
- `wk kit install --worker-bindings '<json>'` fills a kit's worker slots at install, each alias to the UUID of an installed worker.
- `wk workers quality get`, `set` and `preview` expose worker criteria, capability reasons and the three gates. Updates require `--expected-revision`; automatic/shared learning fields accept `false` only. Activation and paid improvement controls require owner review in the dashboard.
- Kit install previews explain copied public criteria and gates starting off. Run output separates quality checks and report coverage from execution status; `--json` retains the API response unchanged.
- Run output shows who started a run (a user, a fleet key by name and prefix, a schedule, a webhook or a calling worker), the run it continues and the workers it called, each charged separately.
- `wk runs get --no-include-content` reads a receipt's metadata and content references without copying its reports.
- Offline `wk instructions`, `wk tools list` and `wk tools describe` expose shared guidance and map every tool name to its CLI command.
- Full command help includes tool and parameter guidance, links related commands and identifies inputs available only through Manager tools.
- Worker list tables show the owner returned by the API. Member credentials remain limited to their own workers.
- `wk workers timezone <tokenId> --time-zone-id America/New_York` sets report and local-date timezone without changing explicit schedule overrides. `wk kit install --time-zone-id`, `wk workers create-action --time-zone-id` and `timeZoneId` in a decision creation request save the creator's selected zone. Omission uses UTC.
- `wk support` reports errors, bugs, app requests and general questions. It prints a
  `PE-XXXXXX` reference; support replies to the signed-in user's email.
- Action worker commands: `wk workers action-options`, `create-action`, `tools`, `invoke` and
  `invocation`. An Action worker exposes selected app tools with no model and is never deployed
  or run. `invoke` reads JSON arguments from `--file`, `--arguments` or stdin, takes
  `--idempotency-key` for writes, prints the full receipt and exits nonzero unless the call
  succeeded. `wk kit install --slack-connection-id` pins an Action kit's Slack bot.
- Choose a decision worker's classifier (Jev or OpenAI Decisions) independently of its language
  model: `--decision-profile-id` on `wk deploy` and `wk deployment update`, `--decision-profile`
  on `wk run` for one run, and `decisionProfileId` in kit and `wk decision create` documents.
  `wk deployment models --json` lists the enabled profiles and their prices.
- `wk apps github accounts|repos|branches` and `wk apps slack workspaces|conversations` find
  GitHub targets and Slack channel IDs before an install. Both need the `discoverAppResources`
  scope; keep following `nextPage` or `nextCursor` even when a filtered page is empty.
- `wk kit install --github-selection` takes GitHub accounts with all or selected repository IDs.
  When the preview requires an explicit selection, the install stops and says how to find one;
  `{"accounts":[]}` sets GitHub up later.
- `wk kit guide --section state` covers WorkerKit Records, memory options and focused context.
- `wk apps connect nimble` prompts for the API key when no credential is passed.

### Changed

- `wk kit install` points to `wk workers bindings-set` for slots left unbound at install.
- `wk runs tail` drains every retained event page and waits one quiet poll for late events before it prints the settled receipt. A canceled run is followed until it finishes settling.
- `wk auth status` says which workers the key reaches (`Workers: all` or `Workers: N selected`), and `wk workers list` counts and empty states speak of the workers the key reaches, since a key may now be limited to selected workers.
- `wk workers create-action` and `wk decision create` need the `createWorkers` scope instead of `publishKits` + `installKits`.
- Command summaries come from the shared tool descriptions.
- `wk runs bulk` refuses an entry with an unsupported control, such as the retired `preview`,
  before sending any request.
- `wk kit install` checks its JSON and ID flags before asking for confirmation.
- Publication requires the `workerkit` account and a core dependency matching the release notes.

### Removed

- `wk kit stats`, whose API tool was retired, and download counts from kit search tables.

### Fixed

- `wk kit install` prints trigger signing secrets even when the install returns no worker API key.
- `wk kit install` reads a numeric `appsNeedingConnection` count in the preview.
- Help summaries handle abbreviations and parentheses without cutting sentences short.

## [0.3.2] - 2026-09-29

### Added

Adds wk decision set, combined hybrid instruction and receipt rendering, and required nullable descriptor flags. Hybrid runs accept classification overrides together with language prompts. Requires @workerkit/core 0.3.8.

### Fixed

- Preserve full API data in `--json` output before human-oriented receipt compaction.
- Recognize run status casing and owner-input pauses when following runs; show event labels and hybrid action evidence.
- Sanitize terminal output, close HTTP pools, and honor Ctrl-C during follow requests.
- Handle reserved profile names safely, remove stale file credentials after keychain migration, and bound the update-check body read.

### Changed

- Build clean package contents and validate versions, release notes, installed packages and release tags before publication.
- Publish npm packages with provenance and attach the package to a matching GitHub Release.

## [0.3.1] - 2026-09-20

### Added

- Added resumable headless account approval (`auth login --start/--resume/--cancel --json`),
  browser/email handoff, protected pending requests, and one-time key storage.
- Added `wk onboarding` and wallet balance, checkout, and checkout-status commands through
  `@workerkit/core` 0.3.7.
- Added `wk decision sources`, `guide`, and `create` (`--file` or stdin) through
  `@workerkit/core` 0.3.7.

### Changed

- Isolated OS keychain entries when `WK_CONFIG_DIR` is set, preserving existing profiles.
- JSON auth status now reports nonsecret credential metadata.

### Removed

- **`wk run --preview`** and **`wk deployment update --decision-mode`** — Preview
  mode was removed from the platform: every decision run is live and its routing table's
  actions execute. `wk run`
  still confirms before running a decision worker; `wk instruction get` no
  longer prints a mode line.

## [0.3.0] - 2026-09-18

### Added

Parity with `@workerkit/core` 0.3.4 — decision workers, on the commands that already existed.

- **`wk run`** gains `--preview` (report what this run would do and act on nothing),
  `--source-args '{...}'` (narrow what is decided about), `--max-items` and `--wait-seconds`
  (wait for the settled receipt and its per-item decisions instead of the freshly minted one).
  Running a decision worker for real confirms first: its table acts on every item it routes.
  A waited run prints what it decided — outcome, confidence, how many were acted on or fell
  below the floor — rather than only the run id.
- **`wk run --answers '{...}'`** — per-run answers to a decision worker's install questions, laid
  over the stored ones for this run only and never saved: how a caller names a searcher kit's
  target without touching the worker's setup, so two callers on one worker never see each other's.
  A waited run names the keys the override actually applied and the decision model that answered.
- **`wk instruction get`** reads a decision worker's routing table, its install questions and
  their answers, and `--options-for <key>` lists an app pick's live values from the worker's own
  app. A pending question is called out where it is read, because it blocks both deploy and run.
  **`wk instruction set --answers '{...}'`** fills or changes those answers — no stdin needed,
  since a decision worker is set by its answers rather than by text.
- **`wk workers get`** reports `Type` (language or decision) and any install question still
  blank: the field that says which calls a worker will accept, and the reason a deploy or run is
  refused.
- **`wk deployment update <tokenId> --decision-mode preview|live`** — `live` (the default) acts;
  `preview` makes every run report what it would do and act on nothing.
- **`wk kit install --decision-answers '{...}'`** for a decision kit's install questions, with a
  pre-install check that names the mandatory ones; **`wk kit search --model-type`** and a TYPE
  column on the results.

### Changed

- **`wk instruction set`** no longer demands an instruction it will not send. `content` became
  optional in core 0.3.3, so `--job-sentence`, `--when-to-use`, `--description`,
  `--memory-profile` and `--self-facts-enabled` can now be changed on their own, without
  resending the whole instruction or piping one in. A closed stdin is read as "no text" rather
  than as an empty instruction, so the same call works unattended.

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
