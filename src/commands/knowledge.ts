import type { Command } from "commander";
import { byName } from "@workerkit/core";
import { mountTool } from "../bind.js";

export function mountKnowledge(program: Command): void {
  const knowledge = program.command("knowledge").description("Read permitted worker reports and dated source observations");
  mountTool(knowledge, "sources", { tool: "knowledge_sources" });
  mountTool(knowledge, "search", { tool: "knowledge_search" });
  mountTool(knowledge, "get", { tool: "knowledge_get", positionals: ["id"], flagAliases: { version: "evidence-version" } });
  mountTool(knowledge, "changes", { tool: "knowledge_changes" });
  // Keep existing commands usable with older core installations. Release checks
  // and the timeline tests require all three descriptors.
  if (["knowledge_timeline", "knowledge_timeline_status", "knowledge_timeline_enable"].every(name => byName(name))) {
    mountTool(knowledge, "timeline", { tool: "knowledge_timeline" });
    mountTool(knowledge, "timeline-status", { tool: "knowledge_timeline_status", positionals: ["id"] });
    mountTool(knowledge, "timeline-enable", { tool: "knowledge_timeline_enable" });
  }
  const configuration = knowledge.command("configuration").description("Admin activation and reader grants");
  mountTool(configuration, "get", { tool: "knowledge_configuration_get" });
  mountTool(configuration, "set", { tool: "knowledge_configuration_set" });
}
