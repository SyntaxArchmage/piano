// Pure cumulative run-statistics reducer for Piano — folds the raw AgentEvent
// stream into ONE running total per run, independent of the trajectory ledger
// (decision: issue #12). The ledger keeps a bounded, per-action timeline; this
// module keeps unbounded counters that survive past the ledger's retention
// window so the footer can always report the whole run's consumption.
//
// Kept in the CLI (not /orchestrator) for the same reason as trajectory.ts:
// the orchestrator already forwards raw events, and the folded aggregate is
// only consumed by the on-screen footer, so there is no other caller. It has
// no pi-tui or theme dependency — the renderer below returns strings plus the
// already-built theme tokens; status-panel.ts lays them out.
//
// Counting semantics (locked by tests/cli/run-stats.test.ts):
//   - `usage` events are cumulative provider snapshots emitted once per
//     message_end (see pi.ts). The reducer keeps the MAXIMUM observed per
//     field, never sums — summing a snapshot double-counts once the provider
//     reports a larger range on the next message_end. Fields absent from every
//     snapshot stay undefined and render as "…".
//   - `toolCalls` increments on each `tool_execution_end` (the event carrying
//     `isError` and one stable `toolCallId`); a start that never completes is
//     not counted. `toolFailures` counts the subset with `isError`.
//   - `completedStages` counts each `agent_end` whose `willRetry` is false;
//     `failedStages` counts the `willRetry` subset. Each `agent_end` is one
//     concrete invocation (root stage, loop iteration, or map slot), so a
//     provider/validation retry emits another `agent_end` rather than
//     double-counting the same attempt.
//   - `done` marks the run terminal and preserves session id / transcript path
//     (evidence availability).

import type { AgentEvent } from "@piano/harness";

/** Cumulative statistics for one run. Token fields keep the LATEST provider
 * snapshot (see the header comment), not a sum. */
export interface RunStats {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  /** Distinct completed tool executions. */
  readonly toolCalls: number;
  /** Failed tool executions (tool_execution_end with `isError` set). */
  readonly toolFailures: number;
  /** Accepted stage invocations (agent_end without willRetry). */
  readonly completedStages: number;
  /** Failed stage invocations (agent_end with willRetry). */
  readonly failedStages: number;
  /** Wall-clock elapsed since the run started, in milliseconds. */
  readonly elapsedMs: number;
  /** A terminal `done` event was observed. */
  readonly completed: boolean;
  readonly terminal?: "completed" | "failed" | "cancelled";
  /** Evidence availability: session id and transcript path from the terminal
   * `done` event (preserved from the raw trajectory as source of truth). */
  readonly sessionId?: string;
  readonly transcriptPath?: string;
}

/** Initial run state: everything zero, nothing terminal. */
export function emptyRunStats(): RunStats {
  return {
    toolCalls: 0,
    toolFailures: 0,
    completedStages: 0,
    failedStages: 0,
    elapsedMs: 0,
    completed: false,
    terminal: undefined,
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
    sessionId: undefined,
    transcriptPath: undefined,
  };
}

function maxKeep(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return current;
  if (current === undefined) return next;
  return Math.max(current, next);
}

/** Pure reducer: fold one `AgentEvent` into a fresh immutable `RunStats`.
 * The input is never mutated; every fold returns a new object. */
