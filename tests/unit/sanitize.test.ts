import { describe, expect, it } from "vitest";
import { sanitizeInline, sanitizeText } from "../../src/output/sanitize.js";

// Built from char codes so this file stays pure ASCII — hostile bytes are constructed, not pasted.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);
const SOH = String.fromCharCode(1);
const RLO = String.fromCharCode(0x202e); // right-to-left override
const PDF = String.fromCharCode(0x202c); // pop directional formatting
const ZWSP = String.fromCharCode(0x200b);

describe("sanitizeText", () => {
  it("strips SGR color/reset sequences", () => {
    expect(sanitizeText(`${ESC}[31mred${ESC}[0m`)).toBe("red");
  });

  it("strips cursor movement and erase sequences", () => {
    expect(sanitizeText(`${ESC}[2Jwiped${ESC}[1;1H`)).toBe("wiped");
  });

  it("strips OSC window-title sequences (BEL and ST terminated)", () => {
    expect(sanitizeText(`${ESC}]0;evil title${BEL}after`)).toBe("after");
    expect(sanitizeText(`${ESC}]8;;https://example.com${ESC}\\link`)).toBe("link");
  });

  it("strips DCS payloads", () => {
    expect(sanitizeText(`${ESC}Pq payload${ESC}\\kept`)).toBe("kept");
  });

  it("strips C0 controls but keeps newline and tab", () => {
    expect(sanitizeText(`a${NUL}b${SOH}c\nd\te`)).toBe("abc\nd\te");
  });

  it("strips bidi overrides and zero-width characters", () => {
    expect(sanitizeText(`user${RLO}evil${PDF} name${ZWSP}`)).toBe("userevil name");
  });

  it("leaves ordinary unicode intact", () => {
    expect(sanitizeText("naive cafe - library")).toBe("naive cafe - library");
  });
});

describe("sanitizeInline", () => {
  it("collapses whitespace after stripping", () => {
    expect(sanitizeInline(` a \n b\t c ${ESC}[31m `)).toBe("a b c");
  });
});
