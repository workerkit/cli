import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { byName, executeTool, isSuccess } from "@workerkit/core";
import { mountTool, globalOpts } from "../bind.js";
import { buildClient, requireToken } from "../context.js";
import { promptHidden, readCredential, readStdin } from "../input.js";
import { renderApiError } from "../errors.js";
import { renderTable } from "../output/table.js";
import { bold, dim, green, red, yellow } from "../output/colors.js";
import { sanitizeInline } from "../output/sanitize.js";
import { connectInBrowser } from "./appConnectBrowser.js";

// `wk apps` opens browser setup unless credential input is supplied. Direct app
// writes and `wk model-keys` can read secrets from protected files or stdin;
// model keys also retain their hidden prompt.

interface AppStatusRow {
  app?: string;
  name?: string;
  connected?: boolean;
  providers?: string[];
  connect?: Array<{ provider?: string; auth?: string; scope?: string; url?: string | null; connected?: boolean | null }>;
}

interface ConnectionRow {
  provider?: string;
  apps?: string[];
  id?: string;
  name?: string | null;
  operatorId?: string | null;
  status?: string;
  requiresReauth?: boolean;
  deletable?: boolean;
}

interface ModelKeyRow {
  provider?: string;
  label?: string | null;
  keySuffix?: string;
  status?: string;
  lastErrorCode?: string | null;
  lastUsedUtc?: string | null;
}

function paintConnected(value: string): string {
  if (value === "yes") return green(value);
  if (value === "") return value;
  return yellow(value);
}

function paintStatus(status: string): string {
  if (status === "ACTIVE") return green(status);
  if (status === "REVOKED" || status === "INVALID") return red(status);
  return yellow(status);
}

/** The ways to connect an app, compressed to one cell: `telegram (credential), slack (credential | oauth)`. */
function connectCell(row: AppStatusRow): string {
  const recipes = row.connect ?? [];
  if (recipes.length === 0) return "";
  const parts = recipes.slice(0, 4).map((r) => `${r.provider ?? "?"} (${r.auth ?? "?"})`);
  if (recipes.length > 4) parts.push(`+${recipes.length - 4} more`);
  return parts.join(", ");
}

function renderApps(data: unknown): string | null {
  const body = data as { operatorTitle?: string | null; apps?: AppStatusRow[]; connections?: ConnectionRow[]; dashboardUrl?: string; warnings?: string[] };
  if (!Array.isArray(body.apps)) return null;
  const lines: string[] = [];
  lines.push(renderTable(body.apps, [
    { header: "APP", value: (a) => a.app ?? "" },
    { header: "NAME", value: (a) => a.name ?? "", maxWidth: 22 },
    { header: "CONNECTED", value: (a) => (a.connected ? "yes" : a.connect && a.connect.length > 0 ? "no" : ""), paint: paintConnected },
    { header: "VIA", value: (a) => (a.providers ?? []).join(", "), maxWidth: 28 },
    { header: "CONNECT WITH", value: connectCell, maxWidth: 60 },
  ]));
  const connections = body.connections ?? [];
  if (connections.length > 0) {
    lines.push("");
    lines.push(bold("Connections"));
    lines.push(renderTable(connections, [
      { header: "PROVIDER", value: (c) => c.provider ?? "" },
      { header: "ID", value: (c) => c.id ?? "", maxWidth: 24 },
      { header: "NAME", value: (c) => c.name ?? "", maxWidth: 30 },
      { header: "APPS", value: (c) => (c.apps ?? []).join(", "), maxWidth: 30 },
      { header: "STATUS", value: (c) => c.status ?? "", paint: paintStatus },
      { header: "REAUTH", value: (c) => (c.requiresReauth ? "needed" : "") },
      { header: "SCOPE", value: (c) => (c.operatorId ? "operator" : "account") },
    ]));
  }
  for (const warning of body.warnings ?? []) lines.push(yellow(`! ${sanitizeInline(warning)}`));
  if (typeof body.dashboardUrl === "string")
    lines.push(dim(`Open an app's setup with wk apps connect <provider>, or use the dashboard: ${sanitizeInline(body.dashboardUrl)}`));
  return lines.join("\n");
}

