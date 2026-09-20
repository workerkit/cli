import type { Command } from "commander";
import { mountTool } from "../bind.js";

export function mountOnboarding(program: Command): void {
  mountTool(program, "onboarding", {
    tool: "onboarding_get",
    summary: "Check model funding and the next human setup steps",
  });
  const wallet = program.command("wallet").description("Inspect funding and request a human-confirmed payment");
  mountTool(wallet, "balance", { tool: "wallet_get" });
  mountTool(wallet, "checkout", {
    tool: "wallet_checkout_create",
    confirm: (params) =>
      `Request a $${params.amountUsd} wallet top-up? The person must review fees and pay in Stripe Checkout.`,
  });
  mountTool(wallet, "checkout-status", { tool: "wallet_checkout_get", positionals: ["sessionId"] });
}
