import { Argument, type Command } from "commander";
import { allDescriptors, byName, instructionsByProfile, toolDocumentation, type ToolProfile } from "@workerkit/core";
import { addToolHelp, toolCommandPaths, formatToolReferences, firstSentence } from "../bind.js";
import { bespokeCommandBindings } from "./bindings.js";

/** Offline guidance: never loads credentials or makes an API request. */
export function mountGuidance(program: Command): void {
  const bespokeHelp: Record<string, string[]> = {};
  for (const [tool, binding] of Object.entries(bespokeCommandBindings)) (bespokeHelp[binding.path] ??= []).push(tool);
  for (const [path, tools] of Object.entries(bespokeHelp)) {
    let command = program;
    for (const part of path.split(" ")) {
      const child = command.commands.find(c => c.name() === part);
      if (!child) throw new Error(`Missing command for canonical help: ${path}`);
      command = child;
    }
    addToolHelp(command, tools, true, Object.fromEntries(tools.map(tool => [tool, bespokeCommandBindings[tool]!.suffix ?? ""])));
    const primary = tools.find(tool => !bespokeCommandBindings[tool]!.suffix) ?? tools[0]!;
    command.description(firstSentence(byName(primary)!.description));
  }
  program.command("instructions")
    .description("Read the agent rules for a WorkerKit surface without connecting")
    .addArgument(new Argument("[surface]", "Tool surface").choices(["workers", "decision", "directory"]).default("workers"))
    .action((surface: ToolProfile) => {
      const instructions = instructionsByProfile[surface];
      process.stdout.write(program.opts().json ? JSON.stringify({ surface, instructions }) + "\n" : formatToolReferences(instructions, program) + "\n");
    });

  const tools = program.command("tools").description("Read the local tool catalog and complete tool guidance");
  tools.command("list").description("List all tool names and titles without connecting")
    .action(() => {
      const paths = toolCommandPaths(program);
      const rows = allDescriptors.map(d => ({ name: d.name, title: d.title, commands: paths[d.name] ?? [] }));
      process.stdout.write(program.opts().json ? JSON.stringify(rows) + "\n"
        : rows.map(row => `${row.name}\t${row.commands.join(" / ")}\t${row.title}`).join("\n") + "\n");
    });
  tools.command("describe <name>").description("Read complete tool and input guidance without connecting")
    .action((name: string) => {
      const descriptor = byName(name);
      if (!descriptor) {
        process.stderr.write("Unknown tool. Run wk tools list for valid names.\n");
        process.exitCode = 2;
        return;
      }
      const commands = toolCommandPaths(program)[name] ?? [];
      const inputs = Object.fromEntries(Object.entries(descriptor.schema).map(([key, field]) => [key, field.description ?? ""]));
      if (program.opts().json) {
        process.stdout.write(JSON.stringify({ name, commands, description: toolDocumentation(descriptor), inputs }) + "\n");
        return;
      }
      process.stdout.write(`${descriptor.name}: ${descriptor.title}\n${commands.join(" / ")}\n\n${formatToolReferences(toolDocumentation(descriptor), program)}\n`);
      for (const [key, field] of Object.entries(descriptor.schema))
        process.stdout.write(`\n${key}: ${formatToolReferences(field.description ?? "See the command's flags for the accepted type.", program)}\n`);
    });
}
