import { describe, expect, it } from "vitest";
import {
  applyTrajectoryEvent,
  emptyTrajectoryState,
  loopIteration,
  TRAJECTORY_MAX_ENTRIES,
  type TrajectoryState,
} from "../../packages/cli/src/trajectory.js";
import {
  renderTrajectoryPanel,
  TrajectoryPanel,
} from "../../packages/cli/src/trajectory-panel.js";
import { darkTheme } from "../../packages/cli/src/theme.js";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (value: string): string => value.replace(ANSI, "");

function fold(state: TrajectoryState, event: Parameters<typeof applyTrajectoryEvent>[1], ts = 0): TrajectoryState {
  return applyTrajectoryEvent(state, event, ts);
}

describe(" trajectory reducer", () => {
  it("folds spawn/tool/message/usage/done/error into the 8-kind ledger", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "spawn", harness: "pi", model: "gpt-4o", skills: [] }, 1000);
    state = fold(state, { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { p: 1 } }, 1100);
    state = fold(state, { type: "tool_execution_end", toolCallId: "c1", toolName: "read", result: "ok", isError: false }, 1350);
    state = fold(state, { type: "message_end", message: { role: "assistant", content: "hello world" } }, 1400);
    state = fold(state, { type: "usage", usage: { input: 2, output: 3 } }, 1500);
    state = fold(state, { type: "done", exitStatus: 0, sessionId: "session", transcriptPath: "/tmp/t" }, 1600);

    const kinds = state.entries.map((e) => e.kind);
    expect(kinds).toEqual(["spawn", "tool_call", "tool_result", "agent_message", "usage", "done"]);

    const toolResult = state.entries.find((e) => e.kind === "tool_result");
    expect(toolResult?.durationMs).toBe(250); // 1350 - 1100
    expect(toolResult?.toolCallId).toBe("c1");

    const spawn = state.entries[0];
    expect(spawn?.label).toBe("agent");
    expect(spawn?.detail).toBe("pi");
    expect(spawn?.model).toBe("gpt-4o");
  });

  it("pairs interleaved calls with the same tool name by toolCallId", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: {} }, 1000);
    state = fold(state, { type: "tool_execution_start", toolCallId: "c2", toolName: "read", args: {} }, 1100);
    state = fold(state, { type: "tool_execution_end", toolCallId: "c1", toolName: "read", result: "first", isError: false }, 1300);
    state = fold(state, { type: "tool_execution_end", toolCallId: "c2", toolName: "read", result: "second", isError: false }, 1500);

    const results = state.entries.filter((entry) => entry.kind === "tool_result");
    expect(results.map((entry) => [entry.toolCallId, entry.durationMs])).toEqual([
      ["c1", 300],
      ["c2", 400],
    ]);
  });

  // Claude's `--include-partial-messages` opens a tool block with an empty
  // input and the completed `assistant` record re-reports the same call with
  // the real args. The ledger folds the re-report (as the chat view does),
  // instead of stacking two ⚙ rows with the first forever empty.
  it("folds Claude's tool-call re-report into the open ledger row", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "tool_execution_start", toolCallId: "c1", toolName: "Read", args: {} }, 1000);
    state = fold(state, { type: "tool_execution_start", toolCallId: "c1", toolName: "Read", args: { path: "a.ts" } }, 1002);
    expect(state.entries.filter((entry) => entry.kind === "tool_call")).toHaveLength(1);
    expect(state.entries[0]?.detail).toContain("a.ts");
    state = fold(state, { type: "tool_execution_end", toolCallId: "c1", toolName: "Read", result: "ok", isError: false }, 1300);
    expect(state.entries.map((entry) => entry.kind)).toEqual(["tool_call", "tool_result"]);
    expect(state.entries[1]?.durationMs).toBe(300);
  });

  it("drops SDK-lifecycle noise (turn/compaction/retry/token deltas)", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "agent_start" });
    state = fold(state, { type: "turn_start" });
    state = fold(state, { type: "turn_end", message: { role: "assistant" }, toolResults: [] });
    state = fold(state, { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "x" } });
    state = fold(state, { type: "compaction_start", reason: "auto" });
    state = fold(state, { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 0, errorMessage: "x" });
    expect(state.entries).toEqual([]);
  });

  it("drops resource events (per-file request/load noise) instead of a context row", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "resource", resource: { kind: "context-file", status: "requested", source: "workflow", path: "/tmp/a.md" } });
    state = fold(state, { type: "resource", resource: { kind: "context-file", status: "loaded", source: "workflow", path: "/tmp/a.md", bytes: 10 } });
    expect(state.entries).toEqual([]);
  });

  it("records a real cumulative usage event as a single usage row", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "usage", usage: { input: 120, output: 80, cacheRead: 12 } });
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.kind).toBe("usage");
    expect(state.entries[0]?.detail).toBe("↑120 ↓80 C12");
  });

  it("keeps unprintable tool values from breaking the reducer", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const throwing: Record<string, unknown> = {};
    Object.defineProperty(throwing, "value", {
      enumerable: true,
      get: () => { throw new Error("value unavailable"); },
    });

    let state = emptyTrajectoryState();
    state = fold(state, { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: circular });
    state = fold(state, { type: "tool_execution_end", toolCallId: "c1", toolName: "read", result: throwing, isError: true });
    state = fold(state, { type: "tool_execution_start", toolCallId: "c2", toolName: "read", args: undefined });
    state = fold(state, { type: "tool_execution_end", toolCallId: "c2", toolName: "read", result: undefined, isError: false });

    expect(state.entries.map((entry) => entry.detail)).toEqual([
      "[unprintable]",
      "✗ [unprintable]",
      "",
      "ok",
    ]);
  });

  it("labels a workflow spawn with its stage and 1-based loop iteration", () => {
    let state = emptyTrajectoryState();
    state = fold(state, {
      type: "spawn",
      harness: "pi",
      model: "gpt-4o",
      skills: [],
      workflow: { stageId: "tune.measure", invocationId: "tune.measure@tune/iter-4", worker: "cuda-benchmark-store", attempt: 0 },
    });
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.kind).toBe("spawn");
    expect(state.entries[0]?.label).toBe("tune.measure #5");
    expect(state.entries[0]?.detail).toBe("pi · cuda-benchmark-store");
    expect(state.entries[0]?.model).toBe("gpt-4o");
  });

  it("ignores loop iteration suffixes that cannot be displayed safely", () => {
    const maximumDisplayed = Number.MAX_SAFE_INTEGER - 1;
    expect(loopIteration(`tune.measure@tune/iter-${maximumDisplayed}`)).toBe(maximumDisplayed);
    expect(loopIteration(`tune.measure@tune/iter-${Number.MAX_SAFE_INTEGER}`)).toBeUndefined();
    expect(loopIteration("tune.measure@tune/iter-9007199254740992")).toBeUndefined();
    expect(loopIteration("tune.measure@tune/iter-9007199254740993")).toBeUndefined();
  });

  it("falls back to the plain 'agent' label for a non-workflow spawn", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "spawn", harness: "pi", skills: [] });
    expect(state.entries[0]?.label).toBe("agent");
  });

  it("labels a user prompt as user instead of agent", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "message_end", message: { role: "user", content: "tune the gemm" } });
    expect(state.entries[0]).toMatchObject({ kind: "user_message", label: "user", detail: "tune the gemm" });
  });

  it("caps retained entries at TRAJECTORY_MAX_ENTRIES", () => {
    let state = emptyTrajectoryState();
    for (let i = 0; i < TRAJECTORY_MAX_ENTRIES + 10; i++) {
      state = fold(state, { type: "usage", usage: { input: i } }, i);
    }
    expect(state.entries).toHaveLength(TRAJECTORY_MAX_ENTRIES);
    expect(state.entries[0]?.seq).toBe(11);
  });

  it("expands tabs in details so no ledger row escapes the renderer's width guard", () => {
    // Regression: a disassembly tool result ending in a tab under-counted
    // width in pi-tui's truncation, escaped the terminal-width guard, and
    // crashed the TUI ("Rendered line 10 exceeds terminal width").
    const disassembly = "34533:   209f4: 98 23 91 44 80 6a    \tm.mop.mac.f32 oacc142, oacc17, oac…";
    let state = emptyTrajectoryState();
    state = fold(state, { type: "tool_execution_start", toolCallId: "c1", toolName: "asm", args: {} }, 1000);
    state = fold(state, { type: "tool_execution_end", toolCallId: "c1", toolName: "asm", result: disassembly, isError: false }, 1100);
    state = fold(state, { type: "message_end", message: { role: "assistant", content: "a\tb first line\nsecond line" } }, 1200);

    const details = state.entries.map((entry) => entry.detail);
    for (const detail of details) {
      expect(detail.includes("\t")).toBe(false);
    }
    // The tab is expanded to three spaces (pi-tui's visibleWidth / Text
    // normalization), keeping width math consistent.
    expect(state.entries[1]?.detail).toBe(disassembly.replace("\t", "   "));
    expect(state.entries[2]?.detail).toBe("a   b first line");
  });
});

