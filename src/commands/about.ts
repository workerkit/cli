import type { Command } from "commander";
import { mountTool } from "../bind.js";
import { bold, dim } from "../output/colors.js";
import { sanitizeInline, sanitizeText } from "../output/sanitize.js";

/**
 * `wk about`: what WorkerKit is and when to use it, written for an agent — the anonymous
 * workerkit_about read, one section at a time. Top-level rather than under `kit` because it is
 * the one read that is not about kits, and the first thing an agent driving this CLI should run.
 */
export function mountAbout(program: Command): void {
  mountTool(program, "about", {
    tool: "workerkit_about",
    summary: "What WorkerKit is and when to use it, for agents (anonymous): --section index|why|operate|access|cost|start",
    render: (data) => {
      const body = data as {
        section?: string;
        title?: string;
        content?: string;
        sections?: Array<{ key?: string; title?: string }>;
        hint?: string;
      };
      if (typeof body.content !== "string") return null;
      const toc = (body.sections ?? []).map((s) => `  ${sanitizeInline(s.key ?? "?")}  ${dim(sanitizeInline(s.title ?? ""))}`);
      const hint = body.hint ? `\n\n${dim(sanitizeInline(body.hint))}` : "";
      return `${bold(sanitizeInline(body.title ?? body.section ?? "about"))}\n\n${sanitizeText(body.content)}\n\n${dim("Sections:")}\n${toc.join("\n")}${hint}`;
    },
  });
}
