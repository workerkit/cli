import { styleText } from "node:util";

/** Colors on only for a TTY without NO_COLOR — never in pipes, never in --json output. */
export function colorsEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  return Boolean(process.stdout.isTTY);
}

type Style = Parameters<typeof styleText>[0];

function paint(style: Style, text: string): string {
  return colorsEnabled() ? styleText(style, text) : text;
}

export const bold = (t: string) => paint("bold", t);
export const dim = (t: string) => paint("dim", t);
export const green = (t: string) => paint("green", t);
export const red = (t: string) => paint("red", t);
export const yellow = (t: string) => paint("yellow", t);
export const cyan = (t: string) => paint("cyan", t);
