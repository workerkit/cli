import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { byName, executeTool, isSuccess, type ApiResult } from "@workerkit/core";
import { mountTool, globalOpts } from "../bind.js";
import { buildClient, requireToken, type GlobalOpts } from "../context.js";
import { parseJsonObject, readStdin } from "../input.js";
import { renderApiError } from "../errors.js";
import { renderTable } from "../output/table.js";
import { confirm } from "../output/confirm.js";
import { bold, dim, green, red, yellow } from "../output/colors.js";
import { sanitizeInline, sanitizeText } from "../output/sanitize.js";

// The kit-authoring lane of `wk kit` / `wk publisher`: the two anonymous reads an author starts
// from, the owner's listing lifecycle, and the three body-carrying commands (validate, publish,
// replace) that read the kit JSON from a file or stdin — a kit is far too large for flags.

interface MyKitRow {
  slug?: string;
  name?: string | null;
  status?: string;
  moderationStatus?: string | null;
  downloadCount?: number;
  installedWorkerCount?: number;
  updatedAt?: string;
}

interface ValidationIssue {
  section?: string;
  message?: string;
}

interface ValidationReport {
  canPublish?: boolean;
  errors?: ValidationIssue[];
  warnings?: ValidationIssue[];
  lintWarnings?: string[];
  requiredInputs?: Array<{ key?: string }>;
}

interface PublishedKit {
  slug?: string;
  name?: string | null;
  status?: string;
  moderationStatus?: string | null;
  lintWarnings?: string[];
}

function paintStatus(status: string): string {
  if (status === "published") return green(status);
  if (status === "private" || status === "unlisted") return yellow(status);
  return red(status);
}

function paintModeration(state: string): string {
  if (state === "clear" || state === "") return state;
  return red(state);
}

/** The kit JSON, from --file or piped stdin. Exit 2 on neither, or on malformed JSON. */
async function readKitBody(options: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  let raw: string;
  if (typeof options.file === "string" && options.file) {
    raw = readFileSync(options.file, "utf8");
  } else if (!process.stdin.isTTY) {
    raw = await readStdin();
  } else {
    process.stderr.write("Provide the kit as JSON via --file <path> or pipe it on stdin (see `wk kit guide --section schema`).\n");
    process.exitCode = 2;
    return null;
  }
  return parseJsonObject(raw, "kit body");
}

function renderReport(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push(report.canPublish ? green(bold("Can publish: yes")) : red(bold("Can publish: no")));
  for (const issue of report.errors ?? [])
    lines.push(red(`  ✗ [${sanitizeInline(issue.section ?? "?")}] ${sanitizeInline(issue.message ?? "")}`));
  for (const issue of report.warnings ?? [])
    lines.push(yellow(`  ! [${sanitizeInline(issue.section ?? "?")}] ${sanitizeInline(issue.message ?? "")}`));
  for (const nudge of report.lintWarnings ?? []) lines.push(dim(`  · ${sanitizeInline(nudge)}`));
  const inputs = (report.requiredInputs ?? []).map((i) => i.key ?? "?");
  if (inputs.length > 0) lines.push(`Install-form fields the text declares: ${sanitizeInline(inputs.join(", "))}`);
  return lines.join("\n");
}

function renderPublished(kit: PublishedKit, verb: string): string {
  const lines = [
    `${bold(`${verb}:`)} ${sanitizeInline(kit.name ?? "")} → ${sanitizeInline(kit.slug ?? "?")} ` +
      `(${paintStatus(sanitizeInline(kit.status ?? "?"))}` +
      (kit.moderationStatus ? `, moderation ${paintModeration(sanitizeInline(kit.moderationStatus))}` : "") +
      ")",
  ];
  for (const nudge of kit.lintWarnings ?? []) lines.push(dim(`  · ${sanitizeInline(nudge)}`));
  if (kit.status === "private")
    lines.push(`Install it as a worker: ${bold(`wk kit install ${sanitizeInline(kit.slug ?? "<slug>")}`)}`);
  if (kit.status === "published")
    lines.push(dim("The semantic scan can still flag a public listing minutes from now — check `wk kit mine`."));
  return lines.join("\n");
}

