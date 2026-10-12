// CLI transport bindings only. Tool semantics and validation come from @workerkit/core.
/** Keys a bespoke command deliberately does not expose as a flag, and why. */
export interface BespokeCommand {
  /** Space-separated command path, e.g. "instruction set". */
  path: string;
  /** Extra flags needed to address only this capability. */
  suffix?: string;
  /** Manager inputs this CLI deliberately does not accept. */
  unsupportedInputs?: readonly string[];
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

export const bespokeCommandBindings: Record<string, BespokeCommand> = {
  worker_tool_call: { path: "workers invoke", offFlag: { contractVersion: "This release supports version 1, validated by core." } },
  decision_worker_create: { path: "decision create", offFlag: kitBodyFields("requestId", "name", "timeZoneId", "source", "questions", "confidenceFloor", "maxItems", "operatorId", "deploy", "decisionProfileId", "maxUsdPerRun", "maxUsdPerDay") },
  worker_run: {
    path: "run",
    aliases: { modelSlug: "model", decisionProfileId: "decisionProfile" },
  },

  run_score: { path: "runs score" },

  instruction_set: {
    path: "instruction set",
    offFlag: { content: "The instruction text is read from --file or stdin, never a flag." },
  },

  kit_install_preview: { path: "kit install", suffix: " --preview" },

  kit_install: {
    path: "kit install",
    unsupportedInputs: ["deploy", "deployment"],
    offFlag: {
      deploy: "Install and deploy in one call is not offered: `wk deploy <tokenId>` is the second step.",
      deployment: "Deployment ceilings belong to `wk deploy`, which owns the whole deployment shape.",
    },
  },

  kit_validate: {
    path: "kit validate",
    offFlag: kitBodyFields(
      "name", "jobSentence", "description", "categorySlugs", "visibility", "isProtected",
      "publisherName", "appDescriptions", "recommendedClients", "recommendedModel", "decisionProfileId",
      "declaredModelFloor", "modelScores", "content",
    ),
  },

  kit_publish: {
    path: "kit publish",
    offFlag: {
      ...kitBodyFields(
        "name", "jobSentence", "description", "categorySlugs", "isProtected", "publisherName",
        "appDescriptions", "recommendedClients", "recommendedModel", "decisionProfileId", "declaredModelFloor",
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
        "appDescriptions", "recommendedClients", "recommendedModel", "decisionProfileId", "declaredModelFloor",
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
    unsupportedInputs: ["credentialHelpText", "setupGuideUrl", "oauthScopes", "callTimeoutSeconds"],
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
