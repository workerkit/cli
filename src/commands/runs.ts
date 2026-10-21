import { renderHybridReceipt, renderRunAttribution, renderRunResult } from "../output/runReceipt.js";
import type { Command } from "commander";
import { byName, executeTool, isSuccess } from "@workerkit/core";
import { mountTool, runTool, globalOpts } from "../bind.js";
import { buildClient, requireToken } from "../context.js";
import { classifyError, renderApiError } from "../errors.js";
import { renderTable } from "../output/table.js";
import { sanitizeInline, sanitizeText } from "../output/sanitize.js";
import { bold, dim, green, red, yellow } from "../output/colors.js";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "timedout", "budgetexceeded", "skipped", "canceled", "awaitinginput"]);
const TAIL_INTERVAL_MS = 4000; // inside the documented 3-5s cadence the run-events bucket is sized for

interface RunRow {
  runId?: string;
  status?: string;
  skipReason?: string | null;
  triggerKind?: string;
  modelSlug?: string | null;
  startedAtUtc?: string | null;
  finishedAtUtc?: string | null;
  modelCostUsd?: number | null;
  billingMode?: string | null;
  ownerScore?: number | null;
}

function paintRunStatus(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "succeeded") return green(status);
  if (["failed", "timedout", "budgetexceeded"].includes(normalized)) return red(status);
  if (["running", "dispatched", "pending", "awaitinginput"].includes(normalized)) return yellow(status);
  return status;
}

function runsTable(rows: RunRow[]): string {
  return renderTable(rows, [
    { header: "RUN", value: (r) => r.runId ?? "" },
    { header: "STATUS", value: (r) => r.status ?? "?", paint: paintRunStatus },
    { header: "TRIGGER", value: (r) => r.triggerKind ?? "" },
    { header: "MODEL", value: (r) => r.modelSlug ?? "", maxWidth: 24 },
    { header: "STARTED", value: (r) => r.startedAtUtc ?? "" },
    { header: "SCORE", value: (r) => (r.ownerScore === null || r.ownerScore === undefined ? "" : String(r.ownerScore)) },
  ]);
}

export function mountRuns(program: Command): void {
  const runs = program.command("runs").description("Run history, live events, cancel and scoring");

  mountTool(runs, "list", {
    tool: "worker_runs",
    positionals: ["tokenId"],
    render: (data) => {
      const body = data as { runs?: RunRow[] };
      if (!Array.isArray(body.runs)) return null;
      if (body.runs.length === 0) return "No runs recorded.";
      return runsTable(body.runs);
    },
  });

  mountTool(runs, "get", {
    tool: "run_get",
    positionals: ["runId"],
    render: renderHybridReceipt,
  });

  mountTool(runs, "events", {
    tool: "run_events",
    positionals: ["runId"],
  });

  mountTool(runs, "cancel", {
    tool: "run_cancel",
    positionals: ["runId"],
  });

  mountTool(runs, "transcript", {
    tool: "run_transcript",
    positionals: ["runId"],
  });

  mountTool(runs, "bulk", {
    tool: "run_bulk",
    confirm: (p) =>
      `Run ${Array.isArray(p.workers) ? p.workers.length : "several"} workers now? Not atomic — read items[] rather than the status.`,
  });

  mountTool(runs, "clear-digest", {
    tool: "run_clear_digest",
    positionals: ["runId"],
    confirm: (p) => `Permanently clear the stored digest of run ${p.runId}?`,
  });

  mountTool(runs, "feed", {
    tool: "runs_feed",
    render: (data) => {
      const body = data as { runs?: RunRow[]; items?: RunRow[] };
      const rows = body.runs ?? body.items;
      if (!Array.isArray(rows)) return null;
      if (rows.length === 0) return "No runs on the account yet.";
      return runsTable(rows);
    },
  });

  mountTool(runs, "question", {
    tool: "run_question",
    positionals: ["runId"],
  });

  mountTool(runs, "answer", {
    tool: "run_answer",
    positionals: ["runId", "answer"],
  });

  const scoreSpec = {
    tool: "run_score",
    positionals: ["runId"],
    hidden: ["score"],
    summary: "Set the owner score (0-100) on a run; --clear removes it",
  } as const;

  const score = runs
    .command("score")
    .description(scoreSpec.summary)
    .argument("<runId>")
    .argument("[score]")
    .option("--clear", "Clear the owner score instead of setting one");
  score.action(async (runId: string, scoreArg: string | undefined, options: { clear?: boolean }) => {
    const globals = globalOpts(score);
    const descriptor = byName("run_score");
    if (!descriptor) throw new Error("run_score descriptor missing");
    let value: number | null;
    if (options.clear) value = null;
    else {
      value = Number(scoreArg);
      if (scoreArg === undefined || !Number.isInteger(value) || value < 0 || value > 100) {
        process.stderr.write("Provide a score between 0 and 100, or pass --clear.\n");
        process.exitCode = 2;
        return;
      }
    }
    await runTool(descriptor, { ...scoreSpec, positionals: ["runId"], hidden: ["score"] }, { runId, score: value }, globals);
  });

  // ── tail: poll run_events + run_get until the run settles ──────────────────────────────────────
  const tail = runs
    .command("tail")
    .description("Follow a run's event feed live until it settles (Ctrl-C stops tailing, not the run)")
    .argument("<runId>");
  tail.action(async (runId: string) => {
    const globals = globalOpts(tail);
    process.exitCode = await tailRun(runId, globals.json, globals.profile);
  });
}

