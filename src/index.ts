#!/usr/bin/env node
import { buildProgram } from "./program.js";
import { maybeNudgeUpdate } from "./updateCheck.js";
import { closeClients } from "./context.js";
import { scrubSecrets } from "@workerkit/core";
import { sanitizeInline } from "./output/sanitize.js";

// A closed pipe (`wk ... | head`) is normal termination, not a crash.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

process.on("SIGINT", () => {
  // Command-specific listeners manage their own shutdown; the default was registered first.
  if (process.listenerCount("SIGINT") === 1) process.exit(130);
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
    process.stderr.write(`${sanitizeInline(scrubSecrets(err.message ?? String(error)))}\n`);
    process.exitCode = 1;
  } finally {
    await closeClients();
  }

  const opts = program.opts<{ json?: boolean; plain?: boolean }>();
  if (!opts.json && !opts.plain) await maybeNudgeUpdate();
}

void main();
