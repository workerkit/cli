import type { Command } from "commander";
import { mountTool } from "../bind.js";
import { renderTable, renderDetail } from "../output/table.js";
import { bold, green, red, yellow } from "../output/colors.js";
import { sanitizeInline } from "../output/sanitize.js";

interface WorkerRow {
  workerId?: string;
  tokenId?: number;
  title?: string | null;
  status?: string;
  isEnabled?: boolean;
  isRunning?: boolean;
  lastRun?: { status?: string; finishedAtUtc?: string } | null;
  schedules?: { nextRunUtc?: string | null; enabledCount?: number } | null;
}

function paintStatus(status: string): string {
  if (status === "active") return green(status);
  if (status === "paused") return yellow(status);
  return red(status);
}

export function mountWorkers(program: Command): void {
  const workers = program.command("workers").description("Manage your workers (list, inspect, start/stop)");

  mountTool(workers, "list", {
    tool: "workers_list",
    summary: "List every worker on the account with status and run rollups",
    render: (data) => {
      const body = data as { workers?: WorkerRow[] };
      if (!Array.isArray(body.workers)) return null;
      if (body.workers.length === 0) return "No workers yet. Install one with `wk kit search` + `wk kit install <slug>`.";
      return renderTable(body.workers, [
        { header: "ID", value: (w) => String(w.tokenId ?? "") },
        { header: "TITLE", value: (w) => w.title ?? "(untitled)", maxWidth: 32 },
        { header: "STATUS", value: (w) => w.status ?? "?", paint: paintStatus },
        { header: "RUNNING", value: (w) => (w.isRunning ? "yes" : "") },
        { header: "LAST RUN", value: (w) => w.lastRun?.status ?? "" },
        { header: "NEXT RUN", value: (w) => w.schedules?.nextRunUtc ?? "" },
        { header: "WORKER ID", value: (w) => w.workerId ?? "" },
      ]);
    },
  });

  mountTool(workers, "get", {
    tool: "worker_get",
    positionals: ["tokenId"],
    summary: "One worker's detail: status, kit, readiness, 30-day activity",
    render: (data) => {
      const w = data as WorkerRow & {
        jobSentence?: string | null;
        readiness?: { status?: string };
        kit?: { slug?: string } | null;
      };
      if (typeof w !== "object" || w === null || w.tokenId === undefined) return null;
      return renderDetail([
        ["ID", String(w.tokenId)],
        ["Worker ID", w.workerId ?? null],
        ["Title", w.title ?? "(untitled)"],
        ["Status", w.status ?? null],
        ["Enabled", w.isEnabled === undefined ? null : String(w.isEnabled)],
        ["Job", w.jobSentence ?? null],
        ["Kit", w.kit?.slug ?? null],
        ["Readiness", w.readiness?.status ?? null],
        ["Running now", w.isRunning ? "yes" : null],
        ["Next run", w.schedules?.nextRunUtc ?? null],
      ]);
    },
  });

  mountTool(workers, "enable", {
    tool: "worker_set_enabled",
    positionals: ["tokenId"],
    fixed: { enabled: true },
    summary: "Start a worker: its API key works and schedules fire again",
  });

  mountTool(workers, "disable", {
    tool: "worker_set_enabled",
    positionals: ["tokenId"],
    fixed: { enabled: false },
    summary: "Stop a worker: pauses its API key AND all of its schedules",
    confirm: (p) => `Stop worker ${p.tokenId}? Its key stops working and schedules stop firing.`,
  });

  mountTool(workers, "permissions", {
    tool: "worker_permissions_get",
    positionals: ["tokenId"],
    summary: "What a worker may touch, in the kit-authoring vocabulary (read-only), plus how many rules it carries",
  });

  // ── creation by cloning: the only non-kit creation path; each new key is shown once ────────
  mountTool(workers, "clone-preview", {
    tool: "worker_clone_preview",
    positionals: ["tokenId"],
    summary: "What a clone WOULD create: apps, counts of what travels, blockers. Creates nothing",
  });

  mountTool(workers, "clone", {
    tool: "worker_clone",
    positionals: ["tokenId"],
    confirm: (p) => `Clone worker ${p.tokenId} into a new worker${p.title ? ` "${String(p.title)}"` : ""}? Its permissions AND restriction rules travel.`,
    summary: "Clone a worker into a new one (run clone-preview first); the new key is shown ONCE",
    render: cloneResult,
  });

  mountTool(workers, "clone-bulk", {
    tool: "worker_clone_bulk",
    positionals: ["tokenId"],
    confirm: (p) => `Clone worker ${p.tokenId} into ${Array.isArray(p.workers) ? p.workers.length : "several"} new workers? Not atomic — read items[] rather than the status.`,
    summary: "Clone a worker into up to 20 new ones: --workers '[{\"title\":\"...\"}, ...]'; each new key is shown ONCE",
    render: cloneBulkResult,
  });

  mountTool(workers, "budget", {
    tool: "budget_get",
    positionals: ["tokenId"],
    summary: "A worker's spend and rate ceilings",
  });

  mountTool(workers, "budget-set", {
    tool: "budget_set",
    positionals: ["tokenId"],
    summary: "Change a worker's spend / rate ceilings and its question timeout (omitted fields unchanged)",
  });
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
