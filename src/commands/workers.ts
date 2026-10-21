import { readFileSync } from "node:fs";
import { byName, executeTool, isSuccess, z } from "@workerkit/core";
import { buildClient, requireToken } from "../context.js";
import { parseJsonObject, readStdin } from "../input.js";
import { renderApiError } from "../errors.js";
import { sanitizeText } from "../output/sanitize.js";
import type { Command } from "commander";
import { mountTool, globalOpts } from "../bind.js";
import { renderTable, renderDetail } from "../output/table.js";
import { bold, green, red, yellow } from "../output/colors.js";
import { sanitizeInline } from "../output/sanitize.js";

interface WorkerRow {
  ownerUserId?: number;
  ownerName?: string | null;
  workerId?: string;
  tokenId?: number;
  title?: string | null;
  status?: string;
  isEnabled?: boolean;
  isRunning?: boolean;
  lastRun?: { status?: string; outcome?: string; finishedAtUtc?: string } | null;
  schedules?: { nextRunUtc?: string | null; enabledCount?: number } | null;
  readiness?: { status?: string } | null;
  deployment?: { status?: string } | null;
}

function paintStatus(status: string): string {
  if (status === "active") return green(status);
  if (status === "paused") return yellow(status);
  return red(status);
}

export function mountWorkers(program: Command): void {
  const workers = program.command("workers").description("Manage your workers (list, inspect, start/stop)");

  const quality = workers.command("quality").description("Review quality criteria and gates; owner-only improvement controls are in the dashboard");
  mountTool(quality, "get", { tool: "worker_quality_get", positionals: ["tokenId"] });
  mountTool(quality, "set", { tool: "worker_quality_set", positionals: ["tokenId"] });
  mountTool(quality, "preview", { tool: "worker_quality_preview", positionals: ["tokenId"] });

  mountTool(workers, "timezone", {
    tool: "worker_timezone_set", positionals: ["tokenId"],
  });

  mountTool(workers, "tools", { tool: "worker_tools", positionals: ["tokenId"],});
  mountTool(workers, "action-options", { tool: "action_worker_options",});
  workers.command("invoke <tokenId> <toolName>")
    .description("Call one Action tool with JSON from --file, --arguments or stdin. Repeating a key with the same arguments returns the stored receipt; never retry an uncertain write with a new key.")
    .option("--file <path>", "Read tool arguments from a JSON file")
    .option("--arguments <json>", "Tool arguments as a JSON object (prefer a file for private content)")
    .option("--idempotency-key <key>", "Unique key for this intended write; preserve it on retries")
    .action(async (tokenId: string, toolName: string, options, cmd: Command) => {
      const globals = globalOpts(cmd);
      if (options.file && options.arguments) { process.stderr.write("Choose --file or --arguments.\n"); process.exitCode = 2; return; }
      const raw = options.file ? readFileSync(options.file, "utf8") : options.arguments ?? (!process.stdin.isTTY ? await readStdin() : null);
      if (raw === null) { process.stderr.write("Provide --file, --arguments or JSON on stdin.\n"); process.exitCode = 2; return; }
      const args = parseJsonObject(raw, "tool arguments");
      if (!args) return;
      const descriptor = byName("worker_tool_call")!;
      const parsed = z.object(descriptor.schema).strict().safeParse({ tokenId: Number(tokenId), toolName, arguments: args, idempotencyKey: options.idempotencyKey });
      if (!parsed.success) { process.stderr.write(parsed.error.message + "\n"); process.exitCode = 2; return; }
      const token = await requireToken(globals.profile);
      const result = await executeTool(buildClient(), descriptor, parsed.data, { token });
      // Preserve the complete receipt even on a non-2xx result.
      const text = JSON.stringify(result.data, null, 2);
      process.stdout.write((globals.json ? text : sanitizeText(text)) + "\n");
      const status = (result.data as { status?: string } | null)?.status;
      if (!isSuccess(result)) process.exitCode = renderApiError(result, globals.json);
      else if (status !== "succeeded") process.exitCode = 1;
    });
  mountTool(workers, "invocation", { tool: "worker_tool_invocation", positionals: ["tokenId", "invocationId"],});
  mountTool(workers, "create-action", { tool: "action_worker_create",});

  mountTool(workers, "list", {
    tool: "workers_list",
    render: (data) => {
      const body = data as { workers?: WorkerRow[]; totalWorkers?: number };
      if (!Array.isArray(body.workers)) return null;
      if (body.workers.length === 0) {
        // totalWorkers counts the workers this key reaches, unfiltered: zero means the key reaches
        // nothing yet, non-zero a filter that matched nothing — two different next steps.
        return body.totalWorkers
          ? `No workers match those filters (${body.totalWorkers} reachable by this key).`
          : "No workers this key can reach yet. Install one with `wk kit search` + `wk kit install <slug>`; it joins the key.";
      }
      return renderTable(body.workers, [
        { header: "ID", value: (w) => String(w.tokenId ?? "") },
        { header: "TITLE", value: (w) => w.title ?? "(untitled)", maxWidth: 32 },
        { header: "OWNER", value: (w) => w.ownerName ?? (w.ownerUserId ? String(w.ownerUserId) : ""), maxWidth: 24 },
        { header: "STATUS", value: (w) => w.status ?? "?", paint: paintStatus },
        { header: "READY", value: (w) => w.readiness?.status ?? "" },
        { header: "DEPLOYED", value: (w) => (w.deployment ? "yes" : "") },
        { header: "RUNNING", value: (w) => (w.isRunning ? "yes" : "") },
        { header: "LAST RUN", value: (w) => w.lastRun?.outcome ?? w.lastRun?.status ?? "" },
        { header: "NEXT RUN", value: (w) => w.schedules?.nextRunUtc ?? "" },
        { header: "WORKER ID", value: (w) => w.workerId ?? "" },
      ]);
    },
  });

  mountTool(workers, "get", {
    tool: "worker_get",
    positionals: ["tokenId"],
    render: (data) => {
      const w = data as WorkerRow & {
        jobSentence?: string | null;
        readiness?: { status?: string };
        kit?: { slug?: string } | null;
        modelType?: string | null;
        decisionPendingSetup?: string[] | null;
      };
      if (typeof w !== "object" || w === null || w.tokenId === undefined) return null;
      // modelType is the field that says which calls this worker accepts — a decision worker takes
      // no prompt and no model, and any question still blank in decisionPendingSetup blocks both
      // deploy and run, so neither belongs buried in --json.
      const pending = Array.isArray(w.decisionPendingSetup) ? w.decisionPendingSetup : [];
      const detail = renderDetail([
        ["ID", String(w.tokenId)],
        ["Worker ID", w.workerId ?? null],
        ["Title", w.title ?? "(untitled)"],
        ["Status", w.status ?? null],
        ["Enabled", w.isEnabled === undefined ? null : String(w.isEnabled)],
        ["Type", w.modelType ?? null],
        ["Job", w.jobSentence ?? null],
        ["Kit", w.kit?.slug ?? null],
        ["Readiness", w.readiness?.status ?? null],
        ["Running now", w.isRunning ? "yes" : null],
        ["Next run", w.schedules?.nextRunUtc ?? null],
      ]);
      if (pending.length === 0) return detail;
      return [
        detail,
        yellow(`Pending setup: ${sanitizeInline(pending.join(", "))} — blocks deploy and run.`),
        `Answer with \`wk instruction set ${w.tokenId} --answers '{"key":"value"}'\`.`,
      ].join("\n");
    },
  });

  mountTool(workers, "enable", {
    tool: "worker_set_enabled",
    positionals: ["tokenId"],
    fixed: { enabled: true },
  });

  mountTool(workers, "disable", {
    tool: "worker_set_enabled",
    positionals: ["tokenId"],
    fixed: { enabled: false },
    confirm: (p) => `Stop worker ${p.tokenId}? Its key stops working and schedules stop firing.`,
  });

  mountTool(workers, "delete", {
    tool: "worker_delete",
    positionals: ["tokenId"],
    confirm: (p) =>
      `PERMANENTLY delete worker ${p.tokenId}? Its key stops, its schedules stop, and its SUB-WORKERS go with it. ` +
      "Nothing undoes this (`wk workers disable` is the reversible stop).",
  });

  mountTool(workers, "permissions", {
    tool: "worker_permissions_get",
    positionals: ["tokenId"],
  });

  mountTool(workers, "permissions-set", {
    tool: "worker_permissions_set",
    positionals: ["tokenId"],
    confirm: (p) =>
      `Replace what worker ${p.tokenId} may touch with ${Array.isArray(p.apps) ? p.apps.length : "the given"} app(s)? Apps left out are switched OFF.`,
  });

  // ── grants to call other workers: the kit's slots and any free alias ──────────────────────
  mountTool(workers, "bindings", {
    tool: "worker_bindings_get",
    positionals: ["tokenId"],
    render: renderBindings,
  });

  mountTool(workers, "bindings-set", {
    tool: "worker_bindings_set",
    positionals: ["tokenId"],
    // Filling is reversible; clearing cancels the alias's in-flight child runs, so that asks first.
    confirm: (p) => {
      const map = (p.workerBindings ?? {}) as Record<string, unknown>;
      const cleared = Object.keys(map).filter((alias) => map[alias] === null);
      return cleared.length === 0 ? null
        : `Clear ${cleared.join(", ")} on worker ${p.tokenId}? Their in-flight child runs are cancelled.`;
    },
    render: renderBindings,
  });

  // ── creation by cloning: the only non-kit creation path; each new key is shown once ────────
  mountTool(workers, "clone-preview", {
    tool: "worker_clone_preview",
    positionals: ["tokenId"],
  });

  mountTool(workers, "clone", {
    tool: "worker_clone",
    positionals: ["tokenId"],
    confirm: (p) => `Clone worker ${p.tokenId} into a new worker${p.title ? ` "${String(p.title)}"` : ""}? Its permissions AND restriction rules travel.`,
    render: cloneResult,
  });

  mountTool(workers, "clone-bulk", {
    tool: "worker_clone_bulk",
    positionals: ["tokenId"],
    confirm: (p) => `Clone worker ${p.tokenId} into ${Array.isArray(p.workers) ? p.workers.length : "several"} new workers? Not atomic — read items[] rather than the status.`,
    render: cloneBulkResult,
  });

  mountTool(workers, "budget", {
    tool: "budget_get",
    positionals: ["tokenId"],
  });

  mountTool(workers, "budget-set", {
    tool: "budget_set",
    positionals: ["tokenId"],
  });
}

