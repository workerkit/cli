import { describe, expect, it } from "vitest";
import type { Command } from "commander";
import { byName } from "@workerkit/core";
import { buildProgram } from "../../src/program.js";

/**
 * The gap the mountTool coverage test cannot see.
 *
 * A mountTool command derives its flags from the descriptor's schema, so it cannot drift: a new
 * key in @workerkit/core becomes a flag the moment the dependency is bumped. The BESPOKE commands
 * — the ones hand-authored for ergonomic positionals, stdin bodies or hidden secret prompts — do
 * not. When core 0.3.3 added `preview`, `sourceArgs`, `maxItems` and `waitSeconds` to worker_run,
 * and `answers` to instruction_set, every gate in this repo stayed green while the new contract
 * was simply unreachable from the CLI.
 *
 * So: every schema key of every bespoke tool must be reachable as a flag or a positional, or be
 * named below with the reason it is not. A core bump that adds a key fails here until someone
 * decides which of the two it is.
 */

/** Keys a bespoke command deliberately does not expose as a flag, and why. */
interface BespokeCommand {
  /** Space-separated command path, e.g. "instruction set". */
  path: string;
  /** schemaKey → the flag or positional that carries it, where the name is not derivable. */
  aliases?: Record<string, string>;
  /** schemaKey → why it is not a flag. Reviewed omissions, not drift. */
  offFlag?: Record<string, string>;
}

// The kit-authoring writes take one JSON document; every listing field inside it is a property of
// that body, never a flag of its own.
const KIT_BODY = "Read from the kit JSON on --file or stdin.";
const kitBodyFields = (...keys: string[]): Record<string, string> =>
  Object.fromEntries(keys.map((k) => [k, KIT_BODY]));

const BESPOKE: Record<string, BespokeCommand> = {
  decision_worker_create: { path: "decision create", offFlag: kitBodyFields("requestId", "name", "source", "questions", "confidenceFloor", "maxItems", "operatorId", "deploy", "maxUsdPerRun", "maxUsdPerDay") },
  worker_run: {
    path: "run",
    aliases: { modelSlug: "model" },
  },

  run_score: { path: "runs score" },

  instruction_set: {
    path: "instruction set",
    offFlag: { content: "The instruction text is read from --file or stdin, never a flag." },
  },

  kit_install_preview: { path: "kit install" },

  kit_install: {
    path: "kit install",
    offFlag: {
      deploy: "Install and deploy in one call is not offered: `wk deploy <tokenId>` is the second step.",
      deployment: "Deployment ceilings belong to `wk deploy`, which owns the whole deployment shape.",
    },
  },

  kit_validate: {
    path: "kit validate",
    offFlag: kitBodyFields(
      "name", "jobSentence", "description", "categorySlugs", "visibility", "isProtected",
      "publisherName", "appDescriptions", "recommendedClients", "recommendedModel",
      "declaredModelFloor", "modelScores", "content",
    ),
  },

  kit_publish: {
    path: "kit publish",
    offFlag: {
      ...kitBodyFields(
        "name", "jobSentence", "description", "categorySlugs", "isProtected", "publisherName",
        "appDescriptions", "recommendedClients", "recommendedModel", "declaredModelFloor",
        "modelScores", "content", "sourceWorkerId",
      ),
      visibility: "Set by --private / --public, so the choice is never a bare string.",
    },
  },

  kit_replace: {
    path: "kit replace",
    offFlag: {
      ...kitBodyFields(
        "name", "jobSentence", "description", "categorySlugs", "isProtected", "publisherName",
        "appDescriptions", "recommendedClients", "recommendedModel", "declaredModelFloor",
        "modelScores", "content",
      ),
      visibility: "Set by --private / --public, so the choice is never a bare string.",
    },
  },

  app_connect: {
    path: "apps connect",
    offFlag: {
      credential: "A secret: --credential-file, stdin or a hidden prompt, so it never lands in shell history.",
    },
  },

  model_key_set: {
    path: "model-keys set",
    offFlag: {
      apiKey: "A secret: --key-file, stdin or a hidden prompt, so it never lands in shell history.",
    },
  },

  mcp_server_create: {
    path: "mcp-servers create",
    aliases: { credentialScope: "account" },
    offFlag: {
      credential: "A secret: --credential-file, stdin or a hidden prompt, so it never lands in shell history.",
      credentialHelpText: "Dashboard display copy for the human who connects it; not part of creating the server.",
      setupGuideUrl: "Dashboard display copy for the human who connects it; not part of creating the server.",
      namespacePrefix: "Derived from --slug; a second name for the same thing invites a mismatch.",
      oauthScopes: "OAuth servers are registered in the dashboard, where the consent screen lives.",
      callTimeoutSeconds: "Server default; tuning it is a dashboard concern, not a create-time one.",
    },
  },

  mcp_server_set_tools: { path: "mcp-servers set-tools", aliases: { enabledToolIds: "toolIds" } },
};

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

function findCommand(root: Command, path: string): Command | undefined {
  let current: Command | undefined = root;
  for (const segment of path.split(" ")) {
    current = current?.commands.find((c) => c.name() === segment);
    if (!current) return undefined;
  }
  return current;
}

/** Every name a user can actually type on this command: positionals and long flags. */
function reachableNames(cmd: Command): Set<string> {
  const names = new Set<string>();
  for (const arg of cmd.registeredArguments) names.add(arg.name());
  for (const option of cmd.options) {
    if (!option.long) continue;
    names.add(option.long.replace(/^--(no-)?/, ""));
  }
  return names;
}

describe("bespoke command coverage", () => {
  const program = buildProgram();

  it("every bespoke tool names a command that exists", () => {
    for (const [tool, spec] of Object.entries(BESPOKE)) {
      expect(byName(tool), `descriptor ${tool}`).toBeDefined();
      expect(findCommand(program, spec.path), `command "${spec.path}" for ${tool}`).toBeDefined();
    }
  });

  it("every schema key of a bespoke tool is reachable, or documented as off-flag", () => {
    const unreachable: string[] = [];

    for (const [tool, spec] of Object.entries(BESPOKE)) {
      const descriptor = byName(tool);
      const cmd = findCommand(program, spec.path);
      if (!descriptor || !cmd) continue;
      const names = reachableNames(cmd);

      for (const key of Object.keys(descriptor.schema)) {
        if (spec.offFlag?.[key]) continue;
        const alias = spec.aliases?.[key];
        if (names.has(key) || names.has(kebab(key)) || (alias && (names.has(alias) || names.has(kebab(alias))))) continue;
        unreachable.push(`${tool}.${key} (command "${spec.path}")`);
      }
    }

    // A key landing here is a core addition nobody has triaged: give it a flag, or an offFlag
    // entry saying why it has none.
    expect(unreachable).toEqual([]);
  });

  it("no off-flag or alias entry names a key that no longer exists", () => {
    const stale: string[] = [];
    for (const [tool, spec] of Object.entries(BESPOKE)) {
      const descriptor = byName(tool);
      if (!descriptor) continue;
      const keys = new Set(Object.keys(descriptor.schema));
      for (const key of [...Object.keys(spec.offFlag ?? {}), ...Object.keys(spec.aliases ?? {})]) {
        if (!keys.has(key)) stale.push(`${tool}.${key}`);
      }
    }
    expect(stale).toEqual([]);
  });
});
