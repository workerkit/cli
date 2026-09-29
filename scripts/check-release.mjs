import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "This workflow publishes stable versions only");
assert.equal(lock.version, pkg.version, "Lockfile version differs from package.json");
assert.equal(lock.packages[""].version, pkg.version, "Lockfile root version differs");
assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies, "Lockfile dependency pins differ");
for (const [name, version] of Object.entries(pkg.dependencies)) {
  assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must have an exact registry version`);
  const dependency = lock.packages[`node_modules/${name}`];
  assert.equal(dependency?.version, version, `${name} lockfile version differs`);
  assert.ok(dependency?.resolved?.startsWith("https://registry.npmjs.org/"), `${name} must resolve from npm`);
  assert.ok(dependency?.integrity?.startsWith("sha512-"), `${name} needs integrity metadata`);
}
const tag = process.argv[2] ?? (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
if (tag) assert.equal(tag, `v${pkg.version}`, "Release tag must match package.json exactly");
const changelog = readFileSync("CHANGELOG.md", "utf8").replace(/\r\n/g, "\n");
assert.ok(changelog.startsWith("# Changelog\n"), "Changelog must start with its title");
const sections = changelog.split(/^## /m);
const matches = sections.filter(section => section.startsWith(`[${pkg.version}] - `));
assert.equal(matches.length, 1, "Expected one dated changelog section for this version");
const [heading, ...body] = matches[0].split("\n");
assert.match(heading, / - \d{4}-\d{2}-\d{2}$/, "Release notes need a date");
const notes = body.join("\n").trim();
assert.ok(notes.length > 40, "Release notes must describe the changes");
process.stdout.write(notes + "\n");
