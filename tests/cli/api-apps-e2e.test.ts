import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-api-apps-cli-test-"));
const appId = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
const calls: Array<{ method?: string; url?: string; auth?: string; body: unknown }> = [];
const definition = { schemaVersion: 1, origin: "https://api.example.com", operations: [{
  key: "lookup", description: "Read a ticket", effect: "Read only", method: "GET", path: "/ticket",
  inputs: { type: "object", properties: {}, additionalProperties: false }, responseFields: { id: "/id" },
}] };
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ id: appId, revision, enabled: false }));
});
let baseUrl: string;
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); });

function wk(args: string[], input?: unknown): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dist, "api-apps", ...args, "--json", "--yes"], {
      env: { ...process.env, WK_API_BASE_URL: baseUrl, WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_api_apps_test", WK_NO_UPDATE_CHECK: "1", CI: "1" }, stdio: "pipe",
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  });
}

describe.skipIf(!existsSync(dist))("API app authoring on the wire", () => {
  it("creates from a file and updates from stdin with the reviewed revision", async () => {
    const request = { name: "Tickets", definition, enabled: false };
    const file = join(configDir, "request.json");
    writeFileSync(file, JSON.stringify(request));
    expect((await wk(["create", "--file", file])).code).toBe(0);
    expect(calls.at(-1)).toEqual({ method: "POST", url: "/api/manage/custom-api/apps", auth: "Bearer pe_mgr_api_apps_test", body: request });
    expect((await wk(["update", appId], { ...request, revision })).code).toBe(0);
    expect(calls.at(-1)).toMatchObject({ method: "PUT", url: `/api/manage/custom-api/apps/${appId}`, body: { ...request, revision } });
    expect((calls.at(-1)!.body as Record<string, unknown>).appId).toBeUndefined();
  });

  it("publishes only the selected app's saved revision", async () => {
    const before = calls.length;
    expect((await wk(["publish", appId, "--revision", revision])).code).toBe(0);
    expect(calls).toHaveLength(before + 1);
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: `/api/manage/custom-api/apps/${appId}/versions`, body: { revision } });
  });

  it("rejects misplaced credentials and route overrides without sending", async () => {
    const before = calls.length;
    expect((await wk(["create"], { name: "Tickets", definition, secrets: { token: "must-not-send" } })).code).toBe(2);
    expect((await wk(["update", appId], { appId, name: "Tickets", definition, enabled: false, revision })).code).toBe(2);
    expect(calls).toHaveLength(before);
  });
});
