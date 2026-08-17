import type { Command } from "commander";
import { InvalidArgumentError } from "commander";
import { executeTool, isSuccess, z, type ApiResult, type ToolDescriptor, byName } from "@workerkit/core";
import { buildClient, requireToken, type GlobalOpts } from "./context.js";
import { renderApiError } from "./errors.js";
import { sanitizeText } from "./output/sanitize.js";
import { dim } from "./output/colors.js";
import { confirm } from "./output/confirm.js";

/**
 * Descriptor-bound commands: the descriptor's zod schema is the single source for flag names,
 * types, enums, defaults, help text, and final validation. Commands are hand-authored (ergonomic
 * positionals, confirm prompts, typed renderers) but structurally incapable of drifting from the
 * wire contract — a coverage test asserts every schema key of every mounted tool is reachable.
 */
export interface ToolCommandSpec {
  /** Descriptor name, e.g. "workers_list". */
  tool: string;
  /** Schema keys promoted to required positional arguments, in order. */
  positionals?: string[];
  /** schemaKey → flag-name override (kebab-case), when the derived name reads badly. */
  flagAliases?: Record<string, string>;
  /** Schema keys the action supplies itself (never exposed as flags). */
  hidden?: string[];
  /** Constant params merged into every invocation (e.g. { enabled: true } for `workers enable`). */
  fixed?: Record<string, unknown>;
  /** Confirmation prompt for destructive actions; null = no prompt needed for these params. */
  confirm?: (params: Record<string, unknown>) => string | null;
  /** Human-mode renderer; return null to fall back to sanitized pretty JSON. */
  render?: (data: unknown, params: Record<string, unknown>) => string | null;
  /** One-line help override; defaults to the first sentence of the descriptor description. */
  summary?: string;
}

/** Flat registry of every mounted spec — consumed by the coverage test. */
export const mountedSpecs: ToolCommandSpec[] = [];

interface FlagInfo {
  key: string;
  flag: string;
  kind: "string" | "number" | "boolean" | "json";
  enumValues?: string[];
  defaultValue?: unknown;
  required: boolean;
  description: string;
}

interface ZodDefLike {
  typeName?: string;
  innerType?: ZodTypeLike;
  defaultValue?: () => unknown;
  values?: string[];
  description?: string;
}

interface ZodTypeLike {
  _def: ZodDefLike;
  description?: string;
}

function unwrap(type: ZodTypeLike): { base: ZodTypeLike; required: boolean; defaultValue?: unknown } {
  let current = type;
  let required = true;
  let defaultValue: unknown;
  for (;;) {
    const def = current._def;
    if (def.typeName === "ZodOptional" || def.typeName === "ZodNullable") {
      required = false;
      current = def.innerType as ZodTypeLike;
    } else if (def.typeName === "ZodDefault") {
      required = false;
      if (def.defaultValue) defaultValue = def.defaultValue();
      current = def.innerType as ZodTypeLike;
    } else {
      return { base: current, required, defaultValue };
    }
  }
}

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

export function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const match = /^(.*?[.!?])(\s|$)/.exec(cleaned);
  return (match ? match[1] : cleaned.slice(0, 120)) ?? "";
}

function flagInfos(descriptor: ToolDescriptor, spec: ToolCommandSpec): FlagInfo[] {
  const skip = new Set([...(spec.positionals ?? []), ...(spec.hidden ?? []), ...Object.keys(spec.fixed ?? {})]);
  const infos: FlagInfo[] = [];

  for (const [key, zodType] of Object.entries(descriptor.schema)) {
    if (skip.has(key)) continue;
    const { base, required, defaultValue } = unwrap(zodType as unknown as ZodTypeLike);
    const typeName = base._def.typeName ?? "ZodString";

    let kind: FlagInfo["kind"] = "string";
    let enumValues: string[] | undefined;
    if (typeName === "ZodNumber") kind = "number";
    else if (typeName === "ZodBoolean") kind = "boolean";
    else if (typeName === "ZodEnum") enumValues = (base._def.values as string[] | undefined) ?? [];
    else if (typeName === "ZodArray" || typeName === "ZodRecord" || typeName === "ZodObject") kind = "json";

    const description =
      (zodType as unknown as ZodTypeLike).description ??
      base.description ??
      "";

    infos.push({
      key,
      flag: spec.flagAliases?.[key] ?? kebab(key),
      kind,
      enumValues,
      defaultValue,
      required,
      description: firstSentence(description),
    });
  }
  return infos;
}

function coerce(info: FlagInfo, raw: string): unknown {
  switch (info.kind) {
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new InvalidArgumentError(`--${info.flag} expects a number.`);
      return n;
    }
    case "json": {
      try {
        return JSON.parse(raw);
      } catch {
        throw new InvalidArgumentError(`--${info.flag} expects JSON.`);
      }
    }
    default:
      return raw;
  }
}