describe(" trajectory panel rendering", () => {
  it("renders a timestamped, icon'd, colored ledger with a sparkline", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "spawn", harness: "pi", model: "gpt-4o", skills: [] }, 1000);
    state = fold(state, { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { p: 1 } }, 1100);
    state = fold(state, { type: "tool_execution_end", toolCallId: "c1", toolName: "read", result: "ok", isError: false }, 1350);

    const rows = renderTrajectoryPanel(state, darkTheme, 80).map(stripAnsi);

    // Row 0: tab bar with the retained entry count.
    expect(rows[0]).toContain("trajectory");
    expect(rows[0]).toContain("· 3");
    // Row 1: overview sparkline (one cell per entry, with a spawn-turn marker).
    expect(rows[1]).toContain("▍");
    // Ledger rows: icon + label + a HH:MM:SS.mmm timestamp.
    expect(rows[2]).toContain("▶");
    expect(rows[2]).toContain("agent");
    expect(rows[2]).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
    // Tool result row carries its duration.
    expect(rows.join("\n")).toMatch(/\+250ms/);
    // Icons for the tool call + result.
    expect(rows.join("\n")).toContain("⚙");
    expect(rows.join("\n")).toContain("↳");
  });

  it("renders the model name as a second indented light-blue row under the spawn stage line", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "spawn", harness: "pi", model: "deepseek-v3", skills: [], workflow: { stageId: "coding", worker: "basic", invocationId: "coding@run/iter-0", attempt: 0 } }, 1000);
    const rows = renderTrajectoryPanel(state, darkTheme, 80).map(stripAnsi);
    // The spawn block is rows[2] (stage line) and rows[3] (model line).
    expect(rows[2]).toContain("coding");
    expect(rows[3]).toContain("deepseek-v3");
    // Model line must not contain the stage icon or timestamp.
    expect(rows[3]).not.toContain("▶");
    expect(rows[3]).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("does not add a model line when no model is present on the spawn entry", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "spawn", harness: "pi", skills: [] }, 1000);
    state = fold(state, { type: "usage", usage: { input: 1 } }, 1100);
    const rows = renderTrajectoryPanel(state, darkTheme, 80).map(stripAnsi);
    // 2 header rows + 1 spawn row (no model line) + 1 usage row = 4 rows.
    expect(rows).toHaveLength(4);
  });

  it("inserts a full-width rule before every non-first spawn", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "spawn", harness: "pi", skills: [] }, 1000);
    state = fold(state, { type: "usage", usage: { input: 1 } }, 1100);
    state = fold(state, { type: "spawn", harness: "pi", skills: [] }, 1200);
    const rows = renderTrajectoryPanel(state, darkTheme, 60).map(stripAnsi);
    const ruleIdx = rows.findIndex((r) => /^─+$/.test(r.trim()));
    expect(ruleIdx).toBeGreaterThan(0);
  });

  it("normalizes fractional and negative widths before drawing spawn rules", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "spawn", harness: "pi", skills: [] }, 1000);
    state = fold(state, { type: "spawn", harness: "pi", skills: [] }, 1100);

    expect(() => renderTrajectoryPanel(state, darkTheme, -1.5)).not.toThrow();
    expect(() => renderTrajectoryPanel(state, darkTheme, Number.POSITIVE_INFINITY)).not.toThrow();
    expect(() => renderTrajectoryPanel(state, darkTheme, Number.NaN)).not.toThrow();
    const rows = renderTrajectoryPanel(state, darkTheme, 3.9).map(stripAnsi);
    expect(rows.find((row) => /^─+$/.test(row))).toBe("───");
  });

  it("truncates a long tool detail to one row with an ellipsis instead of wrapping", () => {
    let state = emptyTrajectoryState();
    state = fold(state, { type: "spawn", harness: "pi", skills: [] }, 1000);
    state = fold(state, { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: "a very long argument string that exceeds the panel width" }, 1100);

    const rows = renderTrajectoryPanel(state, darkTheme, 40).map(stripAnsi);
    const joined = rows.join("\n");
    // The detail is clipped and marked with an ellipsis, never wrapped.
    expect(joined).toContain("…");
    expect(joined).toContain("a very long ar");
    // The tool call produced exactly one row (no continuation rows).
    const readRows = rows.filter((r) => r.includes("read") || r.includes("argument") || r.includes("panel width"));
    expect(readRows).toHaveLength(1);
  });

  it("shows no rows beyond the title + sparkline when empty", () => {
    const rows = renderTrajectoryPanel(emptyTrajectoryState(), darkTheme, 80).map(stripAnsi);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("· 0");
  });
});

