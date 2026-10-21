import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { byName } from "@workerkit/core";
import { addToolHelp, firstSentence, globalOpts, mountTool, runTool } from "../bind.js";
import { parseJsonObject, readStdin } from "../input.js";

export function mountApiApps(program: Command): void {
  const apps = program.command("api-apps").description("Author account-private API apps and their immutable versions");
  mountTool(apps, "list", { tool: "api_apps_list" });
  mountTool(apps, "get", { tool: "api_app_get", positionals: ["appId"] });
  mountTool(apps, "publish", { tool: "api_app_publish", positionals: ["appId"] });
  mountTool(apps, "version", { tool: "api_app_version_get", positionals: ["appId", "versionId"] });
  mountTool(apps, "revoke", {
    tool: "api_app_version_revoke", positionals: ["appId", "versionId"],
    confirm: () => "Permanently revoke this version and block all workers pinned to it?",
  });

  // Definitions can exceed a shell's argument limit. Follow kit authoring's
  // file/stdin convention and let the core descriptor validate the whole body.
  for (const [name, tool, hasAppId] of [
    ["create", "api_app_create", false], ["update", "api_app_update", true],
    ["validate", "api_app_validate", false], ["preview", "api_app_preview", false],
  ] as const) {
    const descriptor = byName(tool)!;
    const command = apps.command(name).description(firstSentence(descriptor.description))
      .option("--file <path>", "Request JSON file; otherwise read the request from stdin");
    if (hasAppId) command.argument("<appId>");
    addToolHelp(command, [tool], true);
    command.action(async (...args: unknown[]) => {
      const { file } = command.opts<{ file?: string }>();
      if (!file && process.stdin.isTTY) {
        process.stderr.write("Provide request JSON with --file <path> or pipe it on stdin.\n");
        process.exitCode = 2;
        return;
      }
      const raw = file ? readFileSync(file, "utf8") : await readStdin();
      const body = parseJsonObject(raw, "API app request");
      if (!body) return;
      if ("appId" in body) {
        process.stderr.write("appId belongs in the command's positional argument, not the JSON body.\n");
        process.exitCode = 2;
        return;
      }
      await runTool(descriptor, { tool }, { ...body, ...(hasAppId ? { appId: args[0] } : {}) }, globalOpts(command));
    });
  }
}
