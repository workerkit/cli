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
  lines.push(...renderRunAttribution(receipt));
  lines.push(...renderRunResult(receipt));
  if (receipt.contentWithheld === true) {
    lines.push(yellow("Run content withheld (metadata requested or unavailable with this key). Resolve content references with an authorized key."));
  } else {
    if (typeof receipt.finalDigest === "string") lines.push(sanitizeText(receipt.finalDigest));
    const decision = object(receipt.decision);
    if (decision) lines.push(...renderDecision(decision as DecisionBlock));
  }
  lines.push(...renderHybridStages(receipt));
  return lines.join("\n");
}

function initiatorLabel(value: unknown): string {
  const initiator = object(value);
  const key = object(initiator?.managerKey);
  if (initiator?.kind === "fleetKey" && key) {
    return `Fleet key ${inline(key.name)} (#${inline(key.id)}, ${inline(key.prefix)})`;
  }
  if (initiator?.kind === "user") return initiator.userDisplayName ? inline(initiator.userDisplayName) : `User #${inline(initiator.userId)}`;
  if (initiator?.kind === "worker") return "Worker";
  if (initiator?.kind === "schedule") return "Schedule";
  if (initiator?.kind === "webhook") return "Webhook";
  return "Not recorded on this historical receipt";
}

/** Safe receipt metadata is available independently of report-content permission. */
export function renderRunAttribution(data: unknown): string[] {
  const receipt = object(data);
  if (!receipt) return [];
  const lines = [`Started by: ${initiatorLabel(receipt.initiator)}`];
  const initiator = object(receipt.initiator);
  if (initiator?.kind === "fleetKey" && initiator.userId != null) lines.push(`Accountable user: ${initiator.userDisplayName ? inline(initiator.userDisplayName) : `#${inline(initiator.userId)}`}`);
  if (receipt.relationship === "questionContinuation") lines.push(`Continues run: ${inline(receipt.parentRunId)}`);
  const caller = object(initiator?.worker);
  if (caller) lines.push(`Calling run: ${inline(caller.runId)}`);
  for (const value of Array.isArray(receipt.workerCalls) ? receipt.workerCalls : []) {
    const call = object(value);
    if (call) {
      const reference = call.actionInvocationId ? `Action receipt ${inline(call.actionInvocationId)}` : `run ${inline(call.runId ?? "not created")}`;
      lines.push(`Called worker ${inline(call.alias)}: ${inline(call.status)}; ${reference} (charged separately)`);
    }
  }
  const origin = object(receipt.origin);
  if (origin && origin.runId !== receipt.runId) {
    lines.push(`Original run: ${origin.runId == null ? "Not recorded" : inline(origin.runId)}; ${initiatorLabel(origin.initiator)}`);
  }
  return lines;
}

/** Shape validation and the worker's business assessment are separate from execution status. */
export function renderRunResult(data: unknown): string[] {
  const receipt = object(data);
  const result = object(object(receipt?.digestStructured)?.result);
  const lines: string[] = [];
  if (receipt?.status === "Canceled" && !receipt.finishedAtUtc) {
    lines.push("Cancellation requested; execution and charges are still settling. Earlier app effects may remain.");
  }
  const quality = object(receipt?.qualityEvaluation);
  if (quality && receipt?.contentWithheld !== true) {
    if (quality.diagnosticsOnly !== true)
      lines.push(`Quality checks: ${inline(quality.status)}; criteria revision ${inline(quality.configurationRevision)}. Unknown is unverified, not a pass.`);
    const execution = (Array.isArray(quality.executionChecks) ? quality.executionChecks : []).map(object).filter(check => check !== null);
    if (execution.length) {
      const attention = execution.filter(check => check.status === "needs_attention");
      const unknown = execution.filter(check => check.status === "unknown");
      lines.push(`Execution checks (code): ${attention.length} need attention; ${unknown.length} unverified. Recovered attempts do not automatically fail business acceptance.`);
      const findings = [...attention, ...unknown];
      for (const check of findings.slice(0, 3)) {
        lines.push(`${inline(check.title ?? check.checkId)}: ${inline(check.status)}. ${inline(check.reason)}`);
        if (check.recommendation) lines.push(`Next step: ${inline(check.recommendation)}`);
      }
      if (findings.length > 3) lines.push("More execution findings are available in the run receipt or JSON output.");
    }
    const review = object(quality.systemReview);
    if (review) {
      const attention = (Array.isArray(review.checks) ? review.checks : []).map(object).filter(check => check?.status === "needs_attention");
      lines.push(`System learning: ${inline(review.state)}; ${attention.length} ${attention.length === 1 ? "check needs" : "checks need"} attention. Recommendations do not apply changes.`);
      for (const check of attention.slice(0, 3))
        lines.push(`Next step (${inline(check?.title ?? check?.checkId)}): ${inline(check?.recommendation ?? "Open the run diagnostic to investigate.")}`);
      if (attention.length > 3) lines.push("More recommendations are available in the run receipt or JSON output.");
    }
  }
  if (!result || receipt?.contentWithheld === true) return lines;
  if (result.validationError) return [...lines, `Structured result unavailable: ${inline(result.validationError)}. Execution status is unchanged.`];
  lines.push(`Worker assessment: ${inline(result.completeness)} coverage; ${inline(result.acceptance)} (self-reported).`);
  for (const item of Array.isArray(result.unresolved) ? result.unresolved : []) lines.push(`Unresolved: ${inline(item)}`);
  return lines;
}
