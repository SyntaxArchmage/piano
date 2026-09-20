import { describe, expect, it } from "vitest";
import {
  borderColumn,
  DEFAULT_SPLIT_RATIO,
  emptySplitDrag,
  isWithinRightPane,
  MIN_RIGHT_COLUMNS,
  parseSgrMouse,
  rightColumns,
  stepSplitDrag,
} from "../../packages/cli/src/split-drag.js";

describe("emptySplitDrag", () => {
  it("defaults to DEFAULT_SPLIT_RATIO, visible, and not dragging", () => {
    expect(emptySplitDrag()).toEqual({ dragging: false, ratio: DEFAULT_SPLIT_RATIO, visible: true });
  });

  it("accepts a custom ratio", () => {
    expect(emptySplitDrag(0.4)).toEqual({ dragging: false, ratio: 0.4, visible: true });
  });
});

describe("parseSgrMouse", () => {
  it("parses a left press", () => {
    expect(parseSgrMouse("\x1b[<0;12;5M")).toEqual({ kind: "press", button: 0, col: 12, row: 5 });
  });

  it("parses a left drag-motion", () => {
    expect(parseSgrMouse("\x1b[<32;12;5M")).toEqual({ kind: "motion", button: 32, col: 12, row: 5 });
  });

  it("parses a release", () => {
    expect(parseSgrMouse("\x1b[<0;12;5m")).toEqual({ kind: "release", button: 0, col: 12, row: 5 });
  });

  it("parses vertical wheel input separately from drag motion", () => {
    expect(parseSgrMouse("\x1b[<64;70;5M")).toEqual({ kind: "wheel", button: 64, col: 70, row: 5 });
    expect(parseSgrMouse("\x1b[<65;70;5M")).toEqual({ kind: "wheel", button: 65, col: 70, row: 5 });
  });

  it("returns null for non-mouse input", () => {
    expect(parseSgrMouse("a")).toBeNull();
    expect(parseSgrMouse("")).toBeNull();
    expect(parseSgrMouse("\x1b[A")).toBeNull();
  });

  it("rejects old-style mouse and malformed sequences", () => {
    expect(parseSgrMouse("\x1b[M\x20\x21\x22")).toBeNull();
    expect(parseSgrMouse("\x1b[<0;12M")).toBeNull();
  });

  it("rejects coordinates that cannot be represented safely", () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    expect(parseSgrMouse(`\x1b[<0;${unsafe};5M`)).toBeNull();
    expect(parseSgrMouse("\x1b[<0;12;999999999999999999999999M")).toBeNull();
  });
});

describe("rightColumns", () => {
  it("returns floor(columns * ratio) within bounds", () => {
    expect(rightColumns(0.3, 80)).toBe(24);
  });

  it("clamps to the chat pane's minimum (≤ 50 at 80 cols)", () => {
    expect(rightColumns(0.95, 80)).toBe(50);
  });

  it("clamps to the right pane's minimum (≥ 20 at 80 cols)", () => {
    expect(rightColumns(0.01, 80)).toBeGreaterThanOrEqual(MIN_RIGHT_COLUMNS);
    expect(rightColumns(0.01, 80)).toBe(20);
  });

  it("degenerates on a narrow terminal (columns=40 → 10)", () => {
    // maxRight = 40 - 30 = 10, minRight = min(20, 10) = 10 → always 10.
    expect(rightColumns(0.3, 40)).toBe(10);
  });

  it("never returns below 1", () => {
    expect(rightColumns(0.3, 1)).toBe(1);
  });

  it("normalizes non-finite terminal widths", () => {
    expect(rightColumns(0.3, Number.POSITIVE_INFINITY)).toBe(1);
    expect(rightColumns(0.3, Number.NaN)).toBe(1);
    expect(borderColumn(0.3, Number.POSITIVE_INFINITY)).toBe(0);
    expect(borderColumn(0.3, Number.NaN)).toBe(0);
  });
});

