import type { Command } from "commander";
import { mountTool } from "../bind.js";

export function mountFleet(program: Command): void {
  const fleet = program.command("fleet").description("Account-wide views: everything in flight, the account-wide budget");

  mountTool(fleet, "pulse", {
    tool: "fleet_pulse",
  });

  mountTool(fleet, "health", {
    tool: "fleet_health",
  });

  mountTool(fleet, "budget", {
    tool: "fleet_budget_get",
  });

  mountTool(fleet, "budget-set", {
    tool: "fleet_budget_set",
  });
}

export function mountAccount(program: Command): void {
  const account = program.command("account").description("The account's headroom: plan, slots, wallet, request windows, spend");

  mountTool(account, "usage", {
    tool: "account_usage",
  });
}
