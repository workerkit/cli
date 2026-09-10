import type { Command } from "commander";
import { byName, executeTool, isSuccess } from "@workerkit/core";
import { mountTool, globalOpts } from "../bind.js";
import { buildClient, requireToken } from "../context.js";
import { readCredential } from "../input.js";
import { renderApiError } from "../errors.js";
import { renderTable, renderDetail } from "../output/table.js";
import { confirm } from "../output/confirm.js";
import { bold, dim, green, yellow } from "../output/colors.js";
import { sanitizeInline } from "../output/sanitize.js";

// `wk mcp-servers` — the account's own MCP servers: how an app the platform does not offer reaches
// a worker. Register (the credential rides the same call), discover, enable tools — which
// publishes the server — and delete. `create` carries a secret, so it never takes it as a plain
// flag: a file, a pipe, or the hidden prompt.

interface McpToolRow {
  toolId?: number;
  name?: string;
  description?: string | null;
  enabled?: boolean;
  state?: string;
}

interface McpServerRow {
  id?: number;
  gatewayId?: string;
  slug?: string;
  name?: string;
  upstreamUrl?: string;
  authType?: string;
  credentialScope?: string;
  published?: boolean;
  status?: string;
  connected?: boolean;
  lastDiscoveryError?: string | null;
  tools?: McpToolRow[];
}

interface McpServerResult {
  server?: McpServerRow;
  discovery?: { added?: string[]; changed?: string[]; removed?: string[]; unchanged?: string[] } | null;
  next?: string;
}

// The fields the hidden prompt asks for, per auth type. CustomHeaders takes an object
// (`{"headers": {...}}`), which no line prompt can collect: it comes from --credential,
// --credential-file or stdin, and the command says so.
const CREDENTIAL_FIELDS: Record<string, string[]> = {
  Bearer: ["token"],
  ApiKeyHeader: ["header", "value"],
  ApiKeyQuery: ["param", "value"],
  Basic: ["username", "password"],
  CustomHeaders: [],
};

function paintState(value: string): string {
  if (value === "enabled" || value === "yes" || value === "ACTIVE") return green(value);
  if (value === "") return value;
  return yellow(value);
}

function renderServer(server: McpServerRow): string {
  const lines = [renderDetail([
    ["Name", server.name],
    ["Slug", server.slug ? `${server.slug} (app_connect provider mcp:${server.slug})` : undefined],
    ["Kit id", server.id === undefined ? undefined : `${server.id} (content.mcpServers[].gatewayId)`],
    ["Handle", server.gatewayId],
    ["Upstream", server.upstreamUrl],
    ["Auth", server.authType ? `${server.authType} (${server.credentialScope ?? "operator"} credential)` : undefined],
    ["Published", server.published ? "yes" : "no — enable at least one tool"],
    ["Connected", server.connected ? "yes" : "no"],
    ["Status", server.status],
    ["Discovery error", server.lastDiscoveryError ?? undefined],
  ])];
  const tools = server.tools ?? [];
  if (tools.length > 0) {
    lines.push("");
    lines.push(bold("Tools"));
    lines.push(renderTable(tools, [
      { header: "TOOL ID", value: (t) => String(t.toolId ?? "") },
      { header: "NAME", value: (t) => t.name ?? "", maxWidth: 36 },
      { header: "ENABLED", value: (t) => (t.enabled ? "enabled" : t.state ?? ""), paint: paintState },
      { header: "DESCRIPTION", value: (t) => t.description ?? "", maxWidth: 60 },
    ]));
  }
  return lines.join("\n");
}

function renderResult(data: unknown): string | null {
  const body = data as McpServerResult;
  if (!body.server) return null;
  const lines = [renderServer(body.server)];
  const d = body.discovery;
  if (d) {
    lines.push("");
    lines.push(dim(`Discovery: +${d.added?.length ?? 0} added, ~${d.changed?.length ?? 0} changed, -${d.removed?.length ?? 0} removed, =${d.unchanged?.length ?? 0} unchanged`));
  }
  if (typeof body.next === "string" && body.next) {
    lines.push("");
    lines.push(`${bold("Next:")} ${sanitizeInline(body.next)}`);
  }
  return lines.join("\n");
}

/** The credential for `authType`, or null (exit 2) when none was given and none could be prompted for. */
async function readServerCredential(options: Record<string, unknown>, authType: string): Promise<Record<string, unknown> | null> {
  const promptFields = CREDENTIAL_FIELDS[authType] ?? [];
  const credential = await readCredential(options, promptFields);
  if (!credential || Object.keys(credential).length > 0) return credential;

  if (promptFields.length === 0) {
    process.stderr.write(
      `${authType} takes a credential object: pass it with --credential '{"headers":{"X-Api-Key":"…"}}', --credential-file <path>, or on stdin (or --no-credential to connect later).\n`,
    );
  } else {
    process.stderr.write("A credential is required: --field name=value, --credential, --credential-file, stdin, or the prompt (or --no-credential to connect later).\n");
  }
  process.exitCode = 2;
  return null;
}

