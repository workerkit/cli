import { describe, expect, it } from "vitest";
import type { Command } from "commander";
import { buildProgram } from "../../src/program.js";

/** Flag-generation contract: schema keys → kebab-case flags, enums in help, boolean negation. */

function findCommand(root: Command, path: string[]): Command {
  let cmd: Command | undefined = root;
  for (const name of path) {
    cmd = cmd?.commands.find((c) => c.name() === name);
    expect(cmd, `command ${path.join(" ")}`).toBeDefined();
  }
  return cmd!;
}

function flagsOf(cmd: Command): string[] {
  return cmd.options.map((o) => o.flags);
}

describe("descriptor-bound flag generation", () => {
  const program = buildProgram();

  it("camelCase schema keys become kebab-case flags with matching attribute names", () => {
    const search = findCommand(program, ["kit", "search"]);
    const pageSize = search.options.find((o) => o.flags.includes("--page-size"));
    expect(pageSize).toBeDefined();
    expect(pageSize!.attributeName()).toBe("pageSize");
  });

  it("enum flags advertise their values in the flag placeholder", () => {
    const search = findCommand(program, ["kit", "search"]);
    const sort = search.options.find((o) => o.flags.startsWith("--sort"));
    expect(sort).toBeDefined();
    expect(sort!.flags).toContain("<downloads|new|name|stars>");
  });

  it("defaults from ZodDefault surface in the help text", () => {
    const search = findCommand(program, ["kit", "search"]);
    const sort = search.options.find((o) => o.flags.startsWith("--sort"));
    expect(sort!.description).toContain("(default: downloads)");
  });

  it("boolean schema fields get both --flag and --no-flag (false must be expressible)", () => {
    const create = findCommand(program, ["schedules", "create"]);
    const flags = flagsOf(create);
    expect(flags).toContain("--is-enabled");
    expect(flags).toContain("--no-is-enabled");

    const kitGet = findCommand(program, ["kit", "get"]);
    expect(flagsOf(kitGet)).toContain("--include-resource-bodies");
  });

  it("schedule_update can express isEnabled=false (pause via --no-is-enabled)", () => {
    const update = findCommand(program, ["schedules", "update"]);
    expect(flagsOf(update)).toContain("--no-is-enabled");
  });

  it("positionals are declared as required arguments, not flags", () => {
    const get = findCommand(program, ["workers", "get"]);
    expect(get.registeredArguments.map((a) => a.name())).toEqual(["tokenId"]);
    expect(flagsOf(get).join(" ")).not.toContain("--token-id");
  });
});
