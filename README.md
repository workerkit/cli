# WorkerKit CLI (`wk`)

[![CI](https://github.com/workerkit/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/workerkit/cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40workerkit%2Fcli.svg?color=2ea44f)](https://www.npmjs.com/package/@workerkit/cli)
[![node](https://img.shields.io/node/v/%40workerkit%2Fcli.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/%40workerkit%2Fcli.svg)](LICENSE)

Manage your [WorkerKit](https://workerkit.ai) AI workers and browse the kit directory from the
terminal. Every command is bound to the same tool definitions the WorkerKit MCP server exposes
to AI agents, so the CLI, the MCP surface and the API cannot drift apart.

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

## Commands

```
wk workers list                       # your fleet, status + last/next run
wk workers get <tokenId>              # tokenId = the ID column in `wk workers list`
wk workers enable|disable <tokenId>

wk run <tokenId> [--prompt ...] [--follow]
wk runs list <tokenId> [--status ...]
wk runs get <runId>
wk runs events <runId>                # one page of the event feed
wk runs tail <runId>                  # live event feed until the run settles
wk runs cancel <runId>
wk runs score <runId> <0-100>         # or --clear
wk runs clear-digest <runId>

wk memory get|add|update|delete <tokenId> ...
wk schedules list|create|update|delete <tokenId> ...
wk instruction get|set <tokenId> [--file ...]

wk kit search [--query ...] [--category ...]   # anonymous: works before sign-in
wk kit get <slug>
wk kit stats <slug>
wk kit categories                     # the directory's filter vocabulary
wk kit install <slug> [--preview]     # preview → confirm → install
wk publisher get <slug>

wk auth status|logout|profiles|use
wk update                             # update the CLI itself
```

Flags mirror the API's field names in kebab-case (`--page-size`, `--from-utc`); boolean flags
also take a `--no-` form to pass an explicit false (`--no-is-enabled`). Run any command with
`--help` for its full flag list.

Global flags: `--json` (raw API data, stable machine contract), `--plain` (compact agent-friendly
text), `--yes` (skip confirmations), `--profile <name>`. They work before or after the
subcommand: `wk --json workers list` and `wk workers list --json` are equivalent.

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
npm test            # unit suites + golden contract + an end-to-end sign-in against a local stand-in server
npm run typecheck
npm run build       # dist/, which `node dist/index.js` runs directly
```

Issues and pull requests are welcome. Commands are generated from the shared
[`@workerkit/core`](https://github.com/workerkit/core) tool descriptors; a coverage test asserts
every descriptor is reachable, so a new tool usually needs no CLI code at all. Security reports
go to [SECURITY.md](SECURITY.md), not the issue tracker.

Releases are tag-driven: maintainers push a `vX.Y.Z` tag and CI publishes to npm via
[trusted publishing](https://docs.npmjs.com/trusted-publishers) with a provenance attestation.
See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.

## Legal

- [Terms of Service](https://workerkit.ai/terms)
- [Privacy Policy](https://workerkit.ai/privacy)
- [Acceptable Use Policy](https://workerkit.ai/aup)
- [Security Overview](https://workerkit.ai/security)

## License

This CLI is released under the [MIT License](LICENSE). That covers the software itself; using it
against WorkerKit's hosted API is separately governed by the Terms of Service above.
