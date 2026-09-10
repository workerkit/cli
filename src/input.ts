import { readFileSync } from "node:fs";
import { sanitizeInline } from "./output/sanitize.js";

/**
 * Input that is too large or too secret for a flag: kit bodies, instruction text, credentials.
 * Every reader here reports a usage problem the same way — a line on stderr, exit code 2, and a
 * null return the caller turns into an early exit.
 */

/** Everything piped on stdin, as one string. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Hidden input for a secret (a manager key, an API key, a bot token) — it must not echo. */
export async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    // Piped input: read a single line from stdin (scripting path).
    return (await readStdin()).split(/\r?\n/, 1)[0]?.trim() ?? "";
  }

  process.stdout.write(question);
  return new Promise<string>((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    let value = "";
    const finish = () => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(value.trim());
    };
    const onData = (data: Buffer) => {
      const code = data[0] ?? 0;
      if (code === 3) {
        // Ctrl-C
        stdin.setRawMode?.(false);
        process.stdout.write("\n");
        process.exit(130);
      }
      if (code === 127 || code === 8) {
        // Backspace / DEL
        value = value.slice(0, -1);
        return;
      }
      if (code === 27) return; // ESC-prefixed sequences (arrows, function keys) — ignore whole chunk
      // Manager keys are ASCII; chunk-level classification by the first byte is deliberate. A
      // paste arrives as one chunk and may carry its own newline — accept up to it and finish.
      const text = data.toString("utf8");
      const newlineAt = text.search(/[\r\n]/);
      if (newlineAt >= 0) {
        if (code >= 32) value += text.slice(0, newlineAt);
        finish();
        return;
      }
      if (code >= 32) value += text;
    };
    stdin.on("data", onData);
  });
}

/** Parse `raw` as a JSON object (not an array, not a scalar); null with exit 2 otherwise. */
export function parseJsonObject(raw: string, what: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    process.stderr.write(`The ${what} is not a JSON object.\n`);
    process.exitCode = 2;
    return null;
  }
}

/**
 * A credential object assembled from, in order: repeatable `--field name=value`,
 * `--credential '{...}'`, `--credential-file <path>`, JSON piped on stdin, and — when nothing
 * else was given and stdin is a terminal — one hidden prompt per entry of `promptFields`.
 * Secrets never have to pass through a flag, so they never land in shell history.
 *
 * An empty object means the user supplied nothing; the caller decides whether that is allowed.
 */
export async function readCredential(
  options: Record<string, unknown>,
  promptFields: string[],
): Promise<Record<string, unknown> | null> {
  const fields: Record<string, unknown> = {};
  for (const pair of (options.field as string[] | undefined) ?? []) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      process.stderr.write(`--field expects name=value, got "${sanitizeInline(pair)}".\n`);
      process.exitCode = 2;
      return null;
    }
    fields[pair.slice(0, eq)] = pair.slice(eq + 1);
  }

  let raw: string | null = null;
  if (typeof options.credential === "string" && options.credential) raw = options.credential;
  else if (typeof options.credentialFile === "string" && options.credentialFile) raw = readFileSync(options.credentialFile, "utf8");
  else if (!process.stdin.isTTY && Object.keys(fields).length === 0) raw = (await readStdin()).trim() || null;

  if (raw !== null) {
    const parsed = parseJsonObject(raw, "credential");
    if (!parsed) return null;
    Object.assign(fields, parsed);
  }

  if (Object.keys(fields).length === 0 && process.stdin.isTTY) {
    for (const name of promptFields) {
      const value = await promptHidden(`${name}: `);
      if (value.length > 0) fields[name] = value;
    }
  }
  return fields;
}
