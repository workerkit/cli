import { afterAll, beforeAll, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const configDir = mkdtempSync(join(tmpdir(), "wk-discovery-"));
const requests: Array<{ method?: string; url: URL; authorization?: string }> = [];
const server = createServer((req, res) => {
  requests.push({ method: req.method, url: new URL(req.url!, "http://localhost"), authorization: req.headers.authorization });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(req.url?.includes("install-preview")
    ? { requiredInputs: [], appsNeedingConnection: 0, githubSetup: { explicitSelectionRequired: true } }
    : { repositories: [], filterScope: "page", nextPage: 3 }));
});
let baseUrl: string;
beforeAll(async () => { server.listen(0, "127.0.0.1"); await new Promise<void>(r => server.once("listening", r)); baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`; });
afterAll(() => { server.close(); });

function run(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dist, ...args, "--json"], { env: { ...process.env, WK_API_BASE_URL: baseUrl,
      WK_CONFIG_DIR: configDir, WK_MANAGER_KEY: "pe_mgr_discovery_test", WK_NO_UPDATE_CHECK: "1", CI: "1" }, stdio: "pipe" });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => stdout += data); child.stderr.on("data", data => stderr += data);
    child.on("error", reject); child.on("close", code => resolve({ code, stdout, stderr })); child.stdin.end();
  });
}

it.each(["accounts", "repos", "branches"])("%s reaches the manager API with filters and pagination", async resource => {
  const args = ["apps", "github", resource]; if (resource === "branches") args.push("acme/private");
  args.push("--q", "release", "--page", "2", "--page-size", "10");
  if (resource !== "accounts") args.push("--connection-id", "7");
  const result = await run(args); expect(result.code, result.stderr).toBe(0);
  const request = requests.at(-1)!;
  expect(request.method).toBe("GET"); expect(request.url.pathname).toBe(`/api/manage/apps/github/${resource}`);
  expect(request.authorization).toBe("Bearer pe_mgr_discovery_test");
  expect(request.url.searchParams.get("q")).toBe("release"); expect(request.url.searchParams.get("page")).toBe("2");
  if (resource !== "accounts") expect(request.url.searchParams.get("connectionId")).toBe("7");
  if (resource === "branches") expect(request.url.searchParams.get("repo")).toBe("acme/private");
  expect(JSON.parse(result.stdout)).toMatchObject({ repositories: [], nextPage: 3 });
});
it("refuses invalid pages before networking", async () => {
  const count = requests.length;
  expect((await run(["apps", "github", "repos", "--page-size", "101"])).code).not.toBe(0);
  expect(requests.length).toBe(count);
});

it.each(["workspaces", "conversations"])("Slack %s forwards paging and setup metadata", async resource => {
  const args = ["apps", "slack", resource];
  if (resource === "workspaces") args.push("--page", "2", "--page-size", "10");
  else args.push("--workspace-id", "T1", "--types", "public_channel", "--cursor", "opaque+/=", "--limit", "20", "--q", "support");
  const result = await run(args); expect(result.code, result.stderr).toBe(0);
  const request = requests.at(-1)!;
  expect(request.url.pathname).toBe(`/api/manage/apps/slack/${resource}`);
  expect(request.authorization).toBe("Bearer pe_mgr_discovery_test");
  if (resource === "conversations") {
    expect(request.url.searchParams.get("workspaceId")).toBe("T1");
    expect(request.url.searchParams.get("cursor")).toBe("opaque+/=");
    expect(request.url.searchParams.get("q")).toBe("support");
  }
});

it("refuses obsolete preview and invalid Slack discovery before networking", async () => {
  const count = requests.length;
  expect((await run(["run", "1", "--preview"])).code).not.toBe(0);
  expect((await run(["apps", "slack", "conversations", "--limit", "201"])).code).not.toBe(0);
  expect(requests.length).toBe(count);
});
it("requires explicit GitHub targets before installing when preview requests them", async () => {
  const count = requests.length;
  const result = await run(["kit", "install", "brain", "--yes"]);
  expect(result.code).toBe(2); expect(result.stderr).toContain("--github-selection");
  expect(requests.slice(count).map(r => r.method)).toEqual(["GET"]);
});
