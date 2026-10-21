import { describe, expect, it, vi } from "vitest";
import { allDescriptors, byName, instructionsByProfile, toolDocumentation, guidanceCoverageFailures } from "@workerkit/core";
import { buildProgram } from "../../src/program.js";
import { toolCommandPaths, formatToolReferences, firstSentence } from "../../src/bind.js";

describe("complete offline guidance", () => {
  it("retains backend-declared teachings in actual command help and offline instructions", async () => {
    const root = buildProgram(), paths = toolCommandPaths(root);
    const help = new Map<string, string>();
    for (const [tool, commands] of Object.entries(paths)) {
      // Includes bespoke commands and aliases; preview flags share their command help.
      const outputs: string[] = [];
      for (const path of commands) {
        let command = root;
        for (const part of path.split(" ").slice(1)) {
          if (part.startsWith("--")) break;
          command = command.commands.find(c=>c.name()===part)!;
        }
        let text = ""; command.configureOutput({writeOut: chunk=>{text += chunk;}}); command.outputHelp();
        outputs.push(text);
      }
      // This reference is rendered as a CLI command in help; coverage uses
      // the canonical tool name. Keep testing the emitted help itself.
      help.set(tool, outputs.join("\n")
        .replaceAll("wk workers quality get", "worker_quality_get")
        .replaceAll("wk workers permissions-set", "worker_permissions_set"));
    }
    for (const profile of ["workers", "decision", "directory"] as const) {
      const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      let instructions = "";
      try {
        await buildProgram().parseAsync(["instructions", profile], {from:"user"});
        const human = write.mock.calls.map(call=>String(call[0])).join("");
        expect(human).toBe(formatToolReferences(instructionsByProfile[profile], root) + "\n");
        write.mockClear();
        await buildProgram().parseAsync(["--json", "instructions", profile], {from:"user"});
        const raw = JSON.parse(write.mock.calls.map(call=>String(call[0])).join(""));
        expect(raw.surface).toBe(profile);
        expect(raw.instructions).toBe(instructionsByProfile[profile]);
        // Coverage anchors use canonical tool names. Human output intentionally
        // maps those names to CLI commands; equality above pins that whole path.
        instructions = raw.instructions;
      } finally {write.mockRestore();}
      expect(guidanceCoverageFailures(profile, check=>check.kind === "instructions" ? instructions : help.get(check.tool!))).toEqual([]);
    }
  });
  it.each(["worker_run", "run_get"])("retains %s result interpretation in offline help for raw JSON consumers", async name => {
    const root = buildProgram();
    const path = toolCommandPaths(root)[name]![0]!.split(" ").slice(1);
    let command = root;
    for (const part of path) command = command.commands.find(c => c.name() === part)!;
    let help = "";
    command.configureOutput({writeOut: text => {help += text;}});
    command.outputHelp();
    expect(help).toContain("unknown coverage is not complete");
    expect(help).toContain("walletChargeUsd is committed wallet cost");
    expect(help).toContain("2xx without an action result ID is unknown");
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      await buildProgram().parseAsync(["--json", "tools", "describe", name], {from:"user"});
      expect(JSON.parse(String(write.mock.calls[0]![0])).description).toBe(toolDocumentation(byName(name)!));
    } finally {write.mockRestore();}
  });
  it("maps every tool to a real CLI command", () => {
    expect(Object.keys(toolCommandPaths(buildProgram())).sort()).toEqual(allDescriptors.map(d => d.name).sort());
    expect(toolCommandPaths(buildProgram()).kit_install_preview).toEqual(["wk kit install --preview"]);
  });
  it("retains the full description and positional guidance in command help", () => {
    const root = buildProgram();
    const command = root.commands.find(c => c.name() === "workers")!.commands.find(c => c.name() === "delete")!;
    let help = "";
    command.configureOutput({ writeOut: text => { help += text; } });
    command.outputHelp();
    expect(help).toContain(formatToolReferences(byName("worker_delete")!.description, root));
    expect(help).toContain("wk auth key-info");
    expect(help).toContain("sub_workers_outside_key");
    expect(help).toContain("NEVER proves an earlier delete succeeded");
    expect(help).toContain("Worker's numeric tokenId");
  });

  it("offers profile instructions without credentials", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      const root = buildProgram();
      await root.parseAsync(["instructions", "decision"], { from: "user" });
      expect(write).toHaveBeenCalledWith(formatToolReferences(instructionsByProfile.decision, root) + "\n");
    } finally { write.mockRestore(); }
  });

  it("keeps idempotency and input guidance on the bespoke invocation command itself", () => {
    const command = buildProgram().commands.find(c => c.name() === "workers")!.commands.find(c => c.name() === "invoke")!;
    let help = "";
    command.configureOutput({ writeOut: text => { help += text; } });
    command.outputHelp();
    expect(help).toContain(formatToolReferences(byName("worker_tool_call")!.schema.idempotencyKey!.description!, command));
    expect(help).toContain("wk workers tools");
    expect(help).toContain("--idempotency-key");
    expect(help).toContain("outcome_unknown");
    expect(help).toContain("do not automatically retry or issue a new key");
  });

  it("makes complete bespoke-tool guidance available offline", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      const root = buildProgram();
      await root.parseAsync(["tools", "describe", "worker_tool_call"], { from: "user" });
      const text = write.mock.calls.map(args => args[0]).join("");
      expect(text).toContain(formatToolReferences(byName("worker_tool_call")!.description, root));
      expect(text).toContain("outcome_unknown");
      expect(text).toContain(formatToolReferences(byName("worker_tool_call")!.schema.idempotencyKey!.description!, root));
    } finally { write.mockRestore(); }
  });

  it("preserves canonical metadata in JSON while translating human references", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      await buildProgram().parseAsync(["--json", "tools", "describe", "worker_tool_call"], { from: "user" });
      const json = JSON.parse(String(write.mock.calls[0]![0]));
      expect(json.description).toBe(byName("worker_tool_call")!.description);
      expect(json.inputs.idempotencyKey).toBe(byName("worker_tool_call")!.schema.idempotencyKey!.description);
      expect(json.commands).toEqual(["wk workers invoke"]);
    } finally { write.mockRestore(); }
    const root = buildProgram();
    expect(formatToolReferences("kit_install_preview then kit_install(deploy:true)", root))
      .toBe("wk kit install --preview then Manager tool kit_install (inputs: deploy:true)");
    expect(formatToolReferences("worker_run.runId / kit_install.githubSelection", root))
      .toBe("wk run result.runId / wk kit install input.githubSelection");
    expect(formatToolReferences("run_not_settled and slack_get_history", root))
      .toBe("run_not_settled and slack_get_history");
  });

  it("renders every help screen without unexplained manager tool references", () => {
    const root = buildProgram();
    let count = 0;
    function visit(command: typeof root): void {
      let help = "";
      command.configureOutput({ writeOut: text => { help += text; } });
      command.outputHelp();
      const references = [...help.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)];
      const unexplained = references.filter(match => byName(match[0]) && !/Manager\s+(?:tool|input)\s+$/.test(help.slice(0, match.index)));
      expect(unexplained.map(match => match[0]), command.name()).toEqual([]);
      expect(help).not.toMatch(/\(e\.g\.(?:\s*\n|$)/);
      count++;
      for (const child of command.commands) visit(child);
    }
    visit(root);
    expect(count).toBeGreaterThan(100);
    const workers = root.commands.find(c => c.name() === "workers")!;
    expect(workers.commands.find(c => c.name() === "list")!.description()).toContain("List reachable workers");
    const install = root.commands.find(c => c.name() === "kit")!.commands.find(c => c.name() === "install")!;
    let help = "";
    install.configureOutput({ writeOut: text => { help += text; } });
    install.outputHelp();
    expect(help).toContain("CLI input limits:");
    expect(help).toContain("Install and deploy in one call is not offered");
    expect(help).toContain("wk deploy");
    expect(help).toContain("--worker-bindings");
  });

  it.each([
    ["Use e.g. Slack or Gmail. Then inspect permissions.", "Use e.g. Slack or Gmail."],
    ["Read inputs, i.e. saved settings. Next step.", "Read inputs, i.e. saved settings."],
    ["Compare paid vs. free tiers. Next step.", "Compare paid vs. free tiers."],
    ["Set a 0.05 ceiling (e.g. for a short run). Next step.", "Set a 0.05 ceiling (e.g. for a short run)."],
    ["Inspect choices (why? for setup). Next step.", "Inspect choices (why? for setup)."],
    ["A complete summary without punctuation", "A complete summary without punctuation"],
  ])("keeps a complete first sentence: %s", (input, expected) => {
    expect(firstSentence(input)).toBe(expected);
  });
});
