import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-activity-test-"));
const calls: Array<{ method?: string; url?: string; auth?: string }> = [];
const page = { items: [{ at: "2026-10-21T12:00:00Z", kind: "call", outcome: "blocked", workerTitle: "Inbox", title: "ListMessages", detail: "contact_rule_denied" }], hasMore: true, nextCursor: "opaque-cursor" };
const server = createServer((req, res) => {
  calls.push({ method: req.method, url: req.url, auth: req.headers.authorization });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(req.url?.includes("/summary") ? { changes: 3 } : req.url?.includes("/spend") ? { spentThisMonthUsd: 1.25 } : page));
});
let baseUrl: string;
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); });

function wk(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dist, ...args], {
      env: { ...process.env, WK_API_BASE_URL: baseUrl, WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_activity_test", WK_NO_UPDATE_CHECK: "1", CI: "1" }, stdio: "pipe",
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}

describe.skipIf(!existsSync(dist))("activity and spend commands on the wire", () => {
  it("forwards activity filters and cursors and preserves the flat JSON response", async () => {
    const worker = "44444444-4444-4444-8444-444444444444";
    const result = await wk(["activity", "feed", "--json", "--kind", "call", "--outcome", "blocked", "--worker-id", worker,
      "--since", "2026-10-20T00:00:00Z", "--until", "2026-10-21T00:00:00Z", "--cursor", "previous", "--limit", "5"]);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(page);
    const call = calls.at(-1)!;
    expect(call.method).toBe("GET");
    expect(call.auth).toBe("Bearer pe_mgr_activity_test");
    const url = new URL(call.url!, baseUrl);
    expect(url.pathname).toBe("/api/manage/workers/activity");
    expect(Object.fromEntries(url.searchParams)).toEqual({ kind: "call", outcome: "blocked", workerId: worker,
      since: "2026-10-20T00:00:00Z", until: "2026-10-21T00:00:00Z", cursor: "previous", limit: "5" });
  });

  it("renders activity with an older-page hint and exposes summary and spend", async () => {
    const human = await wk(["activity", "feed"]);
    expect(human.code, human.stderr).toBe(0);
    expect(human.stdout).toContain("ListMessages");
    expect(human.stdout).toContain("--cursor opaque-cursor");
    for (const [area, command, route, response] of [
      ["activity", "summary", "/api/manage/workers/activity/summary", { changes: 3 }],
      ["account", "spend", "/api/manage/workers/account/spend", { spentThisMonthUsd: 1.25 }],
    ] as const) {
      const result = await wk([area, command, "--json"]);
      expect(result.code, result.stderr).toBe(0);
      expect(calls.at(-1)?.url).toBe(route);
      expect(JSON.parse(result.stdout)).toEqual(response);
    }
  });
});