export function mountApps(program: Command): void {
  const apps = program.command("apps").description("Which apps your operator can use, and connecting them in the browser or by credential");

  mountTool(apps, "list", {
    tool: "apps_list",
    render: renderApps,
  });

  const github = apps.command("github").description("Discover connected GitHub accounts, repositories and branches before installing a worker (discoverAppResources scope)");
  mountTool(github, "accounts", { tool: "app_github_accounts",});
  mountTool(github, "repos", { tool: "app_github_repos",});
  mountTool(github, "branches", { tool: "app_github_branches", positionals: ["repo"],});

  const slack = apps.command("slack").description("Discover connected Slack workspaces and conversations (discoverAppResources scope)");
  mountTool(slack, "workspaces", { tool: "app_slack_workspaces",});
  mountTool(slack, "conversations", { tool: "app_slack_conversations",});

  const connect = apps
    .command("connect")
    .description("Open app setup in the browser, or supply a credential to connect directly")
    .argument("<provider>", "A recipe's provider code from `wk apps list` (telegram, tavily, notion, mcp:<slug>, …)")
    .option("--field <name=value>", "One credential field (repeatable; prefer a file or stdin for secrets)", (v: string, acc: string[]) => [...acc, v], [] as string[])
    .option("--credential <json>", "The whole credential object as JSON (prefer a file or stdin for secrets)")
    .option("--credential-file <path>", "A file holding the credential object as JSON (or pipe it on stdin)")
    .option("--browser", "Open this app's setup dialog in WorkerKit (default without a credential)")
    .option("--no-browser", "Print the setup URL without opening a browser (SSH, containers, CI)")
    .option("--label <label>", "Optional label for direct credential input, where the family keeps one")
    .option("--operator-id <guid>", "The operator to connect for (default: the account's default operator)");
  connect.action(async (provider: string, options: Record<string, unknown>) => {
    const globals = globalOpts(connect);
    const descriptor = byName("app_connect");
    if (!descriptor) throw new Error("app_connect descriptor missing");

    const hasCredentialOption = !!options.credential || !!options.credentialFile || (options.field as string[]).length > 0;
    if (options.browser !== undefined && hasCredentialOption) {
      process.stderr.write("Choose browser setup or credential input, not both.\n");
      process.exitCode = 2;
      return;
    }
    // Explicit browser mode never reads stdin (which may be a long-lived agent pipe).
    const credential = options.browser !== undefined ? {} : await readCredential(options, []);
    if (!credential) return;

    const client = buildClient();
    const token = await requireToken(globals.profile);
    if (options.browser !== undefined || (!hasCredentialOption && Object.keys(credential).length === 0)) {
      await connectInBrowser(client, token, provider, typeof options.operatorId === "string" ? options.operatorId : undefined,
        options.browser !== false && (options.browser === true || !!process.stdout.isTTY), globals.json);
      return;
    }

    const params: Record<string, unknown> = { provider, credential };
    if (typeof options.label === "string") params.label = options.label;
    if (typeof options.operatorId === "string") params.operatorId = options.operatorId;

    const result = await executeTool(client, descriptor, params, { token });
    if (!isSuccess(result)) {
      process.exitCode = renderApiError(result, globals.json);
      return;
    }
    if (globals.json) {
      process.stdout.write(JSON.stringify(result.data, null, 2) + "\n");
      return;
    }
    const body = result.data as { app?: string; provider?: string; connection?: ConnectionRow; warnings?: string[] };
    const row = body.connection ?? {};
    process.stdout.write(
      `${bold("Connected:")} ${sanitizeInline(body.provider ?? provider)} → ${sanitizeInline(row.name ?? row.id ?? "")} ` +
      `(${paintStatus(sanitizeInline(row.status ?? "ACTIVE"))}, app ${sanitizeInline(body.app ?? "")}, id ${sanitizeInline(row.id ?? "")})\n`,
    );
    for (const warning of body.warnings ?? []) process.stdout.write(yellow(`! ${sanitizeInline(warning)}`) + "\n");
  });

  mountTool(apps, "disconnect", {
    tool: "app_disconnect",
    positionals: ["provider", "connectionId"],
    confirm: (p) => `Disconnect ${p.provider} connection ${p.connectionId}? Workers using it lose the app immediately.`,
  });
}

