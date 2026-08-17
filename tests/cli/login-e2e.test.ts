import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * End-to-end sign-in against a stand-in server that speaks the real `api/auth/manager-cli`
 * contract. This is the half of the flow that lives in the CLI: start a session, display the
 * code, poll with the secret in the HEADER, collect the key exactly once, verify it before
 * persisting, and store it. The browser-side approval is simulated by the server flipping the
 * session to approved after the first poll.
 *
 * The assertions that matter are on what the CLI PUT ON THE WIRE: a regression there is
 * invisible in the output but breaks against the real backend.
 */

const DIST = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

const USER_CODE = "WDJB-MJHT";
const SESSION_TOKEN = "test-session-token";
const POLL_SECRET = "test-poll-secret";
const MINTED_KEY = "pe_mgr_testkeymaterial000000";

interface Recorded {
  loginBody: Record<string, unknown> | null;
  pollAuthHeader: string | null;
  pollQuery: string | null;
  pollCount: number;
  verifyAuthHeader: string | null;
  verifyPath: string | null;
  userAgent: string | null;
}

const recorded: Recorded = {
  loginBody: null,
  pollAuthHeader: null,
  pollQuery: null,
  pollCount: 0,
  verifyAuthHeader: null,
  verifyPath: null,
  userAgent: null,
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

let boundPort = 0;

const server: Server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;

    if (req.method === "POST" && path === "/api/auth/manager-cli/login") {
      recorded.loginBody = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
      return json(res, 200, {
        sessionToken: SESSION_TOKEN,
        pollSecret: POLL_SECRET,
        loginUrl: `http://127.0.0.1:${boundPort}/cli-auth-manager?session=${SESSION_TOKEN}`,
        userCode: USER_CODE,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        message: "",
      });
    }

    if (req.method === "GET" && path === `/api/auth/manager-cli/poll/${SESSION_TOKEN}`) {
      recorded.pollCount++;
      recorded.pollAuthHeader = (req.headers["x-poll-secret"] as string) ?? null;
      recorded.pollQuery = url.search || null;

      if (recorded.pollAuthHeader !== POLL_SECRET) {
        return json(res, 400, { status: "invalid_secret", error: "Invalid session or secret" });
      }
      // First poll: still waiting on the human. Second: the admin has approved.
      if (recorded.pollCount < 2) return json(res, 200, { status: "pending" });
      return json(res, 200, {
        status: "completed",
        managerKey: MINTED_KEY,
        keyId: 42,
        keyName: "CLI - test",
        scopes: ["readWorkers", "runWorkers"],
      });
    }

    if (req.method === "GET" && path === "/api/manage/workers") {
      recorded.verifyPath = path;
      recorded.verifyAuthHeader = (req.headers.authorization as string) ?? null;
      recorded.userAgent = (req.headers["user-agent"] as string) ?? null;
      return json(res, 200, {
        workers: [{ tokenId: 1, title: "Test worker", status: "active" }],
        serverTimeUtc: new Date().toISOString(),
      });
    }

    return json(res, 404, { error: "not_found" });
  })();
});

async function start(): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  boundPort = typeof address === "object" && address ? address.port : 0;
}

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const configDir = mkdtempSync(join(tmpdir(), "wk-login-e2e-"));

/**
 * Async on purpose: the stand-in server runs in THIS process, so a synchronous spawn would block
 * the event loop and deadlock every request the child makes.
 */
function wk(
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    WK_API_BASE_URL: `http://127.0.0.1:${boundPort}`,
    WK_CONFIG_DIR: configDir,
    WK_NO_UPDATE_CHECK: "1",
    WK_NO_BROWSER: "1",
    CI: "1",
    NO_COLOR: "1",
    ...extraEnv,
  };
  delete env.WK_MANAGER_KEY;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIST, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

describe.skipIf(!existsSync(DIST))("browser-approved sign-in, end to end", () => {
  it(
    "starts a session, shows the code, polls with the header secret, verifies and stores the key",
    async () => {
      await start();

      const result = await wk(["auth", "login"]);

      expect(result.status ?? 0).toBe(0);

      // What the human sees: the code, prominently, plus the warning that does real work.
      expect(result.stdout).toContain(USER_CODE);
      expect(result.stdout).toContain("cli-auth-manager?session=");
      expect(result.stdout).toContain("Only approve this login if you started it yourself");
      expect(result.stdout).toContain("Signed in.");
      // The key itself must never be echoed.
      expect(result.stdout).not.toContain(MINTED_KEY);

      // What went on the wire at session start.
      expect(recorded.loginBody?.supportsUserCode).toBe(true);
      expect(typeof recorded.loginBody?.clientLabel).toBe("string");
      expect((recorded.loginBody?.clientLabel as string).length).toBeGreaterThan(0);

      // The poll secret travels in the header and NEVER in the query string: the whole point of
      // the header contract is that query strings land in intermediary access logs.
      expect(recorded.pollAuthHeader).toBe(POLL_SECRET);
      expect(recorded.pollQuery).toBeNull();
      expect(recorded.pollCount).toBeGreaterThanOrEqual(2); // kept polling through "pending"

      // Verify-before-persist: the minted key is exercised against a real endpoint first.
      expect(recorded.verifyPath).toBe("/api/manage/workers");
      expect(recorded.verifyAuthHeader).toBe(`Bearer ${MINTED_KEY}`);
      expect(recorded.userAgent).toMatch(/^WorkerKit-CLI\//);

      // Stored, and readable back.
      const config = JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")) as {
        activeProfile?: string;
        profiles: Record<string, { storage: string }>;
      };
      expect(config.activeProfile).toBe("default");
      expect(config.profiles.default).toBeDefined();

      const status = await wk(["auth", "status"]);
      expect(status.status ?? 0).toBe(0);
      expect(status.stdout).toContain("Key is valid.");
      expect(status.stdout).not.toContain(MINTED_KEY);

      // And an authenticated command now works off the stored credential.
      const list = await wk(["workers", "list"]);
      expect(list.status ?? 0).toBe(0);
      expect(list.stdout).toContain("Test worker");
    },
    60_000,
  );
});
