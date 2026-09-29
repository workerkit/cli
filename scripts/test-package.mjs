import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

// Always invoke npm through its JS entry point: works without shell quoting on Windows too.
const npm = process.env.npm_execpath;
assert.ok(npm, "Run this check with npm run test:package");
const runNpm = (args, cwd) => execFileSync(process.execPath, [npm, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const temp = mkdtempSync(join(tmpdir(), "workerkit-package-"));
try {
  const [pack] = JSON.parse(runNpm(["pack", "--json", "--pack-destination", temp], process.cwd()));
  assert.equal(pack.name, pkg.name);
  assert.equal(pack.version, pkg.version);
  const names = pack.files.map(file => file.path);
  for (const required of ["package.json", "README.md", "CHANGELOG.md", "LICENSE", "SECURITY.md", "dist/index.js"]) {
    assert.ok(names.includes(required), `Missing package file: ${required}`);
  }
  for (const name of names) {
    assert.ok(/^(?:package\.json|README\.md|CHANGELOG\.md|LICENSE|SECURITY\.md|docs\/hybrid-workers\.md|dist\/[\w/-]+\.(?:js|d\.ts|js\.map))$/.test(name), `Unexpected package file: ${name}`);
  }
  const consumer = join(temp, "consumer");
  mkdirSync(consumer);
  const extra = pkg.name === "@workerkit/cli" && process.env.WK_CORE_TARBALL ? [resolve(process.env.WK_CORE_TARBALL)] : [];
  runNpm(["install", "--no-audit", "--no-fund", "--prefer-offline", "--omit=dev", "--package-lock=false", join(temp, pack.filename), ...extra], consumer);
  if (pkg.name === "@workerkit/core") {
    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { WorkerKitClient, byName, allDescriptors } from '@workerkit/core';
      assert.ok(byName('worker_decision_set'));
      assert.equal(new Set(allDescriptors.map(d => d.name)).size, allDescriptors.length);
      await new WorkerKitClient({ baseUrl: 'https://api.workerkit.ai' }).close();
    `], { cwd: consumer, stdio: "inherit" });
  } else {
    const installedCore = JSON.parse(readFileSync(join(consumer, "node_modules/@workerkit/core/package.json"), "utf8"));
    assert.equal(installedCore.version, pkg.dependencies["@workerkit/core"]);
    assert.ok(existsSync(join(consumer, "node_modules/.bin", process.platform === "win32" ? "wk.cmd" : "wk")), "Missing installed wk executable");
    const entry = join(consumer, "node_modules/@workerkit/cli/dist/index.js");
    const version = execFileSync(process.execPath, [entry, "--version"], { encoding: "utf8" }).trim();
    assert.equal(version, pkg.version);
    const help = execFileSync(process.execPath, [entry, "decision", "set", "--help"], { encoding: "utf8" });
    assert.ok(help.includes("--decision-spec") && help.includes("--updated-at"));
  }
  console.log(`${pack.name}@${pack.version}: package files and installed consumer passed (${names.length} files)`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
