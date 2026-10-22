import type { Command } from "commander";
import { mountTool } from "../bind.js";
import { green, red, yellow } from "../output/colors.js";
import { sanitizeInline } from "../output/sanitize.js";
import { renderTable } from "../output/table.js";

interface ActivityRow {
  at?: string;
  kind?: string;
  outcome?: string;
  workerTitle?: string | null;
  title?: string;
}

function paintOutcome(outcome: string): string {
  if (outcome === "ok") return green(outcome);
  if (outcome === "failed" || outcome === "blocked") return red(outcome);
  if (outcome === "attention" || outcome === "running") return yellow(outcome);
  return outcome;
}

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
  const account = program.command("account").description("The account's headroom and spend: plan, slots, wallet, request windows, spend by worker, day and model");

  mountTool(account, "usage", {
    tool: "account_usage",
  });

  mountTool(account, "spend", {
    tool: "account_spend",
  });
}

export function mountActivity(program: Command): void {
  const activity = program.command("activity").description("Runs, app calls and configuration changes across the fleet");

  mountTool(activity, "feed", {
    tool: "activity_feed",
    render: (data) => {
      const body = data as { items?: ActivityRow[]; hasMore?: boolean; nextCursor?: string | null };
      if (!Array.isArray(body.items)) return null;
      if (body.items.length === 0) return "No activity matches.";
      const table = renderTable(body.items, [
        { header: "AT", value: (r) => r.at ?? "" },
        { header: "KIND", value: (r) => r.kind ?? "" },
        { header: "OUTCOME", value: (r) => r.outcome ?? "", paint: paintOutcome },
        { header: "WORKER", value: (r) => r.workerTitle ?? "", maxWidth: 28 },
        { header: "TITLE", value: (r) => r.title ?? "", maxWidth: 48 },
      ]);
      return body.hasMore && body.nextCursor
        ? `${table}\n\nOlder activity: repeat the command with --cursor ${sanitizeInline(body.nextCursor)}`
        : table;
    },
  });

  mountTool(activity, "summary", {
    tool: "activity_summary",
  });
}