function coercePositional(descriptor: ToolDescriptor, key: string, raw: string): unknown {
  const zodType = descriptor.schema[key];
  if (!zodType) return raw;
  const { base } = unwrap(zodType as unknown as ZodTypeLike);
  if (base._def.typeName === "ZodNumber") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new InvalidArgumentError(`<${key}> expects a number.`);
    return n;
  }
  return raw;
}

/** Mounts a descriptor-bound subcommand. Returns the commander command for optional tweaks. */
export function mountTool(parent: Command, commandName: string, spec: ToolCommandSpec): Command {
  const descriptor = byName(spec.tool);
  if (!descriptor) throw new Error(`Unknown tool descriptor: ${spec.tool}`);
  mountedSpecs.push(spec);

  const cmd = parent.command(commandName);
  cmd.description(spec.summary ?? firstSentence(descriptor.description));

  for (const key of spec.positionals ?? []) {
    cmd.argument(`<${key}>`);
  }

  const infos = flagInfos(descriptor, spec);
  for (const info of infos) {
    const suffix = info.kind === "boolean" ? "" : ` <${info.enumValues ? info.enumValues.join("|") : "value"}>`;
    let help = info.description;
    if (info.defaultValue !== undefined) help += ` (default: ${String(info.defaultValue)})`;
    if (info.kind === "boolean") {
      // Both polarities: a boolean whose schema default is true (or absent-means-unchanged on a
      // PATCH) is only reachable through the negated form. Neither flag passed = undefined, so
      // the schema default (or the API's "unchanged") still applies.
      cmd.option(`--${info.flag}`, help);
      cmd.option(`--no-${info.flag}`, `Explicitly set ${info.flag} to false`);
    } else {
      cmd.option(`--${info.flag}${suffix}`, help, (raw: string) => coerce(info, raw));
    }
  }

  cmd.action(async (...args: unknown[]) => {
    // commander passes positionals..., options, command
    const positionalValues = args.slice(0, spec.positionals?.length ?? 0) as string[];
    const options = (args[args.length - 2] ?? {}) as Record<string, unknown>;
    const globals = globalOpts(cmd);

    const params: Record<string, unknown> = { ...(spec.fixed ?? {}) };
    (spec.positionals ?? []).forEach((key, i) => {
      params[key] = coercePositional(descriptor, key, positionalValues[i] ?? "");
    });
    for (const info of infos) {
      const camel = info.flag.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
      const value = options[camel];
      if (value !== undefined) params[info.key] = info.kind === "boolean" ? Boolean(value) : value;
    }

    await runTool(descriptor, spec, params, globals);
  });

  return cmd;
}

export function globalOpts(cmd: Command): GlobalOpts {
  let root: Command = cmd;
  while (root.parent) root = root.parent;
  const opts = root.opts<{ json?: boolean; plain?: boolean; yes?: boolean; profile?: string }>();
  return { json: Boolean(opts.json), plain: Boolean(opts.plain), yes: Boolean(opts.yes), profile: opts.profile };
}

/** Validate → confirm → execute → render. Exported for bespoke commands (run --follow, kit install). */
export async function runTool(
  descriptor: ToolDescriptor,
  spec: ToolCommandSpec,
  params: Record<string, unknown>,
  globals: GlobalOpts,
): Promise<ApiResult | null> {
  const parsed = z.object(descriptor.schema).safeParse(params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") ?? "input";
    process.stderr.write(`Invalid ${where}: ${issue?.message ?? "invalid input"}\n`);
    process.exitCode = 2;
    return null;
  }

  if (spec.confirm) {
    const question = spec.confirm(parsed.data);
    if (question && !(await confirm(question, globals.yes))) {
      if (process.exitCode === undefined || process.exitCode === 0) {
        process.stderr.write("Cancelled.\n");
        process.exitCode = 2;
      }
      return null;
    }
  }

  const client = buildClient();
  const token = descriptor.auth === "manager" ? await requireToken(globals.profile) : undefined;
  const result = await executeTool(client, descriptor, parsed.data, { token });

  emitResult(result, descriptor, spec, parsed.data, globals);
  return result;
}

export function emitResult(
  result: ApiResult,
  descriptor: ToolDescriptor,
  spec: ToolCommandSpec,
  params: Record<string, unknown>,
  globals: GlobalOpts,
): void {
  if (!isSuccess(result)) {
    process.exitCode = renderApiError(result, globals.json);
    return;
  }

  if (result.status === 204 || result.data === undefined || result.data === null || result.data === "") {
    const message = descriptor.successMessage ?? "Done.";
    if (globals.json) process.stdout.write(JSON.stringify({ success: true, message }) + "\n");
    else process.stdout.write(`${message}\n`);
    return;
  }

  const data = descriptor.mapData ? (descriptor.mapData(result.data, params) ?? result.data) : result.data;

  if (globals.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }

  let text: string | null = null;
  if (!globals.plain && spec.render) text = spec.render(data, params);
  if (text === null || text === undefined) text = sanitizeText(JSON.stringify(data, null, 2));
  process.stdout.write(text + "\n");

  const footer = descriptor.footer?.(data, params);
  if (footer) process.stdout.write(dim(`\n${sanitizeText(footer)}\n`));
}
