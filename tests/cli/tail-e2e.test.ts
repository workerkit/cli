import { afterAll, beforeAll, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-tail-test-"));
const runId = "11111111-1111-4111-8111-111111111111";
let status = "Succeeded";
let eventStatus = 200;
let receiptStatus = 200;
let eventCalls = 0;
let hang = false;
let signalChild: (() => void) | undefined;
const receipt = () => ({ kind: "hybrid", runId, status, finalDigest: "Draft ready", walletChargeUsd: 0.12,
  agent: { status: "completed", actions: [{ tool: "email_create_reply_draft", sourceId: "mail-1", status: "confirmed", resultReferences: { draftId: "draft-123" } }] } });
const server = createServer((req, res) => {
  if (req.url?.includes("/events")) {
    eventCalls++;
    if (hang) { signalChild?.(); return; }
    res.writeHead(eventStatus, { "content-type": "application/json", "retry-after": "100000" });
    res.end(JSON.stringify(eventStatus === 429 ? { code: "QUOTA_EXCEEDED" } : {
      events: [{ seq: 1, kind: "tool", label: "Draft created\u001b[2J" }],
    }));
  } else {
    res.writeHead(receiptStatus, { "content-type": "application/json" });
    res.end(JSON.stringify(receiptStatus === 200 ? receipt() : { error: "not_found" }));
  }
});
let baseUrl: string;
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(configDir, { recursive: true, force: true });
});

function tail(json = false): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dist, "runs", "tail", runId, ...(json ? ["--json"] : [])], {
      env: { ...process.env, WK_API_BASE_URL: baseUrl, WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_tail_test", WK_NO_UPDATE_CHECK: "1", CI: "1", NO_COLOR: "1" },
      stdio: "pipe",
    });
    signalChild = () => { child.kill("SIGINT"); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Tail failed to settle within its test deadline")); }, 4000);
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end();
  });
}

it.each([
  ["Succeeded", 0], ["succeeded", 0], ["Skipped", 0], ["AwaitingInput", 0],
  ["Failed", 1], ["TimedOut", 1], ["BudgetExceeded", 1], ["Canceled", 1],
] as const)("settles %s with the documented exit code", async (value, code) => {
  status = value;
  const result = await tail();
  expect(result.code, result.stderr).toBe(code);
  expect(result.stdout).toContain("Draft created");
  expect(result.stdout).not.toContain("\u001b[2J");
  expect(result.stdout).toContain("draft-123");
  expect(result.stdout).toContain("Wallet charge: $0.12");
  if (value === "AwaitingInput") expect(result.stdout).toContain("wk runs question");
});

it("keeps raw events and receipts in JSONL", async () => {
  status = "Succeeded";
  const result = await tail(true);
  expect(result.code, result.stderr).toBe(0);
  const lines = result.stdout.trim().split("\n").map(line => JSON.parse(line));
  expect(lines[0].label).toBe("Draft created\u001b[2J");
  expect(lines[1]).toEqual(receipt());
});

it("stops on a quota wall or unreadable receipt instead of polling forever", async () => {
  eventStatus = 429;
  eventCalls = 0;
  try {
    expect((await tail()).code).toBe(4);
    expect(eventCalls).toBe(1);
  } finally { eventStatus = 200; }
  receiptStatus = 404;
  try { expect((await tail()).code).toBe(1); } finally { receiptStatus = 200; }
});

it.skipIf(process.platform === "win32")("Ctrl-C aborts an in-flight follow request and prints the cancel hint", async () => {
  hang = true;
  try {
    const result = await tail();
    expect(result.code).toBe(130);
    expect(result.stderr).toContain("Stopped tailing");
    expect(result.stderr).toContain(`wk runs cancel ${runId}`);
  } finally { hang = false; }
});
