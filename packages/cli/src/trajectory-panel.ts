// Live trajectory tab panel for Piano — a flat, color-coded, timestamped ledger
// of every meaningful agent action (decision 0023). The pure data model and
// reducer (`TrajectoryKind`,
// `TrajectoryEntry`, `TrajectoryState`, `TRAJECTORY_MAX_ENTRIES`,
// `emptyTrajectoryState`, `applyTrajectoryEvent`) live in trajectory.ts;
// this module renders that reduced state. It depends on pi-tui and the CLI theme.

import type { TurnOutcome } from "@piano/base";
import { visibleWidth, type Component } from "@earendil-works/pi-tui";
import { formatCompactDuration } from "./duration.js";
import { RST, type PianoTheme } from "./theme.js";
import type { ScrollModifier } from "./shortcuts.js";
import {
  applyTrajectoryEvent,
  emptyTrajectoryState,
  type TrajectoryKind,
  type TrajectoryState,
} from "./trajectory.js";
import type { AgentEvent } from "@piano/harness";
import type { FailureDetails } from "@piano/logging";

/** Color roles for the panel. */
type TrajectoryTheme = Pick<
  PianoTheme,
  "accent" | "primary" | "dim" | "success" | "error" | "bold" | "barBg" | "mdLink"
>;

/** Ledger rows shown (tail — newest entry last). */
const TRAJECTORY_VISIBLE_ROWS = 8;

// Built via RegExp from an interpolated ESC to dodge eslint's no-control-regex.
const ESC = String.fromCharCode(27);
const ANSI_SEQ = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const ANSI_PREFIX = new RegExp(`^(?:${ESC}\\[[0-9;]*m)*`);

/** Per-kind icon + color role (decision 0023, pinned). */
const KIND_STYLE: Record<TrajectoryKind, { icon: string; role: keyof TrajectoryTheme }> = {
  user_message: { icon: "❯", role: "accent" },
  spawn: { icon: "▶", role: "accent" },
  context: { icon: "▤", role: "accent" },
  tool_call: { icon: "⚙", role: "primary" },
  tool_result: { icon: "↳", role: "dim" },
  agent_message: { icon: "✎", role: "primary" },
  usage: { icon: "∑", role: "dim" },
  done: { icon: "✓", role: "success" },
  error: { icon: "✗", role: "error" },
};

