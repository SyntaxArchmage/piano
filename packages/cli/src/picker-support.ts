// Input handling and framing shared by the overlay pickers (session,
// workspace, workflow). The three pickers filter and frame rows identically;
// only their data sources differ, so the shared mechanics live here once.

import { RST, type PianoTheme } from "./theme.js";

/** Subsequence fuzzy match: every query character must appear in order.
 * Lower is better; consecutive matches score 0, gaps cost their index. */
export function fuzzyScore(value: string, query: string): number | undefined {
  if (query === "") return 0;
  const candidate = value.toLowerCase();
  const needle = query.toLowerCase();
  let cursor = 0;
  let score = 0;
  for (const character of needle) {
    const index = candidate.indexOf(character, cursor);
    if (index < 0) return undefined;
    score += index === cursor ? 0 : index + 1;
    cursor = index + 1;
  }
  return score;
}

/** Whether every code point is a printable non-control character, so typed
 * input can be appended to the query. */
export function isPrintableInput(value: string): boolean {
  return value.length > 0 && [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  });
}

/** Frame picker rows with accent rules top and bottom; unthemed callers get
 * the rows unchanged. */
export function wrapBorder(rows: string[], width: number, theme: PianoTheme | undefined): string[] {
  if (theme === undefined) return rows;
  const line = theme.accent + "─".repeat(width) + RST;
  return [line, ...rows, line];
}
