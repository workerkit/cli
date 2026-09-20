import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { byName } from "@workerkit/core";
import { mountTool, runTool, globalOpts } from "../bind.js";
import { readStdin } from "../input.js";
import { sanitizeText, sanitizeInline } from "../output/sanitize.js";
import { bold, yellow } from "../output/colors.js";

export function mountInstruction(program: Command): void {
  const instruction = program.command("instruction").description("A worker's job instruction");

  mountTool(instruction, "get", {
    tool: "instruction_get",
    positionals: ["tokenId"],
    summary: "Show the worker's instruction, or a decision worker's routing table and install questions (--options-for <key> lists an app pick's live values)",
    render: (data) => {
      const body = data as {
        content?: string;
        narration?: string;
        setup?: Array<{ key?: string; label?: string; answer?: unknown; type?: string }>;
        pendingSetup?: string[];
      };
      if (!body || typeof body !== "object") return null;
      // A language worker: the instruction text, as before.
      if (typeof body.content === "string") return sanitizeText(body.content);
      // A decision worker: the table as sentences, then the install questions and their answers.
      // pendingSetup blocks both deploy and run, so it is the line that must not be buried.
      if (typeof body.narration !== "string") return null;
      const lines = [sanitizeText(body.narration)];
      if (Array.isArray(body.setup) && body.setup.length > 0) {
        lines.push("", bold("Install questions"));
        for (const q of body.setup) {
          // Sanitize the server's value first, then colour it: sanitizeInline strips escape
          // sequences, so colouring before sanitizing would throw the colour away with them.
          const blank = q.answer === undefined || q.answer === null || q.answer === "";
          const answer = blank ? yellow("(unanswered)") : sanitizeInline(String(q.answer));
          lines.push(`  ${sanitizeInline(q.key ?? "?")}: ${answer}`);
        }
      }
      const pending = Array.isArray(body.pendingSetup) ? body.pendingSetup : [];
      if (pending.length > 0) {
        lines.push(
          "",
          yellow(`Pending: ${sanitizeInline(pending.join(", "))} — a pending question blocks deploy and run.`),
          `Answer them with \`wk instruction set <tokenId> --answers '{"key":"value"}'\`.`,
        );
      }
      return lines.join("\n");
    },
  });

  mountTool(instruction, "versions", {
    tool: "instruction_versions",
    positionals: ["tokenId"],
    summary: "The instruction's version history, newest first",
  });

  mountTool(instruction, "version", {
    tool: "instruction_version_get",
    positionals: ["tokenId", "versionNumber"],
    summary: "One earlier version's text (protected kits refuse)",
    render: (data) => {
      const body = data as { content?: string };
      if (body && typeof body.content === "string") return sanitizeText(body.content);
      return null;
    },
  });

  mountTool(instruction, "restore", {
    tool: "instruction_restore",
    positionals: ["tokenId", "versionNumber"],
    confirm: (p) => `Restore version ${p.versionNumber} of worker ${p.tokenId}'s instruction? (appends a new version; reversible)`,
    summary: "Roll the instruction back to an earlier version (appends a new version, so it is itself reversible)",
  });

  const set = instruction
    .command("set")
    .description("Replace the worker's instruction from --file or stdin, or answer a decision worker's install questions with --answers")
    .argument("<tokenId>")
    .option("--file <path>", "Read the instruction text from a file (otherwise stdin)")
    .option("--answers <json>", "Decision workers: install answers by question key (JSON object); '' clears one")
    .option("--job-sentence <text>", "One-line summary of the worker's job")
    .option("--when-to-use <text>", "When an orchestrator should pick this worker")
    .option("--description <text>", "Longer human description")
    .option("--memory-profile <stateless|contextual>", "Memory injection profile")
    .option("--self-facts-enabled", "Allow the worker to propose facts about itself");
  set.action(async (tokenId: string, options: Record<string, unknown>) => {
    const globals = globalOpts(set);
    const descriptor = byName("instruction_set");
    if (!descriptor) throw new Error("instruction_set descriptor missing");

    // Three ways to set a worker, and content is optional in all of them since core 0.3.3:
    //   --answers   a decision worker's install questions (mutually exclusive with content)
    //   --file/stdin  a language worker's instruction text
    //   metadata only  --job-sentence and friends, with no instruction resent at all
    const params: Record<string, unknown> = { tokenId: Number(tokenId) };
    const metadataOnly = ["jobSentence", "whenToUse", "description", "memoryProfile", "selfFactsEnabled"].some(
      (k) => options[k] !== undefined,
    );

    if (typeof options.answers === "string" && options.answers) {
      try {
        params.answers = JSON.parse(options.answers) as unknown;
      } catch {
        process.stderr.write("--answers must be a JSON object of question key to answer.\n");
        process.exitCode = 2;
        return;
      }
    } else if (typeof options.file === "string" && options.file) {
      params.content = readFileSync(options.file, "utf8");
    } else if (!process.stdin.isTTY) {
      // Piped instruction text, possibly alongside metadata flags. A closed stdin (CI, a cron
      // shell) reads as empty, which is not an instruction: drop it rather than sending "" and
      // failing a metadata-only edit that needs no text at all.
      const piped = await readStdin();
      if (piped) params.content = piped;
      else if (!metadataOnly) {
        process.stderr.write("Nothing on stdin. Pass the instruction via --file <path>, or a metadata flag such as --job-sentence.\n");
        process.exitCode = 2;
        return;
      }
    } else if (!metadataOnly) {
      // Nothing to send at all: no text, no answers, no metadata field.
      process.stderr.write(
        "Nothing to set. Pass the instruction via --file <path> or stdin, a decision worker's answers via --answers '{...}', or a metadata flag such as --job-sentence.\n",
      );
      process.exitCode = 2;
      return;
    }
    if (options.jobSentence !== undefined) params.jobSentence = options.jobSentence;
    if (options.whenToUse !== undefined) params.whenToUse = options.whenToUse;
    if (options.description !== undefined) params.description = options.description;
    if (options.memoryProfile !== undefined) params.memoryProfile = options.memoryProfile;
    if (options.selfFactsEnabled !== undefined) params.selfFactsEnabled = Boolean(options.selfFactsEnabled);

    await runTool(
      descriptor,
      { tool: "instruction_set", positionals: ["tokenId"], hidden: Object.keys(descriptor.schema).filter((k) => k !== "tokenId") },
      params,
      globals,
    );
  });
}