interface BindingRow {
  alias?: string;
  title?: string | null;
  workerId?: string;
  modelType?: string;
  operations?: number;
  available?: boolean;
}

/** The grants, then the required slots still empty — the one line that explains a skipped run. */
function renderBindings(data: unknown): string | null {
  const body = data as { bindings?: BindingRow[]; missingSlots?: string[] | null };
  if (!Array.isArray(body.bindings)) return null;
  const lines = [
    body.bindings.length === 0
      ? "No grants to call other workers yet."
      : renderTable(body.bindings, [
          { header: "ALIAS", value: (b) => b.alias ?? "" },
          { header: "WORKER", value: (b) => b.title ?? "(untitled)", maxWidth: 32 },
          { header: "TYPE", value: (b) => b.modelType ?? "" },
          { header: "OPS", value: (b) => String(b.operations ?? "") },
          { header: "AVAILABLE", value: (b) => (b.available ? "yes" : "no") },
          { header: "WORKER ID", value: (b) => b.workerId ?? "" },
        ]),
  ];
  const missing = Array.isArray(body.missingSlots) ? body.missingSlots : [];
  if (missing.length > 0)
    lines.push(yellow(`Required slots still empty: ${sanitizeInline(missing.join(", "))} — runs stay skipped until \`wk workers bindings-set\` fills them.`));
  return lines.join("\n");
}

