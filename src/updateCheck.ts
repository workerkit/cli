import { readConfig, writeConfig } from "./auth/store.js";
import { cliVersion } from "./version.js";
import { dim } from "./output/colors.js";

const REGISTRY_URL = "https://registry.npmjs.org/@workerkit/cli/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BUDGET_MS = 1500;

/**
 * Once-daily passive version nudge. TTY + human output only; suppressed by CI,
 * WK_NO_UPDATE_CHECK, --json/--plain (callers gate on that). The 24h stamp is written BEFORE the
 * network call so rapid agent-loop invocations can't hammer the registry, and the check runs
 * after command output so it never delays results.
 */
export async function maybeNudgeUpdate(): Promise<void> {
  // The entire body is best-effort: a read-only filesystem (writeConfig throws), a corrupt
  // config, or a registry hiccup must never break the command that just succeeded.
  try {
    if (process.env.WK_NO_UPDATE_CHECK || process.env.CI) return;
    if (!process.stderr.isTTY) return;

    const config = readConfig();
    const last = config.lastUpdateCheck ? Date.parse(config.lastUpdateCheck) : 0;
    if (Date.now() - last < CHECK_INTERVAL_MS) return;

    config.lastUpdateCheck = new Date().toISOString();
    writeConfig(config);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BUDGET_MS);
    const res = await fetch(REGISTRY_URL, { signal: controller.signal, redirect: "error" });
    clearTimeout(timer);
    if (!res.ok) return;
    const body = (await res.json()) as { version?: string };
    const latest = body.version;
    if (latest && latest !== cliVersion() && isNewer(latest, cliVersion())) {
      process.stderr.write(dim(`\nA new version of wk is available (${cliVersion()} -> ${latest}). Run: wk update\n`));
    }
  } catch {
    // Never let the nudge break a command.
  }
}

function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}
