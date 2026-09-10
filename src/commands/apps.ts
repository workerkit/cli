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

// `wk apps` — which apps an operator can use, and connecting the credential-based ones — and
// `wk model-keys`, the account's own model-provider keys. Both writes carry a secret, so neither
// takes it as a flag by default: a token in `--field botToken=…` lands in shell history, while a
// file, a pipe, or the hidden prompt does not.

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
    lines.push(dim(`OAuth apps (Google, Microsoft, GitHub, Reddit) connect on the dashboard: ${sanitizeInline(body.dashboardUrl)}`));
  return lines.join("\n");
}

export function mountApps(program: Command): void {
  const apps = program.command("apps").description("Which apps your operator can use, and connecting the credential-based ones");

  mountTool(apps, "list", {
    tool: "apps_list",
    summary: "Every app with its connection state, how to connect it, and every connection behind the grid",
    render: renderApps,
  });

  const connect = apps
    .command("connect")
    .description("Connect an app by credential (validated live, stored encrypted, never shown again)")
    .argument("<provider>", "A recipe's provider code from `wk apps list` (telegram, tavily, notion, mcp:<slug>, …)")
    .option("--field <name=value>", "One credential field (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
    .option("--credential <json>", "The whole credential object as JSON")
    .option("--credential-file <path>", "A file holding the credential object as JSON (or pipe it on stdin)")
    .option("--label <label>", "Optional label, where the family keeps one")
    .option("--operator-id <guid>", "The operator to connect for (default: the account's default operator)");
  connect.action(async (provider: string, options: Record<string, unknown>) => {
    const globals = globalOpts(connect);
    const descriptor = byName("app_connect");
    if (!descriptor) throw new Error("app_connect descriptor missing");

    // With no input at all, prompt for the one field the common single-secret recipes take.
    const SINGLE_FIELD: Record<string, string> = {
      telegram: "botToken", discord: "botToken", slack: "botToken", sendgrid: "apiKey", resend: "apiKey",
      tavily: "apiKey", brave: "apiKey", exa: "apiKey", brightData: "apiKey", firecrawl: "apiKey",
      granola: "apiKey", krisp: "apiKey", hubspot: "token", notion: "apiToken", linear: "apiKey", monday: "apiToken", asana: "accessToken",
    };
    const promptFields = SINGLE_FIELD[provider] ? [SINGLE_FIELD[provider]] : [];
    const credential = await readCredential(options, promptFields);
    if (!credential) return;

    const params: Record<string, unknown> = { provider, credential };
    if (typeof options.label === "string") params.label = options.label;
    if (typeof options.operatorId === "string") params.operatorId = options.operatorId;

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
    summary: "Remove one connection (provider + id from `wk apps list`)",
  });
}

export function mountModelKeys(program: Command): void {
  const keys = program.command("model-keys").description("Your account's own model-provider API keys (Anthropic, OpenAI, Google, XAI)");

  mountTool(keys, "list", {
    tool: "model_keys_list",
    summary: "Stored keys: provider, label, suffix, status (never the key)",
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
    summary: "Remove a provider key (also clears an INVALID one so skipped runs resume)",
  });
}
