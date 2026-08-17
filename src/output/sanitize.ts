/**
 * Terminal-output sanitization for server-controlled text.
 *
 * Everything the API returns is influenced by data an AI worker touched (run digests, kit
 * descriptions, memory items, error messages), so it must never reach a TTY unfiltered: escape
 * sequences can rewrite the screen, retitle the window, or reorder text visually. `--json` output
 * is exempt by design: it is a byte-faithful machine contract for pipes, documented as such.
 */

// CSI (ESC [ ... final byte), OSC (ESC ] ... BEL or ESC \), DCS/SOS/PM/APC (ESC P/X/^/_ ... ESC \),
// then any remaining lone ESC + following byte. Order matters: longest forms first.
const ESCAPE_SEQUENCES = new RegExp(
  [
    "\\x1b\\[[0-9:;<=>?]*[ !\"#$%&'()*+,\\-./]*[@-~]", // CSI
    "\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)?", // OSC
    "\\x1b[PX^_][^\\x1b]*(?:\\x1b\\\\)?", // DCS / SOS / PM / APC
    "\\x1b.?", // any remaining escape
  ].join("|"),
  "g",
);

// C0 controls except \n (0x0a) and \t (0x09), plus DEL (0x7f) and the C1 range (0x80-0x9f).
const CONTROL_CHARS = new RegExp("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f]", "g");

// Bidirectional embedding/override/isolate marks and zero-width characters (the visual-spoofing
// set): U+202A-202E, U+2066-2069, U+200B-200F, U+2060, U+FEFF.
const BIDI_AND_FORMAT = new RegExp("[\\u202a-\\u202e\\u2066-\\u2069\\u200b-\\u200f\\u2060\\ufeff]", "g");

/** Strips escape sequences, control characters (keeping \n and \t), and bidi/format overrides. */
export function sanitizeText(text: string): string {
  return text
    .replace(ESCAPE_SEQUENCES, "")
    .replace(CONTROL_CHARS, "")
    .replace(BIDI_AND_FORMAT, "");
}

/** Sanitize and collapse to a single line (for table cells and inline labels). */
export function sanitizeInline(text: string): string {
  return sanitizeText(text).replace(/\s+/g, " ").trim();
}
