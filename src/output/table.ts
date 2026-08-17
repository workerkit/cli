import { bold, dim } from "./colors.js";
import { sanitizeInline } from "./sanitize.js";

export interface Column<T> {
  header: string;
  value: (row: T) => string;
  /** Cap for long free-text cells; sanitized cell text is truncated with an ellipsis. */
  maxWidth?: number;
  /**
   * Applied AFTER sanitization and width computation, so color codes survive the sanitizer and
   * never distort alignment. Never paint inside `value` — the sanitizer strips it there.
   */
  paint?: (sanitizedCell: string, row: T) => string;
}

/** Renders a plain aligned table. Every cell passes through the sanitizer. */
export function renderTable<T>(rows: T[], columns: Column<T>[]): string {
  const cells = rows.map((row) =>
    columns.map((col) => {
      let text = sanitizeInline(col.value(row));
      if (col.maxWidth && text.length > col.maxWidth) text = `${text.slice(0, col.maxWidth - 1)}…`;
      return text;
    }),
  );

  const widths = columns.map((col, i) =>
    Math.max(col.header.length, ...cells.map((r) => r[i]?.length ?? 0)),
  );

  const lines: string[] = [];
  lines.push(columns.map((c, i) => bold(c.header.padEnd(widths[i] ?? 0))).join("  "));
  lines.push(dim(widths.map((w) => "-".repeat(w)).join("  ")));
  cells.forEach((row, rowIndex) => {
    const line = row
      .map((cell, i) => {
        const pad = " ".repeat(Math.max(0, (widths[i] ?? 0) - cell.length));
        const paint = columns[i]?.paint;
        const painted = paint ? paint(cell, rows[rowIndex] as T) : cell;
        return painted + pad;
      })
      .join("  ")
      .trimEnd();
    lines.push(line);
  });
  return lines.join("\n");
}

/** key: value block for detail views; values sanitized, multi-line values indented. */
export function renderDetail(pairs: Array<[string, string | null | undefined]>): string {
  const lines: string[] = [];
  for (const [key, raw] of pairs) {
    if (raw === null || raw === undefined || raw === "") continue;
    const value = sanitizeInline(String(raw));
    lines.push(`${bold(key.padEnd(18))} ${value}`);
  }
  return lines.join("\n");
}
