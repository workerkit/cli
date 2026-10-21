import { afterEach, expect, it, vi } from "vitest";
import { byName, type ApiResult } from "@workerkit/core";
import { emitResult } from "../../src/bind.js";
import { renderHybridReceipt, renderRunAttribution, renderRunResult } from "../../src/output/runReceipt.js";
import { renderApiError } from "../../src/errors.js";
import { readCredential } from "../../src/input.js";

afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

it("shows bounded code findings without a model review and protects unreadable receipts", () => {
  const receipt = { qualityEvaluation: { status: "pass", configurationRevision: 3, executionChecks: [
    { checkId: "completion", status: "ok", reason: "Succeeded" },
    { checkId: "tools", title: "Failed attempts", status: "needs_attention", reason: "Runtime: 1; app logs: 1. Do not add.", recommendation: "Inspect the recovered call.\u001b[2J" },
    { checkId: "trace", status: "unknown", reason: "Incomplete telemetry." },
    { checkId: "third", status: "needs_attention", reason: "Another finding." },
    { checkId: "fourth", status: "needs_attention", reason: "A fourth finding." },
  ] } };
  const text = renderRunResult(receipt).join("\n");
  expect(text).toContain("Quality checks: pass");
  expect(text).toContain("Execution checks (code): 3 need attention; 1 unverified");
  expect(text).toContain("Runtime: 1; app logs: 1. Do not add.");
  expect(text).toContain("Next step: Inspect the recovered call.");
  expect(text).not.toContain("\u001b");
  expect(text).not.toContain("Incomplete telemetry."); // Attention is shown first, within the output limit.
  expect(text).toContain("More execution findings");
  expect(text).not.toContain("System learning:");
  expect(renderRunResult({ ...receipt, contentWithheld: true })).toEqual([]);
});

it("shows bounded system recommendations only for readable receipts", () => {
  const receipt = { qualityEvaluation: { status: "pass", configurationRevision: 3, systemReview: {
    state: "partial", checks: [{ checkId: "access", title: "Connections", status: "needs_attention", recommendation: "Reconnect the app and verify a read." }],
  } } };
  const text = renderRunResult(receipt).join("\n");
  expect(text).toContain("Quality checks: pass");
  expect(text).toContain("1 check needs attention");
  expect(text).toContain("Next step (Connections): Reconnect the app and verify a read.");
  expect(renderRunResult({ ...receipt, contentWithheld: true })).toEqual([]);
});

it("reports quality independently of self-assessment and withholds private findings", () => {
  const receipt = { status: "Succeeded", qualityEvaluation: { status: "unknown", configurationRevision: 3,
    criteria: [{ reason: "private finding" }] } };
  const text = renderRunResult(receipt).join("\n");
  expect(text).toContain("Quality checks: unknown; criteria revision 3");
  expect(text).toContain("Unknown is unverified, not a pass");
  expect(text).not.toContain("private finding");
  expect(renderRunResult({ ...receipt, contentWithheld: true })).toEqual([]);
});

it("renders current user labels while retaining IDs as the fallback", () => {
  expect(renderRunAttribution({ initiator: { kind: "user", userId: 42, userDisplayName: "Ada\u001b[2J" } }).join("\n"))
    .toContain("Started by: Ada");
  const text = renderRunAttribution({ initiator: { kind: "fleetKey", userId: 42, userDisplayName: "Ada Example",
    managerKey: { id: 31, name: "Fleet", prefix: "pe_mgr_safe" } } }).join("\n");
  expect(text).toContain("Accountable user: Ada Example");
  expect(text).not.toContain("Accountable user: #42");
});

it("renders worker lineage and separately charged child runs", () => {
  const text = renderRunAttribution({ runId: "child", relationship: "workerCall",
    initiator: { kind: "worker", worker: { runId: "parent" } },
    origin: { runId: "root", initiator: { kind: "fleetKey", managerKey: { id: 31, name: "Fleet", prefix: "pe_mgr_safe" } } },
    workerCalls: [{ alias: "research", runId: "grandchild", status: "Succeeded" }] }).join("\n");
  expect(text).toContain("Started by: Worker");
  expect(text).toContain("Calling run: parent");
  expect(text).toContain("Called worker research: Succeeded; run grandchild (charged separately)");
  expect(text).toContain("Original run: root; Fleet key Fleet (#31, pe_mgr_safe)");
});

