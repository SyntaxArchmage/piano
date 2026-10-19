// Display-text helpers shared by the CLI renderers: measuring text that may
// carry ANSI codes, and turning arbitrary values into printable JSON text
// without ever throwing.

/** Visible character count of a string that may contain ANSI SGR codes. */
export function visibleWidth(s: string): number {
  // eslint-disable-next-line no-control-regex -- strip ANSI SGR codes
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** JSON text for any value, never throwing: `"undefined"` when the value does
 * not serialize, and a marker when encoding fails outright. */
export function jsonText(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "undefined" : encoded;
  } catch {
    return "[unprintable]";
  }
}
