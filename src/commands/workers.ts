import type { Command } from "commander";
import { mountTool } from "../bind.js";
import { renderTable, renderDetail } from "../output/table.js";
import { green, red, yellow } from "../output/colors.js";

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
}
