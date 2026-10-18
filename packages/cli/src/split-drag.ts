// SGR mouse parsing + drag-resize state machine for a two-pane TUI layout.
// It is pure input state; the shell decides which panes it uses.
//
// This is a pure module: no pi-tui imports and no TTY I/O.
// import. It only understands bytes in and state out.
//
// SGR mouse reports arrive as `\x1b[<B;X;YM` (press/motion/wheel) and
// `\x1b[<B;X;Ym` (release), where B is the raw button code and X/Y are 1-based
// terminal coordinates. Press codes are < 32; drag-motion codes are 32–63
// (left drag = 32); wheel codes start at 64.

export const DEFAULT_SPLIT_RATIO = 0.3;
export const MIN_RIGHT_COLUMNS = 20; // right pane never shrinks below this
export const MIN_CHAT_COLUMNS = 30;        // left pane never shrinks below this
export const SPLIT_CAPTURE_RANGE = 1;      // ±N columns around the border arm the grab

export interface SgrMouseEvent {
  kind: "press" | "motion" | "release" | "wheel";
  button: number;  // raw SGR code: 0=left, 32=left drag, 64=wheel up, 65=wheel down
  col: number;     // 1-based terminal column
  row: number;     // 1-based terminal row
}
export interface SplitDragState {
  dragging: boolean;
  ratio: number;   // fraction of terminal width given to the right pane, in (0,1)
  visible: boolean;
}

export function emptySplitDrag(ratio: number = DEFAULT_SPLIT_RATIO): SplitDragState {
  return { dragging: false, ratio, visible: true };
}

// eslint-disable-next-line no-control-regex -- SGR mouse escape sequence
const SGR_MOUSE_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

export function parseSgrMouse(sequence: string): SgrMouseEvent | null {
  // Strict whole-string match: anything that isn't a well-formed SGR mouse
  // sequence (plain keys, other escapes, old-style `\x1b[M...` mouse) → null.
  const m = SGR_MOUSE_RE.exec(sequence);
  if (!m) return null;
  const button = Number(m[1]);
  const col = Number(m[2]);
  const row = Number(m[3]);
  if (!Number.isSafeInteger(button) || !Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
  // `m` terminates a release; `M` is press (B < 32), drag-motion (32–63),
  // or wheel input (B ≥ 64).
  const kind: SgrMouseEvent["kind"] =
    m[4] === "m" ? "release" : button >= 64 ? "wheel" : button < 32 ? "press" : "motion";
  return { kind, button, col, row };
}

/** Scroll step of a wheel event's SGR button code: button 0 scrolls up (-1),
 * button 1 scrolls down (+1), anything else (horizontal wheel) is ignored (0). */
export function wheelDelta(button: number): number {
  const wheelButton = button & 3;
  return wheelButton === 0 ? -1 : wheelButton === 1 ? 1 : 0;
}

/** Return whether a 1-based mouse column is inside the visible right pane. */
export function isWithinRightPane(col: number, ratio: number, columns: number): boolean {
  if (!Number.isSafeInteger(col) || col < 1 || !Number.isFinite(columns) || columns < 1) return false;
  const width = rightColumns(ratio, columns);
  const firstColumn = Math.floor(columns) - width + 1;
  return col >= firstColumn && col <= Math.floor(columns);
}

export function rightColumns(ratio: number, columns: number): number {
  const safeColumns = Number.isFinite(columns) ? columns : 0;
  const maxRight = Math.max(1, safeColumns - MIN_CHAT_COLUMNS);
  const minRight = Math.min(MIN_RIGHT_COLUMNS, maxRight);
  return Math.min(maxRight, Math.max(minRight, Math.floor(safeColumns * ratio)));
}

/** 1-based column of the split border — it sits one column right of the left pane. */
export function borderColumn(ratio: number, columns: number): number {
  const safeColumns = Number.isFinite(columns) ? columns : 0;
  return safeColumns - rightColumns(ratio, safeColumns) + 1;
}

export function stepSplitDrag(
  state: SplitDragState,
  ev: SgrMouseEvent,
  columns: number
): SplitDragState {
  if (ev.kind === "press") {
    // Only a left press on (or within SPLIT_CAPTURE_RANGE of) the border arms
    // the grab; any other press leaves the state untouched.
    const armed =
      ev.button === 0 &&
      Math.abs(ev.col - borderColumn(state.ratio, columns)) <= SPLIT_CAPTURE_RANGE;
    return armed ? { dragging: true, ratio: state.ratio, visible: state.visible } : state;
  }
  if (ev.kind === "motion" && state.dragging) {
    if (!Number.isFinite(columns) || columns === 0) return state;
    // The border follows the cursor: a cursor at column `col` puts the right
    // right pane at columns [col, columns], so its fraction is
    // (columns - col + 1) / columns. Store the raw ratio here — rightColumns
    // clamps at render time, so the panes stay inside their min/max column
    // bounds regardless of cursor.
    return { dragging: true, ratio: (columns - ev.col + 1) / columns, visible: state.visible };
  }
  if (ev.kind === "release" && state.dragging) {
    return { dragging: false, ratio: state.ratio, visible: state.visible };
  }
  return state;
}