interface CloneItem {
  index?: number;
  title?: string;
  success?: boolean;
  workerId?: string;
  tokenId?: number;
  rawKey?: string | null;
  error?: string | null;
}

/** A clone's key exists exactly once — in this response. Print it before anything else. */
function cloneResult(data: unknown): string | null {
  const item = data as CloneItem;
  if (typeof item !== "object" || item === null || item.success === undefined) return null;
  const lines: string[] = [];
  if (item.success) {
    lines.push(`${green("Created")} worker ${item.tokenId ?? "?"} (${sanitizeInline(item.workerId ?? "")}) — ${sanitizeInline(item.title ?? "")}`);
    if (item.rawKey) {
      lines.push(red(bold("Worker key — shown ONCE, store it now:")));
      lines.push(`  ${sanitizeInline(item.rawKey)}`);
    }
    if (item.error) lines.push(`${yellow("Created with a warning:")} ${sanitizeInline(item.error)}`);
  } else {
    lines.push(`${red("Not created:")} ${sanitizeInline(item.error ?? "unknown error")}`);
  }
  return lines.join("\n");
}

function cloneBulkResult(data: unknown): string | null {
  const body = data as { requested?: number; created?: number; items?: CloneItem[] };
  if (!Array.isArray(body.items)) return null;
  const lines = [`${bold(`${body.created ?? 0} of ${body.requested ?? body.items.length} created`)}`];
  for (const item of body.items) {
    const rendered = cloneResult(item);
    if (rendered) lines.push(`[${item.index ?? "?"}] ${rendered}`);
  }
  return lines.join("\n");
}
