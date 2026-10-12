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

// Grand piano in side profile, rendered with the same half-block technique as
// Tuna's fish: each terminal cell is two vertical pixels, with fg/bg colors
// keeping the lid curve, keyboard, legs, and gold pedal lyre legible.
// Palette: l = lid highlight, m = case, d = shadow, w/k = keys, g = pedals,
// a = accent feet.
type PianoPixel = " " | "a" | "d" | "m" | "l" | "w" | "k" | "g";
const PIANO_PIXELS = [
  "                          lllllllllllll            ",
  "                    llllllmmmmmmmmmmmmmlll         ",
  "               lllllmmmmmmmmmmmmmmmmmmmmmmlll      ",
  "           llllmmmmmmmmmmmmmmmmmmmmmmmmmmmmmml     ",
  "       llllmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmll   ",
  "    lllmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmml  ",
  " lmllllllllllllllllllllllllllllllllllllllllllllll  ",
  " wwkkwkkwwwwkkwkkwkkwwwwkkwkkwwwwkkwkkwkkwwwwkkwwm ",
  " wwkkwkkwwwwkkwkkwkkwwwwkkwkkwwwwkkwkkwkkwwwwkkww m",
  " dddddddddddddddddddddddddddddddddddddddddddddddd m",
  "  dddddddddddddddddddddddddddddddddddddddddddddddm ",
  "  ddddddddddddddddddddddddddddddddddddddddddddddd  ",
  "      dddd             g     g           dddd      ",
  "      dddd             ggggggg           dddd      ",
  "      dddd             g     g           dddd      ",
  "      ddd              ggggggg           ddd       ",
  "      aaa                ggg             aaa       ",
] satisfies readonly string[];

function pianoPixelColor(pixel: PianoPixel, background: boolean): string {
  if (pixel === "a") return background ? accentBg() : th.accent;
  const rgb = {
    d: "17;24;39",
    m: "51;65;85",
    l: "148;163;184",
    w: "248;250;252",
    k: "15;23;42",
    g: "251;191;36",
  }[pixel as Exclude<PianoPixel, " " | "a">];
  return rgb === undefined ? RST : `\x1b[${background ? 48 : 38};2;${rgb}m`;
}

function renderPixelArt(pixels: readonly string[]): string[] {
  const width = Math.max(...pixels.map((line) => line.length));
  const rows: string[] = [];
  for (let y = 0; y < pixels.length; y += 2) {
    const top = pixels[y]?.padEnd(width) ?? " ".repeat(width);
    const bottom = pixels[y + 1]?.padEnd(width) ?? " ".repeat(width);
    let row = "";
    for (let x = 0; x < width; x += 1) {
      const upper = top[x] as PianoPixel;
      const lower = bottom[x] as PianoPixel;
      if (upper === " " && lower === " ") row += " ";
      else if (upper === lower) row += `${pianoPixelColor(upper, false)}█${RST}`;
      else if (lower === " ") row += `${pianoPixelColor(upper, false)}▀${RST}`;
      else if (upper === " ") row += `${pianoPixelColor(lower, false)}▄${RST}`;
      else row += `${pianoPixelColor(upper, false)}${pianoPixelColor(lower, true)}▀${RST}`;
    }
    rows.push(row.trimEnd());
  }
  return rows;
}

function renderPianoArt(): string[] {
  return renderPixelArt(PIANO_PIXELS);
}

// "PIANO" wordmark drawn with the same half-block palette as the instrument:
// light-slate faces over a gold ground, echoing the lid highlight and pedal
// lyre so type and logo read as one mark.
const PIANO_WORDMARK_PIXELS = [
  "llllll  lllll    ll    ll   ll   lllll",
  "gggggg  ggggg    gg    gg   gg   ggggg",
  "ll  ll    ll    ll ll  lll  ll  ll  ll",
  "gg  gg    gg    gg gg  ggg  gg  gg  gg",
  "llllll    ll   llllll  ll l ll  ll  ll",
  "gggggg    gg   gggggg  gg g gg  gg  gg",
  "ll        ll   ll  ll  ll  lll  ll  ll",
  "gg        gg   gg  gg  gg  ggg  gg  gg",
  "ll      lllll  ll  ll  ll   ll   lllll",
  "gg      ggggg  gg  gg  gg   gg   ggggg",
] satisfies readonly string[];

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
    ...renderPianoArt().map((line) => boxRow(centerLine(line), BOX_W, pad)),
    boxBlank(BOX_W, pad),
    ...renderPixelArt(PIANO_WORDMARK_PIXELS).map((line) => boxRow(centerLine(line), BOX_W, pad)),
    boxBlank(BOX_W, pad),
    row(`${th.primary}Piano: A Programmable Agent Workflow System.${RST}`),
    boxBlank(BOX_W, pad),
    row(`${th.bold}${th.accent}[ START HERE ]${RST}`),
    row(`${th.dim}1. /workspace  pick where the work happens${RST}`),
    row(`${th.dim}2. /workflow   pick how the work happens${RST}`),
    row(`${th.primary}3. type a task. hit enter. make a mess.${RST}`),
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
