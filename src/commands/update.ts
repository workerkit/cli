import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import { cliVersion } from "../version.js";
import { bold } from "../output/colors.js";
import { confirm } from "../output/confirm.js";
import { globalOpts } from "../bind.js";

type InstallMethod = "brew" | "npm" | "unknown";

function detectInstallMethod(): InstallMethod {
  const self = process.argv[1] ?? "";
  const lowered = self.toLowerCase().replace(/\\/g, "/");
  if (lowered.includes("/cellar/") || lowered.includes("/homebrew/")) return "brew";
  if (lowered.includes("/node_modules/")) return "npm";
  return "unknown";
}

export function mountUpdate(program: Command): void {
  const update = program
    .command("update")
    .description("Update wk to the latest release")
    .option("--check", "Only report how this install would be updated");
  update.action(async (options: { check?: boolean }) => {
    const globals = globalOpts(update);
    const method = detectInstallMethod();
    const command =
      method === "brew"
        ? ["brew", "upgrade", "workerkit/tap/wk-cli"]
        : ["npm", "install", "-g", "@workerkit/cli@latest"];

    process.stdout.write(`Current version: ${cliVersion()}\n`);
    if (method === "unknown") {
      // npm only: the Homebrew tap does not exist yet, so naming it here would print a command
      // that fails. The brew branch above stays for when the tap ships.
      process.stdout.write(`Install method not detected. Update with:\n  npm install -g @workerkit/cli@latest\n`);
      return;
    }

    process.stdout.write(`Detected install method: ${method}\nUpdate command: ${bold(command.join(" "))}\n`);
    if (options.check) return;

    if (!(await confirm("Run it now?", globals.yes))) return;

    const executable = command[0];
    if (!executable) return;
    const run = spawnSync(executable, command.slice(1), { stdio: "inherit", shell: process.platform === "win32" });
    process.exitCode = run.status ?? 1;
  });
}
