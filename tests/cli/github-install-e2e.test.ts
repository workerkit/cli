import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-github-install-"));
const installs: unknown[] = [];
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (req.method === "POST") installs.push(JSON.parse(raw));
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(req.method === "POST" ? { worker: { tokenId: 42 } } : {
    requiredInputs: [], githubAccounts: [{ connectionId: 7, login: "acme" }],
  }));
});
let baseUrl: string;
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); });

function install(selection?: unknown, workerBindings?: unknown): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const args = [dist, "kit", "install", "github-triage", "--yes", "--json"];
    if (selection !== undefined) args.push("--github-selection", JSON.stringify(selection));
    if (workerBindings !== undefined) args.push("--worker-bindings", JSON.stringify(workerBindings));
    const child = spawn(process.execPath, args, { env: { ...process.env, WK_API_BASE_URL: baseUrl,
      WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_github_test", WK_NO_UPDATE_CHECK: "1", CI: "1" }, stdio: "pipe" });
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stderr }));
    child.stdin.end();
  });
}

describe("kit GitHub selections on the wire", () => {
  it("forwards explicit worker bindings and rejects malformed worker IDs", async () => {
    const workerBindings = { research: "11111111-1111-4111-8111-111111111111" };
    const result = await install(undefined, workerBindings);
    expect(result.code, result.stderr).toBe(0);
    expect(installs.at(-1)).toMatchObject({ workerBindings });
    const count = installs.length;
    expect((await install(undefined, { research: "pe_secret" })).code).toBe(2);
    expect(installs).toHaveLength(count);
  });
  it("forwards multiple accounts and explicit setup later without widening selections", async () => {
    for (const accounts of [[], [
      { connectionId: 7, repositoryMode: "selected", repositoryIds: [101, 102] },
      { connectionId: 8, repositoryMode: "all", repositoryIds: [] },
    ]]) {
      const githubSelection = { accounts };
      const result = await install(githubSelection);
      expect(result.code, result.stderr).toBe(0);
      expect(installs.at(-1)).toMatchObject({ githubSelection });
    }
  });
  it("rejects malformed selections without submitting an install", async () => {
    const count = installs.length;
    for (const selection of [[], { accounts: [{ connectionId: 7, repositoryMode: "selected", repositoryIds: [] }] }]) {
      expect((await install(selection)).code).not.toBe(0);
    }
    expect(installs).toHaveLength(count);
  });
  it("preserves legacy requests that omit GitHub selections", async () => {
    const result = await install();
    expect(result.code, result.stderr).toBe(0);
    expect(installs.at(-1)).not.toHaveProperty("githubSelection");
  });
});