it("separates business assessment from execution and pending cancellation charges", () => {
  const text = renderRunResult({ status: "Succeeded", digestStructured: { result: {
    version: 1, completeness: "partial", acceptance: "rejected", unresolved: ["Review\u001b[2J"] } } }).join("\n");
  expect(text).toContain("partial coverage; rejected (self-reported)");
  expect(text).toContain("Unresolved: Review");
  expect(text).not.toContain("\u001b");
  expect(renderRunResult({ status: "Canceled", finishedAtUtc: null }).join("\n")).toContain("still settling");
  expect(renderRunResult({ status: "Canceled", finishedAtUtc: "2026-10-14T00:00:00Z" })).toEqual([]);
});

it("identifies Action child receipts without inventing a model run", () => {
  const text = renderRunAttribution({ workerCalls: [{ alias: "notify", actionInvocationId: "effect-1", status: "outcome_unknown", modelType: "none" }] }).join("\n");
  expect(text).toContain("Action receipt effect-1");
  expect(text).toContain("outcome_unknown");
  expect(text).not.toContain("run not created");
});

it("renders immediate and original identities with terminal text sanitized", () => {
  const text = renderRunAttribution({ runId: "current", parentRunId: "previous", relationship: "questionContinuation",
    initiator: { kind: "fleetKey", userId: 7, managerKey: { id: 32, name: "Answer\u001b[2J", prefix: "pe_mgr_answer" } },
    origin: { runId: "original", initiator: { kind: "fleetKey", userId: 7, managerKey: { id: 31, name: "Research", prefix: "pe_mgr_start" } } } }).join("\n");
  expect(text).toContain("Started by: Fleet key Answer (#32, pe_mgr_answer)");
  expect(text).toContain("Accountable user: #7");
  expect(text).toContain("Continues run: previous");
  expect(text).toContain("Original run: original; Fleet key Research (#31, pe_mgr_start)");
  expect(text).not.toContain("\u001b");
  expect(renderRunAttribution({ triggerKind: "Api", requestedByUserId: 7 })).toEqual(["Started by: Not recorded on this historical receipt"]);
});

it("keeps the raw receipt in JSON even when mapData compacts duplicated decisions", () => {
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const rows = [{ id: "mail-1", answer: "reply" }];
  const data = { decision: { decisions: rows }, digestStructured: { items: rows }, extension: { future: true } };
  const descriptor = byName("run_get")!;
  expect(descriptor.mapData!(data, {})).not.toEqual(data);
  emitResult({ status: 200, data } as ApiResult, descriptor, { tool: "run_get" }, {}, { json: true, plain: false, yes: false });
  expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toEqual(data);
});

it("renders withheld content, omissions and uncertain actions without claiming success", () => {
  const withheld = renderHybridReceipt({ kind: "hybrid", contentWithheld: true, runId: "id", status: "Succeeded" });
  expect(withheld).toContain("Run content withheld");
  const text = renderHybridReceipt({ kind: "hybrid", runId: "id\u001b[2J", status: "Failed", finalDigest: "Check the draft",
    agent: { status: "failed", actionsOmitted: 2, selectedIdsOmitted: 1,
      actions: [{ tool: "draft", status: "unknown", resultReferences: { draftId: "unconfirmed-id" } }] } });
  expect(text).not.toContain("\u001b[2J");
  expect(text).not.toContain("unconfirmed-id");
  expect(text).toContain("Check the app before trying this action again");
  expect(text).toContain("2 additional action records omitted");
  expect(text).toContain("1 selected item references omitted");
});

it("sanitizes error metadata as well as error prose", () => {
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  renderApiError({ status: 400, data: { code: "bad\u001b[2J", message: "Bad input" },
    requestId: "id\u001b[2J", quota: { limit: null, used: null, remaining: null, retryAfter: null } }, false);
  expect(write.mock.calls.map(call => call[0]).join("")).not.toContain("\u001b[2J");
});

it("does not echo a malformed secret field", async () => {
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  expect(await readCredential({ field: ["a-secret-without-an-equals-sign"] }, [])).toBeNull();
  expect(write.mock.calls.map(call => call[0]).join("")).not.toContain("a-secret-without");
});
