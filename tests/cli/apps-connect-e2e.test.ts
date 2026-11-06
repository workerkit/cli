import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-app-connect-"));
const operatorId = "11111111-1111-4111-8111-111111111111";
const url = `https://workerkit.ai/apps?connect=mcp%3Akrisp&accountId=org&operatorId=${operatorId}`;
const requests: Array<{ method?: string; url: URL; body: string }> = [];
let status = 200;
let recipeUrl: string | undefined = url;
let warnings: string[] = [];
const server = createServer(async (req, res) => {
  let body = ""; for await (const chunk of req) body += chunk;
  requests.push({ method: req.method, url: new URL(req.url!, "http://localhost"), body });
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(status !== 200 ? { error: "forbidden", message: "readWorkers required" }
    : req.method === "POST" ? { provider: "telegram", connection: { id: "bot", status: "ACTIVE" } }
    : { warnings, apps: [{ connect: [
      { provider: "mcp:krisp", name: "Krisp", auth: "oauth", scope: "operator", url: recipeUrl },
      { provider: "telegram", name: "Telegram", auth: "credential", url: "https://workerkit.ai/apps?connect=telegram" },
      { provider: "weather", auth: "platform" },
    ] }] }));
});
let baseUrl: string;
beforeAll(async () => { server.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve)); baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
beforeEach(() => { requests.length = 0; status = 200; recipeUrl = url; warnings = []; });
afterAll(() => server.close());
function run(args: string[], stdin: string | null = "") {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [dist, "apps", "connect", ...args], { env: { ...process.env,
      WK_API_BASE_URL: baseUrl, WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_app_connect_test", WK_NO_UPDATE_CHECK: "1", CI: "1" }, stdio: "pipe" });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => stdout += chunk); child.stderr.on("data", chunk => stderr += chunk);
    const timeout = setTimeout(() => { child.kill(); reject(new Error("App connection command timed out")); }, 10_000);
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("close", code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
    if (stdin !== null) child.stdin.end(stdin);
  });
}
it.each(["krisp", "mcp:krisp"])("%s returns the exact live link without a credential prompt or write", async provider => {
  const result = await run([provider, "--operator-id", operatorId, "--json"]);
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ provider: "mcp:krisp", status: "setup_required", url });
  expect(JSON.parse(result.stdout).next).toContain(`wk apps list --operator-id ${operatorId}`);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.method).toBe("GET");
  expect(requests[0]!.url.pathname).toBe("/api/manage/apps");
  expect(requests[0]!.url.searchParams.get("operatorId")).toBe(operatorId);
});
it("prints a usable URL for headless users and never claims connection success", async () => {
  const result = await run(["krisp", "--no-browser"]);
  expect(result.code).toBe(0); expect(result.stdout).toContain(url);
  expect(result.stdout).toContain("Opening this link does not connect");
  expect(result.stdout).not.toContain("Connected:");
});
it("offers browser entry for credential apps too", async () => {
  const result = await run(["telegram", "--browser", "--json"]);
  expect(JSON.parse(result.stdout)).toMatchObject({ auth: "credential", url: "https://workerkit.ai/apps?connect=telegram" });
  expect(requests.map(request => request.method)).toEqual(["GET"]);
});
it("preserves piped credential input without requiring a catalog read", async () => {
  const result = await run(["telegram", "--json"], '{"botToken":"test-only-secret"}');
  expect(result.code, result.stderr).toBe(0);
  expect(requests.map(request => request.method)).toEqual(["POST"]);
  expect(JSON.parse(requests[0]!.body).credential).toEqual({ botToken: "test-only-secret" });
  expect(result.stdout + result.stderr).not.toContain("test-only-secret");
});
it("rejects mixed browser and credential inputs before networking", async () => {
  const result = await run(["telegram", "--browser", "--field", "botToken=test"]);
  expect(result.code).toBe(2); expect(requests).toHaveLength(0);
});
it("does not invent a link on an unknown provider or denied catalog read", async () => {
  expect((await run(["unknown", "--json"])).code).toBe(2);
  status = 403;
  const result = await run(["krisp", "--json"]);
  expect(result.code).not.toBe(0); expect(result.stdout).not.toContain("https://workerkit.ai/apps");
});
it("reports a platform app as ready without opening a connect flow", async () => {
  expect(JSON.parse((await run(["weather", "--json"])).stdout)).toMatchObject({ status: "ready" });
});

it.each(["--browser", "--no-browser"])("%s does not wait for a long-lived stdin pipe", async mode => {
  const result = await run(["krisp", mode, "--json"], null);
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ provider: "mcp:krisp", status: "setup_required", url });
  expect(requests.map(request => request.method)).toEqual(["GET"]);
}, 15_000);

it.each([undefined, "javascript:alert(1)", "file:///tmp/setup", "https://user:secret@workerkit.ai/apps"])(
  "rejects missing or unsafe browser setup URL %s", async invalidUrl => {
    recipeUrl = invalidUrl;
    const result = await run(["krisp", "--no-browser", "--json"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("no browser setup link");
    expect(requests.map(request => request.method)).toEqual(["GET"]);
  },
);

it("preserves catalog warnings and does not treat missing rows as absent apps", async () => {
  warnings = ["A connection family could not be read."];
  const known = await run(["krisp", "--no-browser", "--json"]);
  expect(JSON.parse(known.stdout).warnings).toEqual(warnings);
  const unknown = await run(["unknown", "--no-browser", "--json"]);
  expect(unknown.code).toBe(2);
  expect(unknown.stderr).toContain("incomplete connection list");
});
