import type { Command } from "commander";
import { byName, executeTool, isSuccess } from "@workerkit/core";
import { mountTool, globalOpts } from "../bind.js";
import { buildClient, requireToken } from "../context.js";
import { renderApiError } from "../errors.js";
import { renderTable, renderDetail } from "../output/table.js";
import { confirm } from "../output/confirm.js";
import { bold, cyan, red, yellow } from "../output/colors.js";
import { sanitizeInline, sanitizeText } from "../output/sanitize.js";
import { mountKitAuthoring, mountPublisherAuthoring } from "./kitAuthoring.js";

interface KitCard {
  slug?: string;
  name?: string | null;
  jobSentence?: string | null;
  publisherSlug?: string | null;
  modelType?: string | null;
  stars?: number | null;
}

// A decision kit's install questions (kit_install_preview decisionSetup): the ones an install
// must answer are required with no default — except an appPick, whose options come from the
// installer's own app and can be answered on the worker afterwards (wk instruction set --answers).
interface DecisionSetupQuestion {
  key?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
}

const mandatoryDecisionKeys = (questions: DecisionSetupQuestion[] | undefined): string[] =>
  (questions ?? [])
    .filter((q) => q.required && q.default === undefined && q.type !== "appPick")
    .map((q) => q.key)
    .filter((k): k is string => Boolean(k));

