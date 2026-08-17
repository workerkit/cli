import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** CLI version, read from package.json at runtime (single source of truth). */
export function cliVersion(): string {
  try {
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function userAgent(): string {
  return `WorkerKit-CLI/${cliVersion()} (${process.platform}; ${process.arch})`;
}