export function mountModelKeys(program: Command): void {
  const keys = program.command("model-keys").description("Your account's own model-provider API keys (Anthropic, OpenAI, Google, XAI)");

  mountTool(keys, "list", {
    tool: "model_keys_list",
    render: (data) => {
      const body = data as { keys?: ModelKeyRow[] };
      if (!Array.isArray(body.keys)) return null;
      if (body.keys.length === 0) return "No model keys stored. Add one with `wk model-keys set <provider>`.";
      return renderTable(body.keys, [
        { header: "PROVIDER", value: (k) => k.provider ?? "" },
        { header: "LABEL", value: (k) => k.label ?? "", maxWidth: 24 },
        { header: "SUFFIX", value: (k) => (k.keySuffix ? `…${k.keySuffix}` : "") },
        { header: "STATUS", value: (k) => k.status ?? "", paint: paintStatus },
        { header: "ERROR", value: (k) => k.lastErrorCode ?? "" },
        { header: "LAST USED", value: (k) => k.lastUsedUtc ?? "" },
      ]);
    },
  });

  const set = keys
    .command("set")
    .description("Set or rotate a provider key (probed live before storage; never shown again)")
    .argument("<provider>", "Anthropic | OpenAI | Google | XAI")
    .option("--key <value>", "The API key (prefer --key-file, stdin, or the hidden prompt — a flag lands in shell history)")
    .option("--key-file <path>", "A file holding the API key")
    .option("--label <label>", "Optional label shown beside the key");
  set.action(async (provider: string, options: Record<string, unknown>) => {
    const globals = globalOpts(set);
    const descriptor = byName("model_key_set");
    if (!descriptor) throw new Error("model_key_set descriptor missing");

    let apiKey: string | null = null;
    if (typeof options.key === "string" && options.key) apiKey = options.key;
    else if (typeof options.keyFile === "string" && options.keyFile) apiKey = readFileSync(options.keyFile, "utf8");
    else if (!process.stdin.isTTY) apiKey = await readStdin();
    else apiKey = await promptHidden(`${provider} API key: `);
    apiKey = (apiKey ?? "").trim();
    if (apiKey.length < 8) {
      process.stderr.write("An API key is required: --key, --key-file, stdin, or the prompt.\n");
      process.exitCode = 2;
      return;
    }

    const params: Record<string, unknown> = { provider, apiKey };
    if (typeof options.label === "string") params.label = options.label;

    const client = buildClient();
    const token = await requireToken(globals.profile);
    const result = await executeTool(client, descriptor, params, { token });
    if (!isSuccess(result)) {
      process.exitCode = renderApiError(result, globals.json);
      return;
    }
    if (globals.json) {
      process.stdout.write(JSON.stringify(result.data, null, 2) + "\n");
      return;
    }
    const item = result.data as ModelKeyRow;
    process.stdout.write(
      `${bold("Stored:")} ${sanitizeInline(item.provider ?? provider)} key …${sanitizeInline(item.keySuffix ?? "")} ` +
      `(${paintStatus(sanitizeInline(item.status ?? "ACTIVE"))}). Runs on this provider bill your key from the next run.\n`,
    );
  });

  mountTool(keys, "delete", {
    tool: "model_key_delete",
    positionals: ["provider"],
    confirm: (p) => `Remove the ${p.provider} key? Runs on its models return to platform billing.`,
  });
}
