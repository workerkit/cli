import type { Command } from "commander";
import { mountTool } from "../bind.js";
import { renderTable } from "../output/table.js";
import { bold, red } from "../output/colors.js";
import { sanitizeInline } from "../output/sanitize.js";

interface DeliveryRow {
  deliveryId?: number;
  channel?: string;
  title?: string | null;
  condition?: string;
  isEnabled?: boolean;
  targetLabel?: string | null;
}

/**
 * A webhook destination's signing secret exists exactly once: in the create response and in
 * the rotate response. Print it the way `kit install` prints a worker's key — loudly, and
 * before anything else the human might scroll past.
 */
function secretOnce(data: unknown): string | null {
  const body = data as DeliveryRow & { signingSecret?: string | null };
  if (typeof body !== "object" || body === null) return null;
  const lines: string[] = [];
  if (body.deliveryId !== undefined) lines.push(`Destination ${body.deliveryId} (${sanitizeInline(body.channel ?? "?")})`);
  if (typeof body.signingSecret === "string" && body.signingSecret.length > 0) {
    lines.push(red(bold("Signing secret — shown ONCE, store it now:")));
    lines.push(`  ${sanitizeInline(body.signingSecret)}`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

export function mountDeliveries(program: Command): void {
  const deliveries = program
    .command("deliveries")
    .description("Where the platform sends a worker's run reports (email, Slack, Teams, Telegram, Discord, SMS, webhook)");

  mountTool(deliveries, "list", {
    tool: "delivery_list",
    positionals: ["tokenId"],
    summary: "A worker's delivery destinations",
    render: (data) => {
      const body = data as { deliveries?: DeliveryRow[] } | DeliveryRow[];
      const rows = Array.isArray(body) ? body : body.deliveries;
      if (!Array.isArray(rows)) return null;
      if (rows.length === 0) return "No delivery destinations. Add one with `wk deliveries create <tokenId> <channel> ...`.";
      return renderTable(rows, [
        { header: "ID", value: (d) => String(d.deliveryId ?? "") },
        { header: "CHANNEL", value: (d) => d.channel ?? "" },
        { header: "TITLE", value: (d) => d.title ?? "", maxWidth: 28 },
        { header: "WHEN", value: (d) => d.condition ?? "" },
        { header: "ENABLED", value: (d) => (d.isEnabled === false ? "no" : "yes") },
        { header: "TARGET", value: (d) => d.targetLabel ?? "", maxWidth: 40 },
      ]);
    },
  });

  mountTool(deliveries, "channels", {
    tool: "delivery_channels",
    positionals: ["tokenId"],
    summary: "Which channels this account can deliver to right now (connection state per channel)",
  });

  mountTool(deliveries, "create", {
    tool: "delivery_create",
    positionals: ["tokenId", "channel"],
    summary: "Add a destination: wk deliveries create <tokenId> <channel> --target '{...}' (a webhook's secret is shown once)",
    render: secretOnce,
  });

  mountTool(deliveries, "update", {
    tool: "delivery_update",
    positionals: ["tokenId", "deliveryId"],
    summary: "Edit a destination (the channel is immutable — delete and recreate to change it)",
  });

  mountTool(deliveries, "rotate-secret", {
    tool: "delivery_secret_rotate",
    positionals: ["tokenId", "deliveryId"],
    confirm: (p) => `Rotate the signing secret of destination ${p.deliveryId}? The previous secret stops verifying immediately.`,
    summary: "Mint a new webhook signing secret (shown once); the old one stops verifying at once",
    render: secretOnce,
  });

  mountTool(deliveries, "delete", {
    tool: "delivery_delete",
    positionals: ["tokenId", "deliveryId"],
    confirm: (p) => `Delete delivery destination ${p.deliveryId} from worker ${p.tokenId}? (disable it with update --no-is-enabled to keep the configuration)`,
    summary: "Delete a destination",
  });
}
