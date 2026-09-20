import type { Command } from "commander";
import { byName, executeTool, isSuccess } from "@workerkit/core";
import { globalOpts, mountTool } from "../bind.js";
import { buildClient } from "../context.js";
import { runAgentLogin, type AgentLoginOptions } from "../auth/agent-login-command.js";
import {
  ENV_KEY,
  deleteCredential,
  envKeyActive,
  readConfig,
  resolveCredential,
  storeCredential,
  writeConfig,
} from "../auth/store.js";
import { dim, green } from "../output/colors.js";
import { promptHidden } from "../input.js";
import { sanitizeInline } from "../output/sanitize.js";

const KEY_PREFIX = "pe_mgr_";

export function mountAuth(program: Command): void {
  const auth = program.command("auth").description("Sign in, inspect and switch profiles");

  mountTool(auth, "key-info", {
    tool: "key_info",
    summary: "What the current key is: account, scopes (exactly what the other commands will accept), expiry",
  });

  const login = auth
    .command("login")
    .description("Sign in via the browser (an account admin approves), or paste a key with --key")
    .option("--key", "Paste a manager key minted in the dashboard instead of using the browser")
    .option("--name <profile>", "Profile name to store the credential under", "default")
    .option("--scopes <list>", "Comma-separated scopes to request (prefill for the approver)")
    .option("--start", "Start a resumable login and return immediately")
    .option("--resume", "Check the saved request once and collect an approved credential")
    .option("--cancel", "Cancel the saved request and revoke its uncollected credential")
    .option("--email <address>", "Email the approval link to the person (code stays with this client)")
    .option("--no-browser", "Print the URL instead of opening a browser (SSH, containers, CI)");
  login.action(async (options: AgentLoginOptions & { key?: boolean }) => {
    if (envKeyActive()) {
      process.stderr.write(`${ENV_KEY} is set — unset it to manage stored profiles.\n`);
      process.exitCode = 2;
      return;
    }

    const modes = [options.start, options.resume, options.cancel].filter(Boolean).length;
    if (modes > 1) {
      process.stderr.write("Choose only one of --start, --resume, or --cancel.\n");
      process.exitCode = 2;
      return;
    }
    if (options.key && (modes > 0 || options.email !== undefined)) {
      process.stderr.write("--key cannot be combined with --start, --resume, --cancel, or --email.\n");
      process.exitCode = 2;
      return;
    }
    if (options.cancel && options.email !== undefined) {
      process.stderr.write("--email cannot be combined with --cancel.\n");
      process.exitCode = 2;
      return;
    }

    let managerKey: string;

    if (options.key) {
      const pasted = await promptHidden("Manager key (input hidden): ");
      if (!pasted.startsWith(KEY_PREFIX)) {
        process.stderr.write(`That doesn't look like a manager key (expected ${KEY_PREFIX}…).\n`);
        process.exitCode = 2;
        return;
      }
      managerKey = pasted;
    } else {
      try {
        await runAgentLogin(options, !!globalOpts(auth).json);
      } catch (error) {
        process.stderr.write(sanitizeInline((error as Error).message) + "\n");
        process.exitCode = 1;
      }
      return;
    }

    // Key introspection works with every valid scope combination.
    const descriptor = byName("key_info");
    if (descriptor) {
      const check = await executeTool(buildClient(), descriptor, {}, { token: managerKey });
      if (!isSuccess(check)) {
        process.stderr.write(
          check.status === 401
            ? "That key was not accepted by the server (invalid or revoked).\n"
            : `Could not verify the key (HTTP ${check.status}). It was NOT saved.\n`,
        );
        process.exitCode = check.status === 401 ? 3 : 1;
        return;
      }
    }

    const storage = await storeCredential(options.name, managerKey);
    process.stdout.write(
      `${green("Signed in.")} Key saved to ${storage} ` +
        `(profile "${sanitizeInline(options.name)}").\n`,
    );
  });

  auth
    .command("status")
    .description("Which credential would be used, and whether it works")
    .action(async () => {
      const globals = globalOpts(auth);
      const cred = await resolveCredential(globals.profile);
      if (!cred) {
        process.stdout.write(
          globals.json
            ? JSON.stringify({ status: "signed_out" }) + "\n"
            : "Not signed in. Run `wk auth login`.\n",
        );
        process.exitCode = 3;
        return;
      }
      if (!globals.json) {
        process.stdout.write(
          `Credential source: ${cred.source}` +
            `${cred.profile ? ` (profile "${sanitizeInline(cred.profile)}")` : ""}\n`,
        );
      }
      const descriptor = byName("key_info");
      if (descriptor) {
        const check = await executeTool(buildClient(), descriptor, {}, { token: cred.key });
        if (globals.json) {
          process.stdout.write(JSON.stringify({
            status: isSuccess(check) ? "signed_in" : "unavailable",
            source: cred.source,
            profile: cred.profile,
            httpStatus: check.status,
            ...(isSuccess(check) ? { keyInfo: check.data } : {}),
          }) + "\n");
          if (!isSuccess(check)) process.exitCode = check.status === 401 || check.status === 403 ? 3 : 1;
          return;
        }
        if (isSuccess(check)) {
          process.stdout.write(`${green("Key is valid.")}\n`);
        } else {
          process.stdout.write(`Key check failed (HTTP ${check.status}).\n`);
          process.exitCode = check.status === 401 || check.status === 403 ? 3 : 1;
        }
      }
    });

  auth
    .command("logout")
    .description("Remove the stored credential for the active (or --profile) profile")
    .action(async () => {
      if (envKeyActive()) {
        process.stderr.write(`${ENV_KEY} is set — unset it instead; there is no stored profile to remove.\n`);
        process.exitCode = 2;
        return;
      }
      const globals = globalOpts(auth);
      const config = readConfig();
      const name = globals.profile ?? config.activeProfile;
      if (!name || !config.profiles[name]) {
        process.stdout.write("No stored profile to remove.\n");
        return;
      }
      await deleteCredential(name);
      process.stdout.write(`Removed profile "${sanitizeInline(name)}". The key itself remains valid until revoked in the dashboard.\n`);
    });

  auth
    .command("profiles")
    .description("List stored profiles")
    .action(() => {
      const config = readConfig();
      const names = Object.keys(config.profiles);
      if (names.length === 0) {
        process.stdout.write("No profiles. Run `wk auth login`.\n");
        return;
      }
      for (const name of names) {
        const marker = name === config.activeProfile ? "* " : "  ";
        process.stdout.write(`${marker}${sanitizeInline(name)} (${config.profiles[name]?.storage})\n`);
      }
      if (envKeyActive()) process.stdout.write(dim(`\n${ENV_KEY} is set and overrides all profiles.\n`));
    });

  auth
    .command("use")
    .description("Switch the active profile")
    .argument("<name>")
    .action((name: string) => {
      if (envKeyActive()) {
        process.stderr.write(`${ENV_KEY} is set — it overrides profiles; unset it first.\n`);
        process.exitCode = 2;
        return;
      }
      const config = readConfig();
      if (!config.profiles[name]) {
        process.stderr.write(`No profile "${sanitizeInline(name)}". See \`wk auth profiles\`.\n`);
        process.exitCode = 2;
        return;
      }
      config.activeProfile = name;
      writeConfig(config);
      process.stdout.write(`Active profile: ${sanitizeInline(name)}\n`);
    });
}
