import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-action-cli-test-"));
const calls: Array<{ url: string; key?: string; body: unknown }> = [];
const receipt = { invocationId: "11111111-1111-4111-8111-111111111111", tool: "slack_send_dm", status: "outcome_unknown", error: { code: "outcome_unknown", retryable: false } };
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  calls.push({ url: req.url!, key: req.headers["idempotency-key"] as string | undefined, body: raw ? JSON.parse(raw) : null });
  res.writeHead(req.method === "POST" ? 502 : 200, { "content-type": "application/json" });
  res.end(JSON.stringify(receipt));
});
let baseUrl: string;
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); });

function wk(args: string[], input?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dist, ...args], { env: { ...process.env, WK_API_BASE_URL: baseUrl, WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_action_test", WK_NO_UPDATE_CHECK: "1", CI: "1" }, stdio: "pipe" });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

describe.skipIf(!existsSync(dist))("Action commands on the wire", () => {
  it("preserves arguments, key and unknown receipt without automatically resending", async () => {
    const args = { userId: "U123", text: "Hello" };
    const path = join(configDir, "arguments.json");
    writeFileSync(path, JSON.stringify(args));
    for (const source of [["--file", path], []]) {
      const before = calls.length;
      const result = await wk(["workers", "invoke", "42", "slack_send_dm", "--idempotency-key", "intended-send-1", "--json", ...source], JSON.stringify(args));
      expect(result.code).not.toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(receipt);
      expect(calls).toHaveLength(before + 1);
      expect(calls.at(-1)).toEqual({ url: "/api/manage/workers/42/tools/slack_send_dm/invoke", key: "intended-send-1", body: { contractVersion: 1, arguments: args } });
    }
  });

  it("reads a receipt without executing an action", async () => {
    const before = calls.length;
    const result = await wk(["workers", "invocation", "42", receipt.invocationId, "--json"]);
    expect(JSON.parse(result.stdout)).toEqual(receipt);
    expect(calls).toHaveLength(before + 1);
    expect(calls.at(-1)?.url).toBe(`/api/manage/workers/42/tool-invocations/${receipt.invocationId}`);
    expect(calls.at(-1)?.body).toBeNull();
  });
});