/**
 * validate → print the report → confirm → act. Shared by publish and replace: the dry run is
 * what makes a body-carrying write safe to run unattended, so it is on by default and only
 * --skip-validate turns it off (a publish stops at the FIRST problem; validate reports them all).
 */
async function validateThen(
  globals: GlobalOpts,
  body: Record<string, unknown>,
  kitRef: string | undefined,
  skipValidate: boolean,
  question: string,
  act: (client: ReturnType<typeof buildClient>, token: string) => Promise<ApiResult>,
  verb: string,
): Promise<void> {
  const validateDescriptor = byName("kit_validate");
  if (!validateDescriptor) throw new Error("kit_validate descriptor missing");
  const client = buildClient();
  const token = await requireToken(globals.profile);

  // A sourceWorkerId publish has nothing to dry-run — the server derives the kit from the worker.
  const canDryRun = !skipValidate && typeof body.content === "object" && body.content !== null;
  if (canDryRun) {
    const params: Record<string, unknown> = { ...body };
    if (kitRef) params.kitRef = kitRef;
    const validation = await executeTool(client, validateDescriptor, params, { token });
    if (!isSuccess(validation)) {
      process.exitCode = renderApiError(validation, globals.json);
      return;
    }
    const report = validation.data as ValidationReport;
    if (!globals.json) process.stdout.write(renderReport(report) + "\n");
    if (!report.canPublish) {
      if (globals.json) process.stdout.write(JSON.stringify(validation.data, null, 2) + "\n");
      process.stderr.write("Fix the errors above and run again (or --skip-validate to send it anyway).\n");
      process.exitCode = 1;
      return;
    }
  }

  const ok = await confirm(question, globals.yes);
  if (!ok) {
    process.exitCode = 2;
    return;
  }

  const result = await act(client, token);
  if (!isSuccess(result)) {
    process.exitCode = renderApiError(result, globals.json);
    return;
  }
  if (globals.json) process.stdout.write(JSON.stringify(result.data, null, 2) + "\n");
  else process.stdout.write(renderPublished(result.data as PublishedKit, verb) + "\n");
}

