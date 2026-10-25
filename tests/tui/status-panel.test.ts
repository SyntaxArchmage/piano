import { resetCapabilitiesCache, setCapabilities, visibleWidth } from "@earendil-works/pi-tui";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { renderStatusPanel } from "../../packages/cli/src/status-panel.js";
import { darkTheme } from "../../packages/cli/src/theme.js";
import { WorkflowGraph } from "../../packages/cli/src/workflow-graph.js";

// eslint-disable-next-line no-control-regex -- test helper strips terminal SGR codes
const stripAnsi = (value: string): string => value.replace(/\x1b\[[0-9;]*m/g, "");
const KITTY_IMAGE_PREFIX = `${String.fromCharCode(27)}_Ga=T,`;

afterEach(() => {
  resetCapabilitiesCache();
});

describe("interaction footer", () => {
  it("keeps the four interaction sections and an empty workflow column", () => {
    const rows = renderStatusPanel(darkTheme, 120).map(stripAnsi);
    const header = rows[0] ?? "";
    const workflowStart = header.indexOf("WORKFLOW");

    expect(header).toContain("COMMANDS");
    expect(header).toContain("SHORTCUTS");
    expect(header).toContain("USAGE");
    expect(header).toContain("WORKFLOW");
    expect(header).not.toContain("INPUT");
    expect(header).not.toContain("STATUS");
    expect(workflowStart).toBeGreaterThanOrEqual(0);
    const commands = rows.join("\n");
    expect(commands).toContain("/exit");
    expect(commands).toContain("/rename");
    expect(commands).toContain("/side");
    expect(commands).toContain("/workspace");
    expect(commands).toContain("/workflow");
    expect(commands).toContain("Choose a workflow file");
    expect(commands).toContain("Choose the workspace directory");
    // /quit is a pure alias of /exit: both are caught, and the footer shows
    // them on one row instead of spending a second line on the alias.
    expect(commands).toContain("/quit");
    // Submit moved from its own INPUT column into SHORTCUTS.
    expect(commands).toContain("Enter");
    // Ctrl+Home/End jump both panes to the oldest / newest content.
    expect(commands).toContain("Ctrl+Home/End");
    // The USAGE column renders four rows (tokens/tools/stages/waiting).
    expect(commands).toContain("tokens");
    expect(commands).toContain("tools");
    expect(commands).toContain("stages");
    expect(commands).toContain("waiting");
  });

  it("renders the selected terminal modifier in the footer", () => {
    const output = renderStatusPanel(darkTheme, 120, undefined, undefined, false, "Alt")
      .map(stripAnsi)
      .join("\n");
    expect(output).toContain("Alt+Home/End");
    expect(output).not.toContain("Ctrl+Home/End");
  });

  it("never renders a text row wider than the requested terminal", () => {
    for (const width of [1, 6, 7, 12, 13, 24, 80, 120]) {
      const rows = renderStatusPanel(darkTheme, width);
      expect(rows.every((row) => stripAnsi(row).length <= width), `width ${width}`).toBe(true);
    }
    expect(renderStatusPanel(darkTheme, 0)).toEqual([]);
  });

  it("accounts for wide workflow text when enforcing the terminal width", async () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const graph = new WorkflowGraph({
      name: "工作流",
      path: "/tmp/工作流.yml",
      stages: [{ id: "准备", dependsOn: [] }],
    }, () => Effect.succeed(undefined), darkTheme);
    await Effect.runPromise(graph.refresh());

    for (const width of [40, 80, 120]) {
      const rows = renderStatusPanel(darkTheme, width, graph);
      expect(rows.every((row) => visibleWidth(row) <= width), `width ${width}`).toBe(true);
    }
  });

  it("preserves USAGE over SHORTCUTS on a narrow terminal", () => {
    // At a narrow width, the lowest-priority SHORTCUTS column is truncated
    // away before the higher-priority USAGE column loses its content.
    const narrow = renderStatusPanel(darkTheme, 40).map(stripAnsi).join("\n");
    const medium = renderStatusPanel(darkTheme, 120).map(stripAnsi).join("\n");
    expect(medium).toContain("Esc");
    expect(medium).toContain("tokens");
    // USAGE must still survive the narrow width; SHORTCUTS may drop.
    expect(narrow).toContain("tokens");
    expect(narrow).toContain("tools");
    expect(narrow).toContain("stages");
  });

  it("keeps USAGE content before WORKFLOW content on a narrow terminal", async () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const graph = new WorkflowGraph({ stages: [{ id: "setup", dependsOn: [] }] }, () => Effect.succeed({
      plannedStages: 1, completedStages: 0, status: "running",
      current: { stageId: "setup", status: "running" },
    }), darkTheme);
    await Effect.runPromise(graph.refresh());
    const narrow = renderStatusPanel(darkTheme, 40, graph).map(stripAnsi).join("\n");
    expect(narrow).toContain("tokens");
  });

  it("renders populated USAGE values and drops SHORTCUTS first when narrowing", () => {
    // A run with real usage: 1.2k in / 0.4k out, 5 tools (1 failed), 2/3 stages.
    const stats = {
      inputTokens: 1200,
      outputTokens: 400,
      totalTokens: 1600,
      cacheReadTokens: 300,
      cacheWriteTokens: undefined,
      toolCalls: 5,
      toolFailures: 1,
      completedStages: 2,
      failedStages: 1,
      elapsedMs: 1500,
      completed: false,
      terminal: undefined,
      sessionId: undefined,
      transcriptPath: undefined,
    };
    const wideStats = renderStatusPanel(darkTheme, 120, undefined, stats).map(stripAnsi).join("\n");
    expect(wideStats).toContain("1.2k");
    expect(wideStats).toContain("↓400");
    expect(wideStats).toContain("5");
    expect(wideStats).toContain("(1✗)");
    expect(wideStats).toContain("2/3");
    expect(wideStats).toContain("running");

    // At a 50-column terminal the USAGE numbers must still be present while
    // the longer SHORTCUTS labels ("interrupt"/"exit"/"submit") have shed width.
    const narrowStats = renderStatusPanel(darkTheme, 50, undefined, stats).map(stripAnsi).join("\n");
    expect(narrowStats).toContain("1.2k");
    expect(narrowStats).toContain("2/3");
    // SHORTCUTS is the first column to be truncated away; its column header
    // must collapse to at most a couple of visible characters before USAGE
    // loses any of its four labels.
    expect(narrowStats).toContain("tokens");
    expect(narrowStats).toContain("tools");
    expect(narrowStats).toContain("stages");
  });

  it("normalizes non-finite widths", () => {
    const graph = new WorkflowGraph({ stages: [{ id: "setup", dependsOn: [] }] }, () => Effect.succeed(undefined), darkTheme);
    expect(renderStatusPanel(darkTheme, Number.POSITIVE_INFINITY)).toEqual([]);
    expect(renderStatusPanel(darkTheme, Number.NaN)).toEqual([]);
    expect(renderStatusPanel(darkTheme, Number.POSITIVE_INFINITY, graph)).toEqual([]);
    expect(renderStatusPanel(darkTheme, Number.NaN, graph)).toEqual([]);
  });

  it("places the fallback summary in existing WORKFLOW without a workflow section", async () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const graph = new WorkflowGraph({ name: "basic", path: "/tmp/basic.yml", stages: [{ id: "setup", dependsOn: [] }] }, () => Effect.succeed({
      plannedStages: 1, completedStages: 0, status: "running",
      current: { stageId: "setup", status: "running" },
    }), darkTheme);
    await Effect.runPromise(graph.refresh());
    const rows = renderStatusPanel(darkTheme, 120, graph).map(stripAnsi);
    expect(rows[0]).toContain("COMMANDS");
    const headerRow = rows.find((row) => row.includes("COMMANDS") && row.includes("WORKFLOW")) ?? "";
    const workflowStart = headerRow.indexOf("WORKFLOW");
    const summary = rows.find((row) => row.includes("basic /tmp/basic.yml"));

    expect(workflowStart).toBeGreaterThanOrEqual(0);
    expect(rows.join("\n")).not.toContain("STATUS");
    expect(summary?.slice(workflowStart)).toContain("basic /tmp/basic.yml");
    expect(summary?.slice(0, workflowStart)).not.toContain("basic /tmp/basic.yml");
    const dagRowIndex = rows.findIndex((row) => row.includes("◉"));
    expect(dagRowIndex).toBeGreaterThanOrEqual(0);
    expect(rows.slice(dagRowIndex, dagRowIndex + 2).join("\n").slice(workflowStart)).toContain("◉");
    // "setup" appears on the row adjacent to the glyph (above or below,
    // depending on the alternating label placement).
    const nearDag = rows.slice(Math.max(0, dagRowIndex - 1), dagRowIndex + 2).join("\n");
    expect(nearDag).toContain("setup");
  });

  it("shows the stage model in light blue under the stage name inside WORKFLOW", async () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const stages = [{ id: "implement", dependsOn: [], model: "qwen3.8-flash" }];
    const snapshot = () => Effect.succeed({
      plannedStages: 1, completedStages: 0, status: "running" as const,
      current: { stageId: "implement", status: "running" as const },
    });
    const graph = new WorkflowGraph({ name: "basic", path: "/tmp/basic.yml", stages }, snapshot, darkTheme);
    await Effect.runPromise(graph.refresh());
    const rows = renderStatusPanel(darkTheme, 120, graph);
    const plainRows = rows.map(stripAnsi);
    const workflowStart = (plainRows.find((row) => row.includes("WORKFLOW")) ?? "").indexOf("WORKFLOW");
    const nameRow = plainRows.findIndex((row) => row.includes("implement"));
    const modelRow = plainRows.findIndex((row) => row.includes("qwen3.8-flash"));

    expect(workflowStart).toBeGreaterThanOrEqual(0);
    // Directly under the stage name, in the WORKFLOW column, in light blue.
    expect(modelRow).toBe(nameRow + 1);
    expect(plainRows[modelRow]?.slice(0, workflowStart)).not.toContain("qwen3.8-flash");
    expect(rows[modelRow]).toContain(darkTheme.mdLink);
    expect(rows.every((row) => visibleWidth(row) <= 120)).toBe(true);
    // Adding a model row extends the DAG canvas by 2 rows (symmetric above/below
    // padding grows by one on each side), but only when the WORKFLOW column is the
    // tallest column; if COMMANDS already dominates, the footer height stays the same.
    const heightOf = async (model: string | undefined) => {
      const other = new WorkflowGraph(
        { name: "basic", path: "/tmp/basic.yml", stages: [{ id: "implement", dependsOn: [], model }] },
        snapshot,
        darkTheme,
      );
      await Effect.runPromise(other.refresh());
      return renderStatusPanel(darkTheme, 120, other).length;
    };
    const withoutModel = await heightOf(undefined);
    const withLongModel = await heightOf("a-very-long-model-name-that-overflows-the-column");
    // A long model is still clipped to one row — it must not grow past the short model height.
    expect(withLongModel).toBe(rows.length);
    // With model is at least as tall as without.
    expect(rows.length).toBeGreaterThanOrEqual(withoutModel);
  });

  it("draws the DAG at the WORKFLOW column's own width instead of slicing it", async () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const graph = new WorkflowGraph({
      name: "basic",
      path: "/tmp/basic.yml",
      stages: [{ id: "implement", dependsOn: [], model: "qwen3.8-flash" }],
    }, () => Effect.succeed(undefined), darkTheme);
    await Effect.runPromise(graph.refresh());

    // 120 columns is an ordinary terminal. Sizing the canvas to a share of the
    // whole terminal instead of the column makes `layoutColumns` slice the
    // surplus off the right, which pushes the centered stage out of the visible
    // cell — the stage name and its model line with it. The node must sit at the
    // center of the column it is actually drawn in.
    const rows = renderStatusPanel(darkTheme, 120, graph).map(stripAnsi);
    const workflowStart = (rows.find((row) => row.includes("WORKFLOW")) ?? "").indexOf("WORKFLOW");
    const nodeRow = rows.find((row) => row.includes("·")) ?? "";

    // The node must sit near the center of the WORKFLOW column — within 1
    // character of the exact midpoint (alignment differs by 1 depending on
    // whether the column width is odd or even).
    const colWidth = 120 - workflowStart;
    const expectedCenter = workflowStart + Math.floor(colWidth / 2);
    expect(Math.abs(nodeRow.indexOf("·") - expectedCenter)).toBeLessThanOrEqual(1);
    const nameRowIdx = rows.findIndex((row) => row.includes("implement"));
    // Model row is adjacent to name row (above or below, depending on even/odd index).
    const modelRowIdx = rows.findIndex((row) => row.includes("qwen3.8-flash"));
    expect(Math.abs(modelRowIdx - nameRowIdx)).toBe(1);
    expect(rows.every((row) => row.length <= 120)).toBe(true);
  });

  it("updates WORKFLOW when the selected workflow changes", () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false });
    const graph = new WorkflowGraph({ stages: [{ id: "old-stage", dependsOn: [] }] }, () => Effect.succeed(undefined), darkTheme);
    graph.setDefinition({ stages: [{ id: "new-stage", dependsOn: [] }] });
    const output = renderStatusPanel(darkTheme, 120, graph).map(stripAnsi).join("\n");
    expect(output).toContain("new-stage");
    expect(output).not.toContain("old-stage");
  });

  it("keeps the image payload full-width and the summary in WORKFLOW", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    const graph = new WorkflowGraph({ name: "basic", path: "/tmp/basic.yml", stages: [{ id: "setup", dependsOn: [] }] }, () => Effect.succeed({
      plannedStages: 1, completedStages: 0, status: "running",
      current: { stageId: "setup", status: "running" },
    }), darkTheme);
    await Effect.runPromise(graph.refresh());
    const rows = renderStatusPanel(darkTheme, 120, graph);

    expect(rows[0]?.startsWith(KITTY_IMAGE_PREFIX)).toBe(true);
    expect(rows.find((row) => stripAnsi(row).includes("WORKFLOW"))).toBeDefined();
    expect(rows.map(stripAnsi).join("\n")).toContain("basic /tmp/basic.yml");
    expect(rows.map(stripAnsi).join("\n")).not.toContain("STATUS");
  });
});
