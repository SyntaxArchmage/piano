// Pure trajectory ledger reducer for Piano — folds the rich, SDK-native
// AgentEvent stream into a compact 8-kind ledger (decision 0027). Kept in the
// CLI (not /orchestrator) because the orchestrator already forwards raw events through `onEvent` and
// `main.ts` appends the raw `events` to `trajectory.jsonl`; the folded
// ledger is only consumed by the on-screen side panel, so there is no other
// caller. It has no pi-tui or theme dependency — the renderer lives in
// trajectory-panel.ts.

import { messageText, type AgentEvent } from "@piano/harness";
import {
  AGENT_DONE_NAME,
  AGENT_ERROR_NAME,
  AGENT_USAGE_NAME,
  asRecord,
  messageName,
  toolCallIdFromHandle,
  type ObservationOp,
} from "@piano/logging";
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

/** The one-line detail a tool result gets, including the failure mark. Shared
 * by the `AgentEvent` and the op path so the two ledgers cannot drift on how a
 * failed call is spelled. The renderer truncates; the ledger keeps the line. */
function toolResultDetail(result: unknown, isError: boolean): string {
  const text = result === undefined
    ? (isError ? "error" : "ok")
    : typeof result === "string" ? result : jsonText(result);
  return isError ? `✗ ${text}` : text;
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
  const seq = nextSeq(state);

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
      const result = toolResultDetail(event.result, event.isError);
      return {
        seq,
        kind: "tool_result",
        label: event.toolName,
        detail: result,
        tsMs: now,
        toolCallId: event.toolCallId,
        durationMs,
      };
    }
    case "message_end": {
      const text = messageText(event.message);
      const line = firstLine(text);
      if (line === "") return null;
      const role = event.message.role;
      return {
        seq,
        kind: role === "user" ? "user_message" : "agent_message",
        label: role === "user" ? "user" : "agent",
        detail: line,
        tsMs: now,
      };
    }
    case "usage": {
      return { seq, kind: "usage", label: "usage", detail: usageDetail(event.usage), tsMs: now };
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


/** The next ledger seq: 1-based and monotonic per run. */
function nextSeq(state: TrajectoryState): number {
  return state.entries.length === 0
    ? 1
    : (state.entries[state.entries.length - 1]?.seq ?? 0) + 1;
}

/** Append one row, sanitizing at the ledger boundary and dropping the oldest
 * past `maxEntries`. Both reducers share this so retention cannot drift. */
function appendEntry(
  entries: TrajectoryEntry[],
  entry: TrajectoryEntry,
  maxEntries: number,
): void {
  entries.push({ ...entry, detail: sanitizeDetail(entry.detail) });
  if (entries.length > maxEntries) {
    entries.splice(0, entries.length - maxEntries);
  }
}

/** The one usage line format the ledger shows. */
function usageDetail(u: {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}): string {
  let detail = `↑${u.input ?? 0} ↓${u.output ?? 0}`;
  if (u.cacheRead !== undefined) detail += ` C${u.cacheRead}`;
  if (u.cacheWrite !== undefined) detail += ` W${u.cacheWrite}`;
  return detail;
}

/** The one "first non-empty line" rule the ledger shows for a message. */
function firstLine(text: string | undefined): string {
  return (text ?? "").split("\n", 1)[0] ?? "";
}

function outputText(op: ObservationOp): string | undefined {
  const output = asRecord("output" in op ? op.output : undefined);
  const text = output?.text;
  return typeof text === "string" ? text : undefined;
}

function metadataString(op: ObservationOp, key: string): string | undefined {
  const value = op.metadata?.[key];
  return typeof value === "string" ? value : undefined;
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
  const entries = [...state.entries];
  appendEntry(entries, entry, state.maxEntries);
  return { entries, maxEntries: state.maxEntries };
}

/** Map one observation op to the ledger rows it implies (0–2).
 *
 * This is the chat-area read path for the Langfuse-aligned model: the same
 * `TrajectoryEntry` ledger the side panel already draws, fed from `ObservationOp`
 * instead of `AgentEvent`. `--langfuse` uses it; the `AgentEvent` reducer stays. */
function opToEntries(
  state: TrajectoryState,
  op: ObservationOp,
): TrajectoryEntry[] {
  const tsMs = Date.parse(op.timestamp);
  const seq = nextSeq(state);

  if (op.op === "emit" && op.name.endsWith(".message")) {
    const line = firstLine(outputText(op));
    if (line === "") return [];
    // The name is the declared role (`user.message` / `assistant.message`);
    // metadata.role is a redundant copy some producers omit.
    const user = op.name === messageName("user") || metadataString(op, "role") === "user";
    return [{
      seq,
      kind: user ? "user_message" : "agent_message",
      label: user ? "user" : "agent",
      detail: line,
      tsMs,
    }];
  }
  if (op.op === "emit" && op.name === AGENT_ERROR_NAME) {
    const errorType = metadataString(op, "errorType") ?? "error";
    const message = metadataString(op, "message") ?? "";
    return [{ seq, kind: "error", label: "error", detail: `${errorType}: ${message}`, tsMs }];
  }
  if (op.op === "emit" && op.name === AGENT_DONE_NAME) {
    const exitStatus = typeof op.metadata?.exitStatus === "number" ? op.metadata.exitStatus : 0;
    return [{ seq, kind: "done", label: "done", detail: `exit ${exitStatus}`, tsMs }];
  }
  if (op.op === "start" && op.type === "tool") {
    return [{
      seq,
      kind: "tool_call",
      label: op.name,
      detail: argText(op.input),
      tsMs,
      toolCallId: toolCallIdFromHandle(op.handle),
    }];
  }
  if (op.op === "end") {
    const toolCallId = toolCallIdFromHandle(op.handle);
    if (toolCallId !== undefined) {
      const failed = op.level === "ERROR";
      return [{
        seq,
        kind: "tool_result",
        // The close op carries the tool name; the handle is the join key.
        label: metadataString(op, "toolName") ?? toolCallId,
        detail: toolResultDetail(op.output, failed),
        tsMs,
        toolCallId,
      }];
    }
  }
  if (op.op === "start" && op.type === "agent") {
    const input = asRecord(op.input);
    const stageId = typeof input?.stageId === "string" ? input.stageId : undefined;
    const worker = metadataString(op, "worker");
    const iteration = loopIteration(metadataString(op, "invocationId"));
    const stageLabel = stageId === undefined
      ? "agent"
      : `${stageId}${iteration === undefined ? "" : ` #${iteration + 1}`}`;
    return [{
      seq,
      kind: "spawn",
      label: stageLabel,
      detail: worker ?? "",
      model: op.model,
      tsMs,
    }];
  }
  if (op.op === "emit" && op.name === AGENT_USAGE_NAME && op.usageDetails !== undefined) {
    return [{ seq, kind: "usage", label: "usage", detail: usageDetail(op.usageDetails), tsMs }];
  }
  return [];
}

/** Fold a batch of observation ops into trajectory state. Same ledger and same
 * cap as `applyTrajectoryEvent`; only the vocabulary differs. A second `start`
 * or `emit` on a handle already on the ledger is dropped — the handle is the
 * identity, the first open is the fact. */
export function applyObservationOps(
  state: TrajectoryState,
  ops: readonly ObservationOp[],
): TrajectoryState {
  if (ops.length === 0) return state;
  const entries = [...state.entries];
  const before = entries.length;
  const open = new Set<string>();
  for (const entry of entries) {
    if (entry.toolCallId !== undefined) open.add(`tool:${entry.toolCallId}`);
  }
  for (const op of ops) {
    if (op.op === "start" || op.op === "emit") {
      if (open.has(op.handle)) continue;
      open.add(op.handle);
    }
    for (const entry of opToEntries({ entries, maxEntries: state.maxEntries }, op)) {
      appendEntry(entries, entry, state.maxEntries);
    }
  }
  if (entries.length === before) return state;
  return { entries, maxEntries: state.maxEntries };
}