export function mountKitAuthoring(kit: Command): void {
  // ── the two anonymous reads an author starts from ──────────────────────────────────────────
  mountTool(kit, "guide", {
    tool: "kit_authoring_guide",
    summary: "How to write a kit, one section at a time (anonymous): --section index|schema|rules|skill|slots|instruction|example|selfcheck",
    render: (data) => {
      const body = data as { section?: string; title?: string; content?: string; sections?: Array<{ key?: string; title?: string }> };
      if (typeof body.content !== "string") return null;
      const toc = (body.sections ?? []).map((s) => `  ${sanitizeInline(s.key ?? "?")}  ${dim(sanitizeInline(s.title ?? ""))}`);
      return `${bold(sanitizeInline(body.title ?? body.section ?? "guide"))}\n\n${sanitizeText(body.content)}\n\n${dim("Sections:")}\n${toc.join("\n")}`;
    },
  });

  mountTool(kit, "vocabulary", {
    tool: "kit_vocabulary",
    summary: "The live app / tool-key / category vocabulary a kit manifest accepts (anonymous); --app <code> for one surface with its vendors and tools",
  });

  mountTool(kit, "tools", {
    tool: "kit_app_tools",
    summary: "What a worker can do, app by app: every tool's description and the operation key that unlocks it (anonymous); --app <code> for one app",
    render: (data) => {
      const body = data as { apps?: Array<{ app?: string; name?: string; tools?: Array<{ name?: string; description?: string; readOnly?: boolean; requires?: string[]; hosted?: boolean }> | null; toolsNote?: string }>; toolCount?: number; note?: string };
      if (!Array.isArray(body.apps)) return null;
      const lines: string[] = [];
      for (const app of body.apps) {
        lines.push(bold(`${sanitizeInline(app.app ?? "?")}  ${dim(sanitizeInline(app.name ?? ""))}`));
        if (!app.tools) {
          lines.push(dim(`  ${sanitizeInline(app.toolsNote ?? "no catalog tools")}`));
          continue;
        }
        for (const tool of app.tools) {
          const flags = [tool.readOnly ? "read" : yellow("write"), tool.hosted === false ? red("mcp-only") : null].filter(Boolean).join(" ");
          const requires = tool.requires && tool.requires.length > 0 ? dim(` requires: ${sanitizeInline(tool.requires.join(" | "))}`) : "";
          lines.push(`  ${sanitizeInline(tool.name ?? "?")}  [${flags}]${requires}`);
          if (tool.description) lines.push(dim(`    ${sanitizeInline(tool.description)}`));
        }
      }
      if (typeof body.toolCount === "number") lines.push(dim(`${body.toolCount} tools`));
      if (typeof body.note === "string") lines.push(dim(sanitizeInline(body.note)));
      return lines.join("\n");
    },
  });

  // ── the owner's listings ───────────────────────────────────────────────────────────────────
  mountTool(kit, "mine", {
    tool: "my_kits_list",
    summary: "This account's kits, any status, with moderation state",
    render: (data) => {
      const body = data as { items?: MyKitRow[] };
      if (!Array.isArray(body.items)) return null;
      if (body.items.length === 0) return "No kits yet. Write one: `wk kit guide`, then `wk kit publish --file kit.json`.";
      return renderTable(body.items, [
        { header: "SLUG", value: (k) => k.slug ?? "" },
        { header: "NAME", value: (k) => k.name ?? "", maxWidth: 30 },
        { header: "STATUS", value: (k) => k.status ?? "?", paint: paintStatus },
        { header: "MODERATION", value: (k) => k.moderationStatus ?? "", paint: paintModeration },
        { header: "DL", value: (k) => String(k.downloadCount ?? "") },
        { header: "WORKERS", value: (k) => String(k.installedWorkerCount ?? "") },
      ]);
    },
  });

  mountTool(kit, "scan", {
    tool: "kit_scan_get",
    positionals: ["kitRef"],
    summary: "A listing's security-scan report: moderation state, checks, findings (author-only)",
  });

  mountTool(kit, "update", {
    tool: "kit_update",
    positionals: ["kitRef"],
    summary: "Edit a listing in place (partial; omitted fields unchanged; the slug never moves)",
  });

  mountTool(kit, "unpublish", {
    tool: "kit_unpublish",
    positionals: ["kitRef"],
    summary: "Withdraw a listing from the directory (reversible with relist)",
  });

  mountTool(kit, "relist", {
    tool: "kit_relist",
    positionals: ["kitRef"],
    summary: "Restore an unlisted kit to the directory (re-runs the supply-chain scan)",
  });

  mountTool(kit, "make-private", {
    tool: "kit_make_private",
    positionals: ["kitRef"],
    summary: "Hide a listing from the directory; this account can still install it",
  });

  mountTool(kit, "delete", {
    tool: "kit_delete",
    positionals: ["kitRef"],
    confirm: (p) => `Permanently delete kit ${p.kitRef} and its download history? (unpublish is the reversible alternative)`,
    summary: "Hard-delete a listing (permanent)",
  });

  // ── validate: the dry run ──────────────────────────────────────────────────────────────────
  const validate = kit
    .command("validate")
    .description("Dry-run a publish: every gate's verdict at once, from --file or stdin")
    .option("--file <path>", "The kit JSON (see `wk kit guide --section schema`); otherwise stdin")
    .option("--kit-ref <slug>", "Validate as a replacement of this owned listing");
  validate.action(async (options: Record<string, unknown>) => {
    const globals = globalOpts(validate);
    const descriptor = byName("kit_validate");
    if (!descriptor) throw new Error("kit_validate descriptor missing");
    const body = await readKitBody(options);
    if (!body) return;

    const params: Record<string, unknown> = { ...body };
    if (typeof options.kitRef === "string" && options.kitRef) params.kitRef = options.kitRef;

    const client = buildClient();
    const token = await requireToken(globals.profile);
    const result = await executeTool(client, descriptor, params, { token });
    if (!isSuccess(result)) {
      process.exitCode = renderApiError(result, globals.json);
      return;
    }
    const report = result.data as ValidationReport;
    if (globals.json) process.stdout.write(JSON.stringify(result.data, null, 2) + "\n");
    else process.stdout.write(renderReport(report) + "\n");
    if (!report.canPublish) process.exitCode = 1;
  });

  // ── publish: validate → confirm → publish ──────────────────────────────────────────────────
  const publish = kit
    .command("publish")
    .description("Publish a NEW kit from --file or stdin (validates first, then confirms). Publish private first.")
    .option("--file <path>", "The kit JSON: listing fields + content, or sourceWorkerId")
    .option("--private", "Publish as private (installable only by this account, no supply-chain scan)")
    .option("--public", "Publish to the directory (runs the fail-closed supply-chain scan)")
    .option("--skip-validate", "Send it without the dry run");
  publish.action(async (options: Record<string, unknown>) => {
    const globals = globalOpts(publish);
    const descriptor = byName("kit_publish");
    if (!descriptor) throw new Error("kit_publish descriptor missing");
    const body = await readKitBody(options);
    if (!body) return;
    if (options.private) body.visibility = "private";
    if (options.public) body.visibility = "public";
    const visibility = typeof body.visibility === "string" ? body.visibility : "public";

    await validateThen(
      globals,
      body,
      undefined,
      Boolean(options.skipValidate),
      `Publish "${sanitizeInline(String(body.name ?? "(unnamed)"))}" as ${visibility}?`,
      (client, token) => executeTool(client, descriptor, body, { token }),
      "Published",
    );
  });

  // ── replace: validate against the listing → confirm → replace ──────────────────────────────
  const replace = kit
    .command("replace")
    .description("Replace a listing wholesale from --file or stdin (content required; also swaps schedules and triggers)")
    .argument("<kitRef>")
    .option("--file <path>", "The kit JSON: listing fields + content")
    .option("--private", "Result is private")
    .option("--public", "Result is public (how a private kit is promoted; runs the scan)")
    .option("--skip-validate", "Send it without the dry run");
  replace.action(async (kitRef: string, options: Record<string, unknown>) => {
    const globals = globalOpts(replace);
    const descriptor = byName("kit_replace");
    if (!descriptor) throw new Error("kit_replace descriptor missing");
    const body = await readKitBody(options);
    if (!body) return;
    if (options.private) body.visibility = "private";
    if (options.public) body.visibility = "public";
    const visibility = typeof body.visibility === "string" ? body.visibility : "public";

    await validateThen(
      globals,
      body,
      kitRef,
      Boolean(options.skipValidate),
      `Replace kit ${sanitizeInline(kitRef)} wholesale and leave it ${visibility}?`,
      (client, token) => executeTool(client, descriptor, { ...body, kitRef }, { token }),
      "Replaced",
    );
  });
}

export function mountPublisherAuthoring(publisher: Command): void {
  mountTool(publisher, "me", {
    tool: "publisher_get_mine",
    summary: "This account's publisher profile (404 until the first publish creates it)",
  });

  mountTool(publisher, "set", {
    tool: "publisher_set",
    summary: "Edit the publisher profile: --name, --description, --links '[...]', --is-listed / --no-is-listed",
  });
}
