import { describe, expect, it } from "vitest";
import { allDescriptors, byName } from "@workerkit/core";
import { buildProgram } from "../../src/program.js";
import { mountedSpecs } from "../../src/bind.js";

/**
 * The drift-proofing the plan trades generic command generation for: every descriptor must be
 * reachable from the CLI, and every hand-authored mapping must only name schema keys that exist.
 * A new tool added to @workerkit/core fails this test until the CLI mounts it.
 */

// Tools wired through bespoke commands (runTool/executeTool directly) rather than mountTool.
const BESPOKE_TOOLS = ["worker_run", "run_score", "instruction_set", "kit_install_preview", "kit_install"];

describe("command coverage", () => {
  it("every core descriptor is reachable from the CLI", () => {
    buildProgram(); // mounting populates mountedSpecs

    const covered = new Set([...mountedSpecs.map((s) => s.tool), ...BESPOKE_TOOLS]);
    const missing = allDescriptors.map((d) => d.name).filter((name) => !covered.has(name));

    expect(missing).toEqual([]);
  });

  it("every spec names only real schema keys", () => {
    buildProgram();

    for (const spec of mountedSpecs) {
      const descriptor = byName(spec.tool);
      expect(descriptor, `descriptor ${spec.tool}`).toBeDefined();
      const keys = new Set(Object.keys(descriptor!.schema));
      for (const key of [...(spec.positionals ?? []), ...(spec.hidden ?? []), ...Object.keys(spec.fixed ?? {})]) {
        expect(keys.has(key), `${spec.tool}: unknown schema key "${key}"`).toBe(true);
      }
    }
  });

  it("bespoke tools exist in core", () => {
    for (const name of BESPOKE_TOOLS) {
      expect(byName(name), name).toBeDefined();
    }
  });
});
