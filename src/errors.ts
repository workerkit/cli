import type { ApiResult } from "@workerkit/core";
import { dim, red } from "./output/colors.js";
import { sanitizeInline } from "./output/sanitize.js";

/**
 * Normalizes the API's error envelope variants into one shape:
 *  - { error, message, code? }        — general surface (error may be prose, code machine)
 *  - { error, message }               — run endpoints, where `error` IS the snake_case code
 *  - codeless 401 bodies
 *  - 402 { error: "feature_gated", feature, message } — the machine code is in `feature`
 *  - { StatusCode, Message }          — one legacy PascalCase shape
 */
export interface ClassifiedError {
  httpStatus: number;
  code: string | null;
  message: string;
  retryAfter: number | null;
}

// A machine code is a single all-lowercase token ("invalid_key") or an underscore-joined token in
// any case ("RUNTIME_NOT_ENABLED") — never prose like "Forbidden" or "Something went wrong".
const CODE_SHAPED = /^(?:[a-z0-9]+|[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+)$/;

export function classifyError(result: ApiResult): ClassifiedError {
  const body = (result.data ?? {}) as Record<string, unknown>;
  let code: string | null = null;
  let message: string | null = null;

  if (typeof body.code === "string" && body.code) code = body.code;
  if (typeof body.message === "string" && body.message) message = body.message;

  if (typeof body.error === "string" && body.error) {
    if (result.status === 402 && body.error === "feature_gated" && typeof body.feature === "string") {
      code = `feature_gated:${body.feature}`;
    } else if (!code && CODE_SHAPED.test(body.error)) {
      code = body.error;
    }
    if (!message) message = body.error;
  }

  // Legacy PascalCase shape.
  if (!message && typeof body.Message === "string" && body.Message) message = body.Message;

  if (!message) {
    message =
      result.status === 0
        ? "Could not reach the server. Check your connection."
        : `Request failed (HTTP ${result.status}).`;
  }

  return {
    httpStatus: result.status,
    code,
    message,
    retryAfter: result.quota.retryAfter,
  };
}

/** Exit-code contract (documented in the README; pinned by golden tests). */
export function exitCodeFor(status: number): number {
  if (status === 0 || status === 504) return 5; // transport / local timeout
  if (status === 401 || status === 403) return 3;
  if (status === 429) return 4;
  return 1;
}

/** Human rendering with targeted hints. Returns the process exit code. */
export function renderApiError(result: ApiResult, json: boolean): number {
  const err = classifyError(result);

  if (json) {
    process.stderr.write(
      JSON.stringify({ status: err.httpStatus, code: err.code, message: err.message, requestId: result.requestId }) +
        "\n",
    );
    return exitCodeFor(err.httpStatus);
  }

  const parts = [err.code, `HTTP ${err.httpStatus}`, result.requestId ? `request ${result.requestId}` : null]
    .filter(Boolean)
    .join(" · ");
  process.stderr.write(`${red("Error:")} ${sanitizeInline(err.message)}\n${dim(`(${parts})`)}\n`);

  const hint = hintFor(err);
  if (hint) process.stderr.write(`${hint}\n`);

  return exitCodeFor(err.httpStatus);
}

function hintFor(err: ClassifiedError): string | null {
  if (err.httpStatus === 401) return "Sign in with `wk auth login`, or check WK_MANAGER_KEY.";
  if (err.httpStatus === 403)
    return "Your manager key is missing a scope for this operation. Re-mint it with the needed scopes at workerkit.ai.";
  if (err.httpStatus === 429)
    return err.retryAfter !== null ? `Rate limited — retry after ${err.retryAfter}s.` : "Rate limited — slow down and retry.";
  if (err.code?.toUpperCase() === "RUNTIME_NOT_ENABLED")
    return "Hosted runs are not enabled for this environment — this is a server-side switch, retrying won't help.";
  if (err.code?.startsWith("feature_gated:"))
    return "This feature needs a plan upgrade — see your workerkit.ai billing page.";
  return null;
}
