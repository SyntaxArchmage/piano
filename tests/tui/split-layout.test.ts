import { describe, expect, it } from "vitest";
import type { Component } from "@earendil-works/pi-tui";
import { SideBySide } from "../../packages/cli/src/tui-face.js";

// eslint-disable-next-line no-control-regex -- test helper strips terminal SGR codes
const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");

class SizedComponent implements Component {
  readonly widths: number[] = [];

  constructor(private readonly fill: string, private readonly rows = 1) {}

  render(width: number): string[] {
    this.widths.push(width);
    return Array.from({ length: this.rows }, () => this.fill.repeat(width));
  }

  invalidate(): void {}
}

describe(" side-by-side layout", () => {
  it("reserves one column for the divider and keeps the split width exact", () => {
    const left = new SizedComponent("L");
    const right = new SizedComponent("R");
    const layout = new SideBySide(left, right, { ratio: 0.3, visible: true }, { color: "\x1b[2m" });

    const row = stripAnsi(layout.render(100)[0] ?? "");

    expect(left.widths).toEqual([70]);
    expect(right.widths).toEqual([30]);
    expect(row).toHaveLength(100);
    expect(row[69]).toBe("│");
    expect(row.slice(70)).toBe("R".repeat(30));
  });

  it("renders the chat at full width and omits the side panel when hidden", () => {
    const left = new SizedComponent("L", 2);
    const right = new SizedComponent("R", 3);
    const layout = new SideBySide(left, right, { ratio: 0.3, visible: false }, { color: "\x1b[2m" });

    const rows = layout.render(80).map(stripAnsi);

    expect(left.widths).toEqual([80]);
    expect(right.widths).toEqual([0]);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row === "L".repeat(80))).toBe(true);
    expect(rows.join("\n")).not.toContain("│");
  });

  it("returns no rows for non-finite widths", () => {
    const layout = new SideBySide(
      new SizedComponent("L"),
      new SizedComponent("R"),
      { ratio: 0.3, visible: true },
      { color: "\x1b[2m" },
    );

    expect(layout.render(Number.POSITIVE_INFINITY)).toEqual([]);
    expect(layout.render(Number.NaN)).toEqual([]);
  });
});
