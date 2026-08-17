/**
 * Browser-approved login: `wk auth login`.
 *
 * Device-style flow against api/auth/manager-cli. The CLI displays a user code; an account admin
 * types it on the approval page and picks the key's scopes; the poll (secret in the X-Poll-Secret
 * HEADER, never a query string) collects the newly minted pe_mgr_ key exactly once.
 */

import { hostname, userInfo } from "node:os";
import { spawn } from "node:child_process";

export interface LoginEndpoints {
  /** e.g. https://api.workerkit.ai */
  apiBaseUrl: string;
}

export interface LoginStart {
  sessionToken: string;
  pollSecret: string;
  loginUrl: string;
  userCode: string | null;
  expiresAt: string;
  message: string;
}

export interface LoginResult {
  managerKey: string;
  keyId: number | null;
  keyName: string | null;
  scopes: string[] | null;
}

export interface LoginProgress {
  onCode(userCode: string, loginUrl: string): void;
  onWaiting?(): void;
}

const POLL_SECRET_HEADER = "X-Poll-Secret";
const POLL_INTERVAL_MS = 3000;
const INITIAL_DELAY_MS = 5000;
const MAX_BODY_BYTES = 1024 * 1024;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await boundedText(res, MAX_BODY_BYTES);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Unexpected response from server (HTTP ${res.status}).`);
  }
}

async function boundedText(res: Response, cap: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      void reader.cancel();
      throw new Error("Server response too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function defaultClientLabel(): string {
  try {
    return `${userInfo().username}@${hostname()}`.slice(0, 64);
  } catch {
    return hostname().slice(0, 64);
  }
}

/** fetch throws TypeErrors for network failures and redirect:"error" hits — translate to a clean message. */
async function fetchOrClean(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
}

export async function startLogin(
  endpoints: LoginEndpoints,
  opts: { requestedScopes?: string[]; keyName?: string; signal?: AbortSignal },
): Promise<LoginStart> {
  const res = await fetchOrClean(`${endpoints.apiBaseUrl}/api/auth/manager-cli/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      supportsUserCode: true,
      clientLabel: defaultClientLabel(),
      requestedScopes: opts.requestedScopes,
      keyName: opts.keyName,
    }),
    redirect: "error",
    signal: opts.signal ?? null,
  });

  if (!res.ok) {
    const body = await readJson(res).catch(() => ({}) as Record<string, unknown>);
    const message = typeof body.message === "string" ? body.message : `HTTP ${res.status}`;
    throw new Error(`Could not start login: ${message}`);
  }

  const body = await readJson(res);
  const start: LoginStart = {
    sessionToken: String(body.sessionToken ?? ""),
    pollSecret: String(body.pollSecret ?? ""),
    loginUrl: String(body.loginUrl ?? ""),
    userCode: typeof body.userCode === "string" ? body.userCode : null,
    expiresAt: String(body.expiresAt ?? ""),
    message: typeof body.message === "string" ? body.message : "",
  };
  if (!start.sessionToken || !start.pollSecret || !start.loginUrl) {
    throw new Error("Could not start login: malformed server response.");
  }
  return start;
}

/** Best-effort browser open; the URL is always printed too (SSH/headless). */
export function openBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // The printed URL is the fallback.
  }
}

/**
 * Polls until the session settles. Throws with a user-renderable message on failure/expiry;
 * respects Retry-After on 429; aborts promptly on the signal (Ctrl-C).
 */
export async function pollForKey(
  endpoints: LoginEndpoints,
  start: LoginStart,
  signal: AbortSignal,
): Promise<LoginResult> {
  const deadline = Date.parse(start.expiresAt) || Date.now() + 10 * 60 * 1000;
  const MAX_TRANSIENT_FAILURES = 5;
  let transientFailures = 0;

  await sleep(INITIAL_DELAY_MS, signal);

  for (;;) {
    if (Date.now() > deadline) throw new Error("Login session expired. Run the login again.");

    // A dropped connection between polls is routine (laptop lid, flaky wifi) — retry a few
    // times before giving the session up. An abort (Ctrl-C) always propagates immediately.
    let res: Response;
    try {
      res = await fetch(
        `${endpoints.apiBaseUrl}/api/auth/manager-cli/poll/${encodeURIComponent(start.sessionToken)}`,
        { headers: { [POLL_SECRET_HEADER]: start.pollSecret }, redirect: "error", signal },
      );
    } catch (error) {
      if ((error as Error).name === "AbortError" || signal.aborted) throw abortError();
      if (++transientFailures > MAX_TRANSIENT_FAILURES) {
        throw new Error("Lost the connection to the server. Run the login again.");
      }
      await sleep(POLL_INTERVAL_MS, signal);
      continue;
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : POLL_INTERVAL_MS * 2;
      await res.body?.cancel();
      await sleep(waitMs, signal);
      continue;
    }

    // 5xx between polls (proxy hiccup, deploy) is transient too — same grace budget.
    if (res.status >= 500) {
      await res.body?.cancel();
      if (++transientFailures > MAX_TRANSIENT_FAILURES) {
        throw new Error(`The server is unavailable right now (HTTP ${res.status}). Run the login again later.`);
      }
      await sleep(POLL_INTERVAL_MS, signal);
      continue;
    }

    // Body reads can also fail mid-stream on a dropped connection — same transient budget.
    let body: Record<string, unknown>;
    try {
      body = await readJson(res);
    } catch (error) {
      if ((error as Error).name === "AbortError" || signal.aborted) throw abortError();
      if (++transientFailures > MAX_TRANSIENT_FAILURES) {
        throw new Error("Lost the connection to the server. Run the login again.");
      }
      await sleep(POLL_INTERVAL_MS, signal);
      continue;
    }
    transientFailures = 0;
    const status = String(body.status ?? "");

    switch (status) {
      case "pending":
        await sleep(POLL_INTERVAL_MS, signal);
        continue;

      case "completed": {
        const managerKey = typeof body.managerKey === "string" ? body.managerKey : null;
        if (!managerKey) throw new Error("The key was already retrieved. Run the login again.");
        return {
          managerKey,
          keyId: typeof body.keyId === "number" ? body.keyId : null,
          keyName: typeof body.keyName === "string" ? body.keyName : null,
          scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : null,
        };
      }

      case "expired":
        throw new Error("Login session expired. Run the login again.");

      case "failed":
        throw new Error(typeof body.error === "string" && body.error ? body.error : "Login failed.");

      case "invalid_secret":
        throw new Error("Login session is invalid. Run the login again.");

      default:
        await sleep(POLL_INTERVAL_MS, signal);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const err = new Error("Login cancelled.");
  err.name = "AbortError";
  return err;
}
