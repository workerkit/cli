import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { byName } from "@workerkit/core";
import { mountTool, runTool, globalOpts } from "../bind.js";
import { readStdin } from "../input.js";
import { sanitizeText } from "../output/sanitize.js";

export function mountInstruction(program: Command): void {
  const instruction = program.command("instruction").description("A worker's job instruction");

  mountTool(instruction, "get", {
    tool: "instruction_get",
    positionals: ["tokenId"],
    summary: "Show the worker's instruction (protected kits serve a redacted form)",
    render: (data) => {
      const body = data as { content?: string };
      if (body && typeof body.content === "string") return sanitizeText(body.content);
      return null;
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
    .description("Replace the worker's instruction from --file or stdin")
    .argument("<tokenId>")
    .option("--file <path>", "Read the instruction text from a file (otherwise stdin)")
    .option("--job-sentence <text>", "One-line summary of the worker's job")
    .option("--when-to-use <text>", "When an orchestrator should pick this worker")
    .option("--description <text>", "Longer human description")
    .option("--memory-profile <stateless|contextual>", "Memory injection profile")
    .option("--self-facts-enabled", "Allow the worker to propose facts about itself");
  set.action(async (tokenId: string, options: Record<string, unknown>) => {
    const globals = globalOpts(set);
    const descriptor = byName("instruction_set");
    if (!descriptor) throw new Error("instruction_set descriptor missing");

    let content: string;
    if (typeof options.file === "string" && options.file) {
      content = readFileSync(options.file, "utf8");
    } else if (!process.stdin.isTTY) {
      content = await readStdin();
    } else {
      process.stderr.write("Provide the instruction via --file <path> or pipe it on stdin.\n");
      process.exitCode = 2;
      return;
    }

    const params: Record<string, unknown> = { tokenId: Number(tokenId), content };
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
