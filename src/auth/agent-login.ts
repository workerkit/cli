import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { configDir, writePrivateJson } from "./store.js";

export interface PendingLogin {
  apiBaseUrl: string;
  requestId: string;
  pollSecret: string;
  approvalUrl: string;
  userCode: string;
  expiresAt: string;
}
export interface AgentLoginStatus {
  status: string;
  expiresAt?: string;
  managerKey?: string;
  keyId?: number;
  scopes?: string[];
}
const pendingPath = (profile: string) =>
  join(configDir(), `pending-${createHash("sha256").update(profile).digest("hex")}.json`);

export function savePending(profile: string, value: PendingLogin): void {
  writePrivateJson(pendingPath(profile), value);
}

export function loadPending(profile: string, origin: string): PendingLogin {
  let value: PendingLogin;
  try {
    const parsed = JSON.parse(readFileSync(pendingPath(profile), "utf8")) as Partial<PendingLogin>;
    const fields = ["apiBaseUrl", "requestId", "pollSecret", "approvalUrl", "userCode", "expiresAt"] as const;
    if (
      fields.some((key) => typeof parsed[key] !== "string" || parsed[key]!.length === 0) ||
      !Number.isFinite(Date.parse(parsed.expiresAt!))
    ) {
      throw new Error("invalid pending login");
    }
    value = Object.fromEntries(fields.map((key) => [key, parsed[key]])) as unknown as PendingLogin;
  } catch {
    throw new Error("No pending login for this profile. Run wk auth login --start.");
  }
  if (value.apiBaseUrl !== origin) {
    throw new Error("Pending login belongs to another API origin. Restore the original WK_API_BASE_URL.");
  }
  return value;
}

export function clearPending(profile: string): void {
  rmSync(pendingPath(profile), { force: true });
}

async function request(base: string, path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const url = new URL(base);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  ) {
    throw new Error("Login requires HTTPS (HTTP is allowed only on loopback).");
  }
  const response = await fetch(`${base}/api/auth/agent/requests${path}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  // Bound response reads; neither errors nor server bodies containing credentials are printed.
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        throw new Error("Login response too large.");
      }
      chunks.push(value);
    }
  }
  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "Login rate limited. Wait at least 5 seconds before resuming (email delivery: 15 minutes)."
        : `Login request failed (HTTP ${response.status}).`,
    );
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid body");
    return data as Record<string, unknown>;
  } catch {
    throw new Error("Malformed login response.");
  }
}

export async function startAgentLogin(apiBaseUrl: string, name: string, scopes: string[]): Promise<PendingLogin> {
  const data = await request(apiBaseUrl, "", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, clientLabel: "WorkerKit CLI", scopes }),
  });
  for (const key of ["requestId", "pollSecret", "approvalUrl", "userCode", "expiresAt"]) {
    if (typeof data[key] !== "string" || !data[key]) throw new Error("Malformed login response.");
  }
  let approval: URL;
  try {
    approval = new URL(String(data.approvalUrl));
  } catch {
    throw new Error("Invalid approval URL.");
  }
  if (
    approval.protocol !== "https:" &&
    !(approval.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(approval.hostname))
  ) {
    throw new Error("Invalid approval URL.");
  }
  if (!Number.isFinite(Date.parse(String(data.expiresAt)))) throw new Error("Malformed login response.");
  return {
    apiBaseUrl,
    requestId: String(data.requestId),
    pollSecret: String(data.pollSecret),
    approvalUrl: approval.href,
    userCode: String(data.userCode),
    expiresAt: String(data.expiresAt),
  };
}
export async function agentLoginAction(
  pending: PendingLogin,
  action: "status" | "redeem" | "cancel" | "email",
  email?: string,
): Promise<AgentLoginStatus> {
  const suffix = action === "status" ? "" : `/${action}`;
  const data = await request(pending.apiBaseUrl, `/${encodeURIComponent(pending.requestId)}${suffix}`, {
    method: action === "status" ? "GET" : "POST",
    headers: { "X-Poll-Secret": pending.pollSecret, "Content-Type": "application/json" },
    ...(action === "email" ? { body: JSON.stringify({ email }) } : {}),
  });
  const statuses = ["pending", "approved", "denied", "cancelled", "expired", "redeemed", "queued"];
  if (typeof data.status !== "string" || !statuses.includes(data.status)) {
    throw new Error("Malformed login response.");
  }
  return {
    status: data.status,
    ...(typeof data.expiresAt === "string" ? { expiresAt: data.expiresAt } : {}),
    ...(typeof data.managerKey === "string" ? { managerKey: data.managerKey } : {}),
    ...(typeof data.keyId === "number" && Number.isInteger(data.keyId) ? { keyId: data.keyId } : {}),
    ...(Array.isArray(data.scopes) && data.scopes.every((scope) => typeof scope === "string")
      ? { scopes: data.scopes as string[] } : {}),
  };
}

export function publicPending(pending: PendingLogin) {
  return {
    status: "pending",
    requestId: pending.requestId,
    approvalUrl: pending.approvalUrl,
    userCode: pending.userCode,
    expiresAt: pending.expiresAt,
    interval: 5,
    next: "wk auth login --resume --json",
  };
}
