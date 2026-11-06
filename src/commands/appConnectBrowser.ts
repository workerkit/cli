import { byName, executeTool, isSuccess, type WorkerKitClient } from "@workerkit/core";
import { openBrowser } from "../auth/login.js";
import { renderApiError } from "../errors.js";
import { sanitizeInline } from "../output/sanitize.js";

interface Recipe {
  provider: string;
  name?: string;
  auth: string;
  scope?: string;
  url?: string;
}

/** Resolve against the live catalog, so OAuth apps never prompt for obsolete keys. */
export async function connectInBrowser(client: WorkerKitClient, token: string, provider: string,
  operatorId: string | undefined, open: boolean, json: boolean): Promise<void> {
  const descriptor = byName("apps_list");
  if (!descriptor) throw new Error("apps_list descriptor missing");
  const result = await executeTool(client, descriptor, operatorId ? { operatorId } : {}, { token });
  if (!isSuccess(result)) {
    process.exitCode = renderApiError(result, json);
    return;
  }
  const body = result.data as { apps?: Array<{ connect?: Recipe[] }>; warnings?: string[] };
  const recipes = body.apps?.flatMap(app => app.connect ?? []) ?? [];
  const normalized = provider.toLowerCase();
  // The explicit native code wins; a bare MCP slug is a convenient CLI spelling.
  const recipe = recipes.find(item => item.provider.toLowerCase() === normalized)
    ?? recipes.find(item => item.provider.toLowerCase() === `mcp:${normalized}`);
  if (!recipe) {
    process.stderr.write(body.warnings?.length
      ? "Could not resolve this app from an incomplete connection list. Retry `wk apps list`.\n"
      : "Unknown provider. Use a provider code from `wk apps list`.\n");
    process.exitCode = 2;
    return;
  }
  if (recipe.auth === "platform") {
    process.stdout.write(json ? JSON.stringify({ provider: recipe.provider, status: "ready", message: "No connection needed." }) + "\n"
      : "This app is ready; no connection is needed.\n");
    return;
  }
  let url: URL;
  try {
    url = new URL(recipe.url ?? "");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch {
    process.stderr.write("This app has no browser setup link. Check `wk apps list --json` for its connection instructions.\n");
    process.exitCode = 2;
    return;
  }
  const verifyCommand = operatorId ? `wk apps list --operator-id ${operatorId}` : "wk apps list";
  const next = `Complete setup in the browser, then run ${verifyCommand} to verify the connection for the same operator. Opening this link does not connect the app.`;
  if (json) {
    process.stdout.write(JSON.stringify({ provider: recipe.provider, status: "setup_required", auth: recipe.auth,
      scope: recipe.scope, url: url.href, next, ...(body.warnings?.length ? { warnings: body.warnings } : {}) }, null, 2) + "\n");
  } else {
    process.stdout.write(`Connect ${sanitizeInline(recipe.name ?? recipe.provider)}: ${sanitizeInline(url.href)}\n${next}\n`);
    for (const warning of body.warnings ?? []) process.stderr.write(`${sanitizeInline(warning)}\n`);
  }
  if (open && !json) openBrowser(url.href);
}
