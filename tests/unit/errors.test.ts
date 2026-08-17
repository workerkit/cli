import { describe, expect, it } from "vitest";
import type { ApiResult } from "@workerkit/core";
import { classifyError, exitCodeFor } from "../../src/errors.js";

const result = (status: number, data: unknown, retryAfter: number | null = null): ApiResult => ({
  status,
  data,
  quota: { limit: null, used: null, remaining: null, retryAfter },
  requestId: "req-1",
});

describe("classifyError — the five envelope shapes", () => {
  it("general shape {error, message, code}", () => {
    const err = classifyError(result(403, { error: "Forbidden", message: "Missing scope", code: "OPERATION_NOT_ALLOWED" }));
    expect(err.code).toBe("OPERATION_NOT_ALLOWED");
    expect(err.message).toBe("Missing scope");
  });

  it("run shape where error IS the snake_case code (either case)", () => {
    const upper = classifyError(result(422, { error: "RUNTIME_NOT_ENABLED", message: "Hosted runs are off" }));
    expect(upper.code).toBe("RUNTIME_NOT_ENABLED");
    expect(upper.message).toBe("Hosted runs are off");

    const lower = classifyError(result(402, { error: "limit_exceeded", message: "Worker cap reached" }));
    expect(lower.code).toBe("limit_exceeded");
  });

  it("codeless 401", () => {
    const err = classifyError(result(401, {}));
    expect(err.code).toBeNull();
    expect(err.message).toContain("401");
  });

  it("402 feature_gated carries the machine code in feature", () => {
    const err = classifyError(result(402, { error: "feature_gated", feature: "schedules", message: "Upgrade to use schedules" }));
    expect(err.code).toBe("feature_gated:schedules");
  });

  it("legacy PascalCase {StatusCode, Message}", () => {
    const err = classifyError(result(500, { StatusCode: 500, Message: "Boom" }));
    expect(err.message).toBe("Boom");
  });

  it("prose error strings are not mistaken for codes", () => {
    const err = classifyError(result(400, { error: "Something went wrong here" }));
    expect(err.code).toBeNull();
    expect(err.message).toBe("Something went wrong here");
  });
});

describe("exit codes", () => {
  it("maps the documented contract", () => {
    expect(exitCodeFor(0)).toBe(5);
    expect(exitCodeFor(504)).toBe(5);
    expect(exitCodeFor(401)).toBe(3);
    expect(exitCodeFor(403)).toBe(3);
    expect(exitCodeFor(429)).toBe(4);
    expect(exitCodeFor(400)).toBe(1);
    expect(exitCodeFor(500)).toBe(1);
  });
});