describe("TrajectoryPanel component", () => {
  it("seeds the prompt as the first row and renders the terminal outcome", () => {
    const panel = new TrajectoryPanel(darkTheme);
    panel.start("hello");
    panel.record({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: {} });
    panel.complete({
      status: "completed",
      sessionId: "session",
      transcriptPath: "/tmp/run/respond/session/transcript.jsonl",
    });

    const output = panel.render(80).map(stripAnsi).join("\n");
    expect(output).toContain("session · session");
    expect(output).toContain("transcript · /tmp/run/respond/session/transcript.jsonl");
    expect(output).toContain("piano: workflow completed");
    // The prompt seed surfaces as the first user_message row.
    expect(output).toContain("hello");
  });

  it("reports a failed workflow as a piano system event", () => {
    const panel = new TrajectoryPanel(darkTheme);
    panel.start("hello");
    panel.complete({ status: "failed" });
    const output = panel.render(80).map(stripAnsi).join("\n");
    expect(output).toContain("piano: workflow failed");
    expect(output).not.toContain("piano: workflow completed");
  });

  it("normalizes non-finite component widths before rendering outcomes", () => {
    const panel = new TrajectoryPanel(darkTheme);
    panel.start("hello");
    panel.complete({ status: "completed", sessionId: "session", transcriptPath: "/tmp/transcript" });

    expect(() => panel.render(Number.POSITIVE_INFINITY)).not.toThrow();
    expect(() => panel.render(Number.NaN)).not.toThrow();
  });

  it("does not add harness user echoes to the trajectory", () => {
    const panel = new TrajectoryPanel(darkTheme);
    panel.start("hello");
    panel.record({ type: "message_end", message: { role: "user", content: "a provider-expanded prompt" } });
    const output = panel.render(80).map(stripAnsi).join("\n");
    expect(output).toContain("hello");
    expect(output).not.toContain("provider-expanded prompt");
  });

  it("renders a timestamped piano workflow failure without duplicating its detail", () => {
    const panel = new TrajectoryPanel(darkTheme);
    panel.start("hello");
    panel.complete({
      status: "failed",
      error: {
        type: "WorkflowError",
        message: "workflow.yml: bad indentation",
      },
    });
    const output = panel.render(80).map(stripAnsi).join("\n");
    expect(output).toContain("piano");
    expect(output).toContain("workflow failed");
    expect(output).not.toContain("task · failed");
    expect(output).not.toContain("workflow.yml: bad indentation");
    expect(output).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  });
});

