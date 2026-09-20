import { describe, expect, it } from "vitest";
import { buildFacePage } from "../../packages/cli/src/tui-face.js";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

describe(" visual shell", () => {
  it("keeps the welcome face within the terminal width", () => {
    const rows = buildFacePage(80).split("\n");
    expect(rows.join("\n")).toContain("Piano: A Programmable Agent Workflow System.");
    expect(rows.join("\n")).toContain("[ START HERE ]");
    expect(rows.join("\n")).toContain("/workspace  pick where the work happens");
    expect(rows.join("\n")).toContain("/workflow   pick how the work happens");
    expect(rows.join("\n")).not.toContain("pipeline");
    expect(rows.join("\n")).toContain("█");
    expect(rows.join("\n")).toContain(`${String.fromCharCode(27)}[48;`);
    expect(rows.every((row) => row.replace(ANSI, "").length <= 80)).toBe(true);
  });

  it("keeps non-finite welcome widths on the narrow-terminal fallback", () => {
    expect(() => buildFacePage(Number.POSITIVE_INFINITY)).not.toThrow();
    expect(() => buildFacePage(Number.NaN)).not.toThrow();
  });
});
