import { afterEach, describe, expect, it, vi } from "vitest";
import { agentLoginAction, publicPending, startAgentLogin, type PendingLogin } from "../../src/auth/agent-login.js";

describe("agent login output", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(["not a URL", "ftp://localhost/approve", "file://localhost/approve", "javascript://localhost/approve", "http://example.test/approve"])(
    "rejects unsafe approval URL %s", async (approvalUrl) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
        requestId: "request",
        pollSecret: "secret",
        userCode: "ABCD-EFGH",
        expiresAt: "2026-09-20T18:00:00Z",
        approvalUrl,
      }))));
      await expect(startAgentLogin("https://api.workerkit.ai", "Test", ["readWorkers"]))
        .rejects.toThrow("Invalid approval URL.");
    });
  it("whitelists public fields and omits the polling credential", () => {
    const pending: PendingLogin = {
      apiBaseUrl: "https://api.workerkit.ai",
      requestId: "request",
      pollSecret: "secret-do-not-print",
      userCode: "ABCD-EFGH",
      approvalUrl: "https://workerkit.ai/cli-auth-manager?agent=request",
      expiresAt: "2026-09-20T18:00:00Z",
    };
    const result = publicPending(pending);
    expect(result.userCode).toBe("ABCD-EFGH");
    expect(JSON.stringify(result)).not.toContain(pending.pollSecret);
    expect(Object.keys(result)).not.toContain("pollSecret");
    expect(result.interval).toBe(5);
  });
  it("rejects malformed successful responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{")));
    await expect(startAgentLogin("https://api.workerkit.ai", "Test", ["readWorkers"]))
      .rejects.toThrow("Malformed login response.");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: "request",
      pollSecret: "secret",
      userCode: "ABCD-EFGH",
      expiresAt: "not-a-date",
      approvalUrl: "https://workerkit.ai/cli-auth-manager?agent=request",
    }))));
    await expect(startAgentLogin("https://api.workerkit.ai", "Test", ["readWorkers"]))
      .rejects.toThrow("Malformed login response.");
  });
  it("rejects an unknown status instead of treating it as terminal", async () => {
    const pending: PendingLogin = {
      apiBaseUrl: "https://api.workerkit.ai",
      requestId: "request",
      pollSecret: "secret",
      userCode: "ABCD-EFGH",
      approvalUrl: "https://workerkit.ai/cli-auth-manager?agent=request",
      expiresAt: "2026-09-20T18:00:00Z",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "unexpected" }))));
    await expect(agentLoginAction(pending, "status")).rejects.toThrow("Malformed login response.");
  });
});
