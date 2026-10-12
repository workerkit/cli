import type { Command } from "commander";
import { mountTool } from "../bind.js";
import { bold } from "../output/colors.js";
import { sanitizeInline } from "../output/sanitize.js";

/**
 * `wk support`: contact WorkerKit support on the signed-in user's behalf. The reply goes to that
 * user by email and quotes the printed reference.
 */
export function mountSupport(program: Command): void {
  mountTool(program, "support", {
    tool: "support_request_create",
    render: (data) => {
      const body = data as { referenceNumber?: string; message?: string };
      if (typeof body.referenceNumber !== "string") return null;
      return `${bold(`Reference ${sanitizeInline(body.referenceNumber)}`)}\n${sanitizeInline(body.message ?? "")}`;
    },
  });
}
