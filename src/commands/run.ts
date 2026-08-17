import type { Command } from "commander";
import { byName } from "@workerkit/core";
import { runTool, globalOpts } from "../bind.js";
import { tailRun } from "./runs.js";
import { bold, yellow } from "../output/colors.js";
import { sanitizeInline } from "../output/sanitize.js";

/**
 * `wk run <tokenId>` — the marquee verb. POST worker_run, print the receipt, and with --follow
 * hand off to the tail loop. A policy-skipped run is HTTP 200 with status "skipped"/"Skipped": a
 * receipt, not an error — exit 0 and say why (agents branch on --json).
 */
export function mountRun(program: Command): void {
  const cmd = program
    .command("run")
    .description("Trigger a worker to run now")
    .argument("<tokenId>")
    .option("-p, --prompt <text>", "Extra instruction for this run only (<=8000 chars)")
    .option("--model <slug>", "Override the model for this run")
    .option("-f, --follow", "Stay attached and stream the run's events until it settles");

  cmd.action(async (tokenId: string, options: { prompt?: string; model?: string; follow?: boolean }) => {
    const globals = globalOpts(cmd);
    const descriptor = byName("worker_run");
    if (!descriptor) throw new Error("worker_run descriptor missing");

    const params: Record<string, unknown> = { tokenId: Number(tokenId) };
    if (options.prompt !== undefined) params.prompt = options.prompt;
    if (options.model !== undefined) params.modelSlug = options.model;

    // Suppress default rendering only when following (we print the receipt ourselves either way
    // via emitResult; --follow needs the runId from the result).
    const result = await runTool(
      descriptor,
      {
        tool: "worker_run",
        positionals: ["tokenId"],
        hidden: ["prompt", "modelSlug"],
        render: (data) => {
          const receipt = data as { runId?: string; status?: string; skipReason?: string | null };
          if (!receipt || typeof receipt !== "object") return null;
          const status = String(receipt.status ?? "");
          if (status.toLowerCase() === "skipped") {
            return `${yellow("Run skipped:")} ${sanitizeInline(String(receipt.skipReason ?? "policy"))}`;
          }
          return `${bold("Run started:")} ${receipt.runId ?? "?"} (${status || "pending"})`;
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
