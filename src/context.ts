import { WorkerKitClient } from "@workerkit/core";
import { resolveCredential, ENV_KEY } from "./auth/store.js";
import { userAgent } from "./version.js";
import { yellow } from "./output/colors.js";
import { sanitizeInline } from "./output/sanitize.js";

export const DEFAULT_API_BASE = "https://api.workerkit.ai";

export interface GlobalOpts {
  json: boolean;
  plain: boolean;
  yes: boolean;
  profile?: string;
}

export function apiBaseUrl(): string {
  const override = process.env.WK_API_BASE_URL;
  return (override && override.trim().length > 0 ? override.trim() : DEFAULT_API_BASE).replace(/\/+$/, "");
}

let warnedOverride = false;
const clients = new Set<WorkerKitClient>();

export function buildClient(): WorkerKitClient {
  const base = apiBaseUrl();
  const client = new WorkerKitClient({ baseUrl: base, userAgent: userAgent() });
  clients.add(client);
  if (base !== DEFAULT_API_BASE && !warnedOverride && process.stderr.isTTY) {
    warnedOverride = true;
    process.stderr.write(yellow(`Using API base ${sanitizeInline(new URL(base).origin)} (WK_API_BASE_URL)\n`));
  }
  return client;
}

/** Release every command's pool, including lookups performed before a mutation. */
export async function closeClients(): Promise<void> {
  const pending = [...clients];
  clients.clear();
  await Promise.all(pending.map(client => client.close()));
}

/** Resolves the manager key or exits 3 with a actionable hint. */
export async function requireToken(profile?: string): Promise<string> {
  const cred = await resolveCredential(profile);
  if (cred) return cred.key;
  process.stderr.write(
    `Not signed in. Run \`wk auth login\` (or set ${ENV_KEY}, or pass a key with \`wk auth login --key\`).\n`,
  );
  process.exit(3);
}