interface RunEvent {
  seq?: number;
  kind?: string;
  message?: string | null;
  label?: string | null;
  atUtc?: string | null;
}

/**
 * The tail loop. Never re-triggers anything — it only reads. Ctrl-C exits the loop and prints how
 * to cancel; the run itself continues server-side.
 */
export async function tailRun(runId: string, json: boolean, profile?: string): Promise<number> {
  const eventsDescriptor = byName("run_events");
  const runDescriptor = byName("run_get");
  if (!eventsDescriptor || !runDescriptor) throw new Error("descriptors missing");
  // Tail bypasses runTool, so validate before interpolating the id into paths or output.
  runDescriptor.schema.runId!.parse(runId);

  const client = buildClient();
  const token = await requireToken(profile);

  let afterSeq = 0;
  let cycles = 0;
  let transportBlips = 0;
  let terminalSeen = false;
  let interrupted = false;
  const controller = new AbortController();
  const onSigint = () => {
    interrupted = true;
    controller.abort();
  };
  process.once("SIGINT", onSigint);

  try {
    for (;;) {
      if (interrupted) {
        process.stderr.write(`\nStopped tailing. The run continues; cancel with: wk runs cancel ${runId}\n`);
        return 130;
      }

      const events = await executeTool(client, eventsDescriptor, { runId, afterSeq, limit: 200 }, { token, signal: controller.signal });
      if (interrupted) continue;

      if (!isSuccess(events)) {
        // A 429 mid-tail is a pacing signal, not a failure: honor Retry-After and keep tailing.
        if (events.status === 429 && classifyError(events).code?.toUpperCase() !== "QUOTA_EXCEEDED") {
          const waitMs = events.quota.retryAfter ? events.quota.retryAfter * 1000 : TAIL_INTERVAL_MS * 2;
          await sleep(Math.min(waitMs, 30_000), () => interrupted);
          continue;
        }
        // Transport blips (the client already retried) get a few grace cycles before giving up.
        if (events.status === 0 && ++transportBlips <= 3) {
          await sleep(TAIL_INTERVAL_MS, () => interrupted);
          continue;
        }
        return renderApiError(events, json);
      }
      transportBlips = 0;

      const body = events.data as { events?: RunEvent[]; lastSeq?: number; hasMore?: boolean };
      let newEvents = 0;
      for (const event of body.events ?? []) {
        if (typeof event.seq !== "number" || event.seq <= afterSeq) continue;
        afterSeq = event.seq;
        newEvents++;
        const line =
          `${dim(sanitizeInline(event.atUtc ?? ""))} ${bold(sanitizeInline(event.kind ?? "event"))} ` +
          sanitizeInline(event.label ?? event.message ?? "");
        if (json) process.stdout.write(JSON.stringify(event) + "\n");
        else process.stdout.write(line.trim() + "\n");
      }
      if (typeof body.lastSeq === "number" && Number.isInteger(body.lastSeq)) afterSeq = Math.max(afterSeq, body.lastSeq);

      cycles++;
      if (terminalSeen || cycles === 1 || cycles % 3 === 0 || newEvents === 0) {
        const run = await executeTool(client, runDescriptor, { runId }, { token, signal: controller.signal });
        if (interrupted) continue;
        if (!isSuccess(run)) return renderApiError(run, json);
        if (isSuccess(run)) {
          const receipt = run.data as { status?: string; finalDigest?: string | null; ownerScore?: number | null; finishedAtUtc?: string | null };
          const status = sanitizeInline(receipt.status ?? "");
          const normalized = status.toLowerCase();
          const terminal = TERMINAL_STATUSES.has(normalized)
            && !(normalized === "canceled" && receipt.finishedAtUtc === null);
          // Read-only recovery: drain retained pages and give the runtime one quiet poll to
          // deliver its final events. A cancellation signal is not completed settlement.
          if (terminal && terminalSeen && body.hasMore !== true && newEvents === 0) {
            if (json) process.stdout.write(JSON.stringify(run.data) + "\n");
            else {
              process.stdout.write(`\n${bold("Run settled:")} ${paintRunStatus(status)}\n`);
              const hybrid = renderHybridReceipt(run.data);
              if (hybrid) process.stdout.write(hybrid + "\n");
              else {
                process.stdout.write([...renderRunAttribution(receipt), ...renderRunResult(receipt)].join("\n") + "\n");
                if (receipt.finalDigest) process.stdout.write(`${sanitizeText(String(receipt.finalDigest))}\n`);
              }
              if (normalized === "awaitinginput") process.stdout.write(`Read the question with: wk runs question ${runId}\n`);
            }
            return ["succeeded", "skipped", "awaitinginput"].includes(normalized) ? 0 : 1;
          }
          terminalSeen = terminal;
        }
      }

      await sleep(TAIL_INTERVAL_MS, () => interrupted);
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

/** Slice the wait so Ctrl-C is honored within ~250ms even during a long Retry-After backoff. */
async function sleep(ms: number, isCancelled?: () => boolean): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    const left = end - Date.now();
    if (left <= 0 || isCancelled?.()) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, left)));
  }
}
