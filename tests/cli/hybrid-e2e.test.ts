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
const sourceId = 'mail-' + 'x'.repeat(240);
const receipt = { kind: 'hybrid', runId: '11111111-1111-4111-8111-111111111111', status: 'Succeeded', finalDigest: 'Drafted one reply',
  modelCostUsd: 2.4, walletChargeUsd: 0.12, billingMode: 'Byok',
  decision: { calls: 20, outcome: 'Five eligible', decisions: [{ id: sourceId, route: 'agent' }] },
  agent: { status: 'completed', selectedCount: 5, eligibleCount: 5, actions: [{ tool: 'email_create_reply_draft', sourceId, status: 'confirmed', resultReferences: { draftId: 'draft-123' } }] },
  usageBreakdown: { decision: { calls: 20, requestedModel: 'evaluated-decision', measuredCostUsd: 0.04, funding: 'platform' }, language: { calls: 1, requestedModel: 'language-model', measuredCostUsd: 2.36, funding: 'byok' } },
};
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  calls.push({ url: req.url!, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(req.url?.includes('/instruction')
    ? { modelType: 'hybrid', instruction: { content: 'Draft replies only.' }, decision: { narration: 'Classify support questions.', setup: [] } }
    : req.url === '/api/manage/workers/42' ? { modelType: 'hybrid' } : receipt));
});
let baseUrl: string;
beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
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


describe.skipIf(!existsSync(dist))('hybrid commands on the wire', () => {
  it('attaches and removes with required explicit nullable fields', async () => {
    const spec = { schemaVersion: 3, agentAction: { maxItems: 5 } };
    const attached = await wk(['decision', 'set', '42', '--decision-spec', JSON.stringify(spec), '--answers', '{}', '--updated-at', 'null', '--json']);
    expect(attached.code, attached.stderr).toBe(0);
    expect(calls.at(-1)).toMatchObject({ url: '/api/manage/workers/42/decision', body: { decisionSpec: spec, answers: {}, updatedAt: null } });
    const removed = await wk(['decision', 'set', '42', '--decision-spec', 'null', '--updated-at', '2026-09-22T12:00:00Z', '--json']);
    expect(removed.code, removed.stderr).toBe(0);
    expect(calls.at(-1)?.body).toEqual({ decisionSpec: null, updatedAt: '2026-09-22T12:00:00Z' });
  });
  it('renders both instruction and classifier sections', async () => {
    const result = await wk(['instruction', 'get', '42']);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('Language instruction');
    expect(result.stdout).toContain('Draft replies only.');
    expect(result.stdout).toContain('Classify support questions.');
  });
  it('preserves hybrid receipt JSON and sends combined run inputs', async () => {
    const result = await wk(['run', '42', '--prompt', 'Draft concise replies', '--source-args', '{"query":"test"}', '--max-items', '20', '--wait-seconds', '55', '--json']);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject(receipt);
    expect(calls.at(-1)?.body).toMatchObject({ prompt: 'Draft concise replies', sourceArgs: { query: 'test' }, maxItems: 20, waitSeconds: 55 });
  });
  it('renders exact draft evidence and combined wallet charge', async () => {
    const result = await wk(['runs', 'get', '11111111-1111-4111-8111-111111111111']);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(sourceId);
    expect(result.stdout).toContain('draft-123');
    expect(result.stdout).toContain('Wallet charge: $0.12');
    expect(result.stdout).toContain('Language: 1 calls');
  });
});
