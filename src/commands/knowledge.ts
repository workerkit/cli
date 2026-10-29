import type { Command } from "commander";
import { mountTool } from "../bind.js";

export function mountKnowledge(program: Command): void {
  const knowledge = program.command("knowledge").description("Discover, search and read permitted worker outputs");
  mountTool(knowledge, "sources", { tool: "knowledge_sources" });
  mountTool(knowledge, "search", { tool: "knowledge_search" });
  mountTool(knowledge, "get", { tool: "knowledge_get", positionals: ["id"], flagAliases: { version: "evidence-version" } });
  mountTool(knowledge, "changes", { tool: "knowledge_changes" });
  const configuration = knowledge.command("configuration").description("Admin activation and reader grants");
  mountTool(configuration, "get", { tool: "knowledge_configuration_get" });
  mountTool(configuration, "set", { tool: "knowledge_configuration_set" });
}
