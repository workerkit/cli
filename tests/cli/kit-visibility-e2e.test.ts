import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-kit-visibility-test-"));
const shared = { slug: "shared-helper", name: "Shared helper", status: "private", isPersonal: false };
const personal = { slug: "personal-helper", name: "Personal helper", status: "private", isPersonal: true };
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) as { visibility?: string } : {};
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(req.method === "GET"
    ? { items: [shared, personal] }
    : body.visibility === "personal" ? personal : shared));
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
    const child = spawn(process.execPath, [dist, "kit", ...args, "--yes"], {
      env: { ...process.env, WK_API_BASE_URL: baseUrl, WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_kit_test", WK_NO_UPDATE_CHECK: "1", CI: "1" },
      stdio: "pipe",
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify({ name: "Helper", jobSentence: "Summarizes email.", categorySlugs: ["productivity"], content: { instructionContent: "Summarize email.", appCodes: ["email"] } }));
  });
}

describe.skipIf(!existsSync(dist))("kit visibility in human output", () => {
  it.each([["publish"], ["replace", "personal-helper"]])("shows a personal result and keeps its install hint: %j", async (...args) => {
    const result = await wk([...args, "--personal", "--skip-validate"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("(personal)");
    expect(result.stdout).toContain("wk kit install personal-helper");
  });

  it("keeps shared private kits distinct in publish output", async () => {
    const result = await wk(["publish", "--private", "--skip-validate"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("(private)");
    expect(result.stdout).toContain("wk kit install shared-helper");
  });

  it("distinguishes personal and shared private kits in the owner listing", async () => {
    const result = await wk(["mine"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/shared-helper\s+Shared helper\s+private\b/);
    expect(result.stdout).toMatch(/personal-helper\s+Personal helper\s+personal\b/);
  });
});
