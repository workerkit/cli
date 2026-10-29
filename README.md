# WorkerKit CLI (`wk`)

[![CI](https://github.com/workerkit/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/workerkit/cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40workerkit%2Fcli.svg?color=2ea44f)](https://www.npmjs.com/package/@workerkit/cli)
[![node](https://img.shields.io/node/v/%40workerkit%2Fcli.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/%40workerkit%2Fcli.svg)](LICENSE)

Manage your [WorkerKit](https://workerkit.ai) AI workers and browse the kit directory from the
terminal. API commands use the same tool definitions as the WorkerKit MCP server,
with shared schemas and contract tests keeping their request formats aligned.

## Install

```
npm install -g @workerkit/cli
```

Or with [Homebrew](https://github.com/workerkit/homebrew-tap):

```
brew install workerkit/tap/wk
```

The npm package requires Node.js 22 or newer; the Homebrew formula brings its own.

## Sign in

```
wk auth login
```

This opens workerkit.ai in your browser. An **account admin** approves the login by typing the
code shown in your terminal and choosing what the CLI may do; the CLI then receives its own
manager key, which you can see and revoke anytime in the dashboard.

Alternatives:

- `wk auth login --key` pastes a manager key minted in the dashboard.
- `WK_MANAGER_KEY=pe_mgr_…` as an environment variable wins over stored profiles (great for CI).

> Only approve logins you started yourself. The approval page will always ask for the code shown
> in **your** terminal.

## Headless signup and funding

```sh
wk auth login --start --no-browser --json --scopes readWorkers,readRuns
# Add --email person@example.com when the person requests email delivery.
wk auth login --resume --json
wk onboarding --json
```

The person can approve on another device. Signup and Google, Microsoft or email OTP sign-in happen on WorkerKit's approval page. An admin chooses the account, permissions and expiry; defaults are read-only and 30 days. Start prints the approval URL, user code and deadline. Pending credentials stay in the protected config directory; resume with the same directory and `--name` profile. Resume checks once; wait at least five seconds between checks. On a lost redemption response, `wk auth login --cancel` revokes that request's key before fresh approval. Never put OTPs, provider keys or fleet keys in an agent transcript.

Runtime permissions require a human-approved account ceiling, shared by all workers and schedules. `wk onboarding --json` reports `spendPolicy`: daily/monthly limits and reserved allowance. A run reserves its model ceiling plus possible BYOK fees until the UTC window resets, even if it costs less or fails. Agents cannot raise this ceiling. Metered app charges are separate.

`wk wallet balance --json` requires `readWallet`. With permission for the amount and `requestWalletTopUp`, `wk wallet checkout --amount-usd 20 --idempotency-key purchase-1 --json` returns the credit, fee, total and Stripe Checkout link. The person pays. Reuse the same idempotency key and amount on retries. Inspect `wk wallet checkout-status <sessionId> --json`: only `credited` confirms committed funds. No saved-card charging is exposed.

For BYOK, give the person the Settings URL and account from `wk onboarding`. A provider key already in protected storage can use the existing `wk model-keys` secret-input flow with `manageConnections`. BYOK can still incur platform or app fees. Check worker readiness, deployment and budgets before a run. Revoking agent access does not pause existing scheduled workers.

## Offline tool guidance

Use `wk instructions [workers|decision|directory]` for shared rules, `wk tools list` to map tool names to CLI commands, and `wk tools describe <tool-name>` for full tool and input guidance. These commands need no credentials or network; add `--json` for structured output. Each command's `--help` includes its full core-provided description and parameter guidance.

Help links related commands, including `wk kit install --preview`. Examples labeled "tool inputs" use API field names; use the command's listed flags, arguments or request file to pass them. Inputs available only through Manager tools are labeled separately, with a CLI alternative where available. JSON guidance preserves the original tool names and text.

## Commands

```
wk about [--section why]              # what WorkerKit is and when to use it, written for agents (anonymous)

wk workers list [--status ...] [--deployed] [--readiness ...] [--q ...]   # your fleet, filterable
wk workers get <tokenId>              # tokenId = the ID column in `wk workers list`; shows Type and any pending setup
wk workers enable|disable <tokenId>
wk workers delete <tokenId>           # permanent, takes sub-workers with it (`disable` is the reversible stop)
wk workers permissions <tokenId>      # what it may touch, in the kit vocabulary
wk workers permissions-set <tokenId> --apps '<json>' [--timeframe-past-days=-1 ...]   # replace the app set (Admin, manageAppsAndWorkers); apps left out are switched off
wk workers bindings <tokenId>         # grants to call other workers, the kit's slots and what is still empty
wk workers bindings-set <tokenId> --worker-bindings '{"brain":{"workerId":"<uuid>"},"old":null}'   # fill, re-point or clear aliases (manageAppsAndWorkers)
wk workers clone-preview|clone|clone-bulk <tokenId> [--title ...]   # keys shown once
wk workers budget|budget-set <tokenId> ...
wk workers timezone <tokenId> --time-zone-id America/New_York   # reports and schedules that follow the worker
wk workers timezone <tokenId> --time-zone-id UTC               # reset the worker clock; requires manageSchedules
wk workers action-options [--app ...]   # Action worker apps, tools and defaults
wk workers create-action --app ... --name ... --request-id ...   # Action worker: no model, never deployed
wk workers tools|invoke|invocation <tokenId> ...   # list an Action worker's tools, call one, read a write's receipt
wk workers quality get|set|preview <tokenId> ...   # acceptance criteria and quality gates (see Worker quality)

wk deploy <tokenId> [--model-slug ...]   # enable hosted runs and schedules; does not start a run
wk deployment list
wk deployment get|update|remove <tokenId> ...
wk deployment models                  # language models and decision profiles this account may use, priced

wk run <tokenId> [--prompt ...] [--follow]
wk run <tokenId> [--source-args '{...}'] [--answers '{...}'] [--max-items 20] [--wait-seconds 25]   # a decision worker's per-item decisions; --answers = per-run install answers, never saved
wk runs bulk --workers '[...]'        # one prompt across up to 20 workers (not atomic; read items[])
wk runs list <tokenId> [--status ...]
wk runs feed [--status ...]           # the account-wide feed (no per-worker fan-out)
wk runs get <runId>
wk runs events <runId>                # one page of the event feed
wk runs tail <runId>                  # live event feed until the run settles
wk runs transcript <runId>            # the stored LLM process log (opt-in per deployment)
wk runs question|answer <runId> ...   # two-way runs
wk runs cancel <runId>
wk runs score <runId> <0-100>         # or --clear
wk runs clear-digest <runId>
wk fleet pulse|health|budget|budget-set   # current runs, fleet issues and account-wide ceilings
wk account usage                      # plan, worker + hosted slots, wallet, request windows, spend
wk account spend                      # this UTC day's and month's run spend, by worker, day and model
wk activity feed [--kind run|call|change] [--outcome ...] [--worker-id ...] [--since ...]   # runs, app calls and configuration changes, newest first
wk activity summary [--since ...] [--until ...]   # the same activity counted over a window

wk knowledge sources|search|get|changes   # retained worker reports a key may read: discover sources, lexical search, read evidence, reconcile changes
wk knowledge configuration get|set    # account admin: activation, enrolled sources and reader grants

wk memory get|add|update|delete <tokenId> ...
wk schedules list|create|update|delete <tokenId> ...
wk deliveries list|channels|create|update|rotate-secret|delete <tokenId> ...
wk instruction get <tokenId> [--options-for <key>]   # the instruction, or a decision worker's routing table
wk instruction set <tokenId> [--file ...] [--answers '{...}']   # the text, or a decision worker's install answers
wk instruction set <tokenId> --job-sentence '...'   # metadata alone: no instruction resent
wk instruction versions|version|restore <tokenId> [versionNumber]

wk kit search [--query ...] [--category ...]   # anonymous: works before sign-in
wk kit get <slug>
wk kit categories                     # the directory's filter vocabulary
wk kit install <slug> [--preview] [--time-zone-id America/New_York]   # preview → confirm → install (a decision kit's questions: --decision-answers '{...}')
wk kit tools [--app email]            # what a worker can do, app by app, with the keys that unlock each tool (anonymous)
wk kit guide [--section schema]       # how to write a kit (anonymous)
wk kit vocabulary [--app email]       # the live tool-key vocabulary (anonymous)
wk decision sources [--app email]     # supported classification sources, grants and request examples
wk decision guide                     # focused authoring guide (anonymous)
wk decision create --file decision.json --json   # private kit + worker; optional deploy, never runs
wk decision set <tokenId> --decision-spec '<JSON>' --updated-at '<revision>'   # --updated-at null attaches the first classifier
wk kit validate --file kit.json       # every gate's verdict at once
wk kit publish --file kit.json --private   # validate → confirm → publish
wk kit replace <slug> --file kit.json --private
wk kit mine                           # your kits, with moderation state
wk kit scan|update|unpublish|relist|make-private|delete <slug>
wk publisher get <slug>
wk publisher me|set ...

wk apps list [--operator-id ...]      # which apps the operator can use, how to connect the rest
wk apps connect <provider> [--field name=value ...]   # secret from a file, stdin or a hidden prompt
wk apps disconnect <provider> <connectionId>
wk apps github accounts [--q ...] [--operator-id ...]
wk apps github repos --connection-id <id> [--q ...] [--page ...]
wk apps github branches <owner/repo> --connection-id <id> [--q ...]
wk apps slack workspaces [--operator-id ...]
wk apps slack conversations --workspace-id <id> [--types ...] [--q ...] [--cursor ...]
wk model-keys list                   # the account's own model-provider API keys
wk model-keys set|delete <provider> ...
wk mcp-servers list                  # your own MCP servers: reach an app the platform does not offer
wk mcp-servers get <handle>
wk mcp-servers create <name> <url> --auth-type Bearer   # register + credential (file, stdin or prompt) + discover
wk mcp-servers discover|delete <handle>
wk mcp-servers set-tools <handle> <toolId...>   # enabling ≥1 tool publishes the server
wk api-apps list|get|validate|preview|create|update|publish|version|revoke ...   # account-private API apps (see API apps)

wk onboarding [--provider <slug>]
wk wallet balance
wk wallet checkout --amount-usd <amount> --idempotency-key <key>
wk wallet checkout-status <sessionId>

wk support --category error|bug|app_request|general --subject <line> --message <text> [--run-id ...] [--worker-id ...]
                                      # contact support; prints a PE-XXXXXX reference, the reply goes to your email

wk auth key-info                      # what the current key is and its scopes
wk auth login [--start|--resume|--cancel] [--no-browser] [--email <address>]
wk auth status|logout|profiles|use
wk update                             # update the CLI itself
```

Public kit publishing, promotion and relisting are temporarily paused. Explicitly use
`--private` (or `"visibility": "private"` in the JSON) for publish and replace. Public
publisher attribution is hidden; public publisher profiles return 404. Owner profile management
remains available.

General worker authoring is a two-step: `wk kit publish --file kit.json --private`, then
`wk kit install <slug>`. A private kit is installable only by your account and goes through the
same validators as a directory listing — that is the platform's rule for a worker an agent builds
from scratch; an existing worker's apps change with `wk workers permissions-set` (account Admin,
`manageAppsAndWorkers`). A kit can be a language kit (an instruction), a decision kit (a routing table), a hybrid
kit (classification followed by one language-model agent), or an Action kit (selected app tools
with no model; see [Action workers](#action-workers)). Use `wk kit search --model-type decision`
or `--model-type hybrid` to narrow discovery; `wk kit guide --section index` says which a job is.
A decision worker is read, answered and run through the same `wk instruction` and `wk run`
commands as any other, with its own flags.

`wk kit tools`, `wk kit guide` and `wk kit vocabulary` are what to read first, and `wk apps list`
says which apps the worker will actually be able to reach: a worker only uses apps that are
connected on its operator. `wk apps connect` connects the credential-based ones (bot tokens, API
keys, private-app tokens); Google, Microsoft, GitHub and Reddit sign in on the dashboard. An app
the platform does not offer can still be reached through its MCP server: `wk mcp-servers create`
registers it as your own custom MCP app (credential included), `wk mcp-servers set-tools` enables
the tools a job needs — which publishes it — and the kit binds it in `content.mcpServers` by the
kit id `wk mcp-servers list` shows.

For GitHub setup, preview the kit, then run `wk apps github accounts`,
`wk apps github repos --connection-id <id> --q my-repo --json` and
`wk apps github branches <owner/repo> --connection-id <id> --json`. These need a key with the
`discoverAppResources` scope and return private metadata without running a worker. Repository
and branch filters cover one page, so follow `nextPage` even when a page has no matches. Install
with `--github-selection '{"accounts":[{"connectionId":7,"repositoryMode":"selected","repositoryIds":[101]}]}'`,
using the IDs from discovery, or `{"accounts":[]}` to set GitHub up later. A key with
`discoverAppResources` must make this choice explicitly; `"all"` also covers repositories granted
later. A branch input configures the job but does not restrict repository access.

Flags mirror the API's field names in kebab-case (`--page-size`, `--from-utc`); boolean flags
also take a `--no-` form to pass an explicit false (`--no-is-enabled`). Run any command with
`--help` for its full flag list.

Global flags: `--json` (raw API data, stable machine contract), `--plain` (compact agent-friendly
text), `--yes` (skip confirmations), `--profile <name>`. They work before or after the
subcommand: `wk --json workers list` and `wk workers list --json` are equivalent.

## Decision and hybrid workers

For classification, start with `wk decision sources --app email` and `wk decision guide`. Put a
recipe, typed questions, `confidenceFloor` and a unique `requestId` in a JSON file, then call
`wk decision create --file decision.json --json` (piped JSON also works). This creates a private
kit and worker through the normal lifecycle. `deploy:true` optionally deploys it; creation never
runs it. Follow the returned `nextCall`, then use `wk run`. Creation requires `createWorkers`;
deployment also needs `manageDeployments`. After a timeout, reuse the same request
ID with the identical body. The recipes cover email previews, calendar events and Google Sheets
rows; any other source, or a routed action, needs a decision kit published privately and
installed.

Runs have no preview mode: they execute their declared actions. To compare classifiers safely,
use a spec whose routes only return results.

### Classifiers

Decision workers classify with Jev by default. `wk deployment models --json` lists the enabled
`decisionProfiles` and their prices. Save a worker's classifier with
`wk deployment update <tokenId> --decision-profile-id openai-luna`, or choose one for a single run
with `wk run <tokenId> --decision-profile openai-luna`; `jev-default` returns to Jev. A kit
document or a `wk decision create` request can set a top-level `decisionProfileId` as the
default, even when nothing is deployed. A run's choice wins over the worker's, then the kit
default, then Jev. The classifier is independent of the language model. Review sample results
after switching classifiers, because confidence scores differ between providers.

### Classify then act

A hybrid worker keeps its language instruction and a schema-3 classifier. `wk instruction get
<tokenId>` reads both sections and the classifier revision. Attach a classifier with
`wk decision set <tokenId> --decision-spec '<JSON>' --answers '{}' --updated-at null`; replace it
using the exact current revision, or remove it with `--decision-spec null --updated-at
'<revision>'`. A protected kit's classifier cannot be replaced.

`wk run` accepts source arguments, setup-answer overrides and a source cap alongside a language
prompt and model. A waited receipt shows the classification, one agent stage, confirmed draft
references, separate model usage and the actual wallet charge; `--json` keeps the full receipt.
Hybrid runs are on demand: recurring drafts and automatic retries of uncertain writes are not
supported. Hybrid availability depends on the server; an unavailable feature returns the server's
error, and the CLI never emulates classification or retries uncertain actions.

### Slack sources

`wk apps slack workspaces --json` lists the connected workspaces and their saved capabilities.
`wk apps slack conversations --workspace-id T123 --types public_channel --json` finds channel
IDs; pass each `nextCursor` back with `--cursor`, even after an empty filtered page. Both need the
`discoverAppResources` scope. Search needs a user token with `search:read`; reading history needs
the bot in the conversation with history scopes, and covers one conversation. Neither discovery
nor kit validation proves live message access.

For a Slack decision kit, copy the tool's `argsSchema` and documented `decisionSource` mapping
from `wk kit tools --app slack --json` rather than guessing, then validate, publish privately and
install.

## Action workers

An Action worker exposes selected app tools without a language or decision model. Discover apps
and their default tools, then create a worker. Native and reviewed MCP apps use the same flow;
omitting `--app` selects Slack:

```sh
wk workers action-options --json
wk workers action-options --app weather --json
wk workers create-action --app weather --name "Weather tools" --request-id weather-tools-1 --json
wk workers create-action --name "Slack actions" --slack-connection-id 123 --request-id slack-actions-1 --json
wk workers tools 42 --json
```

Use the connection and worker IDs your account returns. Discovery needs `readWorkers`; creation
needs `createWorkers`. There is no model or deployment: `wk run` and `wk deploy`
refuse an Action worker with `400 action_worker_requires_invoke`. The selected tools and the
connected sender stay fixed until the owner saves changes in the dashboard, and tools added to
the catalog later are never added to an existing worker.

To send a Slack DM, put the tool's arguments in `message.json`, for example
`{"userId":"U123","text":"Hello"}`, then run:

```sh
wk workers invoke 42 slack_send_dm --file message.json --idempotency-key intended-send-1 --json
wk workers invocation 42 <invocationId> --json
```

Calls and receipts need `invokeActions`. A call answers with `status` `succeeded`, `denied`,
`failed`, `in_progress` or `outcome_unknown`; `invoke` prints the full receipt and exits nonzero
unless the call succeeded. Reads take JSON arguments the same way and need no key. After a
transport failure, repeat the same key with the same arguments: it returns the stored result
without calling the app again. `outcome_unknown` means the app may have acted: read the receipt,
check the app, and never retry under a new key. A refusal marked `retryable` can be tried again
later under a new key. Write receipts keep the confirmation, not the app's private response, so
never resend to recover a lost response.

## Worker quality

```sh
wk workers quality get <tokenId> --json
wk workers quality set <tokenId> --expected-revision <revision> --no-quality-and-suggestions-enabled
wk workers quality preview <tokenId> --spec '<json>' --evidence '<json>'
```

Read settings before updating; a stale revision needs a fresh review. Preview checks supplied samples without saving or running a worker; it cannot qualify an improvement. `--automatic-improvement-enabled false` and `--shared-learning-enabled false` revoke those gates. Their activation, private examples, paid comparisons, diagnosis, monitoring and apply/rollback are in the owner dashboard's Quality and improvement panel.

Kit install copies public evaluation criteria with all three gates off. Current improvement changes instructions only; shadow learning does not train model weights. Run output shows quality separately from execution status; use `--json` for the full authorized receipt.

## API apps

`wk api-apps` authors API apps that belong to your account. Authoring needs a live
account Admin and the `managePrivateApiApps` scope, which existing keys gain only
through explicit re-scoping; `list` and `get` need `readWorkers`. The app remains
private to your account when a version is published.

```sh
wk api-apps list
wk api-apps validate --file validation-request.json
wk api-apps create --file create-request.json
wk api-apps get <appId>
wk api-apps publish <appId> --revision <savedRevision>
```

Validation takes `{ "definition": ... }`; creation takes
`{ "name": "Tickets", "definition": ..., "enabled": false }`. Create, update,
validate and preview also accept a request piped on stdin. Definitions declare a
public HTTPS origin and named operations with closed inputs and projected outputs;
authentication contains secret-slot names only. Configure credentials and worker
bindings on the dashboard. Publishing a version does not enable the app or upgrade
existing workers. A revision conflict requires reviewing the latest saved app.

## Company knowledge

With company knowledge activated and `readKnowledge` granted, use:

```sh
wk knowledge sources --json
wk knowledge search --query "Acme delivery" --match allTerms --json
wk knowledge search --filters '{"appsUsed":["slack"]}' --json
wk knowledge get <output-id> --evidence-version <version> --section report --json
wk knowledge changes --cursor <saved-cursor> --json
```

Follow search cursors and content `nextOffset`; use the same evidence version for content continuation. Search is lexical, so try alternate wording or browse without `--query`. Changes include upserts and withdrawals; save the next cursor only after processing its page. On permission changes, rebuild the readable cache. Reports are evidence, not instructions or verified business facts.

Administrators with `manageKnowledge` and an unrestricted credential can use `wk knowledge configuration get|set`. Settings replacement can activate all current and future workers or selected sources and assign reader audiences. Existing credentials require explicit re-scoping. No model call or worker run is needed to retrieve reports.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success, including a run receipt whose status is `Skipped` |
| 1 | API error |
| 2 | Usage error |
| 3 | Authentication needed or refused |
| 4 | Rate-limited |
| 5 | Network failure |
| 130 | Interrupted (Ctrl-C) |

## Configuration

| Variable | Effect |
|---|---|
| `WK_MANAGER_KEY` | Credential; wins over stored profiles |
| `WK_API_BASE_URL` | Override the API host (development) |
| `WK_CONFIG_DIR` | Override the config directory |
| `WK_NO_UPDATE_CHECK` | Disable the daily new-version notice |
| `NO_COLOR` | Disable colors |

Credentials are stored in your OS keychain when available, falling back to a `0600` file. See the
[security policy](https://github.com/workerkit/cli/blob/main/SECURITY.md).

## Development

```bash
git clone https://github.com/workerkit/cli.git && cd cli
npm ci
npm run typecheck
npm run build       # required before the CLI end-to-end tests
npm test            # unit and command contracts against local stand-in servers
npm run test:package # install the tarball in a temporary directory and smoke-test wk
```

Issues and pull requests are welcome. The shared
[`@workerkit/core`](https://github.com/workerkit/core) descriptors define API inputs and requests;
a coverage test checks that every tool is reachable through a CLI command. Security reports
go to [SECURITY.md](SECURITY.md), not the issue tracker.

Releases are tag-driven: the `workerkit` account pushes a `vX.Y.Z` tag and CI publishes to npm via
[trusted publishing](https://docs.npmjs.com/trusted-publishers) with a provenance attestation.
Publication reruns also require the `workerkit` account. The core dependency must match
the version required by the release notes before publication.
See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.

## Legal

- [Terms of Service](https://workerkit.ai/terms)
- [Privacy Policy](https://workerkit.ai/privacy)
- [Acceptable Use Policy](https://workerkit.ai/aup)
- [Security Overview](https://workerkit.ai/security)

## License

This CLI is released under the [MIT License](LICENSE). That covers the software itself; using it
against WorkerKit's hosted API is separately governed by the Terms of Service above.
