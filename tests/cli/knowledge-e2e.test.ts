import { afterAll, beforeAll, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-knowledge-test-"));
const calls: Array<{ method?: string; url?: string; auth?: string; body: unknown }> = [];
const page = { items: [{ id: "44444444-4444-4444-8444-444444444444", citation: "wk:run:test:v2" }], hasMore: true, nextCursor: "opaque", coverage: "retained", consistency: "snapshot" };
const server = createServer(async (req, res) => {
  let body = ""; for await (const part of req) body += part;
  calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
  res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(page));
});
let baseUrl: string;
beforeAll(async () => { server.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve)); baseUrl = `http://127.0.0.1:${(server.address() as {port:number}).port}`; });
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  rmSync(configDir, { recursive: true, force: true });
});
function wk(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dist, "knowledge", ...args, "--json"], {
      env: { ...process.env, WK_API_BASE_URL: baseUrl, WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_knowledge_test", WK_NO_UPDATE_CHECK: "1", CI: "1" }, stdio: "pipe",
    });
    let stdout = "", stderr = ""; child.stdout.on("data", c => {stdout += c;}); child.stderr.on("data", c => {stderr += c;});
    child.on("error", reject); child.on("close", code => resolve({code,stdout,stderr})); child.stdin.end();
  });
}
it("preserves search filters, full-read continuation and opaque change cursors on the wire", async () => {
  const filters = {appsUsed:["slack"],fromUtc:"2026-10-01T00:00:00Z"};
  const search = await wk(["search", "--query", "Acme delivery", "--match", "anyTerms", "--filters", JSON.stringify(filters), "--limit", "5"]);
  expect(search.code, search.stderr).toBe(0); expect(JSON.parse(search.stdout)).toEqual(page);
  expect(calls.at(-1)).toEqual({method:"POST",url:"/api/manage/knowledge/search",auth:"Bearer pe_mgr_knowledge_test",body:{query:"Acme delivery",match:"anyTerms",filters,limit:5}});
  for (const [args, path] of [
    [["sources", "--cursor", "next-source"], "/api/manage/knowledge/sources"],
    [["changes", "--cursor", "next-change"], "/api/manage/knowledge/changes"],
    [["get", page.items[0]!.id, "--evidence-version", "2", "--section", "structured", "--offset", "256"], `/api/manage/knowledge/items/${page.items[0]!.id}`],
  ] as const) {
    const response = await wk([...args]); expect(response.code, response.stderr).toBe(0);
    expect(new URL(calls.at(-1)!.url!, baseUrl).pathname).toBe(path); expect(JSON.parse(response.stdout)).toEqual(page);
  }
  expect(new URL(calls.at(-1)!.url!, baseUrl).searchParams.get("offset")).toBe("256");
  expect(new URL(calls.at(-1)!.url!, baseUrl).searchParams.get("version")).toBe("2");
  const before = calls.length;
  const invalid = await wk(["search", "--mode", "semantic"]); expect(invalid.code).not.toBe(0); expect(calls).toHaveLength(before);
});

it("sends explicit configuration booleans and preserves audiences without null identities", async () => {
  const audiences = [{workerId:page.items[0]!.id,allWorkers:true,workerIds:[]}];
  const response = await wk(["configuration", "set", "--expected-version", "3", "--enabled", "--all-workers",
    "--no-include-structured", "--audiences", JSON.stringify(audiences)]);
  expect(response.code, response.stderr).toBe(0);
  expect(calls.at(-1)).toEqual({method:"PUT",url:"/api/manage/knowledge/configuration",auth:"Bearer pe_mgr_knowledge_test",
    body:{expectedVersion:3,enabled:true,allWorkers:true,includeStructured:false,audiences}});
  const before = calls.length;
  const incomplete = await wk(["configuration", "set", "--expected-version", "3"]);
  expect(incomplete.code).not.toBe(0); expect(calls).toHaveLength(before);
});
