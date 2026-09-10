import type { Command } from "commander";
import { mountTool } from "../bind.js";

export function mountFleet(program: Command): void {
  const fleet = program.command("fleet").description("Account-wide views: everything in flight, the account-wide budget");

  mountTool(fleet, "pulse", {
    tool: "fleet_pulse",
    summary: "Every run in flight across the account, in one call (no per-worker fan-out)",
  });

  mountTool(fleet, "budget", {
    tool: "fleet_budget_get",
    summary: "The account-wide daily / monthly spend ceilings above the per-worker caps",
  });

  mountTool(fleet, "budget-set", {
    tool: "fleet_budget_set",
    summary: "Set or clear the account-wide daily / monthly ceilings (a breach refuses new runs; nothing is paused)",
  });
}
