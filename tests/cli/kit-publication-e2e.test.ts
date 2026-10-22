import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-kit-publication-test-"));
const calls: Array<{ url: string; body: unknown }> = [];
const kit = { name: "Private helper", jobSentence: "Summarizes email.", categorySlugs: ["productivity"], content: { instructionContent: "Summarize email.", appCodes: ["email"] } };
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  calls.push({ url: req.url!, body: raw ? JSON.parse(raw) : null });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(req.url?.includes("/validate")
    ? { canPublish: true, errors: [], warnings: [] }
    : { slug: "private-helper", status: "private" }));
});
let baseUrl: string;
beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); });

function wk(args: string[], body: unknown): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dist, "kit", ...args, "--yes", "--json"], {
      env: { ...process.env, WK_API_BASE_URL: baseUrl, WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_kit_test", WK_NO_UPDATE_CHECK: "1", CI: "1" },
      stdio: "pipe",
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(body));
  });
}

describe.skipIf(!existsSync(dist))("public kit publishing pause", () => {
  it.each([["publish"], ["replace", "private-helper"]])("refuses public and omitted visibility before any request: %j", async (...args) => {
    for (const [flags, body] of [
      [[], kit],
      [["--public", "--skip-validate"], { ...kit, visibility: "private" }],
      [["--skip-validate"], { ...kit, visibility: "public" }],
    ] as Array<[string[], unknown]>) {
      const count = calls.length;
      const result = await wk([...args, ...flags], body);
      expect(result.code, result.stderr).toBe(2);
      expect(result.stderr).toContain("temporarily disabled");
      expect(calls).toHaveLength(count);
    }
  });

  it.each([["publish"], ["replace", "private-helper"]])("still validates and writes an explicitly private kit: %j", async (...args) => {
    const result = await wk([...args, "--private"], kit);
    expect(result.code, result.stderr).toBe(0);
    expect(calls.at(-2)?.url).toContain("/api/manage/kits/validate");
    expect(calls.at(-2)?.body).toMatchObject({ visibility: "private" });
    expect(calls.at(-1)?.body).toMatchObject({ visibility: "private" });
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "private" });
  });
});
