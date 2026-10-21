import { afterAll, beforeAll, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-quality-test-"));
const calls: Array<{ method?: string; url?: string; body: unknown }> = [];
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  calls.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ revision: 4, gates: { qualityAndSuggestionsEnabled: true, automaticImprovementEnabled: false, sharedLearningEnabled: false } }));
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
    const child = spawn(process.execPath, [dist, "--json", "workers", "quality", ...args], {
      env: { ...process.env, WK_API_BASE_URL: baseUrl, WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_quality_test", WK_NO_UPDATE_CHECK: "1", CI: "1" }, stdio: "pipe",
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}

it("reads and updates quality with optimistic concurrency and revoke-only learning fields", async () => {
  const read = await wk(["get", "42"]);
  expect(read.code, read.stderr).toBe(0);
  expect(calls.at(-1)).toEqual({ method: "GET", url: "/api/manage/workers/42/quality", body: null });
  const changed = await wk(["set", "42", "--expected-revision", "3", "--quality-and-suggestions-enabled", "--automatic-improvement-enabled", "false", "--shared-learning-enabled", "false"]);
  expect(changed.code, changed.stderr).toBe(0);
  expect(calls.at(-1)).toEqual({ method: "PATCH", url: "/api/manage/workers/42/quality", body: { expectedRevision: 3, qualityAndSuggestionsEnabled: true, automaticImprovementEnabled: false, sharedLearningEnabled: false } });
  expect(JSON.parse(changed.stdout).revision).toBe(4);
  const before = calls.length;
  const refused = await wk(["set", "42", "--expected-revision", "4", "--automatic-improvement-enabled", "true"]);
  expect(refused.code).toBe(2);
  expect(calls).toHaveLength(before);
});

it("previews supplied evidence without writing settings or starting a run", async () => {
  const spec = { schemaVersion: 1, criteria: [] };
  const result = await wk(["preview", "42", "--spec", JSON.stringify(spec), "--evidence", "[]"]);
  expect(result.code, result.stderr).toBe(0);
  expect(calls.at(-1)).toEqual({ method: "POST", url: "/api/manage/workers/42/quality/preview", body: { spec, evidence: [] } });
});
