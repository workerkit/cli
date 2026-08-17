import { describe, expect, it } from "vitest";
import { renderTable } from "../../src/output/table.js";

const ESC = String.fromCharCode(27);

describe("renderTable paint hook", () => {
  it("applies paint AFTER sanitization and width computation, so alignment ignores paint bytes", () => {
    const rows = [
      { status: "ok", name: "alpha" },
      { status: "failedlong", name: "b" },
    ];
    const out = renderTable(rows, [
      { header: "STATUS", value: (r) => r.status, paint: (cell) => `<<${cell}>>` },
      { header: "NAME", value: (r) => r.name },
    ]);
    const lines = out.split("\n");
    // Width comes from the plain cell ("failedlong", 10 chars), not the painted one.
    expect(lines[2]).toBe("<<ok>>          alpha");
    expect(lines[3]).toBe("<<failedlong>>  b");
  });

  it("colors painted inside value are stripped by the sanitizer (the trap paint exists to avoid)", () => {
    const rows = [{ s: `${ESC}[32mok${ESC}[0m` }];
    const out = renderTable(rows, [{ header: "S", value: (r) => r.s }]);
    expect(out.split("\n")[2]).toBe("ok");
  });
});
