import { byName, executeTool, isSuccess } from "@workerkit/core";
import { apiBaseUrl, buildClient } from "../context.js";
import { openBrowser } from "./login.js";
import {
  agentLoginAction,
  clearPending,
  loadPending,
  publicPending,
  savePending,
  startAgentLogin,
} from "./agent-login.js";
import { storeCredential } from "./store.js";
import { sanitizeInline } from "../output/sanitize.js";

export interface AgentLoginOptions {
  name: string;
  scopes?: string;
  browser?: boolean;
  start?: boolean;
  resume?: boolean;
  cancel?: boolean;
  email?: string;
}

export async function runAgentLogin(options: AgentLoginOptions, json: boolean): Promise<void> {
  const origin = apiBaseUrl();
  if ([options.start, options.resume, options.cancel].filter(Boolean).length > 1) {
    throw new Error("Choose only one of --start, --resume or --cancel.");
  }
  let pending;
  if (options.resume || options.cancel) pending = loadPending(options.name, origin);
  else {
    // An existing request must be resumed or explicitly cancelled, never orphaned.
    try {
      const prior = loadPending(options.name, origin);
      if (Date.parse(prior.expiresAt) > Date.now()) {
        throw new Error("A login is pending. Use --resume or --cancel.");
      }
      await agentLoginAction(prior, "cancel");
      clearPending(options.name);
    } catch (error) {
      if (!(error as Error).message.startsWith("No pending login")) throw error;
    }
    const scopes = options.scopes?.split(",").map((scope) => scope.trim()).filter(Boolean) ?? ["readWorkers", "readRuns"];
    pending = await startAgentLogin(origin, options.name, scopes);
    savePending(options.name, pending);
  }
  if (options.cancel) {
    await agentLoginAction(pending, "cancel");
    clearPending(options.name);
    process.stdout.write(
      json
        ? JSON.stringify({ status: "cancelled" }) + "\n"
        : "Login cancelled; any credential from this request was revoked.\n",
    );
    return;
  }
  if (options.email) await agentLoginAction(pending, "email", options.email);
  if (!options.resume) {
    if (!json) {
      process.stdout.write(
        `Open ${sanitizeInline(pending.approvalUrl)}\n` +
        `Enter code: ${sanitizeInline(pending.userCode)}\n` +
        "Only approve a request you started.\n",
      );
    }
    if (!json && options.browser !== false && !process.env.CI && !process.env.WK_NO_BROWSER) {
      openBrowser(pending.approvalUrl);
    }
    if (options.start || json) {
      if (json) process.stdout.write(JSON.stringify(publicPending(pending)) + "\n");
      return;
    }
  }
  // --resume checks once, which makes agent invocations bounded and resumable.
  for (;;) {
    if (Date.parse(pending.expiresAt) <= Date.now()) {
      throw new Error("Login expired. Start a new request.");
    }
    const status = await agentLoginAction(pending, "status");
    if (status.status === "approved") {
      const result = await agentLoginAction(pending, "redeem");
      if (!result.managerKey?.startsWith("pe_mgr_")) {
        throw new Error("Credential was already collected. Use --cancel to revoke it, then start again.");
      }
      // Persist immediately: a transient verification failure must not lose a one-time credential.
      const storage = await storeCredential(options.name, result.managerKey);
      clearPending(options.name);
      const check = await executeTool(buildClient(), byName("key_info")!, {}, { token: result.managerKey });
      const output = {
        status: "signed_in",
        profile: options.name,
        storage,
        keyId: result.keyId,
        scopes: result.scopes,
        verified: isSuccess(check),
      };
      process.stdout.write(
        json
          ? JSON.stringify(output) + "\n"
          : `Signed in. Credential saved to ${storage} for ${sanitizeInline(options.name)}.` +
            `${isSuccess(check) ? "" : " Verification unavailable; run wk auth key-info."}\n`,
      );
      return;
    }
    if (status.status !== "pending") {
      if (status.status === "redeemed") {
        throw new Error("Redemption response was lost. Use --cancel to revoke the uncollected key, then start again.");
      }
      clearPending(options.name);
      throw new Error(`Login ${sanitizeInline(status.status)}. Start a new request.`);
    }
    if (options.resume) {
      process.stdout.write(
        json
          ? JSON.stringify(publicPending(pending)) + "\n"
          : "Awaiting human approval. Resume again after at least 5 seconds.\n",
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_100));
  }
}
