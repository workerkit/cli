import type { Command } from "commander";
import { byName, executeTool, isSuccess } from "@workerkit/core";
import { runTool, globalOpts } from "../bind.js";
import { buildClient, requireToken, type GlobalOpts } from "../context.js";
import { tailRun } from "./runs.js";
import { bold, yellow } from "../output/colors.js";
import { confirm } from "../output/confirm.js";
import { sanitizeInline } from "../output/sanitize.js";

/**
 * `wk run <tokenId>` — the marquee verb. POST worker_run, print the receipt, and with --follow
 * hand off to the tail loop. A policy-skipped run is HTTP 200 with status "skipped"/"Skipped": a
 * receipt, not an error — exit 0 and say why (agents branch on --json).
 *
 * A decision worker runs its routing table here too, and acts on every item it routes:
 * --source-args narrows what is decided about, --max-items caps it, and --wait-seconds waits for
 * the settled receipt and its per-item decisions.
 */

interface DecisionRow {
  route?: string;
  executed?: boolean;
  ok?: boolean;
}

interface DecisionBlock {
  mode?: "item" | "corpus";
  aboveFloorPercent?: number;
  counts?: { fetched: number; submitted: number; returned: number; omitted: number; notAttempted: number };
  source?: { state?: string; complete?: boolean | null; hasMore?: boolean };
  outcome?: string;
  confidence?: number;
  model?: string;
  answersOverride?: Record<string, unknown> | null;
  decisions?: DecisionRow[];
  openQuestions?: unknown[];
  contentWithheld?: boolean;
}

/**
 * Is this a LIVE decision worker — one whose routing table acts on every item it routes?
 *
 * The flags cannot answer it. --wait-seconds is model-agnostic, so keying off it both nagged
 * language workers and (in a non-TTY, where confirm refuses) broke them; and the invocation that
 * acts on the most items is the bare `wk run <tokenId>`, which carries no flag at all. So ask the
 * worker what it is: modelType is the field core points at for exactly this.
 *
 * Fail-open. A key without readWorkers, a 404, or a dead network must not break `wk run`: the
 * server still refuses mismatched flags (409 not_language_worker / not_decision_worker), so a
 * missed prompt costs a prompt.
 */
async function isDecisionWorker(tokenId: number, globals: GlobalOpts): Promise<boolean> {
  const descriptor = byName("worker_get");
  if (!descriptor) return false;
  try {
    const token = await requireToken(globals.profile);
    const result = await executeTool(buildClient(), descriptor, { tokenId }, { token });
    if (!isSuccess(result)) return false;
    return (result.data as { modelType?: string } | null)?.modelType === "decision";
  } catch {
    return false;
  }
}

/** The settled receipt's decision block, as a few lines rather than a JSON dump. */
function renderDecision(block: DecisionBlock): string[] {
  if (block.contentWithheld) {
    return [yellow("Decision rows withheld: this key lacks the readRuns scope.")];
  }
  const lines: string[] = [];
  if (typeof block.outcome === "string") lines.push(`${bold("Decision:")} ${sanitizeInline(block.outcome)}`);
  const floor = block.aboveFloorPercent ?? block.confidence;
  if (typeof floor === "number") lines.push(`Above floor: ${floor}% of judged items`);
  if (block.counts) lines.push(`${block.counts.submitted}/${block.counts.fetched} submitted; ${block.counts.notAttempted} not attempted; ${block.counts.returned} rows shown, ${block.counts.omitted} omitted.`);
  if (block.source) lines.push(`Source: ${sanitizeInline(block.source.state ?? "unknown")}; coverage ${block.source.complete === true ? "complete" : block.source.complete === false ? "partial" : "unknown"}${block.source.hasMore ? "; more data available" : ""}.`);

  const rows = Array.isArray(block.decisions) ? block.decisions : [];
  if (rows.length > 0) {
    const acted = rows.filter((r) => r.executed).length;
    const failed = rows.filter((r) => r.executed && r.ok === false).length;
    const belowFloor = rows.filter((r) => r.route === "below_floor").length;
    const parts = [`${rows.length} ${block.mode === "corpus" ? "finalist" : "result"} rows shown`];
    if (acted > 0) parts.push(`${acted} acted on`);
    if (belowFloor > 0) parts.push(`${belowFloor} below the floor`);
    if (failed > 0) parts.push(yellow(`${failed} failed`));
    lines.push(`Items: ${parts.join(", ")}`);
  }

  // The per-run answers the run was actually minted with: the receipt is where a caller confirms
  // an override landed, rather than assuming it did.
  const override = block.answersOverride;
  if (override && typeof override === "object" && Object.keys(override).length > 0) {
    lines.push(`Per-run answers applied: ${sanitizeInline(Object.keys(override).join(", "))}`);
  }
  if (typeof block.model === "string") lines.push(`Decision model: ${sanitizeInline(block.model)}`);

  const open = Array.isArray(block.openQuestions) ? block.openQuestions.length : 0;
  if (open > 0) lines.push(yellow(`${open} open question(s) for a person to look at.`));
  if (lines.length > 0) lines.push("Per-item rows: `wk runs get <runId> --json`.");
  return lines;
}

