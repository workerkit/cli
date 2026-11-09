import type { Command } from "commander";
import { mountTool } from "../bind.js";

export function mountApprovals(program: Command): void {
  const approvals = program.command("approvals").description("Read exact action requests and review history; decisions require the dashboard");
  mountTool(approvals, "list", { tool: "approvals_list" });
  mountTool(approvals, "get", { tool: "approval_get", positionals: ["id"] });
}
