import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/check-release.mjs", import.meta.url));
const fixtures: string[] = [];
afterEach(() => { for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function check(required: string | undefined, pin = "1.2.3", tag = "v0.1.0") {
  const dir = mkdtempSync(join(tmpdir(), "wk-release-check-"));
  fixtures.push(dir);
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
  return spawnSync(process.execPath, [script, tag], { cwd: dir, encoding: "utf8" });
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
});
