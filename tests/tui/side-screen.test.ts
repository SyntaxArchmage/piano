// The side screen's chrome, pinned as unit tests because these are the two
// properties that make the mode legible: the footer is exactly ONE row (a
// wrapped footer would be two lines and would stop being visibly "not the run's
// panel"), and neither the footer nor the banner draws any part of the run's
// greeting or status columns.
import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSideBanner, renderSideFooter, sideFooterRunToken } from "../../packages/cli/src/side-screen.js";
import { detectTheme, sideTheme } from "../../packages/cli/src/theme.js";

const theme = sideTheme(detectTheme());
const LONG_CWD = "/very/long/workspace/path/that/does/not/fit/in/the/footer";

describe("/btw side screen chrome", () => {
  it("keeps the footer to exactly one row, at any width", () => {
    for (const width of [12, 20, 40, 60, 80, 100, 200, 400]) {
      const rows = renderSideFooter(theme, width, LONG_CWD, sideFooterRunToken(theme, 12_345));
      expect(rows, `width ${width}`).toHaveLength(1);
      // Padded to the full terminal width, so the bar is a solid strip.
      expect(visibleWidth(rows[0]!), `width ${width}`).toBe(width);
    }
  });

  it("paints the whole row over the side bar background", () => {
    const rows = renderSideFooter(theme, 120, "/w", sideFooterRunToken(theme, undefined));
    expect(rows[0]!.startsWith(theme.barBg)).toBe(true);
  });

  it("names the mode, the tree it writes to, and the way back", () => {
    const rows = renderSideFooter(theme, 200, "/home/dev/project", sideFooterRunToken(theme, 1500));
    const line = rows[0]!;
    expect(line).toContain("⌥ btw");
    expect(line).toContain("read, edit, write and bash in /home/dev/project");
    expect(line).toContain("/btw back");
    expect(line).toContain("Esc interrupt");
    // Whether the run left behind is still working is placed early so a narrow
    // terminal truncates the wording, not this.
    expect(line).toContain("run ▶ 1.5s");
    expect(renderSideFooter(theme, 200, "/w", sideFooterRunToken(theme, undefined))[0]).toContain("run idle");
  });

  it("greets with the side agent, never with the run's face page", () => {
    const banner = buildSideBanner(theme, "/home/dev/project");
    expect(banner).toContain("⌥ btw");
    expect(banner).toContain("side agent");
    expect(banner).toContain("/home/dev/project");
    expect(banner).toContain("/btw puts it back");
    // The run's own greeting is brand art; drawing it here would make an empty
    // side screen read as an empty run.
    expect(banner).not.toContain("Piano: A Programmable Agent Workflow System.");
  });
});
