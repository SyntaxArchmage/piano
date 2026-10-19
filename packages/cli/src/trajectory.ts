// Pure trajectory ledger reducer for Piano — folds the rich, SDK-native
// AgentEvent stream into a compact 8-kind ledger (decision 0027). Kept in the
// CLI (not /orchestrator) because the orchestrator already forwards raw events through `onEvent` and
// `main.ts` appends the raw `events` to `trajectory.jsonl`; the folded
// ledger is only consumed by the on-screen side panel, so there is no other
// caller. It has no pi-tui or theme dependency — the renderer lives in
// trajectory-panel.ts.

import { messageText, type AgentEvent } from "@piano/harness";
import { iterationOfInvocationId } from "@piano/orchestrator";
import { jsonText } from "./text.js";

/** The kind of action a trajectory entry records. */
export type TrajectoryKind =
  | "user_message"
  | "spawn"
  | "context"
  | "tool_call"
  | "tool_result"
  | "agent_message"
  | "usage"
  | "done"
  | "error";

/** One row in the trajectory ledger. */
export interface TrajectoryEntry {
  seq: number; // 1-based, monotonic per run
  kind: TrajectoryKind;
  label: string; // short noun: tool name / "agent" / "usage" / "done"
  detail: string; // one-line summary (truncated on render)
  model?: string; // spawn entries only: model name shown as a second line
  tsMs: number; // Date.now() when the event was observed
  toolCallId?: string; // SDK identity used to pair tool start/end events
  durationMs?: number; // tool_call → tool_result duration (optional)
}

/** Reduced panel state: the retained ledger plus its retention cap. */
export interface TrajectoryState {
  entries: TrajectoryEntry[];
  maxEntries: number;
}

/** Hard cap on retained ledger entries. */
export const TRAJECTORY_MAX_ENTRIES = 500;

/** Initial trajectory state: empty ledger, default retention cap. */
export function emptyTrajectoryState(): TrajectoryState {
  return { entries: [], maxEntries: TRAJECTORY_MAX_ENTRIES };
}

/** Serialize a tool result for a one-line detail (bounded, like the args). */
function resultText(result: unknown, isError: boolean): string {
  if (result === undefined) return isError ? "error" : "ok";
  if (typeof result === "string") return result;
  return jsonText(result);
}

/** Serialize a tool call argument for a one-line detail. */
function argText(args: unknown): string {
  if (args === undefined) return "";
  if (typeof args === "string") return args;
  return jsonText(args);
}

/**
 * Normalize a one-line detail before it enters the ledger: expand literal
 * tabs to three spaces. pi-tui's width math is inconsistent on tabs
 * (`visibleWidth` counts `\t` as 3 columns while `sliceWithWidth` /
 * `graphemeWidth` count it as 0), which lets a tab-bearing row escape the
 * renderer's terminal-width guard and crash the TUI with "Rendered line N
 * exceeds terminal width" — first seen with a disassembly tool result whose
 * line ended in a trailing tab. Keeping every ledger detail free of `\t`
 * makes the guard truncate correctly.
 */
function sanitizeDetail(detail: string): string {
  return detail.includes("\t") ? detail.replace(/\t/g, "   ") : detail;
}

/** How many context files/skills did an event carry (0 when absent). */
function contextCounts(context: { contextFiles?: readonly unknown[]; contextFilePaths?: readonly unknown[]; skills?: readonly unknown[] }): {
  files: number;
  skills: number;
} {
  return {
    files: context.contextFilePaths?.length ?? context.contextFiles?.length ?? 0,
    skills: context.skills?.length ?? 0,
  };
}

/** The zero-based loop iteration of a workflow `invocationId`, or undefined
 * for non-loop invocations. Delegates to the orchestrator's shared parser —
 * the inverse of the `iter-N` spelling `runtimeInstanceId` produces — so the
 * chat renderer, this ledger, and the evals driver cannot drift apart.
 * Consumers render the value as `iteration + 1`. */
export function loopIteration(invocationId: string | undefined): number | undefined {
  return iterationOfInvocationId(invocationId);
}

/** Fold one `AgentEvent` into a `TrajectoryEntry` (or null when the event
 * type does not produce a row — SDK-lifecycle noise such as turn/compaction/
 * retry boundaries, token `message_update` deltas, and the like belong in the
 * transcript/log, not the side ledger; the reducer drops
 * `agent_message_delta`). */
