import type { Command } from "commander";
import { byName, executeTool, isSuccess } from "@workerkit/core";
import { mountTool, globalOpts } from "../bind.js";
import { buildClient, requireToken } from "../context.js";
import { renderApiError } from "../errors.js";
import { renderTable, renderDetail } from "../output/table.js";
import { confirm } from "../output/confirm.js";
import { bold, cyan, red, yellow } from "../output/colors.js";
import { sanitizeInline, sanitizeText } from "../output/sanitize.js";

interface KitCard {
  slug?: string;
  name?: string | null;
  jobSentence?: string | null;
  publisherSlug?: string | null;
  downloads?: number | null;
  stars?: number | null;
}

export function mountKit(program: Command): void {
  const kit = program.command("kit").description("Browse the kit directory and install kits as workers");

  mountTool(kit, "search", {
    tool: "kits_search",
    summary: "Search the public kit directory (works before sign-in)",
    render: (data) => {
      const body = data as { items?: KitCard[] };
      if (!Array.isArray(body.items)) return null;
      if (body.items.length === 0) return "No kits matched. Drop a filter or try a shorter query.";
      return renderTable(body.items, [
        { header: "SLUG", value: (k) => k.slug ?? "" },
        { header: "NAME", value: (k) => k.name ?? "", maxWidth: 30 },
        { header: "JOB", value: (k) => k.jobSentence ?? "", maxWidth: 48 },
        { header: "PUBLISHER", value: (k) => k.publisherSlug ?? "" },
        { header: "DL", value: (k) => String(k.downloads ?? "") },
      ]);
    },
  });

  mountTool(kit, "get", {
    tool: "kit_get",
    positionals: ["slug"],
    summary: "A kit's full public detail: permissions, instruction, install form",
  });

  mountTool(kit, "stats", {
    tool: "kit_stats",
    positionals: ["slug"],
    summary: "A kit's usage stats",
  });

  mountTool(kit, "categories", {
    tool: "directory_overview",
    summary: "The directory's filter vocabulary: categories, apps, models, sorts",
  });

  // ── install: preview → confirm → install, secrets shown once ──────────────────────────────────
  const install = kit
    .command("install")
    .description("Install a kit as a new worker (preview first, then confirm)")
    .argument("<slug>")
    .option("--operator-id <uuid>", "Operator (workspace) to install into")
    .option("--title <text>", "Name for the new worker")
    .option("--avatar <slug>", "Avatar for the new worker")
    .option("--category-choices <json>", "One entry per preview categorySlots slot (JSON array)")
    .option("--inputs <json>", "Answers to the preview's requiredInputs (JSON object)")
    .option("--memory-answers <json>", "Answers to the preview's memorySetup questions (JSON object)")
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
      appsNeedingConnection?: Array<{ app?: string } | string>;
      limits?: { currentWorkers?: number; maxWorkers?: number };
    };

    if (globals.json && options.preview) {
      process.stdout.write(JSON.stringify(preview.data, null, 2) + "\n");
      return;
    }

    if (!globals.json) {
      const required = (previewBody.requiredInputs ?? []).map((i) => i.key ?? "?");
      const needing = (previewBody.appsNeedingConnection ?? []).map((a) =>
        typeof a === "string" ? a : (a.app ?? "?"),
      );
      process.stdout.write(`${bold(`Installing kit ${slug}`)}\n`);
      if (required.length > 0)
        process.stdout.write(`Required inputs: ${sanitizeInline(required.join(", "))} (pass via --inputs '{...}')\n`);
      if (needing.length > 0)
        process.stdout.write(
          `${yellow("Apps needing connection after install:")} ${sanitizeInline(needing.join(", "))}\n`,
        );
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

    if (!(await confirm(`Install ${slug} as a new worker?`, globals.yes))) {
      if (!process.exitCode) process.exitCode = 2;
      return;
    }

    const installParams: Record<string, unknown> = { slug };
    if (options.operatorId) installParams.operatorId = options.operatorId;
    if (options.title) installParams.title = options.title;
    if (options.avatar) installParams.avatar = options.avatar;
    const categoryChoices = safeJson(options.categoryChoices);
    if (categoryChoices) installParams.categoryChoices = categoryChoices;
    const inputs = safeJson(options.inputs);
    if (inputs) installParams.inputs = inputs;
    const memoryAnswers = safeJson(options.memoryAnswers);
    if (memoryAnswers) installParams.memoryAnswers = memoryAnswers;

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
}

function safeJson(value: unknown): unknown | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    process.stderr.write("Invalid JSON in one of the --inputs/--category-choices/--memory-answers flags.\n");
    process.exit(2);
  }
}

export function mountPublisher(program: Command): void {
  const publisher = program.command("publisher").description("Directory publishers");
  mountTool(publisher, "get", {
    tool: "publisher_get",
    positionals: ["slug"],
    summary: "A publisher's profile and kit list",
  });
}