/** Format `tsMs` as local `HH:MM:SS.mmm`. */
function formatTimestamp(tsMs: number): string {
  const d = new Date(tsMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const mmm = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${mmm}`;
}

/** Truncate a plain (ANSI-free) string to `width` visible columns, reserving
 * one column for a trailing "…". */
function truncatePlain(text: string, width: number): string {
  const budget = Math.max(0, width - 1);
  let out = "";
  let w = 0;
  for (const ch of text) {
    const cw = visibleWidth(ch);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return out;
}

/** Truncate one colored segment (a leading SGR prefix + plain text) to `width`
 * visible columns, appending "…" when content is cut. */
function truncateSeg(seg: string, width: number): string {
  if (visibleWidth(seg) <= width) return seg;
  const prefix = ANSI_PREFIX.exec(seg)?.[0] ?? "";
  const body = seg.slice(prefix.length).replace(ANSI_SEQ, "");
  return `${prefix}${truncatePlain(body, width)}…${RST}`;
}

/** Join pre-colored segments into one full-width bar row: segments are joined
 * with a single space and dropped/truncated (with "…") so the visible width
 * never exceeds `columns`; the remainder is filled with `barBg` so the strip
 * reads as a solid bar. */
function barRow(theme: TrajectoryTheme, segments: readonly string[], columns: number): string {
  const max = Math.max(0, Math.floor(columns));
  if (max <= 0) return "";
  const parts: string[] = [];
  let used = 0;
  for (const seg of segments) {
    const segW = visibleWidth(seg);
    const need = parts.length === 0 ? segW : 1 + segW;
    if (used + need <= max) {
      parts.push(seg);
      used += need;
      continue;
    }
    if (parts.length === 0) {
      parts.push(truncateSeg(seg, max));
      used = max;
    } else {
      const room = max - used - 1;
      if (room >= 1) {
        parts.push(truncateSeg(seg, room));
        used = max;
      }
    }
    break;
  }
  const content = parts.join(" ");
  const pad = Math.max(0, max - visibleWidth(content));
  return `${theme.barBg}${content}${" ".repeat(pad)}${RST}`;
}

/** Fill a partial row's visible width to `columns` with `barBg`, wrapping the
 * whole row in the theme's reset — the shared "solid strip" treatment. */
function fillRow(theme: TrajectoryTheme, content: string, columns: number): string {
  const max = Math.max(0, Math.floor(columns));
  const pad = Math.max(0, max - visibleWidth(content));
  return `${theme.barBg}${content}${" ".repeat(pad)}${RST}`;
}

/** Render one ledger entry into one or two full-width bar rows. The fixed
 * `timestamp icon label` prefix occupies the leading columns; the colored
 * `detail` (plus an optional `+duration`) is truncated to the remaining width
 * with a trailing "…" — never wrapped — so long bash commands / tool args stay
 * on one line and the ledger stays a flat, scrollable list. Spawn entries with
 * a model name get a second indented row in light-blue beneath the first. */
function entryRows(
  entry: TrajectoryState["entries"][number],
  theme: TrajectoryTheme,
  columns: number,
): string[] {
  const style = KIND_STYLE[entry.kind];
  const color = theme[style.role];
  const prefix = `${theme.dim}${formatTimestamp(entry.tsMs)}${RST} ${color}${style.icon}${RST} ${theme.bold}${entry.label}:${RST}`;
  const detail = `${color}${entry.detail}${RST}`;
  const tail = entry.durationMs === undefined ? detail : `${detail} ${color}+${formatCompactDuration(entry.durationMs)}${RST}`;

  const max = Math.max(0, Math.floor(columns));
  const prefixW = visibleWidth(prefix);
  const detailW = max - prefixW - 1; // the single separator space before the detail
  const rows: string[] = [];
  if (detailW < 1) {
    // Too narrow to fit the detail — emit the prefix alone, truncated.
    rows.push(fillRow(theme, truncateSeg(`${prefix} ${detail}`, max), max));
  } else {
    const clipped = truncateSeg(tail, detailW);
    rows.push(fillRow(theme, `${prefix} ${clipped}`, columns));
  }

  if (entry.kind === "spawn" && entry.model !== undefined) {
    // Indent the model name under the stage label, light-blue, no timestamp.
    const indent = " ".repeat(Math.min(prefixW, max));
    const modelStr = `${theme.mdLink}${entry.model}${RST}`;
    const room = Math.max(0, max - visibleWidth(indent) - 1);
    const clippedModel = room < 1 ? "" : truncateSeg(modelStr, room);
    rows.push(fillRow(theme, `${indent} ${clippedModel}`, columns));
  }

  return rows;
}

/** Overview sparkline: one 1-column cell per visible entry, with a dim `│`
 * turn-boundary marker inserted before every non-first `spawn`. Truncated to
 * `columns` and padded with `barBg` so it reads as a solid strip. */
function sparklineRow(state: TrajectoryState, theme: TrajectoryTheme, columns: number): string {
  const visible = state.entries.slice(-TRAJECTORY_VISIBLE_ROWS);
  const max = Math.max(0, Math.floor(columns));
  const cells: string[] = [];
  for (const entry of visible) {
    if (entry.kind === "spawn" && entry !== state.entries[0]) {
      cells.push(`${theme.dim}│${RST}`);
    }
    const color = theme[KIND_STYLE[entry.kind].role];
    cells.push(`${color}▍${RST}`);
  }
  const kept = cells.slice(0, max);
  const content = kept.join("");
  const pad = Math.max(0, max - kept.length);
  return `${theme.barBg}${content}${" ".repeat(pad)}${RST}`;
}

/** Render the full trajectory ledger: row 0 is the tab bar (active tab
 * `trajectory` plus the retained entry count), row 1 is the overview
 * sparkline, rows 2..N are one row per retained entry (newest last) with a
 * full-width rule inserted before every non-first `spawn`. Always exactly
 * `2 + entries.length + ruleCount` rows; no row exceeds `columns` visible
 * columns. This is the unfiltered, unwindowed list the component windows over. */
function renderLedgerRows(
  state: TrajectoryState,
  theme: TrajectoryTheme,
  columns: number,
): string[] {
  const maxColumns = Number.isFinite(columns) ? Math.max(0, Math.floor(columns)) : 0;
  const rows: string[] = [
    barRow(
      theme,
      [
        `${theme.bold}${theme.accent}▐ trajectory${RST}`,
        `${theme.dim}· ${state.entries.length}${RST}`,
      ],
      maxColumns,
    ),
    sparklineRow(state, theme, maxColumns),
  ];

  for (const entry of state.entries) {
    if (entry.kind === "spawn" && entry !== state.entries[0]) {
      rows.push(`${theme.dim}${"─".repeat(maxColumns)}${RST}`);
    }
    rows.push(...entryRows(entry, theme, maxColumns));
  }

  return rows;
}

/** Render the trajectory tab panel tail — the backward-compatibility view that
 * shows only the last `TRAJECTORY_VISIBLE_ROWS` ledger rows (the previous
 * fixed tail). The scrollable component uses `renderLedgerRows` directly and
 * windows over the full ledger instead. */
export function renderTrajectoryPanel(
  state: TrajectoryState,
  theme: TrajectoryTheme,
  columns: number,
): string[] {
  const full = renderLedgerRows(state, theme, columns);
  const headerRows = 2;
  const maxLedgerRows = TRAJECTORY_VISIBLE_ROWS;
  // Keep the 2 header rows and slice the last `maxLedgerRows` of the ledger
  // body (the ledger also contains rule rows, so slicing by index is
  // approximate, matching the entry-count-based tail).
  if (full.length <= headerRows + maxLedgerRows) return full;
  return [...full.slice(0, headerRows), ...full.slice(full.length - maxLedgerRows)];
}

/** Live trajectory surface component for the current prompt run: folds
 * `AgentEvent` through `applyTrajectoryEvent` and renders a scrollable
 * window over the full ledger. `start` seeds the ledger with the user prompt as
 * its first row; `complete` records the terminal outcome, rendered as reserved
 * trailing rows. Scrolling is self-managed: `scrollTop` is a 0-based row index
 * into the ledger body (excluding the two header rows), `scrollBy`/`scrollHome`/
 * `scrollEnd` clamp it to the valid range, and `render` auto-follows the newest
 * entry when `pinned` unless the user has scrolled up. */
export class TrajectoryPanel implements Component {
  private state: TrajectoryState = emptyTrajectoryState();
  private sessionId: string | undefined;
  private transcriptPath: string | undefined;
  private status: TurnOutcome | undefined;
  private error: FailureDetails | undefined;
  private completedAt: number | undefined;
  private scrollTop = 0; // 0-based index into the ledger body (0 = oldest)
  private pinned = true; // follow the newest entry until the user scrolls up

  constructor(
    private readonly theme: PianoTheme,
    private readonly getHeight?: () => number,
    private readonly scrollModifier: ScrollModifier = "Ctrl",
  ) {}

  start(prompt: string): void {
    this.state = emptyTrajectoryState();
    this.sessionId = undefined;
    this.transcriptPath = undefined;
    this.status = undefined;
    this.error = undefined;
    this.completedAt = undefined;
    this.scrollTop = 0;
    this.pinned = true;
    this.state = applyTrajectoryEvent(
      this.state,
      { type: "message_end", message: { role: "user", content: prompt } },
      Date.now(),
    );
  }

  record(event: AgentEvent): void {
    if (event.type === "message_end" && event.message.role === "user") {
      return;
    }
    this.state = applyTrajectoryEvent(this.state, event, Date.now());
    // No explicit re-pin here: `render` computes the window from `pinned` and
    // the current ledger length, so staying pinned keeps the newest entry in
    // view automatically as entries stream in.
  }

  /** Visible window rows (ledger body only, excluding the 2 header rows). */
  private visibleLedgerRows(): number {
    if (this.getHeight !== undefined) {
      return Math.max(1, this.getHeight() - 2);
    }
    return Math.max(1, TRAJECTORY_VISIBLE_ROWS);
  }

  private ledgerRowCount(): number {
    // One row per entry plus one rule row before every non-first spawn.
    // Spawn entries with a model name take two rows (stage line + model line).
    let count = 0;
    for (const entry of this.state.entries) {
      if (entry.kind === "spawn" && entry !== this.state.entries[0]) count += 1;
      count += entry.kind === "spawn" && entry.model !== undefined ? 2 : 1;
    }
    return count;
  }

  private outcomeRowCount(): number {
    if (this.status === undefined) return 0;
    return 1
      + (this.sessionId === undefined ? 0 : 1)
      + (this.transcriptPath === undefined ? 0 : 1);
  }

  private renderedRows = 0;

  isWithin(row: number): boolean {
    return Number.isSafeInteger(row) && row >= 1 && row <= this.renderedRows;
  }

  private maxScrollTop(): number {
    // The scroll coordinate is the window's first body row, and the maximum
    // must coincide with the pinned render anchor (body minus the pinned
    // window of visible - outcome - 1 rows): scrollEnd lands there, and a
    // single wheel step from it moves the rendered window by exactly one row.
    const pinnedWindow = Math.max(
      1,
      this.visibleLedgerRows() - this.outcomeRowCount() - 1,
    );
    return Math.max(0, this.ledgerRowCount() - pinnedWindow);
  }

  scrollBy(delta: number): boolean {
    const max = this.maxScrollTop();
    const current = this.pinned ? max : this.scrollTop;
    const next = Math.min(max, Math.max(0, current + delta));
    if (this.pinned && next === current) return false;
    // Unlike the chat viewport, a wheel step here never re-pins: follow mode
    // is restored only through scrollEnd. The difference is intentional.
    this.pinned = false;
    this.scrollTop = next;
    return next !== current;
  }

  scrollHome(): void {
    this.pinned = false;
    this.scrollTop = 0;
  }

  scrollEnd(): void {
    this.pinned = true;
    this.scrollTop = this.maxScrollTop();
  }

  complete(result: {
    status: TurnOutcome;
    sessionId?: string;
    transcriptPath?: string;
    error?: FailureDetails;
  }): void {
    this.sessionId = result.sessionId;
    this.transcriptPath = result.transcriptPath;
    this.status = result.status;
    this.error = result.error;
    this.completedAt = Date.now();
  }

  render(width: number): string[] {
    const columns = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
    const full = renderLedgerRows(this.state, this.theme, columns);
    const fullHeader = full.slice(0, 2);
    const body = full.slice(2);
    const visibleRows = this.visibleLedgerRows();
    const outcomeRows = this.outcomeRows(columns);

    const max = this.maxScrollTop();

    // Scroll state, independent of how many body rows the window finally
    // shows: "↑ more" iff older content is reachable, "↓ more" iff newer
    // content is reachable (pinned or resting at maxScrollTop = at tail).
    const hasAbove = this.pinned ? max > 0 : this.scrollTop > 0;
    const hasBelow = !this.pinned && this.scrollTop < max;

    // The overlay is anchored to the terminal top and must end exactly above
    // the editor, so every row — indicators and outcome included — comes out
    // of the same getHeight() budget instead of being appended past it.
    const budget = Math.max(0, visibleRows - outcomeRows.length - (hasAbove ? 1 : 0) - (hasBelow ? 1 : 0));

    // Anchor the window to the newest rows at the tail (pinned, or scrolled to
    // the end), otherwise to the user's scrollTop. The clamp ceiling is
    // maxScrollTop — the pinned anchor — not body-minus-budget: clamping to
    // the smaller scrolled window would shift the window past scrollTop and
    // desynchronize the "↑ N more" count from the scroll coordinate.
    const atTail = this.pinned || this.scrollTop >= max;
    let start = atTail ? max : this.scrollTop;
    start = Math.min(start, max);
    const windowed = body.slice(start, start + budget);

    const rows: string[] = [];

    // Scroll indicators (discoverability): an "↑ more" row above when scrolled
    // back, a "↓ more" row below when not at the tail; the body re-flows. Both
    // name the terminal-specific Home/End jumps, which move both panes together.
    const headerWithCount = fullHeader;
    if (hasAbove) {
      headerWithCount.push(`${this.theme.dim}↑ ${start} more · ${this.scrollModifier}+Home top${RST}`);
    }
    rows.push(...headerWithCount);
    rows.push(...windowed);
    rows.push(...outcomeRows);

    if (hasBelow) {
      rows.push(`${this.theme.dim}↓ more · ${this.scrollModifier}+End bottom${RST}`);
    }

    this.renderedRows = rows.length;
    return rows;
  }

  private outcomeRows(columns: number): string[] {
    if (this.status === undefined) return [];
    const rows: string[] = [];
    if (this.sessionId !== undefined) rows.push(`${this.theme.dim}· session · ${this.sessionId}${RST}`);
    if (this.transcriptPath !== undefined) rows.push(`${this.theme.dim}· transcript · ${this.transcriptPath}${RST}`);
    const kind = this.status === "completed"
      ? "done"
      : this.status === "cancelled"
        ? "context"
        : "error";
    const detail = this.status === "failed"
      ? terminalFailureLabel(this.error)
      : `workflow ${this.status}`;
    rows.push(...entryRows({
      seq: 0,
      kind,
      label: "piano",
      detail,
      tsMs: this.completedAt ?? Date.now(),
    }, this.theme, columns));
    return rows;
  }

  invalidate(): void {}
}

function terminalFailureLabel(error: FailureDetails | undefined): string {
  switch (error?.type) {
    case "WorkflowError":
      return "workflow failed";
    case "WorkerError":
      return "worker failed";
    case "LogWriteError":
    case "TraceWriteError":
      return "observability failed";
    case "ContractValidationError":
      return "validation failed";
    default:
      return "workflow failed";
  }
}
