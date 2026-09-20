import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { rightColumns } from "./split-drag.js";
import { RST, darkTheme, type PianoTheme } from "./theme.js";

let th: PianoTheme = darkTheme;
export function setTheme(t: PianoTheme): void { th = t; }
export function getTheme(): PianoTheme { return th; }

// ── Box drawing ───────────────────────────────────────────────────────────────

const BOX_W = 64; // total box width, not counting the 2-char left indent

/** Visible character count of a string that may contain ANSI codes. */
function visLen(s: string): number {
  // eslint-disable-next-line no-control-regex -- strip ANSI SGR codes
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}
/** Background-accent code derived from the theme's foreground accent. */
function accentBg(): string {
  // accent is "\x1b[38;2;R;G;Bm" (24-bit) or "\x1b[3Xm" (palette)
  const m = th.accent.match(/(38;2;(\d+);(\d+);(\d+))|3(\d)/);
  if (!m) return th.accent;
  if (m[1]) return `\x1b[48;2;${m[2]};${m[3]};${m[4]}m`;
  return `\x1b[4${m[5]}m`;
}

function boxTop(title: string, w = BOX_W, pad = "  "): string {
  const label = title ? `─ ${title} ` : "";
  const dashes = "─".repeat(Math.max(0, w - 2 - label.length));
  return `${pad}${th.accent}╭${th.bold}${label}${RST}${th.accent}${dashes}╮${RST}`;
}

function boxBottom(w = BOX_W, pad = "  "): string {
  return `${pad}${th.accent}╰${"─".repeat(Math.max(0, w - 2))}╯${RST}`;
}

function boxRow(content: string, w = BOX_W, pad = "  "): string {
  const innerW = w - 4;
  const padding = " ".repeat(Math.max(0, innerW - visLen(content)));
  return `${pad}${th.accent}│${RST} ${content}${padding} ${th.accent}│${RST}`;
}

function boxBlank(w = BOX_W, pad = "  "): string {
  return `${pad}${th.accent}│${RST}${" ".repeat(Math.max(0, w - 2))}${th.accent}│${RST}`;
}

/** Center a single-line (possibly ANSI-colored) string within the box width. */
function centerLine(s: string): string {
  const innerW = BOX_W - 4;
  const pad = Math.max(0, Math.floor((innerW - visLen(s)) / 2));
  return " ".repeat(pad) + s;
}

/**
 * Word-wrap plain text (no ANSI) to `width` visible columns, preserving leading
 * indentation. Used for config panel rows that exceed the box inner width on
 * narrow terminals.
 */
// Built via RegExp from an interpolated ESC to dodge eslint's
// no-control-regex (the literal-visLen regex in the same file is
// pre-existing). Matches ESC [ … m (ANSI SGR).
const ANSI_SEQ = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const ANSI_PREFIX = new RegExp(`^(?:${String.fromCharCode(27)}\\[[0-9;]*m)+`);

