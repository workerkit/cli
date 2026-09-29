import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { byName, executeTool, isSuccess, z } from "@workerkit/core";
import { mountTool, globalOpts } from "../bind.js";
import { buildClient, requireToken } from "../context.js";
import { parseJsonObject, readStdin } from "../input.js";
import { renderApiError } from "../errors.js";
import { sanitizeText } from "../output/sanitize.js";

export function mountDecision(program: Command): void {
  const decision = program.command("decision").description("Discover sources and create typed classification workers");
  mountTool(decision, "set", {
    tool: "worker_decision_set", positionals: ["tokenId"],
    summary: "Attach or replace a classifier with --decision-spec JSON --answers JSON --updated-at timestamp (null when attaching); --decision-spec null removes it",
  });
  mountTool(decision, "sources", { tool: "kit_app_tools", fixed: { purpose: "decision" }, hidden: ["purpose"], summary: "Classification source recipes, schemas, permissions and creation examples" });
  mountTool(decision, "guide", { tool: "kit_authoring_guide", fixed: { section: "decision" }, hidden: ["section"], summary: "How to create, run and adjust a decision worker", render: data => {
    const body = data as { content?: string };
    return body.content ? sanitizeText(body.content) : null;
  } });
  decision.command("create").description("Create a private kit and worker from JSON; optional deploy, never runs")
    .option("--file <path>", "Creation request JSON; otherwise read stdin")
    .action(async (options, cmd: Command) => {
      const globals = globalOpts(cmd);
      const raw = options.file ? readFileSync(options.file, "utf8") : !process.stdin.isTTY ? await readStdin() : null;
      if (raw === null) { process.stderr.write("Provide --file <path> or pipe a decision request on stdin. See wk decision sources.\n"); process.exitCode = 2; return; }
      const body = parseJsonObject(raw, "decision worker request");
      if (!body) return;
      const descriptor = byName("decision_worker_create")!;
      const parsed = z.object(descriptor.schema).strict().safeParse(body);
      if (!parsed.success) { process.stderr.write(parsed.error.message + "\n"); process.exitCode = 2; return; }
      const token = await requireToken(globals.profile);
      const result = await executeTool(buildClient(), descriptor, parsed.data, { token });
      if (!isSuccess(result)) { process.exitCode = renderApiError(result, globals.json); return; }
      const text = JSON.stringify(result.data, null, 2);
      process.stdout.write((globals.json ? text : sanitizeText(text)) + "\n");
    });
}
