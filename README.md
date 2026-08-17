# WorkerKit CLI (`wk`)

Manage your [WorkerKit](https://workerkit.ai) AI workers and browse the kit directory from the
terminal.

```
npm install -g @workerkit/cli
```

Requires Node.js 22 or newer.

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

Exit codes: `0` success (including a run receipt whose status is `Skipped`), `1` API error,
`2` usage error, `3` authentication, `4` rate-limited, `5` network, `130` interrupted.

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

## Legal

- [Terms of Service](https://workerkit.ai/terms)
- [Privacy Policy](https://workerkit.ai/privacy)
- [Acceptable Use Policy](https://workerkit.ai/aup)
- [Security Overview](https://workerkit.ai/security)

## License

This CLI is released under the [MIT License](LICENSE). That covers the software itself; using it
against WorkerKit's hosted API is separately governed by the Terms of Service above.
