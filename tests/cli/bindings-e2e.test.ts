import { afterAll, beforeAll, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-bindings-test-"));
const calls: Array<{ method?: string; url?: string; body: unknown }> = [];
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  calls.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(req.url?.includes("/permissions")
    ? { workerId: "6e6f6f70-0000-4000-8000-000000000009", tokenId: 42, apps: [{ code: "email" }], ruleCounts: {} }
    : { enabled: true, bindings: [{ alias: "brain", title: "Project Brain Search", operations: 3, available: true }], targets: [], slots: [], missingSlots: ["drafter"] }));
});
let baseUrl: string;
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); });

function wk(args: string[], json = true): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dist, ...(json ? ["--json"] : []), "--yes", "workers", ...args], {
      env: { ...process.env, WK_API_BASE_URL: baseUrl, WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_bindings_test", WK_NO_UPDATE_CHECK: "1", CI: "1" }, stdio: "pipe",
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}

it("reads and sets a worker's grants as one alias map, null clearing an alias", async () => {
  const read = await wk(["bindings", "42", "--search", "brain"]);
  expect(read.code, read.stderr).toBe(0);
  expect(calls.at(-1)).toEqual({ method: "GET", url: "/api/manage/workers/42/worker-bindings?search=brain", body: null });

  const workerBindings = { brain: { workerId: "6e6f6f70-0000-4000-8000-000000000001" }, notes: { workerId: "6e6f6f70-0000-4000-8000-000000000002", operations: 1 }, old: null };
  const set = await wk(["bindings-set", "42", "--worker-bindings", JSON.stringify(workerBindings)]);
  expect(set.code, set.stderr).toBe(0);
  expect(calls.at(-1)).toEqual({ method: "PATCH", url: "/api/manage/workers/42/worker-bindings", body: { workerBindings } });

  const human = await wk(["bindings", "42"], false);
  expect(human.code, human.stderr).toBe(0);
  expect(human.stdout).toContain("Project Brain Search");
  expect(human.stdout).toContain("drafter");
});

it("replaces the app set with only the scalars given", async () => {
  const apps = [{ code: "email", operations: ["view_email"] }, { code: "slack" }];
  const set = await wk(["permissions-set", "42", "--apps", JSON.stringify(apps), "--timeframe-past-days=-1"]);
  expect(set.code, set.stderr).toBe(0);
  expect(calls.at(-1)).toEqual({ method: "PUT", url: "/api/manage/workers/42/permissions", body: { apps, timeframePastDays: -1 } });
  expect(JSON.parse(set.stdout).tokenId).toBe(42);
});

it("passes explicit attachment forwarding grants and revocation without a client operation allowlist", async () => {
  const apps = [
    { code: "email", operations: ["view_email", "forward_attachments"], visibleFields: ["attachments"] },
    { code: "slack", operations: ["read_messages", "read_file", "forward_attachments"], visibleFields: ["files"] },
  ];
  for (const selected of [apps, apps.map(app => ({ ...app, operations: app.operations.filter(op => op !== "forward_attachments") }))]) {
    const result = await wk(["permissions-set", "42", "--apps", JSON.stringify(selected)]);
    expect(result.code, result.stderr).toBe(0);
    expect(calls.at(-1)).toEqual({ method: "PUT", url: "/api/manage/workers/42/permissions", body: { apps: selected } });
  }
});