export function mountRun(program: Command): void {
  const cmd = program
    .command("run")
    .description("Trigger a worker to run now")
    .argument("<tokenId>")
    .option("-p, --prompt <text>", "Language workers: extra instruction for this run only (<=8000 chars)")
    .option("--model <slug>", "Language workers: override the model for this run")
    .option("--source-args <json>", "Decision workers: narrow what is decided about (JSON object, merged over the spec's source args)")
    .option("--answers <json>", "Decision workers: per-run answers to the install questions (JSON object of key → value, laid over the stored answers for this run only)")
    .option("--max-items <n>", "Decision workers: judge at most this many items this run")
    .option("--wait-seconds <n>", "Wait up to N seconds (max 55) for the settled receipt instead of returning the freshly minted one")
    .option("-f, --follow", "Stay attached and stream the run's events until it settles");

  cmd.action(async (tokenId: string, options: {
    prompt?: string; model?: string; follow?: boolean;
    sourceArgs?: string; answers?: string; maxItems?: string; waitSeconds?: string;
  }) => {
    const globals = globalOpts(cmd);
    const descriptor = byName("worker_run");
    if (!descriptor) throw new Error("worker_run descriptor missing");

    const params: Record<string, unknown> = { tokenId: Number(tokenId) };
    if (options.prompt !== undefined) params.prompt = options.prompt;
    if (options.model !== undefined) params.modelSlug = options.model;
    if (options.maxItems !== undefined) params.maxItems = Number(options.maxItems);
    if (options.waitSeconds !== undefined) params.waitSeconds = Number(options.waitSeconds);
    if (options.sourceArgs !== undefined) {
      try {
        params.sourceArgs = JSON.parse(options.sourceArgs) as unknown;
      } catch {
        process.stderr.write("--source-args must be a JSON object.\n");
        process.exitCode = 2;
        return;
      }
    }
    if (options.answers !== undefined) {
      try {
        params.answers = JSON.parse(options.answers) as unknown;
      } catch {
        process.stderr.write("--answers must be a JSON object of key → value.\n");
        process.exitCode = 2;
        return;
      }
    }

    // A decision worker acts on every item its table routes. Ask before that, and skip the
    // lookup only where it could change nothing: --prompt/--model are language-only (the server
    // 409s them on a decision worker), and --yes is a standing yes.
    const couldAct = options.prompt === undefined && options.model === undefined && !globals.yes;
    if (couldAct && (await isDecisionWorker(Number(tokenId), globals))) {
      const question = `Run decision worker ${tokenId}? Its routing table acts on every item it routes.`;
      if (!(await confirm(question, globals.yes))) {
        if (!process.exitCode) process.exitCode = 2;
        return;
      }
    }

    // Suppress default rendering only when following (we print the receipt ourselves either way
    // via emitResult; --follow needs the runId from the result).
    const result = await runTool(
      descriptor,
      {
        tool: "worker_run",
        positionals: ["tokenId"],
        hidden: ["prompt", "modelSlug", "sourceArgs", "answers", "maxItems", "waitSeconds"],
        render: (data) => {
          const receipt = data as {
            runId?: string;
            status?: string;
            skipReason?: string | null;
            decision?: DecisionBlock | null;
          };
          if (!receipt || typeof receipt !== "object") return null;
          const status = String(receipt.status ?? "");
          if (status.toLowerCase() === "skipped") {
            return `${yellow("Run skipped:")} ${sanitizeInline(String(receipt.skipReason ?? "policy"))}`;
          }
          const verb = options.waitSeconds === undefined ? "Run started:" : "Run:";
          const lines = [`${bold(verb)} ${receipt.runId ?? "?"} (${status || "pending"})`];
          // A waited run answers the SETTLED receipt, decisions and all — the point of
          // --wait-seconds is what it decided, not the id it was given.
          if (receipt.decision && typeof receipt.decision === "object") {
            lines.push(...renderDecision(receipt.decision));
          }
          return lines.join("\n");
        },
      },
      params,
      globals,
    );

    if (!result || result.status < 200 || result.status >= 300) return;

    const receipt = result.data as { runId?: string; status?: string };
    const status = String(receipt?.status ?? "").toLowerCase();
    if (status === "skipped") return; // receipt delivered, exit 0

    if (options.follow && receipt?.runId) {
      process.exitCode = await tailRun(receipt.runId, globals.json, globals.profile);
    }
  });
}
