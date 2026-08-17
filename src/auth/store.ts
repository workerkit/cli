/**
 * Credential storage.
 *
 * Secrets prefer the OS keychain (Windows Credential Manager / macOS Keychain / libsecret) via
 * @napi-rs/keyring; when no keychain is available (headless Linux, some CI), they fall back to a
 * file beside the config, written atomically and chmod 0600 on POSIX. Non-secret state (active
 * profile, which storage each profile uses, update-check timestamp) lives in config.json.
 *
 * The WK_MANAGER_KEY environment variable always wins over stored profiles and disables
 * profile-mutation commands — an explicit environment is not something the CLI should silently
 * write around.
 */

import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

export const ENV_KEY = "WK_MANAGER_KEY";
const KEYCHAIN_SERVICE = "workerkit-cli";

export interface ProfileRecord {
  storage: "keychain" | "file";
}

export interface CliConfig {
  activeProfile?: string;
  profiles: Record<string, ProfileRecord>;
  lastUpdateCheck?: string;
}

export function configDir(): string {
  if (process.env.WK_CONFIG_DIR) return process.env.WK_CONFIG_DIR;
  if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "workerkit");
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.length > 0 ? xdg : join(homedir(), ".config"), "workerkit");
}

const configPath = () => join(configDir(), "config.json");
const credentialsPath = () => join(configDir(), "credentials.json");

export function readConfig(): CliConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), "utf8")) as CliConfig;
    if (parsed && typeof parsed === "object" && parsed.profiles) return parsed;
  } catch {
    // Missing or corrupt config reads as empty — never blocks auth via env var.
  }
  return { profiles: {} };
}

export function writeConfig(config: CliConfig): void {
  atomicWriteJson(configPath(), config);
}

interface CredentialsFile {
  profiles: Record<string, string>;
}

function readCredentialsFile(): CredentialsFile {
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath(), "utf8")) as CredentialsFile;
    if (parsed && typeof parsed === "object" && parsed.profiles) return parsed;
  } catch {
    // fall through
  }
  return { profiles: {} };
}

/**
 * Atomic write: temp file in the same directory, then rename. 0600 on POSIX; on Windows the
 * directory inherits the user-scoped %APPDATA% ACL (and the keychain path is preferred anyway).
 */
function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Windows: chmod is a no-op; ACLs cover it.
  }
  renameSync(tmp, path);
}

// ── Keychain (lazy — the native module may be absent or the daemon unreachable) ────────────────

type KeyringEntry = { getPassword(): string; setPassword(pw: string): void; deletePassword(): boolean };
let keyringCtor: (new (service: string, account: string) => KeyringEntry) | null | undefined;

async function keyring(): Promise<typeof keyringCtor> {
  if (keyringCtor !== undefined) return keyringCtor;
  try {
    // Optional native dependency: resolved at runtime, absent on unsupported platforms — the
    // non-literal specifier keeps the compiler from requiring it at build time too.
    const specifier: string = "@napi-rs/keyring";
    const mod = (await import(specifier)) as { Entry?: unknown };
    keyringCtor = (mod.Entry ?? null) as (new (service: string, account: string) => KeyringEntry) | null;
  } catch {
    keyringCtor = null;
  }
  return keyringCtor;
}

// ── Public surface ──────────────────────────────────────────────────────────────────────────────

export interface ResolvedCredential {
  key: string;
  source: "env" | "keychain" | "file";
  profile?: string;
}

/** Resolve the credential: env var first, then the active (or named) profile. */
export async function resolveCredential(profileName?: string): Promise<ResolvedCredential | null> {
  const envKey = process.env[ENV_KEY];
  if (envKey && envKey.trim().length > 0) return { key: envKey.trim(), source: "env" };

  const config = readConfig();
  const name = profileName ?? config.activeProfile;
  if (!name) return null;
  const record = config.profiles[name];
  if (!record) return null;

  if (record.storage === "keychain") {
    const Entry = await keyring();
    if (Entry) {
      try {
        const key = new Entry(KEYCHAIN_SERVICE, name).getPassword();
        if (key) return { key, source: "keychain", profile: name };
      } catch {
        // Entry vanished (user cleared the keychain) — fall through to null, do not guess.
      }
    }
    return null;
  }

  const creds = readCredentialsFile();
  const key = creds.profiles[name];
  return key ? { key, source: "file", profile: name } : null;
}

/** Store a credential under a profile, preferring the keychain; returns where it landed. */
export async function storeCredential(profileName: string, key: string): Promise<"keychain" | "file"> {
  const config = readConfig();
  let storage: "keychain" | "file" = "file";

  const Entry = await keyring();
  if (Entry) {
    try {
      new Entry(KEYCHAIN_SERVICE, profileName).setPassword(key);
      storage = "keychain";
    } catch {
      storage = "file";
    }
  }

  if (storage === "file") {
    const creds = readCredentialsFile();
    creds.profiles[profileName] = key;
    atomicWriteJson(credentialsPath(), creds);
  }

  config.profiles[profileName] = { storage };
  config.activeProfile = profileName;
  writeConfig(config);
  return storage;
}

/** Remove a profile and its secret from wherever it lives. */
export async function deleteCredential(profileName: string): Promise<void> {
  const config = readConfig();
  const record = config.profiles[profileName];

  if (record?.storage === "keychain") {
    const Entry = await keyring();
    if (Entry) {
      try {
        new Entry(KEYCHAIN_SERVICE, profileName).deletePassword();
      } catch {
        // Already gone.
      }
    }
  }

  const creds = readCredentialsFile();
  if (creds.profiles[profileName]) {
    delete creds.profiles[profileName];
    if (Object.keys(creds.profiles).length === 0) {
      try {
        rmSync(credentialsPath());
      } catch {
        // fine
      }
    } else {
      atomicWriteJson(credentialsPath(), creds);
    }
  }

  delete config.profiles[profileName];
  if (config.activeProfile === profileName) {
    config.activeProfile = Object.keys(config.profiles)[0];
  }
  writeConfig(config);
}

/** True when WK_MANAGER_KEY is set — profile mutation is disabled in that mode. */
export function envKeyActive(): boolean {
  const v = process.env[ENV_KEY];
  return Boolean(v && v.trim().length > 0);
}

export function hasAnyProfile(): boolean {
  return Object.keys(readConfig().profiles).length > 0;
}

export { KEYCHAIN_SERVICE, credentialsPath, configPath };