export function applyRunStat(input: RunStats, event: AgentEvent): RunStats {
  switch (event.type) {
    case "usage": {
      const u = event.usage;
      return {
        ...input,
        inputTokens: maxKeep(input.inputTokens, u.input),
        outputTokens: maxKeep(input.outputTokens, u.output),
        totalTokens: maxKeep(input.totalTokens, u.totalTokens),
        cacheReadTokens: maxKeep(input.cacheReadTokens, u.cacheRead),
        cacheWriteTokens: maxKeep(input.cacheWriteTokens, u.cacheWrite),
      };
    }
    case "tool_execution_end": {
      return {
        ...input,
        toolCalls: input.toolCalls + 1,
        toolFailures: input.toolFailures + (event.isError ? 1 : 0),
      };
    }
    case "agent_end": {
      return {
        ...input,
        completedStages: input.completedStages + (event.willRetry ? 0 : 1),
        failedStages: input.failedStages + (event.willRetry ? 1 : 0),
      };
    }
    case "done": {
      return {
        ...input,
        completed: true,
        // The harness emits `done` only on a successful exit (subprocess.ts and
        // pi.ts both hard-code exitStatus 0); failure and cancellation
        // surface through Effect.fail, not a `done` event. The caller marks
        // those terminals explicitly via `markTerminal`. Keeping exitStatus's
        // sign here is harmless and self-documenting.
        terminal: event.exitStatus === 0 ? "completed" : "failed",
        sessionId: event.sessionId,
        transcriptPath: event.transcriptPath,
      };
    }
    default:
      return input;
  }
}

/** Record a non-success terminal outcome observed outside the event stream. The
 * harness reports failure/cancellation as an Effect error (not a `done` event),
 * so the TUI calls this from its tapError path to fold that outcome into the
 * cumulative stats the same way a successful `done` would. */
export function markTerminal(
  input: RunStats,
  terminal: "completed" | "failed" | "cancelled",
): RunStats {
  return { ...input, completed: true, terminal };
}

/** Fold `events` in order into a cumulative `RunStats`, advancing elapsed to
 * the difference between startTime and now. */
export function foldRunStats(
  events: readonly AgentEvent[],
  startTime: number,
  now: number,
): RunStats {
  let stats = emptyRunStats();
  for (const event of events) {
    stats = applyRunStat(stats, event);
  }
  return { ...stats, elapsedMs: Math.max(0, now - startTime) };
}

/** Compact token formatting for the footer: values ≥1000 render as "1.2k";
 * ≥1e6 as "1.2M"; ≥1e9 as "1.2B"; undefined (missing usage field) as "…". */
export function formatTokens(value: number | undefined): string {
  if (value === undefined) return "…";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

/** Compact lifecycle label for the STATUS row, mirroring the workflow graph's
 * summary phrasing ("waiting" before the first stage resolves). */
export function statsStatusLabel(stats: RunStats): string {
  if (stats.terminal === "cancelled") return "cancelled";
  if (stats.terminal === "failed") return "failed";
  if (stats.completed) return "completed";
  if (stats.completedStages > 0 || stats.failedStages > 0 || stats.toolCalls > 0) return "running";
  return "waiting";
}

/** Theme tokens the USAGE renderer needs (pre-built from PianoTheme by the
 * caller, so this module stays free of the pi-tui/theme dependency). */
export interface UsageRowTheme {
  readonly dim: string;
  readonly primary: string;
  readonly accent: string;
  readonly reset: string;
}

/** Build the four USAGE column rows: tokens, tool calls, stages, status. Rows
 * are returned untruncated; the footer's own `cell()`/`truncateSegment` lays
 * them out and clips to the column width (a single, ANSI-aware truncator). */
export function usageRows(
  stats: RunStats,
  theme: UsageRowTheme,
): string[] {
  const tokenRow = `${theme.dim}tokens${theme.reset} ${theme.primary}↑${formatTokens(stats.inputTokens)} ↓${formatTokens(stats.outputTokens)}${theme.reset}`;
  const toolRow = `${theme.dim}tools${theme.reset} ${theme.primary}${stats.toolCalls}${theme.reset}${stats.toolFailures > 0 ? ` ${theme.accent}(${stats.toolFailures}✗)${theme.reset}` : ""}`;
  const stageRow = `${theme.dim}stages${theme.reset} ${theme.primary}${stats.completedStages}/${stats.completedStages + stats.failedStages}${theme.reset}`;
  const statusRow = `${theme.dim}${statsStatusLabel(stats)}${theme.reset}`;
  return [tokenRow, toolRow, stageRow, statusRow];
}
