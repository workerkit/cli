import { Command } from "commander";
import { cliVersion } from "./version.js";
import { mountAuth } from "./commands/auth.js";
import { mountWorkers } from "./commands/workers.js";
import { mountRun } from "./commands/run.js";
import { mountRuns } from "./commands/runs.js";
import { mountMemory } from "./commands/memory.js";
import { mountSchedules } from "./commands/schedules.js";
import { mountInstruction } from "./commands/instruction.js";
import { mountKit, mountPublisher } from "./commands/kit.js";
import { mountUpdate } from "./commands/update.js";

export function buildProgram(): Command {
  const program = new Command("wk");
  program
    .description("WorkerKit CLI: manage AI workers and browse the kit directory")
    .version(cliVersion(), "-v, --version")
    .option("--json", "Machine output: the raw API data, byte-faithful, on stdout")
    .option("--plain", "Compact text output with agent guidance footers")
    .option("-y, --yes", "Skip confirmation prompts")
    .option("--profile <name>", "Use a specific stored profile")
    .configureOutput({
      // Usage errors go to stderr; exit code 2 via exitOverride below.
      outputError: (str, write) => write(str),
    });

  program.exitOverride((err) => {
    // commander uses specific codes; normalize usage errors to 2, help/version to 0.
    if (err.code === "commander.helpDisplayed" || err.code === "commander.version" || err.code === "commander.help") {
      process.exit(0);
    }
    process.exit(2);
  });

  mountAuth(program);
  mountWorkers(program);
  mountRun(program);
  mountRuns(program);
  mountMemory(program);
  mountSchedules(program);
  mountInstruction(program);
  mountKit(program);
  mountPublisher(program);
  mountUpdate(program);

  return program;
}
