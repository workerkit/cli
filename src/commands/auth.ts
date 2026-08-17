import type { Command } from "commander";
import { byName, executeTool, isSuccess } from "@workerkit/core";
import { globalOpts } from "../bind.js";
import { apiBaseUrl, buildClient } from "../context.js";
import { startLogin, pollForKey, openBrowser } from "../auth/login.js";
import {
  ENV_KEY,
  deleteCredential,
  envKeyActive,
  readConfig,
  resolveCredential,
  storeCredential,
  writeConfig,
} from "../auth/store.js";
import { bold, cyan, dim, green } from "../output/colors.js";
import { promptHidden } from "../output/confirm.js";
import { sanitizeInline } from "../output/sanitize.js";

const KEY_PREFIX = "pe_mgr_";

export function mountAuth(program: Command): void {
  const auth = program.command("auth").description("Sign in, inspect and switch profiles");

  const login = auth
    .command("login")
    .description("Sign in via the browser (an account admin approves), or paste a key with --key")
    .option("--key", "Paste a manager key minted in the dashboard instead of using the browser")
    .option("--name <profile>", "Profile name to store the credential under", "default")
    .option("--scopes <list>", "Comma-separated scopes to request (prefill for the approver)")
    .option("--no-browser", "Print the URL instead of opening a browser (SSH, containers, CI)");
  login.action(async (options: { key?: boolean; name: string; scopes?: string; browser?: boolean }) => {
    if (envKeyActive()) {
      process.stderr.write(`${ENV_KEY} is set — unset it to manage stored profiles.\n`);
      process.exitCode = 2;
      return;
    }

    let managerKey: string;
    let keyLabel = "";

    if (options.key) {
      const pasted = await promptHidden("Manager key (input hidden): ");
      if (!pasted.startsWith(KEY_PREFIX)) {
        process.stderr.write(`That doesn't look like a manager key (expected ${KEY_PREFIX}…).\n`);
        process.exitCode = 2;
        return;
      }
      managerKey = pasted;
    } else {
      const controller = new AbortController();
      const onSigint = () => controller.abort();
      process.once("SIGINT", onSigint);
      try {
        const endpoints = { apiBaseUrl: apiBaseUrl() };
        const requestedScopes = options.scopes
          ? options.scopes.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined;
        const start = await startLogin(endpoints, { requestedScopes, signal: controller.signal });

        process.stdout.write(`\nOpen ${cyan(sanitizeInline(start.loginUrl))}\n`);
        if (start.userCode) {
          process.stdout.write(`\nWhen asked, enter this code:\n\n    ${bold(sanitizeInline(start.userCode))}\n\n`);
          process.stdout.write(dim("Only approve this login if you started it yourself.\n"));
        }
        // Opening a browser is wrong on a headless box, and the URL above is always printed, so
        // it stays the fallback rather than the only path.
        const wantsBrowser = options.browser !== false && !process.env.CI && !process.env.WK_NO_BROWSER;
        if (wantsBrowser) openBrowser(start.loginUrl);
        process.stdout.write("Waiting for approval… (Ctrl-C to cancel)\n");

        const result = await pollForKey(endpoints, start, controller.signal);
        managerKey = result.managerKey;
        keyLabel = result.keyName ?? "";
        if (result.scopes && result.scopes.length > 0) {
          process.stdout.write(`Granted scopes: ${sanitizeInline(result.scopes.join(", "))}\n`);
        }
      } catch (error) {
        const err = error as Error;
        if (err.name === "AbortError") {
          process.stderr.write("\nLogin cancelled.\n");
          process.exitCode = 130;
        } else {
          process.stderr.write(`\n${err.message}\n`);
          process.exitCode = 1;
        }
        return;
      } finally {
        process.removeListener("SIGINT", onSigint);
      }
    }

    // Verify before persisting: one workers_list call proves the key is live.
    const descriptor = byName("workers_list");
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
    const label = sanitizeInline(keyLabel);
    process.stdout.write(
      `${green("Signed in.")} ${label ? `Key "${label}" ` : "Key "}saved to ${storage} ` +
        `(profile "${options.name}").\n`,
    );
  });

  auth
    .command("status")
    .description("Which credential would be used, and whether it works")
    .action(async () => {
      const globals = globalOpts(auth);
      const cred = await resolveCredential(globals.profile);
      if (!cred) {
        process.stdout.write("Not signed in. Run `wk auth login`.\n");
        process.exitCode = 3;
        return;
      }
      process.stdout.write(`Credential source: ${cred.source}${cred.profile ? ` (profile "${cred.profile}")` : ""}\n`);
      const descriptor = byName("workers_list");
      if (descriptor) {
        const check = await executeTool(buildClient(), descriptor, {}, { token: cred.key });
        if (isSuccess(check)) {
          const body = check.data as { workers?: unknown[] };
          process.stdout.write(`${green("Key is valid.")} Workers visible: ${body.workers?.length ?? "?"}\n`);
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
      process.stdout.write(`Removed profile "${name}". The key itself remains valid until revoked in the dashboard.\n`);
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
        process.stdout.write(`${marker}${name} (${config.profiles[name]?.storage})\n`);
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
        process.stderr.write(`No profile "${name}". See \`wk auth profiles\`.\n`);
        process.exitCode = 2;
        return;
      }
      config.activeProfile = name;
      writeConfig(config);
      process.stdout.write(`Active profile: ${name}\n`);
    });
}
