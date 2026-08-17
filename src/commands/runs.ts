import type { Command } from "commander";
import { byName, executeTool, isSuccess } from "@workerkit/core";
import { mountTool, runTool, globalOpts } from "../bind.js";
import { buildClient, requireToken } from "../context.js";
import { renderApiError } from "../errors.js";
import { renderTable } from "../output/table.js";
import { sanitizeInline, sanitizeText } from "../output/sanitize.js";
import { bold, dim, green, red, yellow } from "../output/colors.js";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "timedOut", "budgetExceeded", "skipped", "canceled"]);
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
  if (status === "succeeded") return green(status);
  if (status === "failed" || status === "timedOut" || status === "budgetExceeded") return red(status);
  if (status === "running" || status === "dispatched" || status === "pending") return yellow(status);
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
    summary: "A worker's run history, newest first",
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
    summary: "One run's full receipt",
  });

  mountTool(runs, "events", {
    tool: "run_events",
    positionals: ["runId"],
    summary: "One page of a run's event feed (single poll; see `wk runs tail`)",
  });

  mountTool(runs, "cancel", {
    tool: "run_cancel",
    positionals: ["runId"],
    summary: "Cancel an in-flight run",
  });

  mountTool(runs, "clear-digest", {
    tool: "run_clear_digest",
    positionals: ["runId"],
    confirm: (p) => `Permanently clear the stored digest of run ${p.runId}?`,
    summary: "Scrub a run's stored digest text",
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

  const client = buildClient();
  const token = await requireToken(profile);

  let afterSeq = 0;
  let cycles = 0;
  let transportBlips = 0;
  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
  };
  process.once("SIGINT", onSigint);

  try {
    for (;;) {
      if (interrupted) {
        process.stderr.write(`\nStopped tailing. The run continues; cancel with: wk runs cancel ${runId}\n`);
        return 130;
      }

      const events = await executeTool(client, eventsDescriptor, { runId, afterSeq, limit: 200 }, { token });

      if (!isSuccess(events)) {
        // A 429 mid-tail is a pacing signal, not a failure: honor Retry-After and keep tailing.
        if (events.status === 429) {
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

      const body = events.data as { events?: RunEvent[] };
      for (const event of body.events ?? []) {
        if (typeof event.seq === "number" && event.seq > afterSeq) afterSeq = event.seq;
        const line =
          `${dim(sanitizeInline(event.atUtc ?? ""))} ${bold(sanitizeInline(event.kind ?? "event"))} ` +
          sanitizeInline(event.message ?? "");
        if (json) process.stdout.write(JSON.stringify(event) + "\n");
        else process.stdout.write(line.trim() + "\n");
      }

      cycles++;
      if (cycles % 3 === 0 || (body.events ?? []).length === 0) {
        const run = await executeTool(client, runDescriptor, { runId }, { token });
        if (isSuccess(run)) {
          const receipt = run.data as { status?: string; finalDigest?: string | null; ownerScore?: number | null };
          const status = sanitizeInline(receipt.status ?? "");
          if (TERMINAL_STATUSES.has(status)) {
            if (json) process.stdout.write(JSON.stringify(run.data) + "\n");
            else {
              process.stdout.write(`\n${bold("Run settled:")} ${paintRunStatus(status)}\n`);
              if (receipt.finalDigest) process.stdout.write(`${sanitizeText(String(receipt.finalDigest))}\n`);
            }
            return status === "succeeded" || status === "skipped" ? 0 : 1;
          }
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
