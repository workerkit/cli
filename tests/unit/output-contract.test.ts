import { afterEach, expect, it, vi } from "vitest";
import { byName, type ApiResult } from "@workerkit/core";
import { emitResult } from "../../src/bind.js";
import { renderHybridReceipt } from "../../src/output/runReceipt.js";
import { renderApiError } from "../../src/errors.js";
import { readCredential } from "../../src/input.js";

afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

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