function toEntry(
  state: TrajectoryState,
  event: AgentEvent,
  now: number,
): TrajectoryEntry | null {
  const seq =
    state.entries.length === 0
      ? 1
      : (state.entries[state.entries.length - 1]?.seq ?? 0) + 1;

  switch (event.type) {
    case "spawn": {
      const stage = event.workflow?.stageId;
      const worker = event.workflow?.worker;
      const iteration = loopIteration(event.workflow?.invocationId);
      const stageLabel = stage === undefined ? "" : `${stage}${iteration === undefined ? "" : ` #${iteration + 1}`}`;
      const detailParts = [event.harness];
      if (worker !== undefined && worker !== "") detailParts.push(worker);
      return {
        seq,
        kind: "spawn",
        label: stageLabel === "" ? "agent" : stageLabel,
        detail: detailParts.join(" · "),
        model: event.model,
        tsMs: now,
      };
    }
    case "resource": {
      // SDK resource load/request lifecycle noise with no single-action row;
      // dropped as a lifecycle-only event. Folding each
      // requested/loaded transition here flooded the ledger with per-file rows
      // (ISSUE-010).
      return null;
    }
    case "context": {
      const { files, skills } = contextCounts(event.context);
      const parts: string[] = [];
      if (event.context.systemPromptPath !== undefined) parts.push("sys prompt");
      if (files > 0) parts.push(`${files} file${files === 1 ? "" : "s"}`);
      if (skills > 0) parts.push(`${skills} skill${skills === 1 ? "" : "s"}`);
      if (event.context.userMessage !== undefined) parts.push(`user ${event.context.userMessage.length}ch`);
      return { seq, kind: "context", label: "context", detail: parts.join(" · ") || "loaded", tsMs: now };
    }
    case "tool_execution_start": {
      const args = argText(event.args);
      // Claude's `--include-partial-messages` opens the tool block with an
      // empty input and the completed `assistant` record re-reports the same
      // call with real args; fold that re-report into the open ledger row
      // (mirroring the chat view's fold) instead of stacking a duplicate.
      for (let i = state.entries.length - 1; i >= 0; i--) {
        const prev = state.entries[i];
        if (prev?.kind !== "tool_call" || prev.toolCallId !== event.toolCallId) continue;
        const closed = state.entries
          .slice(i + 1)
          .some((entry) => entry?.kind === "tool_result" && entry.toolCallId === event.toolCallId);
        if (!closed) {
          prev.label = event.toolName;
          if (args !== "") prev.detail = sanitizeDetail(args);
          return null;
        }
        break;
      }
      return {
        seq,
        kind: "tool_call",
        label: event.toolName,
        detail: args,
        tsMs: now,
        toolCallId: event.toolCallId,
      };
    }
    case "tool_execution_end": {
      // Pair with the most recent open tool_call for the same toolCallId to
      // report an accurate duration (the event carries an explicit id, unlike
      // name matching).
      let durationMs: number | undefined;
      let fallbackStart: TrajectoryEntry | undefined;
      for (let i = state.entries.length - 1; i >= 0; i--) {
        const prev = state.entries[i];
        if (prev?.kind !== "tool_call" || prev.label !== event.toolName) continue;
        if (prev.toolCallId === event.toolCallId) {
          durationMs = now - prev.tsMs;
          break;
        }
        // Keep compatibility with entries written before toolCallId was
        // persisted, but never let a different known ID steal the match.
        if (prev.toolCallId === undefined && fallbackStart === undefined) fallbackStart = prev;
      }
      if (durationMs === undefined && fallbackStart !== undefined) {
        durationMs = now - fallbackStart.tsMs;
      }
      const result = resultText(event.result, event.isError);
      return {
        seq,
        kind: "tool_result",
        label: event.toolName,
        detail: event.isError ? `✗ ${result}` : result,
        tsMs: now,
        toolCallId: event.toolCallId,
        durationMs,
      };
    }
    case "message_end": {
      const text = messageText(event.message);
      const firstLine = (text ?? "").split("\n", 1)[0] ?? "";
      if (firstLine === "") return null;
      const role = event.message.role;
      return {
        seq,
        kind: role === "user" ? "user_message" : "agent_message",
        label: role === "user" ? "user" : "agent",
        detail: firstLine,
        tsMs: now,
      };
    }
    case "usage": {
      const u = event.usage;
      let detail = `↑${u.input ?? 0} ↓${u.output ?? 0}`;
      if (u.cacheRead !== undefined) detail += ` C${u.cacheRead}`;
      if (u.cacheWrite !== undefined) detail += ` W${u.cacheWrite}`;
      return { seq, kind: "usage", label: "usage", detail, tsMs: now };
    }
    case "done": {
      return { seq, kind: "done", label: "done", detail: `exit ${event.exitStatus}`, tsMs: now };
    }
    case "error": {
      return { seq, kind: "error", label: "error", detail: `${event.errorType}: ${event.message}`, tsMs: now };
    }
    // SDK-lifecycle events with no single-action row (turn/compaction/retry
    // boundaries, token deltas, steering queue snapshots, resource requests, …).
    default:
      return null;
  }
}

/** Pure reducer: folds one `AgentEvent` into trajectory state, returning a
 * NEW state (never mutating the input). Events that produce no row
 * (token-level `message_update` deltas, lifecycle boundaries) return the same
 * reference unchanged. Retained entries are capped at `maxEntries`, dropping
 * the oldest beyond the cap. */
export function applyTrajectoryEvent(
  state: TrajectoryState,
  event: AgentEvent,
  now: number,
): TrajectoryState {
  const entry = toEntry(state, event, now);
  if (entry === null) return state;
  // Sanitize at the ledger boundary so every retained entry (and any future
  // entry kind) stays free of `\t`; see sanitizeDetail.
  const entries = [...state.entries, { ...entry, detail: sanitizeDetail(entry.detail) }];
  if (entries.length > state.maxEntries) {
    entries.splice(0, entries.length - state.maxEntries);
  }
  return { entries, maxEntries: state.maxEntries };
}
