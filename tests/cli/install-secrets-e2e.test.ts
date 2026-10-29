import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { creationResultGuidance } from "@workerkit/core";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-install-secrets-"));
let installBody: unknown = {};
const server = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(req.method === "POST" ? installBody : { requiredInputs: [] }));
  });
});
let baseUrl: string;
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); });

function install(): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dist, "kit", "install", "webhook-triage", "--yes"], {
      env: { ...process.env, WK_API_BASE_URL: baseUrl, WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_install_test",
        WK_NO_UPDATE_CHECK: "1", CI: "1", NO_COLOR: "1" },
      stdio: "pipe",
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}

describe("one-time install secrets", () => {
  it("keeps the worker/setup links and creation handoff in human install output", async () => {
    installBody = { worker: { tokenId: 42 }, workerUrl: "https://workerkit.ai/workers/synthetic-test",
      connectAppsUrl: "https://workerkit.ai/apps", readiness: { status: "blocked", issues: [{ code: "app_not_connected" }] },
      setupActions: [{ code: "connect_apps", apps: ["email"], message: "Connect email", url: "https://workerkit.ai/apps", arguments: {} }] };
    const result = await install();
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("https://workerkit.ai/workers/synthetic-test");
    expect(result.stdout).toContain("https://workerkit.ai/apps");
    expect(result.stdout).toContain(creationResultGuidance);
  });
  it("prints trigger signing secrets when the install returns no worker API key", async () => {
    installBody = { worker: { tokenId: 42 }, install: { rawKey: null, triggers: [{ signingSecret: "whsec_example_only" }] } };
    const result = await install();
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Shown ONCE");
    expect(result.stdout).toContain("Trigger signing secret: whsec_example_only");
    expect(result.stdout).not.toContain("Worker API key");
  });

  it("prints a returned worker API key with the trigger secrets", async () => {
    installBody = { worker: { tokenId: 42 }, install: { rawKey: "pe_example_key", triggers: [{ signingSecret: "whsec_example_only" }] } };
    const result = await install();
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Worker API key: pe_example_key");
    expect(result.stdout).toContain("Trigger signing secret: whsec_example_only");
  });

  it("prints no secrets banner when nothing secret is returned", async () => {
    installBody = { worker: { tokenId: 42 }, install: { rawKey: null, triggers: [] } };
    const result = await install();
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("Shown ONCE");
  });
});
