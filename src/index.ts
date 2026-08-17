#!/usr/bin/env node
import { buildProgram } from "./program.js";
import { maybeNudgeUpdate } from "./updateCheck.js";

// A closed pipe (`wk ... | head`) is normal termination, not a crash.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

process.on("SIGINT", () => {
  // Commands that handle SIGINT themselves (login, tail) register earlier `once` listeners and
  // manage their own shutdown; this is the default for everything else.
  process.exit(130);
});

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const err = error as { code?: string; message?: string };
    if (typeof err.code === "string" && err.code.startsWith("commander.")) {
      // exitOverride already set the exit code.
      return;
    }
    process.stderr.write(`${err.message ?? String(error)}\n`);
    process.exitCode = 1;
  }

  const opts = program.opts<{ json?: boolean; plain?: boolean }>();
  if (!opts.json && !opts.plain) await maybeNudgeUpdate();
}

void main();
