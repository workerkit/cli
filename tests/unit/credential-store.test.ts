import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const keyring = vi.hoisted(() => ({ available: false, keys: new Map<string, string>() }));
vi.mock("@napi-rs/keyring", () => ({ Entry: class {
  constructor(private service: string, private account: string) {}
  setPassword(value: string) { if (!keyring.available) throw new Error("Unavailable"); keyring.keys.set(this.account, value); }
  getPassword() { return keyring.keys.get(this.account); }
  deletePassword() { return keyring.keys.delete(this.account); }
} }));

import { credentialsPath, deleteCredential, readConfig, resolveCredential, storeCredential, writePrivateJson } from "../../src/auth/store.js";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "wk-credentials-test-"));
  vi.stubEnv("WK_CONFIG_DIR", directory);
  vi.stubEnv("WK_MANAGER_KEY", "");
  keyring.available = false;
  keyring.keys.clear();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });

it("handles reserved profile names without prototype lookups and stores private files", async () => {
  expect(await resolveCredential("constructor")).toBeNull();
  for (const name of ["__proto__", "constructor"]) {
    expect(await storeCredential(name, "test-secret")).toBe("file");
    expect(await resolveCredential(name)).toMatchObject({ key: "test-secret", profile: name });
    expect(Object.hasOwn(readConfig().profiles, name)).toBe(true);
  }
  if (process.platform !== "win32") expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600);
  await deleteCredential("__proto__");
  expect(await resolveCredential("__proto__")).toBeNull();
  expect(await resolveCredential("constructor")).not.toBeNull();
});

it("removes the obsolete plaintext credential when storage moves to the keychain", async () => {
  await storeCredential("default", "old-secret");
  keyring.available = true;
  expect(await storeCredential("default", "new-secret")).toBe("keychain");
  expect(existsSync(credentialsPath())).toBe(false);
  expect(await resolveCredential()).toMatchObject({ key: "new-secret", source: "keychain" });
});

it("rejects non-string credentials read from a malformed local file", async () => {
  await storeCredential("default", "test-secret");
  writePrivateJson(credentialsPath(), { profiles: { default: { unexpected: "object" } } });
  expect(await resolveCredential()).toBeNull();
  expect(readFileSync(credentialsPath(), "utf8")).not.toContain("test-secret");
});
