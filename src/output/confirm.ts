import { createInterface } from "node:readline";
import { bold } from "./colors.js";

/**
 * Destructive-action confirmation. `--yes` bypasses; a non-TTY without `--yes` refuses with exit
 * code 2 so scripts fail loudly instead of hanging on a prompt nobody will answer.
 */
export async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(`Refusing without confirmation in a non-interactive session. Pass --yes to proceed.\n`);
    process.exitCode = 2;
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(`${bold(question)} [y/N] `, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** Hidden input for `wk auth login --key` — the key must not echo. */
export async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // Piped input: read a single line from stdin (scripting path).
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8").split(/\r?\n/, 1)[0]?.trim() ?? "";
  }

  process.stdout.write(question);
  return new Promise<string>((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    let value = "";
    const finish = () => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(value.trim());
    };
    const onData = (data: Buffer) => {
      const code = data[0] ?? 0;
      if (code === 3) {
        // Ctrl-C
        stdin.setRawMode?.(false);
        process.stdout.write("\n");
        process.exit(130);
      }
      if (code === 127 || code === 8) {
        // Backspace / DEL
        value = value.slice(0, -1);
        return;
      }
      if (code === 27) return; // ESC-prefixed sequences (arrows, function keys) — ignore whole chunk
      // Manager keys are ASCII; chunk-level classification by the first byte is deliberate. A
      // paste arrives as one chunk and may carry its own newline — accept up to it and finish.
      const text = data.toString("utf8");
      const newlineAt = text.search(/[\r\n]/);
      if (newlineAt >= 0) {
        if (code >= 32) value += text.slice(0, newlineAt);
        finish();
        return;
      }
      if (code >= 32) value += text;
    };
    stdin.on("data", onData);
  });
}
