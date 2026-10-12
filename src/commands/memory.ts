import type { Command } from "commander";
import { mountTool } from "../bind.js";

export function mountMemory(program: Command): void {
  const memory = program.command("memory").description("A worker's durable memory: rules, facts, proposals");

  mountTool(memory, "get", {
    tool: "memory_get",
    positionals: ["tokenId"],
  });

  mountTool(memory, "add", {
    tool: "memory_add",
    positionals: ["tokenId", "kind", "text"],
  });

  mountTool(memory, "update", {
    tool: "memory_update",
    positionals: ["tokenId", "itemId"],
  });

  mountTool(memory, "delete", {
    tool: "memory_delete",
    positionals: ["tokenId", "itemId"],
    confirm: (p) => `Permanently delete memory item ${p.itemId} from worker ${p.tokenId}?`,
  });
}
