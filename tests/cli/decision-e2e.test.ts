import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-decision-test-"));
const calls: Array<{ url: string; auth?: string; body: unknown }> = [];
const receipt = { workerId: "11111111-1111-4111-8111-111111111111", kitSlug: "triage", nextCall: { tool: "worker_deploy", arguments: { tokenId: 42 } } };
const request = { requestId: "triage-1", name: "Triage", source: { recipe: "email-previews" }, questions: [{ key: "relevant", type: "noul", instructions: "This is a customer support request." }], confidenceFloor: 0.7 };
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  calls.push({ url: req.url!, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(req.method === "POST" ? receipt : { recipes: [{ id: "email-previews" }] }));
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
    const child = spawn(process.execPath, [dist, ...args], { env: { ...process.env, WK_API_BASE_URL: baseUrl, WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_decision_test", WK_NO_UPDATE_CHECK: "1", CI: "1" }, stdio: "pipe" });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

describe.skipIf(!existsSync(dist))("decision commands on the wire", () => {
  it("discovers recipes without forwarding the manager credential", async () => {
    const result = await wk(["decision", "sources", "--app", "email", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).recipes[0].id).toBe("email-previews");
    const url = new URL(calls.at(-1)!.url, baseUrl);
    expect(url.pathname).toBe("/api/directory/mcp/authoring/tools");
    expect(url.searchParams.get("purpose")).toBe("decision");
    expect(url.searchParams.get("app")).toBe("email");
    expect(calls.at(-1)!.auth).toBeUndefined();
  });
  it("creates from a file and stdin, preserving the request id and defaulting to no deployment", async () => {
    const path = join(configDir, "decision.json");
    writeFileSync(path, JSON.stringify(request));
    for (const args of [["--file", path], []]) {
      const result = await wk(["decision", "create", "--json", ...args], JSON.stringify(request));
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(receipt);
      expect(calls.at(-1)).toEqual({ url: "/api/manage/decision-workers", auth: "Bearer pe_mgr_decision_test", body: { ...request, maxItems: 20, deploy: false } });
    }
  });
  it("rejects invalid questions before making a request", async () => {
    const count = calls.length;
    const result = await wk(["decision", "create"], JSON.stringify({ ...request, questions: [{ ...request.questions[0], options: { yes: "Yes" } }] }));
    expect(result.code).toBe(2);
    expect(calls).toHaveLength(count);
  });
});
