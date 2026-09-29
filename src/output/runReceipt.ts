import { bold, yellow } from "./colors.js";
import { sanitizeInline, sanitizeText } from "./sanitize.js";

interface DecisionRow {
  route?: string;
  executed?: boolean;
  ok?: boolean;
}

export interface DecisionBlock {
  mode?: "item" | "corpus";
  aboveFloorPercent?: number;
  counts?: { fetched: number; submitted: number; returned: number; omitted: number; notAttempted: number };
  source?: { state?: string; complete?: boolean | null; hasMore?: boolean };
  outcome?: string;
  confidence?: number;
  model?: string;
  answersOverride?: Record<string, unknown> | null;
  decisions?: DecisionRow[];
  openQuestions?: unknown[];
  contentWithheld?: boolean;
}

/** The settled receipt's decision block, as a few lines rather than a JSON dump. */
export function renderDecision(block: DecisionBlock): string[] {
  if (block.contentWithheld) {
    return [yellow("Decision rows withheld: this key lacks the readRuns scope.")];
  }
  const lines: string[] = [];
  if (typeof block.outcome === "string") lines.push(`${bold("Decision:")} ${sanitizeInline(block.outcome)}`);
  const floor = block.aboveFloorPercent ?? block.confidence;
  if (typeof floor === "number") lines.push(`Above floor: ${floor}% of judged items`);
  if (block.counts) lines.push(`${inline(block.counts.submitted)}/${inline(block.counts.fetched)} submitted; ${inline(block.counts.notAttempted)} not attempted; ${inline(block.counts.returned)} rows shown, ${inline(block.counts.omitted)} omitted.`);
  if (block.source) lines.push(`Source: ${sanitizeInline(block.source.state ?? "unknown")}; coverage ${block.source.complete === true ? "complete" : block.source.complete === false ? "partial" : "unknown"}${block.source.hasMore ? "; more data available" : ""}.`);

  const rows = Array.isArray(block.decisions) ? block.decisions : [];
  if (rows.length > 0) {
    const acted = rows.filter((r) => r.executed).length;
    const failed = rows.filter((r) => r.executed && r.ok === false).length;
    const belowFloor = rows.filter((r) => r.route === "below_floor").length;
    const parts = [`${rows.length} ${block.mode === "corpus" ? "finalist" : "result"} rows shown`];
    if (acted > 0) parts.push(`${acted} acted on`);
    if (belowFloor > 0) parts.push(`${belowFloor} below the floor`);
    if (failed > 0) parts.push(yellow(`${failed} failed`));
    lines.push(`Items: ${parts.join(", ")}`);
  }

  // The per-run answers the run was actually minted with: the receipt is where a caller confirms
  // an override landed, rather than assuming it did.
  const override = block.answersOverride;
  if (override && typeof override === "object" && Object.keys(override).length > 0) {
    lines.push(`Per-run answers applied: ${sanitizeInline(Object.keys(override).join(", "))}`);
  }
  if (typeof block.model === "string") lines.push(`Decision model: ${sanitizeInline(block.model)}`);

  const open = Array.isArray(block.openQuestions) ? block.openQuestions.length : 0;
  if (open > 0) lines.push(yellow(`${open} open question(s) for a person to look at.`));
  if (lines.length > 0) lines.push("Per-item rows: `wk runs get <runId> --json`.");
  return lines;
}


function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function inline(value: unknown): string {
  return sanitizeInline(String(value ?? "unknown"));
}

export function renderHybridStages(data: unknown): string[] {
  const receipt = object(data);
  if (!receipt || receipt.kind !== "hybrid") return [];
  const lines: string[] = [];
  const agent = object(receipt.agent);
  if (agent) {
    const reason = agent.reason ? ` (${inline(agent.reason)})` : "";
    lines.push(`Agent: ${inline(agent.status)}${reason}; ${inline(agent.selectedCount)} selected / ${inline(agent.eligibleCount)} eligible.`);
    for (const value of Array.isArray(agent.actions) ? agent.actions : []) {
      const action = object(value);
      if (!action) continue;
      lines.push(`  ${inline(action.status)}: ${inline(action.tool)} for ${inline(action.sourceId)}`);
      if (action.status === "confirmed") {
        for (const [key, reference] of Object.entries(object(action.resultReferences) ?? {})) {
          lines.push(`    ${inline(key)}: ${inline(reference)}`);
        }
      }
      if (action.status === "unknown") lines.push("    Check the app before trying this action again.");
    }
    if (typeof agent.actionsOmitted === "number" && agent.actionsOmitted > 0) {
      lines.push(`${agent.actionsOmitted} additional action records omitted.`);
    }
    if (typeof agent.selectedIdsOmitted === "number" && agent.selectedIdsOmitted > 0) {
      lines.push(`${agent.selectedIdsOmitted} selected item references omitted.`);
    }
  }
  const usage = object(receipt.usageBreakdown);
  if (usage) {
    for (const stage of ["decision", "language"]) {
      const part = object(usage[stage]);
      if (!part) continue;
      const label = stage === "decision" ? "Classification" : "Language";
      lines.push(`${label}: ${inline(part.calls)} calls; ${inline(part.requestedModel)}; $${inline(part.measuredCostUsd)} measured usage (${inline(part.funding)}).`);
    }
  }
  if (typeof receipt.walletChargeUsd === "number") lines.push(`Wallet charge: $${receipt.walletChargeUsd}`);
  return lines;
}

export function renderHybridReceipt(data: unknown): string | null {
  const receipt = object(data);
  if (!receipt || receipt.kind !== "hybrid") return null;
  const lines = [`Run: ${inline(receipt.runId)} (${inline(receipt.status)})`];
  if (receipt.contentWithheld === true) {
    lines.push(yellow("Run content withheld: this key lacks the readRuns scope."));
  } else {
    if (typeof receipt.finalDigest === "string") lines.push(sanitizeText(receipt.finalDigest));
    const decision = object(receipt.decision);
    if (decision) lines.push(...renderDecision(decision as DecisionBlock));
  }
  lines.push(...renderHybridStages(receipt));
  return lines.join("\n");
}