describe("isWithinRightPane", () => {
  it("matches the right pane's 1-based column bounds", () => {
    expect(isWithinRightPane(57, 0.3, 80)).toBe(true);
    expect(isWithinRightPane(80, 0.3, 80)).toBe(true);
    expect(isWithinRightPane(56, 0.3, 80)).toBe(false);
  });

  it("rejects invalid or non-finite coordinates", () => {
    expect(isWithinRightPane(0, 0.3, 80)).toBe(false);
    expect(isWithinRightPane(57.5, 0.3, 80)).toBe(false);
    expect(isWithinRightPane(57, 0.3, Number.NaN)).toBe(false);
  });
});

describe("borderColumn", () => {
  it("sits one column right of the left pane (0.3 at 80 → 57)", () => {
    expect(borderColumn(0.3, 80)).toBe(57);
  });
});

describe("stepSplitDrag", () => {
  it("arms the drag on a left press at the border", () => {
    const state = emptySplitDrag();
    expect(stepSplitDrag(state, { kind: "press", button: 0, col: 57, row: 5 }, 80)).toEqual({
      dragging: true,
      ratio: DEFAULT_SPLIT_RATIO,
      visible: true,
    });
  });

  it("ignores a left press far from the border", () => {
    const state = emptySplitDrag();
    expect(stepSplitDrag(state, { kind: "press", button: 0, col: 10, row: 5 }, 80)).toBe(state);
  });

  it("updates ratio on motion while armed (border follows the cursor)", () => {
    const state = emptySplitDrag();
    const armed = stepSplitDrag(state, { kind: "press", button: 0, col: 57, row: 5 }, 80);
    // Dragging the border left to col 50 makes the right pane span columns
    // [50, 80] = 31 columns, so ratio = 31/80.
    expect(stepSplitDrag(armed, { kind: "motion", button: 32, col: 50, row: 5 }, 80)).toEqual({
      dragging: true,
      ratio: 31 / 80,
      visible: true,
    });
    // And the border lands back on the cursor: borderColumn(31/80, 80) = 50.
    expect(borderColumn(31 / 80, 80)).toBe(50);
  });

  it("ignores motion while not armed", () => {
    const state = emptySplitDrag();
    expect(stepSplitDrag(state, { kind: "motion", button: 32, col: 50, row: 5 }, 80)).toBe(state);
  });

  it("keeps an armed drag stable for invalid terminal widths", () => {
    const state = { ...emptySplitDrag(), dragging: true };
    const event = { kind: "motion" as const, button: 32, col: 50, row: 5 };
    expect(stepSplitDrag(state, event, Number.POSITIVE_INFINITY)).toBe(state);
    expect(stepSplitDrag(state, event, Number.NaN)).toBe(state);
    expect(stepSplitDrag(state, event, 0)).toBe(state);
  });

  it("disarms on release", () => {
    const state = emptySplitDrag();
    const armed = stepSplitDrag(state, { kind: "press", button: 0, col: 57, row: 5 }, 80);
    expect(stepSplitDrag(armed, { kind: "release", button: 0, col: 57, row: 5 }, 80)).toEqual({
      dragging: false,
      ratio: DEFAULT_SPLIT_RATIO,
      visible: true,
    });
  });

  it("ignores non-left button presses", () => {
    const state = emptySplitDrag();
    expect(stepSplitDrag(state, { kind: "press", button: 1, col: 57, row: 5 }, 80)).toBe(state);
    expect(stepSplitDrag(state, { kind: "press", button: 2, col: 57, row: 5 }, 80)).toBe(state);
  });

  it("does not treat wheel input as a drag motion", () => {
    const state = { ...emptySplitDrag(), dragging: true };
    expect(stepSplitDrag(state, { kind: "wheel", button: 64, col: 70, row: 5 }, 80)).toBe(state);
  });
});
