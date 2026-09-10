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
