import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@piano/harness";
import {
  applyRunStat,
  emptyRunStats,
  foldRunStats,
  formatTokens,
  markTerminal,
  statsStatusLabel,
  usageRows,
} from "../../packages/cli/src/run-stats.js";

function usage(input: number, output: number, extra: Record<string, number> = {}): AgentEvent {
  return { type: "usage", usage: { input, output, ...extra } };
}
function toolEnd(isError = false): AgentEvent {
  return { type: "tool_execution_end", toolCallId: "t1", toolName: "bash", result: "", isError };
}
function agentEnd(willRetry = false): AgentEvent {
  return { type: "agent_end", messages: [], willRetry };
}
function done(exitStatus = 0): AgentEvent {
  return { type: "done", exitStatus, sessionId: "s1", transcriptPath: "/tmp/t.json" };
}

describe("applyRunStat", () => {
  it("accumulates usage snapshots by keeping the maximum, not summing", () => {
    let stats = emptyRunStats();
    stats = applyRunStat(stats, usage(10, 5));
    stats = applyRunStat(stats, usage(50, 20)); // later snapshot covers a larger range
    expect(stats.inputTokens).toBe(50);
    expect(stats.outputTokens).toBe(20);
  });

  it("keeps earlier values when a later snapshot omits a field", () => {
    let stats = emptyRunStats();
    stats = applyRunStat(stats, usage(10, 5));
    // A snapshot missing `input` must not overwrite the earlier value.
    stats = applyRunStat(stats, { type: "usage", usage: { output: 30 } });
    expect(stats.inputTokens).toBe(10);
    expect(stats.outputTokens).toBe(30);
  });

  it("leaves missing usage fields undefined for a run with no usage events", () => {
    const stats = emptyRunStats();
    expect(stats.inputTokens).toBeUndefined();
    expect(stats.totalTokens).toBeUndefined();
  });

  it("counts tool calls once per completed execution", () => {
    let stats = emptyRunStats();
    stats = applyRunStat(stats, toolEnd());
    stats = applyRunStat(stats, toolEnd(true));
    expect(stats.toolCalls).toBe(2);
    expect(stats.toolFailures).toBe(1);
  });

  it("treats agent_end with willRetry as a failed stage, not a completed one", () => {
    let stats = emptyRunStats();
    stats = applyRunStat(stats, agentEnd(false));
    stats = applyRunStat(stats, agentEnd(true));
    expect(stats.completedStages).toBe(1);
    expect(stats.failedStages).toBe(1);
  });

  it("keeps a closed turn's ending out of the run's state", () => {
    let stats = emptyRunStats();
    stats = applyRunStat(stats, agentEnd(false));
    const afterTurn = stats;
    stats = applyRunStat(stats, done(0));

    // One stage's turn closed. The workflow may have many more to run, so the
    // run is still running — the footer must not say otherwise from here on.
    expect(stats).toBe(afterTurn);
    expect(stats.terminal).toBeUndefined();
    expect(statsStatusLabel(stats)).toBe("running");

    // The run's own outcome is what settles the label.
    expect(statsStatusLabel(markTerminal(stats, "completed"))).toBe("completed");
    expect(statsStatusLabel(markTerminal(stats, "failed"))).toBe("failed");
  });

  it("does not read a turn's exit status as the run's terminal state", () => {
    // Both harnesses hard-code exitStatus 0 on `done`; a non-zero value would
    // be a turn-level signal either way, and turn level is not run level.
    const stats = applyRunStat(emptyRunStats(), done(1));
    expect(stats.terminal).toBeUndefined();
  });

  it("does not mutate its input", () => {
    const stats = emptyRunStats();
    const key = stats;
    applyRunStat(stats, toolEnd());
    expect(key.toolCalls).toBe(0);
  });
});

describe("foldRunStats", () => {
  it("folds events in order", () => {
    const stats = foldRunStats([toolEnd(), toolEnd(true), agentEnd(false)]);
    expect(stats.toolCalls).toBe(2);
    expect(stats.completedStages).toBe(1);
  });

  it("returns the empty state for no events", () => {
    expect(foldRunStats([])).toEqual(emptyRunStats());
  });
});

describe("formatTokens", () => {
  it("formats thousands, millions, billions and leaves missing values as ellipsis", () => {
    expect(formatTokens(undefined)).toBe("…");
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1200)).toBe("1.2k");
    expect(formatTokens(12000)).toBe("12k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(12_000_000)).toBe("12M");
    expect(formatTokens(1_200_000_000)).toBe("1.2B");
    expect(formatTokens(12_000_000_000)).toBe("12B");
  });
});

describe("statsStatusLabel", () => {
  it("reports waiting before any event and running after activity", () => {
    expect(statsStatusLabel(emptyRunStats())).toBe("waiting");
    expect(statsStatusLabel(foldRunStats([toolEnd()]))).toBe("running");
  });
});

describe("usageRows", () => {
  const theme = { dim: "", primary: "", accent: "", reset: "" };

  it("always returns four rows", () => {
    expect(usageRows(emptyRunStats(), theme)).toHaveLength(4);
  });

  it("renders token/tool/stage/status labels", () => {
    const stats = foldRunStats([usage(1200, 400), toolEnd(), agentEnd(false)]);
    const rows = usageRows(stats, theme);;
    expect(rows[0]).toContain("tokens");
    expect(rows[0]).toContain("1.2k");
    expect(rows[1]).toContain("tools");
    expect(rows[1]).toContain("1");
    expect(rows[2]).toContain("stages");
    expect(rows[2]).toContain("1/1");
    expect(rows[3]).toContain("running");
  });
});