export function mountKit(program: Command): void {
  const kit = program.command("kit").description("Browse the kit directory and install kits as workers");

  mountTool(kit, "search", {
    tool: "kits_search",
    render: (data) => {
      const body = data as { items?: KitCard[] };
      if (!Array.isArray(body.items)) return null;
      if (body.items.length === 0) {
        return (
          "No kits matched. Drop a filter or try a shorter query. If nothing fits after broadening, author a kit for the exact job " +
          "rather than installing a near miss: wk kit guide, wk kit tools, then wk kit validate, wk kit publish --private and wk kit install."
        );
      }
      return renderTable(body.items, [
        { header: "SLUG", value: (k) => k.slug ?? "" },
        { header: "NAME", value: (k) => k.name ?? "", maxWidth: 30 },
        { header: "JOB", value: (k) => k.jobSentence ?? "", maxWidth: 48 },
        { header: "TYPE", value: (k) => k.modelType ?? "language" },
        { header: "PUBLISHER", value: (k) => k.publisherSlug ?? "" },
      ]);
    },
  });

  mountTool(kit, "get", {
    tool: "kit_get",
    positionals: ["slug"],
  });

  mountTool(kit, "categories", {
    tool: "directory_overview",
  });

  // ── install: preview → confirm → install, secrets shown once ──────────────────────────────────
  const install = kit
    .command("install")
    .description("Install a kit as a new worker (preview first, then confirm)")
    .argument("<slug>")
    .option("--operator-id <uuid>", "Operator (workspace) to install into")
    .option("--title <text>", "Name for the new worker")
    .option("--time-zone-id <zone>", "Worker timezone for reports and daily schedules, for example America/New_York")
    .option("--slack-connection-id <id>", "Action kits: Slack bot connection from the preview actionConnections")
    .option("--avatar <slug>", "Avatar for the new worker")
    .option("--category-choices <json>", "One entry per preview categorySlots slot (JSON array)")
    .option("--github-selection <json>", "GitHub accounts and repository IDs (JSON object); use preview.githubAccounts for connection IDs. An empty accounts array defers GitHub setup.")
    .option("--inputs <json>", "Answers to the preview's requiredInputs (JSON object)")
    .option("--memory-answers <json>", "Answers to the preview's memorySetup questions (JSON object)")
    .option(
      "--decision-answers <json>",
      "Decision kits: answers to the preview's decisionSetup questions by key (JSON object); an appPick may be answered later with wk instruction set --answers",
    )
    .option("--preview", "Stop after showing the install preview");
  install.action(async (slug: string, options: Record<string, unknown>) => {
    const globals = globalOpts(install);
    const previewDescriptor = byName("kit_install_preview");
    const installDescriptor = byName("kit_install");
    if (!previewDescriptor || !installDescriptor) throw new Error("kit descriptors missing");

    const client = buildClient();
    const token = await requireToken(globals.profile);

    const previewParams: Record<string, unknown> = { slug };
    if (options.operatorId) previewParams.operatorId = options.operatorId;

    const preview = await executeTool(client, previewDescriptor, previewParams, { token });
    if (!isSuccess(preview)) {
      process.exitCode = renderApiError(preview, globals.json);
      return;
    }

    const previewBody = preview.data as {
      requiredInputs?: Array<{ key?: string; label?: string }>;
      modelType?: string;
      decisionSetup?: DecisionSetupQuestion[];
      appsNeedingConnection?: number | Array<{ app?: string } | string>;
      githubSetup?: { explicitSelectionRequired?: boolean } | null;
      limits?: { currentWorkers?: number; maxWorkers?: number };
    };

    if (globals.json && options.preview) {
      process.stdout.write(JSON.stringify(preview.data, null, 2) + "\n");
      return;
    }

    if (!globals.json) {
      const required = (previewBody.requiredInputs ?? []).map((i) => i.key ?? "?");
      const needing = (Array.isArray(previewBody.appsNeedingConnection) ? previewBody.appsNeedingConnection : []).map((a) =>
        typeof a === "string" ? a : (a.app ?? "?"),
      );
      process.stdout.write(`${bold(`Installing kit ${slug}`)}\n`);
      if (required.length > 0)
        process.stdout.write(`Required inputs: ${sanitizeInline(required.join(", "))} (pass via --inputs '{...}')\n`);
      if ((previewBody.modelType === "decision" || previewBody.modelType === "hybrid")) {
        const questions = (previewBody.decisionSetup ?? []).map((q) => q.key ?? "?");
        process.stdout.write("Decision kit: no model to pick.\n");
        if (questions.length > 0)
          process.stdout.write(
            `Decision setup questions: ${sanitizeInline(questions.join(", "))} (pass via --decision-answers '{...}')\n`,
          );
      }
      if (needing.length > 0)
        process.stdout.write(
          `${yellow("Apps needing connection after install:")} ${sanitizeInline(needing.join(", "))}\n`,
        );
      else if (typeof previewBody.appsNeedingConnection === "number" && previewBody.appsNeedingConnection > 0)
        process.stdout.write(`${yellow("Apps needing connection after install:")} ${previewBody.appsNeedingConnection}\n`);
      if (previewBody.limits)
        process.stdout.write(
          `Workers: ${previewBody.limits.currentWorkers ?? "?"}/${previewBody.limits.maxWorkers ?? "?"}\n`,
        );
    }

    if (options.preview) {
      if (!globals.json) process.stdout.write(sanitizeText(JSON.stringify(preview.data, null, 2)) + "\n");
      return;
    }

    const missing = (previewBody.requiredInputs ?? [])
      .map((i) => i.key)
      .filter((k): k is string => Boolean(k))
      .filter((k) => {
        const inputs = safeJson(options.inputs) as Record<string, unknown> | null;
        return !inputs || inputs[k] === undefined;
      });
    if (missing.length > 0) {
      process.stderr.write(
        `Missing required inputs: ${missing.join(", ")}. Pass them with --inputs '{"key":"value",...}'.\n`,
      );
      process.exitCode = 2;
      return;
    }
    const decisionAnswers = safeJson(options.decisionAnswers) as Record<string, unknown> | null;
    const missingDecision = mandatoryDecisionKeys(previewBody.decisionSetup).filter(
      (k) => !decisionAnswers || decisionAnswers[k] === undefined,
    );
    if (missingDecision.length > 0) {
      process.stderr.write(
        `Missing decision answers: ${missingDecision.join(", ")}. Pass them with --decision-answers '{"key":"value",...}'.\n`,
      );
      process.exitCode = 2;
      return;
    }

    const installParams: Record<string, unknown> = { slug };
    if (previewBody.githubSetup?.explicitSelectionRequired && options.githubSelection === undefined) {
      process.stderr.write('GitHub targets are required. Use `wk apps github accounts` and `wk apps github repos`, then pass --github-selection with explicit repository IDs. To set up later, pass --github-selection \'{"accounts":[]}\'.\n');
      process.exitCode = 2;
      return;
    }
    if (options.operatorId) installParams.operatorId = options.operatorId;
    if (options.title) installParams.title = options.title;
    if (options.avatar) installParams.avatar = options.avatar;
    if (options.githubSelection !== undefined) {
      const githubSelection = safeJson(options.githubSelection);
      if (!githubSelection || typeof githubSelection !== "object" || Array.isArray(githubSelection)) {
        process.stderr.write("--github-selection must be a JSON object with an accounts array.\n");
        process.exitCode = 2; return;
      }
      const selectionSchema = installDescriptor.schema.githubSelection;
      if (!selectionSchema) throw new Error("The installed core package does not support GitHub selections");
      const validated = selectionSchema.safeParse(githubSelection);
      if (!validated.success) {
        process.stderr.write(`Invalid GitHub selection: ${validated.error.issues.map(issue => issue.message).join("; ")}\n`);
        process.exitCode = 2; return;
      }
      installParams.githubSelection = validated.data;
    }
    const categoryChoices = safeJson(options.categoryChoices);
    if (categoryChoices) installParams.categoryChoices = categoryChoices;
    const inputs = safeJson(options.inputs);
    if (inputs) installParams.inputs = inputs;
    if (options.timeZoneId !== undefined) installParams.timeZoneId = options.timeZoneId;
    const memoryAnswers = safeJson(options.memoryAnswers);
    if (memoryAnswers) installParams.memoryAnswers = memoryAnswers;
    if (options.slackConnectionId !== undefined) {
      const id = Number(options.slackConnectionId);
      if (!Number.isSafeInteger(id) || id < 1) { process.stderr.write("slack-connection-id must be a positive integer.\n"); process.exitCode = 2; return; }
      installParams.slackConnectionId = id;
    }
    if (decisionAnswers) installParams.decisionAnswers = decisionAnswers;

    if (!(await confirm(`Install ${slug} as a new worker?`, globals.yes))) {
      if (!process.exitCode) process.exitCode = 2;
      return;
    }

    const result = await executeTool(client, installDescriptor, installParams, { token });
    if (!isSuccess(result)) {
      process.exitCode = renderApiError(result, globals.json);
      return;
    }

    if (globals.json) {
      process.stdout.write(JSON.stringify(result.data, null, 2) + "\n");
      return;
    }

    const body = result.data as {
      install?: { rawKey?: string; triggers?: Array<{ signingSecret?: string }> };
      worker?: { tokenId?: number; title?: string };
      workerUrl?: string;
      connectAppsUrl?: string;
      readiness?: { status?: string; issues?: Array<{ code?: string }> } | null;
    };

    process.stdout.write(`${bold("Installed.")}\n`);
    const detail: Array<[string, string | null | undefined]> = [
      ["Worker", body.worker?.title ?? undefined],
      ["Worker ID", body.worker?.tokenId === undefined ? undefined : String(body.worker.tokenId)],
      ["Dashboard", body.workerUrl],
      ["Readiness", body.readiness?.status ?? "unknown"],
    ];
    process.stdout.write(renderDetail(detail) + "\n");

    if (body.install?.rawKey) {
      // Secrets are shown verbatim on purpose (this is their one delivery); sanitizeInline only
      // strips control/escape bytes, which no legitimate key material contains.
      process.stdout.write(
        `\n${red(bold("Shown ONCE — store these now:"))}\n` +
          `${bold("Worker API key:")} ${sanitizeInline(body.install.rawKey)}\n`,
      );
      for (const trigger of body.install.triggers ?? []) {
        if (trigger.signingSecret) {
          process.stdout.write(`${bold("Trigger signing secret:")} ${sanitizeInline(trigger.signingSecret)}\n`);
        }
      }
    }
    if (body.readiness?.status === "blocked" && body.connectAppsUrl) {
      process.stdout.write(
        `\n${yellow("Worker starts blocked.")} Connect its apps: ${cyan(sanitizeInline(body.connectAppsUrl))}\n`,
      );
    }
  });

  // The authoring lane: guide + vocabulary (anonymous), then validate / publish / replace and
  // the listing lifecycle. Lives in its own module — this file is the browse-and-install half.
  mountKitAuthoring(kit);
}

function safeJson(value: unknown): unknown | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    process.stderr.write("Invalid JSON. Check --inputs, --category-choices, --memory-answers, --decision-answers or --github-selection.\n");
    process.exit(2);
  }
}

export function mountPublisher(program: Command): void {
  const publisher = program.command("publisher").description("Directory publishers");
  mountTool(publisher, "get", {
    tool: "publisher_get",
    positionals: ["slug"],
  });
  mountPublisherAuthoring(publisher);
}
