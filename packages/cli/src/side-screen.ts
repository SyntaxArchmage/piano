// `/btw`'s own screen chrome: the banner an empty side chat opens with, and the
// single footer line that names the mode.
//
// Kept apart from `tui.ts` so the side screen's whole visual identity — banner,
// footer and palette (`sideTheme` in theme.ts) — is reviewable in one place, and
// so it stays obvious that neither function renders any part of the run's status
// panel: the side screen deliberately has no COMMANDS / SHORTCUTS / USAGE /
// WORKFLOW columns, because reusing the run's footer is exactly what made the
// old `/btw` unreadable as a mode.

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { RST, type PianoTheme } from "./theme.js";

/** Banner box width, borders included. A narrower pane truncates it. */
const BANNER_WIDTH = 56;

/** What the side agent can do, in the words a developer reads. Prose on
 * purpose: it mirrors `SIDE_AGENT_TOOLS` without pretending to be machine
 * readable, and it is repeated in the footer where the grant actually matters. */
const CAPABILITIES = "read, edit, write and bash";

/**
 * Greeting for `/btw`'s chat pane.
 *
 * Deliberately not the mission's face page: the run's greeting is brand art in
 * the mission accent, and drawing it here would make an empty side screen look
 * like an empty run. This is a small teal box that says what the mode is and
 * which tree it can write to.
 */
export function buildSideBanner(theme: PianoTheme, cwd: string): string {
  const inner = BANNER_WIDTH - 4;
  const row = (text: string): string => {
    const pad = " ".repeat(Math.max(0, inner - visibleWidth(text)));
    return `  ${theme.accent}│${RST} ${text}${pad} ${theme.accent}│${RST}`;
  };
  const label = "─ ⌥ btw ";
  const dashes = "─".repeat(Math.max(0, BANNER_WIDTH - 2 - visibleWidth(label)));
  return [
    "",
    `  ${theme.accent}╭${label}${dashes}╮${RST}`,
    row(`${theme.primary}side agent${RST}${theme.dim} · ${CAPABILITIES}${RST}`),
    row(`${theme.dim}${cwd}${RST}`),
    `  ${theme.accent}╰${"─".repeat(BANNER_WIDTH - 2)}╯${RST}`,
    `  ${theme.dim}nothing here belongs to the run; /btw puts it back${RST}`,
    "",
  ].join("\n");
}

/**
 * The side screen's entire footer: one full-width bar row, never more.
 *
 * `run` is a short token describing the mission's turn (or that there is none)
 * and it is placed *before* the longer wording on purpose: a narrow terminal
 * truncates the tail, and whether the run left behind is still working is the
 * one fact that would otherwise be lost entirely. It rides on the same row
 * rather than a second one — the mode is identified by the whole screen, and a
 * single row is what keeps this footer unmistakably not the run's multi-column
 * panel.
 *
 * Painted over `barBg` the same way the run's panel is, so the two footers
 * differ in colour as well as in shape, and truncated to `width` as a hard
 * guarantee: `Text` word-wraps, and a wrapped footer would be two lines.
 */
export function renderSideFooter(theme: PianoTheme, width: number, cwd: string, run: string): string[] {
  const total = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  if (total === 0) return [];
  const body = truncateToWidth(
    `${theme.accent}⌥ btw${RST}${run}${theme.dim} · read, edit, write and bash in ${cwd}`
    + ` · /btw back · Esc interrupt${RST}`,
    total,
    "",
  );
  const painted = `${theme.barBg}${body.replaceAll(RST, `${RST}${theme.barBg}`)}`;
  const pad = " ".repeat(Math.max(0, total - visibleWidth(body)));
  return [`${painted}${pad}${RST}`];
}

/** The mission's liveness token for a side-screen footer. `undefined` means the
 * run has no turn in flight, which the caller words differently from a turn
 * that has simply been quiet for a while. */
export function sideFooterRunToken(theme: PianoTheme, elapsedMs: number | undefined): string {
  if (elapsedMs === undefined) return `${theme.dim} · run idle${RST}`;
  return `${theme.dim} · run ▶ ${formatElapsed(elapsedMs)}${RST}`;
}

/** Compact elapsed time for the run token: `123ms`, `4.2s`, `1m02s`. */
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}
