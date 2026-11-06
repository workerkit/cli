import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/check-release.mjs", import.meta.url));
const fixtures: string[] = [];
afterEach(() => { for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true }); });

interface CoreFixture {
  missingTool?: string;
  withoutPersonalVisibility?: string;
  withoutPersonalFlag?: boolean;
  sourceRevision?: string;
}

function check(required: string | undefined, pin = "1.2.3", tag = "v0.1.0", core: CoreFixture = {}) {
  const dir = mkdtempSync(join(tmpdir(), "wk-release-check-"));
  fixtures.push(dir);
  // Resolve the script's ESM import inside this fixture, independently of the installed core.
  const scriptDir = join(dir, "scripts");
  const coreDir = join(dir, "node_modules", "@workerkit", "core");
  mkdirSync(scriptDir, { recursive: true });
  mkdirSync(coreDir, { recursive: true });
  const fixtureScript = join(scriptDir, "check-release.mjs");
  copyFileSync(script, fixtureScript);
  writeFileSync(join(coreDir, "package.json"), JSON.stringify({
    name: "@workerkit/core", version: pin, type: "module", exports: "./index.js",
  }));
  writeFileSync(join(coreDir, "index.js"), `
    const fixture = ${JSON.stringify(core)};
    // Synthetic provenance exercises the format guard only; it is not a backend commit.
    export const backendContractProvenance = { sourceRevision: fixture.sourceRevision ?? "a".repeat(40) };
    export function byName(name) {
      if (name === fixture.missingTool) return undefined;
      if (["knowledge_timeline", "knowledge_timeline_status", "knowledge_timeline_enable"].includes(name))
        return { schema: {} };
      if (["kit_validate", "kit_publish", "kit_replace"].includes(name))
        return { schema: { visibility: { safeParse: value => ({ success:
          value === "personal" && name !== fixture.withoutPersonalVisibility }) } } };
      if (name === "kit_make_private")
        return { schema: fixture.withoutPersonalFlag ? {} : { personal: {} } };
      return undefined;
    }
  `);
  const pkg = { version: "0.1.0", dependencies: { "@workerkit/core": pin } };
  const lock = { version: pkg.version, packages: {
    "": pkg,
    "node_modules/@workerkit/core": {
      version: pin, resolved: `https://registry.npmjs.org/@workerkit/core/-/core-${pin}.tgz`,
      integrity: "sha512-fixture",
    },
  } };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock));
  writeFileSync(join(dir, "CHANGELOG.md"), "# Changelog\n\n## [0.1.0] - 2026-10-11\n\n"
    + (required ? `Requires \`@workerkit/core\` ${required}.\n\n` : "")
    + "### Changed\n\n- Adds offline guidance to command help and tool descriptions.\n");
  return spawnSync(process.execPath, [fixtureScript, tag], { cwd: dir, encoding: "utf8" });
}

describe("release requirements", () => {
  it("accepts matching core pins, notes and tag", () => {
    const result = check("1.2.3");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Requires `@workerkit/core` 1.2.3.");
  });
  it("rejects an internally consistent lockfile pinned to the wrong core release", () => {
    const result = check("1.2.4");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("pin must match this release's requirement");
  });
  it("requires an explicit core version in the release notes", () => {
    const result = check(undefined);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("must declare the required @workerkit/core version");
  });
  it("still rejects mismatched release tags", () => {
    const result = check("1.2.3", "1.2.3", "v0.1.1");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Release tag must match package.json exactly");
  });
  it.each(["knowledge_timeline", "knowledge_timeline_status", "knowledge_timeline_enable"])(
    "rejects a core release missing %s despite matching metadata", missingTool => {
      const result = check("1.2.3", "1.2.3", "v0.1.0", { missingTool });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`The pinned @workerkit/core lacks ${missingTool};`);
    },
  );
  it.each(["kit_validate", "kit_publish", "kit_replace"])(
    "requires personal visibility in %s", withoutPersonalVisibility => {
      const result = check("1.2.3", "1.2.3", "v0.1.0", { withoutPersonalVisibility });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`lacks personal visibility in ${withoutPersonalVisibility};`);
    },
  );
  it("requires the personal audience flag on kit_make_private", () => {
    const result = check("1.2.3", "1.2.3", "v0.1.0", { withoutPersonalFlag: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("lacks the kit_make_private personal flag");
  });
  it("rejects working-tree provenance even when all required tools exist", () => {
    const result = check("1.2.3", "1.2.3", "v0.1.0", { sourceRevision: "working-tree-test-fixture" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not a working-tree contract");
  });
});