describe("TrajectoryPanel scrolling", () => {
  function seeded(count: number): TrajectoryPanel {
    const panel = new TrajectoryPanel(darkTheme);
    panel.start("seed");
    for (let i = 0; i < count; i++) {
      panel.record({ type: "usage", usage: { input: i } });
    }
    return panel;
  }

  it("keeps prior entries reachable instead of flushing beyond the visible window", () => {
    const panel = seeded(20);
    // Pinned to tail: the oldest entries are out of view — no "more above".
    const tail = panel.render(80).map(stripAnsi).join("\n");
    expect(tail).not.toContain("more above");
    // Jump home: the first usage entry ("↑0") is now in view and we can page down.
    panel.scrollHome();
    const head = panel.render(80).map(stripAnsi).join("\n");
    expect(head).toContain("↑0 ↓0");
    expect(head).toContain("↓ more");
  });

  it("scrollBy clamps and scrollHome/scrollEnd move to the extremes", () => {
    const panel = seeded(30);
    panel.scrollHome();
    // At the top, scrolling up further is a no-op; nothing above to scroll into.
    panel.scrollBy(-1000); // clamp to top
    const top = panel.render(80).map(stripAnsi).join("\n");
    expect(top).not.toContain("↑ "); // no "↑ N more" when at the very top
    panel.scrollEnd();
    // At the tail, no "↓ more" (nothing below).
    const end = panel.render(80).map(stripAnsi).join("\n");
    expect(end).not.toContain("↓ more");
    panel.scrollBy(1000); // clamp past bottom is a no-op once at end
    expect(panel.render(80).map(stripAnsi).join("\n")).not.toContain("↓ more");
  });

  it("scrolls up from the pinned tail on the first scroll", () => {
    const panel = seeded(30);
    // Pinned tail: the window anchors to the newest rows, so the "↑ more"
    // count reflects the body rows hidden above the indicator row itself.
    expect(panel.render(80).map(stripAnsi).join("\n")).toMatch(/↑ 24 more · Ctrl\+Home top/);

    panel.scrollBy(-1);

    expect(panel.render(80).map(stripAnsi).join("\n")).toMatch(/↑ 23 more · Ctrl\+Home top/);
  });

  // The overlay is anchored to the terminal top and must end exactly above the
  // editor: indicator and outcome rows come out of the same visible-row budget
  // as the ledger body, so the rendered row count is constant across every
  // scroll position. A count that grew with scroll state would push the panel
  // over the input cell.
  it("renders a constant row count across all scroll positions", () => {
    const panel = new TrajectoryPanel(darkTheme, () => 10);
    panel.start("seed");
    for (let i = 0; i < 30; i++) panel.record({ type: "usage", usage: { input: i } });
    panel.complete({ status: "completed", sessionId: "s1", transcriptPath: "/tmp/t" });

    panel.scrollEnd();
    const atEnd = panel.render(80).map(stripAnsi).length;
    panel.scrollBy(-5);
    const midRows = panel.render(80).map(stripAnsi);
    panel.scrollHome();
    const atHome = panel.render(80).map(stripAnsi).length;

    expect(atEnd).toBe(midRows.length);
    expect(midRows.length).toBe(atHome);
    // Both indicators show at mid-scroll, each naming its jump shortcut.
    expect(midRows.join("\n")).toContain("Ctrl+Home top");
    expect(midRows.join("\n")).toContain("Ctrl+End bottom");
  });

  it("uses the actual outcome row count for its viewport budget", () => {
    const panel = new TrajectoryPanel(darkTheme, () => 10);
    panel.start("seed");
    for (let i = 0; i < 30; i++) panel.record({ type: "usage", usage: { input: i } });
    panel.complete({ status: "completed" });

    panel.scrollEnd();
    const tail = panel.render(80);
    panel.scrollHome();
    const head = panel.render(80);

    expect(tail).toHaveLength(10);
    expect(head).toHaveLength(10);
    expect(tail.some((row) => stripAnsi(row).includes("workflow completed"))).toBe(true);
    expect(panel.isWithin(10)).toBe(true);
    expect(panel.isWithin(11)).toBe(false);
  });

  it("renders a window bounded to the visible row count", () => {
    const panel = seeded(50);
    const rows = panel.render(80).map(stripAnsi);
    // 2 header rows + up to 8 ledger rows (+ one indicator row) — never the full 50.
    expect(rows.length).toBeLessThanOrEqual(2 + 8 + 1);
  });
});
