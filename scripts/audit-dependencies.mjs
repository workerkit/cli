// Audit gate for the publish workflow: npm audit over production dependencies,
// failing on any high or critical advisory that is not allowlisted here with a
// reason and an expiry date. An expired entry fails the gate again on purpose.
import { execSync } from "node:child_process";

const allowlist = {
  "GHSA-mrhx-c7xc-m3w5": {
    until: "2026-12-31",
    reason: "zod 3 validates oversized constrained collections before rejecting them and the only patched line is zod 4; the CLI validates its own user's input. Removed by the zod 4 migration.",
  },
};

let report;
try {
  report = execSync("npm audit --omit=dev --json", { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
} catch (error) {
  // npm exits non-zero whenever it reports a vulnerability; the JSON is still on stdout.
  if (!error.stdout) throw error;
  report = error.stdout;
}
const audit = JSON.parse(report);
if (audit.error) throw new Error(`npm audit failed: ${audit.error.summary ?? JSON.stringify(audit.error)}`);

const today = new Date().toISOString().slice(0, 10);
const failures = [];
for (const [name, entry] of Object.entries(audit.vulnerabilities ?? {})) {
  for (const via of entry.via) {
    if (typeof via !== "object" || !["high", "critical"].includes(via.severity)) continue;
    const id = via.url?.match(/GHSA-[a-z0-9-]+/i)?.[0] ?? via.url ?? via.title;
    const allowed = allowlist[id];
    if (allowed && allowed.until >= today) {
      console.log(`allowlisted until ${allowed.until}: ${id} (${name} ${entry.range}) - ${allowed.reason}`);
      continue;
    }
    failures.push(`${id} (${name} ${entry.range}, ${via.severity}): ${via.title}${allowed ? ` - allowlist expired ${allowed.until}` : ""}`);
  }
}
if (failures.length) {
  console.error(`npm audit: ${failures.length} unresolved high or critical advisories\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`npm audit: no unresolved high or critical advisories in production dependencies (${audit.metadata?.vulnerabilities?.total ?? 0} reported).`);
