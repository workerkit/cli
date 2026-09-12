import type { Command } from "commander";
import { mountTool } from "../bind.js";

export function mountFleet(program: Command): void {
  const fleet = program.command("fleet").description("Account-wide views: everything in flight, the account-wide budget");

  mountTool(fleet, "pulse", {
    tool: "fleet_pulse",
    summary: "Every run in flight across the account, in one call (no per-worker fan-out)",
  });

  mountTool(fleet, "health", {
    tool: "fleet_health",
    summary: "The fleet's rot in one call: blocked, undeployed, overdue schedules, open questions, last runs needing attention",
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

export function mountAccount(program: Command): void {
  const account = program.command("account").description("The account's headroom: plan, slots, wallet, request windows, spend");

  mountTool(account, "usage", {
    tool: "account_usage",
    summary: "Plan, worker and hosted slots, spendable wallet, request windows and spend — read before an install, deploy or run",
  });
}
