import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Exit-code and parsing contract, pinned against the BUILT binary (run `npm run build` first —
 * CI does). Everything here is offline: usage errors and the auth gate fire before any network.
 */

const DIST = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
const emptyConfigDir = mkdtempSync(join(tmpdir(), "wk-cli-test-"));

function wk(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env, WK_NO_UPDATE_CHECK: "1", WK_CONFIG_DIR: emptyConfigDir, CI: "1" };
  delete (env as Record<string, unknown>).WK_MANAGER_KEY;
  const run = spawnSync(process.execPath, [DIST, ...args], { encoding: "utf8", env, timeout: 30_000 });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

describe.skipIf(!existsSync(DIST))("built CLI golden contract", () => {
  it("--version exits 0 with a semver", () => {
    const r = wk(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("--help exits 0", () => {
    expect(wk(["--help"]).status).toBe(0);
  });

  it("unknown command exits 2", () => {
    const r = wk(["nosuchcmd"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown command");
  });

  it("missing required positional exits 2", () => {
    const r = wk(["kit", "get"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("missing required argument");
  });

  it("unknown option exits 2", () => {
    expect(wk(["workers", "list", "--bogus"]).status).toBe(2);
  });

  it("bad enum value exits 2 via the schema (no network)", () => {
    const r = wk(["kit", "search", "--sort", "bogus"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Invalid sort");
  });

  it("non-numeric value for a number flag exits 2", () => {
    const r = wk(["kit", "search", "--page-size", "abc"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--page-size expects a number");
  });

  it("runs score without a score or --clear exits 2", () => {
    const r = wk(["runs", "score", "some-run-id"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("between 0 and 100");
  });

  it("manager commands without a credential exit 3", () => {
    const r = wk(["workers", "list"]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("Not signed in");
  });

  it("global --json is accepted before AND after the subcommand", () => {
    // Both forms must at least parse past commander (exit 3 = reached the auth gate).
    expect(wk(["--json", "workers", "list"]).status).toBe(3);
    expect(wk(["workers", "list", "--json"]).status).toBe(3);
  });

  it("boolean negation flags are mounted (--no-is-enabled in schedules help)", () => {
    const r = wk(["schedules", "create", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--no-is-enabled");
  });
});