export function wrapIndented(text: string, width: number): string[] {
  // Clamp the budget to at least one column: the wrap loop and the ellipsis
  // fallback below require a positive width, and zero/negative widths must
  // never produce output wider than requested.
  const budget = Math.max(1, width);
  if (visLen(text) <= budget) return [text];
  const indent = /^\s*/.exec(text)?.[0] ?? "";
  // The wrap loop measures candidates without the indent, so shrink the budget
  // by the indent width — otherwise an indent + width-long line overflows and
  // gets hard-truncated by the ellipsis fallback below.
  const limit = Math.max(1, budget - visLen(indent));
  const words = text.slice(indent.length).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (cur && visLen(candidate) > limit) {
      lines.push(cur);
      cur = word;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((line) => {
    const indented = `${indent}${line}`;
    if (visLen(indented) <= budget) return indented;
    // Truncate by visible width, keeping leading ANSI sequence(s) intact and
    // appending an ellipsis. Using raw .length here over-truncates colored
    // rows and can eat the last token (e.g. the filename of the config path).
    const ansiPrefix = ANSI_PREFIX.exec(indented)?.[0] ?? "";
    const keep = Math.max(0, budget - 1 - visLen(ansiPrefix));
    const body = indented.slice(ansiPrefix.length).replace(ANSI_SEQ, "");
    return `${ansiPrefix}${[...body].slice(0, keep).join("")}…`;
  });
}

// ── Brand art ─────────────────────────────────────────────────────────────────

// Piano logo as half-block ANSI art (dorsal fin + head + gill + belly + tail).
// `\u0001` = accent foreground, `\u0002` = accent background (substituted at render).
const PIANO_FISH = [
  "                  \u0001\x1b[48;2;32;47;64m\u2580\u2580\x1b[0m                               \x1b[0m",
  "                 \x1b[38;2;18;26;36m\x1b[48;2;18;26;36m\u2580\x1b[48;2;32;47;64m\u2580\x1b[48;2;18;26;36m\u2580\u2580\x1b[0m\x1b[48;2;18;26;36m\u2584\x1b[0m                           \x1b[38;2;32;47;64m\x1b[48;2;32;47;64m\u2580\x1b[0m\u2580\x1b[0m",
  "                 \x1b[38;2;18;26;36m\x1b[48;2;18;26;36m\u2580\u2580\u2580\u2580\u2580\u2580\x1b[0m\x1b[48;2;18;26;36m\u2584\x1b[0m                       \x1b[48;2;32;47;64m\u2584\x1b[38;2;32;47;64m\u2580\u2580\x1b[0m \x1b[0m",
  "        \x1b[48;2;246;249;251m\u2584\x1b[48;2;170;186;197m\u2584\x1b[48;2;88;108;130m\u2584\u2584\u2584\u2584\u2584\x1b[48;2;32;47;64m\u2584\x1b[38;2;32;47;64m\u0002\u2580\x1b[48;2;88;108;130m\u2580\u2580\u2580\u2580\x1b[38;2;18;26;36m\u2580\u2580\u2580\u2580\x1b[0m\x1b[48;2;88;108;130m\u2584\u2584\x1b[48;2;32;47;64m\u2584\u2584\x1b[0m                 \x1b[38;2;32;47;64m\x1b[48;2;32;47;64m\u2580\u2580\u2580\x1b[0m  \x1b[0m",
  "     \x1b[48;2;32;47;64m\u2584\x1b[38;2;246;249;251m\x1b[48;2;170;186;197m\u2580\x1b[48;2;88;108;130m\u2580\x1b[38;2;170;186;197m\u2580\x1b[48;2;32;47;64m\u2580\x1b[48;2;170;186;197m\u2580\x1b[38;2;88;108;130m\x1b[48;2;32;47;64m\u2580\u2580\x1b[38;2;32;47;64m\u2580\u2580\u0001\u2580\x1b[38;2;32;47;64m\u2580\u2580\u2580\u2580\u2580\u2580\u2580\x1b[38;2;88;108;130m\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\x1b[38;2;32;47;64m\u2580\u2580\x1b[0m\x1b[48;2;32;47;64m\u2584\u2584\u2584\x1b[0m        \x1b[48;2;32;47;64m\u2584\x1b[38;2;32;47;64m\u2580\u2580\u2580\x1b[0m   \x1b[0m",
  " \x1b[48;2;32;47;64m\u2584\u2584\x1b[38;2;32;47;64m\u2580\u2580\u2580\x1b[38;2;170;186;197m\u2580\x1b[48;2;170;186;197m\u2580\x1b[38;2;18;26;36m\u2580\x1b[38;2;88;108;130m\u2580\x1b[48;2;32;47;64m\u2580\x1b[38;2;32;47;64m\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\x1b[0m\x1b[48;2;32;47;64m\u2584\u2584\x1b[0m   \x1b[38;2;32;47;64m\x1b[48;2;32;47;64m\u2580\u2580\u2580\u2580\x1b[0m    \x1b[0m",
  "\x1b[38;2;32;47;64m\x1b[48;2;88;108;130m\u2580\u2580\x1b[48;2;170;186;197m\u2580\u2580\x1b[48;2;88;108;130m\u2580\u2580\u2580\x1b[38;2;18;26;36m\u2580\x1b[38;2;32;47;64m\u2580\x1b[38;2;18;26;36m\u2580\x1b[38;2;32;47;64m\x1b[48;2;32;47;64m\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\x1b[48;2;88;108;130m\u2580\u2580\u2580\u2580\u2580\u2580\x1b[48;2;32;47;64m\u2580\u2580\x1b[0m     \x1b[0m",
  "   \x1b[38;2;170;186;197m\u2580\u2580\u2580\x1b[48;2;170;186;197m\u2580\u2580\u2580\u2580\u2580\u2580\x1b[38;2;88;108;130m\u2580\u2580\x1b[38;2;32;47;64m\u2580\u2580\x1b[38;2;88;108;130m\x1b[48;2;32;47;64m\u2580\x1b[38;2;32;47;64m\x1b[48;2;170;186;197m\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\x1b[38;2;88;108;130m\u2580\u2580\u2580\u2580\x1b[38;2;170;186;197m\u2580\x1b[0m\u2580\x1b[38;2;170;186;197m\u2580\x1b[0m   \x1b[38;2;170;186;197m\u2580\x1b[48;2;170;186;197m\u2580\x1b[38;2;88;108;130m\u2580\x1b[38;2;32;47;64m\x1b[48;2;88;108;130m\u2580\x1b[0m    \x1b[0m",
  "         \x1b[38;2;170;186;197m\u2580\u2580\u2580\x1b[48;2;170;186;197m\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\x1b[0m\u2580\x1b[38;2;170;186;197m\u2580\x1b[0m        \x1b[38;2;170;186;197m\u2580\x1b[48;2;170;186;197m\u2580\u2580\u2580\x1b[0m   \x1b[0m",
  "               \x1b[38;2;170;186;197m\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580\x1b[0m                 \x1b[38;2;170;186;197m\u2580\x1b[48;2;170;186;197m\u2580\u2580\x1b[0m  \x1b[0m",
  "                                               \x1b[38;2;170;186;197m\u2580\x1b[48;2;170;186;197m\u2580\u2580\x1b[0m \x1b[0m",
  "                                                 \x1b[38;2;170;186;197m\u2580\x1b[48;2;170;186;197m\u2580\x1b[0m",
];

// Figlet-style "PIANO" wordmark.
const PIANO_WORDMARK = [
  "████████╗██╗   ██╗███╗   ██╗ █████╗ ",
  "╚══██╔══╝██║   ██║████╗  ██║██╔══██╗",
  "   ██║   ██║   ██║██╔██╗ ██║███████║",
  "   ██║   ██║   ██║██║╚██╗██║██╔══██║",
  "   ██║   ╚██████╔╝██║ ╚████║██║  ██║",
  "   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝",
];

// ── Constants ─────────────────────────────────────────────────────────────────

// Built at render time so the detected theme (setTheme) is applied.
// `columns` makes the box horizontally centered (copilot-style welcome) instead
// of hugging the left edge; narrow terminals fall back to the 2-space indent.
export function buildFacePage(columns = 80): string {
  const renderColumns = Number.isFinite(columns) ? columns : 0;
  const pad = " ".repeat(Math.max(0, Math.floor((renderColumns - BOX_W) / 2)));
  const row = (s: string) => boxRow(centerLine(s), BOX_W, pad);
  return [
    "",
    boxTop("", BOX_W, pad),
    boxBlank(BOX_W, pad),
    ...PIANO_FISH.map((line) =>
      boxRow(centerLine(line.replaceAll("\u0001", th.accent).replaceAll("\u0002", accentBg())), BOX_W, pad)
    ),
    boxBlank(BOX_W, pad),
    ...PIANO_WORDMARK.map((line) => boxRow(centerLine(`${th.accent}${line}${RST}`), BOX_W, pad)),
    boxBlank(BOX_W, pad),
    row(`${th.primary}Piano: A Programmable Agent Workflow System.${RST}`),
    boxBlank(BOX_W, pad),
    row(`${th.dim}Reshape it as your Operator Tuning Agent,${RST}`),
    row(`${th.dim}PPT Maker, Patent Writer, or Daily-work${RST}`),
    row(`${th.dim}Assistant. Just write your own workflow.${RST}`),
    boxBlank(BOX_W, pad),
    boxBottom(BOX_W, pad),
    "",
  ].join("\n");
}

/**
 * Renders two components side-by-side on the same rows. pi-tui's Container only
 * stacks children vertically (no Row/HBox primitive), so a two-column split
 * needs this tiny wrapper (decisions 0023, 0024). The left child renders at
 * `width - rightW` and the right child at `rightW = rightColumns(split.ratio, width)`.
 * The ratio is mutable: it is read live from `split.ratio` on every render so
 * the mouse-drag listener can live-resize the split (decision 0024). The
 * shorter side is padded with blanks so every merged line spans `width`.
 */
export class SideBySide implements Component {
  constructor(
    private readonly left: Component,
    private readonly right: Component,
    private readonly split: { ratio: number; visible?: boolean },
    private readonly divider: { color: string },
  ) {}

  invalidate(): void {
    this.left.invalidate();
    this.right.invalidate();
  }

  render(width: number): string[] {
    const totalWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    if (totalWidth === 0) return [];
    const sideVisible = this.split.visible !== false && totalWidth > 1;
    const rightW = sideVisible ? Math.min(rightColumns(this.split.ratio, totalWidth), totalWidth - 1) : 0;
    const leftW = totalWidth - rightW;
    const leftLines = this.left.render(leftW);
    const rightLines = this.right.render(rightW);
    const height = sideVisible ? Math.max(leftLines.length, rightLines.length) : leftLines.length;
    const out: string[] = [];
    for (let i = 0; i < height; i++) {
      const left = sideVisible
        ? truncateToWidth(leftLines[i] ?? "", Math.max(0, leftW - 1), "", true) +
          `${this.divider.color}│\x1b[0m`
        : truncateToWidth(leftLines[i] ?? "", leftW, "", true);
      out.push(
        left + (sideVisible ? truncateToWidth(rightLines[i] ?? "", rightW, "", true) : ""),
      );
    }
    return out;
  }
}