export function mountMcpServers(program: Command): void {
  const servers = program.command("mcp-servers").description("Your account's own MCP servers: reach an app the platform does not offer");

  mountTool(servers, "list", {
    tool: "mcp_servers_list",
    summary: "Every MCP server you registered, published or not, with its tools",
    render: (data) => {
      const body = data as { servers?: McpServerRow[]; max?: number };
      if (!Array.isArray(body.servers)) return null;
      if (body.servers.length === 0) return "No MCP servers registered. Add one with `wk mcp-servers create`.";
      const lines = [renderTable(body.servers, [
        { header: "KIT ID", value: (s) => String(s.id ?? "") },
        { header: "HANDLE", value: (s) => s.gatewayId ?? "" },
        { header: "SLUG", value: (s) => s.slug ?? "" },
        { header: "NAME", value: (s) => s.name ?? "", maxWidth: 24 },
        { header: "AUTH", value: (s) => `${s.authType ?? ""}${s.credentialScope === "account" ? " (account)" : ""}` },
        { header: "PUBLISHED", value: (s) => (s.published ? "yes" : "no"), paint: paintState },
        { header: "CONNECTED", value: (s) => (s.connected ? "yes" : "no"), paint: paintState },
        { header: "TOOLS", value: (s) => `${(s.tools ?? []).filter((t) => t.enabled).length}/${(s.tools ?? []).length}` },
      ])];
      if (typeof body.max === "number") lines.push(dim(`${body.servers.length} of ${body.max} servers. KIT ID is what a kit binds; HANDLE is what the other commands take.`));
      return lines.join("\n");
    },
  });

  mountTool(servers, "get", {
    tool: "mcp_server_get",
    positionals: ["gatewayId"],
    summary: "One server with every discovered tool (handle from `wk mcp-servers list`)",
    render: (data) => renderServer(data as McpServerRow),
  });

  const create = servers
    .command("create")
    .description("Register an MCP server as your own custom MCP app; the credential is validated live, stored encrypted, never shown again")
    .argument("<name>", "Display name, e.g. the product name")
    .argument("<upstreamUrl>", "The https MCP endpoint itself (not a docs page)")
    .option("--auth-type <type>", "None | Bearer | ApiKeyHeader | ApiKeyQuery | Basic | CustomHeaders | McpOAuth", "None")
    .option("--account", "One credential for every operator (default: each operator connects its own)")
    .option("--field <name=value>", "One credential field (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
    .option("--credential <json>", "The whole credential object as JSON")
    .option("--credential-file <path>", "A file holding the credential object as JSON (or pipe it on stdin)")
    .option("--no-credential", "Register without a credential and connect later with `wk apps connect mcp:<slug>`")
    .option("--operator-id <guid>", "The operator the credential is stored for (default: the account's default operator)")
    .option("--description <text>", "Catalog blurb")
    .option("--connection-instructions <text>", "Where a person finds the credential, per the vendor's docs")
    .option("--slug <slug>", "Override the slug derived from the name")
    .option("--transport <transport>", "AutoDetect | StreamableHttp | Sse");
  create.action(async (name: string, upstreamUrl: string, options: Record<string, unknown>) => {
    const globals = globalOpts(create);
    const descriptor = byName("mcp_server_create");
    if (!descriptor) throw new Error("mcp_server_create descriptor missing");

    const authType = String(options.authType ?? "None");
    const params: Record<string, unknown> = { name, upstreamUrl, authType, credentialScope: options.account ? "account" : "operator" };
    if (authType !== "None" && authType !== "McpOAuth" && options.credential !== false) {
      const credential = await readServerCredential(options, authType);
      if (!credential) return;
      params.credential = credential;
    }
    if (typeof options.operatorId === "string") params.operatorId = options.operatorId;
    if (typeof options.description === "string") params.description = options.description;
    if (typeof options.connectionInstructions === "string") params.connectionInstructions = options.connectionInstructions;
    if (typeof options.slug === "string") params.slug = options.slug;
    if (typeof options.transport === "string") params.transport = options.transport;

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
    process.stdout.write(`${bold("Registered.")}\n${renderResult(result.data) ?? ""}\n`);
  });

  mountTool(servers, "discover", {
    tool: "mcp_server_discover",
    positionals: ["gatewayId"],
    summary: "List the server's tools again with its stored credential",
    render: renderResult,
  });

  const setTools = servers
    .command("set-tools")
    .description("Enable exactly these tools (enabling at least one publishes the server; none unpublishes it)")
    .argument("<gatewayId>", "The server's handle from `wk mcp-servers list`")
    .argument("[toolIds...]", "The complete set of tool ids to enable");
  setTools.action(async (gatewayId: string, toolIds: string[]) => {
    const globals = globalOpts(setTools);
    const descriptor = byName("mcp_server_set_tools");
    if (!descriptor) throw new Error("mcp_server_set_tools descriptor missing");

    const enabledToolIds = toolIds.map((id) => Number(id));
    if (enabledToolIds.some((id) => !Number.isInteger(id) || id < 0)) {
      process.stderr.write("Tool ids are the integer toolId values from `wk mcp-servers get`.\n");
      process.exitCode = 2;
      return;
    }
    // No ids = unpublish. A decision, never a slip of the shell: confirm it (the same exit
    // convention as every other declined confirmation).
    if (enabledToolIds.length === 0 && !(await confirm(`Enable no tools on ${gatewayId}? That unpublishes the server: workers lose its tools.`, globals.yes))) {
      if (process.exitCode === undefined || process.exitCode === 0) {
        process.stderr.write("Cancelled.\n");
        process.exitCode = 2;
      }
      return;
    }

    const client = buildClient();
    const token = await requireToken(globals.profile);
    const result = await executeTool(client, descriptor, { gatewayId, enabledToolIds }, { token });
    if (!isSuccess(result)) {
      process.exitCode = renderApiError(result, globals.json);
      return;
    }
    if (globals.json) {
      process.stdout.write(JSON.stringify(result.data, null, 2) + "\n");
      return;
    }
    process.stdout.write((renderResult(result.data) ?? "") + "\n");
  });

  mountTool(servers, "delete", {
    tool: "mcp_server_delete",
    positionals: ["gatewayId"],
    confirm: (p) => `Delete MCP server ${p.gatewayId}? Its tools, credentials and every worker binding go with it.`,
    summary: "Delete a server (its tools, credentials and worker bindings go with it)",
  });
}
