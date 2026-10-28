// Pure trajectory ledger reducer for Piano — folds the rich, SDK-native
// AgentEvent stream into a compact 8-kind ledger (decision 0027). Kept in the
// CLI (not /orchestrator) because the orchestrator already forwards raw events through `onEvent` and
// `main.ts` appends the raw `events` to `trajectory.jsonl`; the folded
// ledger is only consumed by the on-screen side panel, so there is no other
// caller. It has no pi-tui or theme dependency — the renderer lives in
// trajectory-panel.ts.

import { messageText, type AgentEvent } from "@piano/harness";
import {
  AGENT_CONTEXT_NAME,
  AGENT_DONE_NAME,
  AGENT_ERROR_NAME,
  AGENT_USAGE_NAME,
  asRecord,
  contextCounts,
  contextDetail,
  contextFacts,
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
  /** The op handle that opened a `spawn` row, so a re-reported `start` can find
   * and refine it. Tools join on `toolCallId`; nothing else is refinable. */
  handle?: string;
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

/** The one-line detail a `spawn` row shows: harness, then worker. Shared by
 * both feeders so the two ledgers cannot drift on the label. */
function spawnDetail(harness: string | undefined, worker: string | undefined): string {
  const parts: string[] = [];
  if (harness !== undefined && harness !== "") parts.push(harness);
  if (worker !== undefined && worker !== "") parts.push(worker);
  return parts.join(" · ");
}

/** The spawn facts an `agent` `start` carries, whichever feeder reads it. */
function spawnIdentity(op: Extract<ObservationOp, { op: "start" | "emit" }>): string {
  const input = asRecord(op.input);
  return spawnDetail(
    typeof input?.harness === "string" ? input.harness : undefined,
    metadataString(op, "worker"),
  );
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
      const iteration = loopIteration(event.workflow?.invocationId);
      const stageLabel = stage === undefined ? "" : `${stage}${iteration === undefined ? "" : ` #${iteration + 1}`}`;
      return {
        seq,
        kind: "spawn",
        label: stageLabel === "" ? "agent" : stageLabel,
        detail: spawnDetail(event.harness, event.workflow?.worker),
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
      return {
        seq,
        kind: "context",
        label: "context",
        detail: contextDetail({
          systemPromptPath: event.context.systemPromptPath,
          files,
          skills,
          ...(event.context.userMessage === undefined ? {} : { userMessageLength: event.context.userMessage.length }),
        }),
        tsMs: now,
      };
    }
    case "tool_execution_start": {
      const args = argText(event.args);
      // Claude's `--include-partial-messages` opens the tool block with an
      // empty input and the completed `assistant` record re-reports the same
      // call with real args; fold that re-report into the open ledger row
      // (mirroring the chat view's fold) instead of stacking a duplicate.
      const folded = foldToolReReport(state.entries, event.toolCallId, event.toolName, args);
      if (folded !== undefined) {
        state.entries[folded.index] = folded.row;
        return null;
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

function metadataNumber(op: ObservationOp, key: string): number | undefined {
  const value = op.metadata?.[key];
  return typeof value === "number" ? value : undefined;
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
  openStarts: ReadonlyMap<string, number>,
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
  if (op.op === "emit" && op.name === AGENT_CONTEXT_NAME) {
    return [{ seq, kind: "context", label: "context", detail: contextDetail(contextFacts(op)), tsMs }];
  }
  if (op.op === "emit" && op.name === AGENT_ERROR_NAME) {
    const errorType = metadataString(op, "errorType") ?? "error";
    const message = metadataString(op, "message") ?? "";
    return [{ seq, kind: "error", label: "error", detail: `${errorType}: ${message}`, tsMs }];
  }
  if (op.op === "emit" && op.name === AGENT_DONE_NAME) {
    const exitStatus = metadataNumber(op, "exitStatus") ?? 0;
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
      const startedAt = openStarts.get(op.handle);
      return [{
        seq,
        kind: "tool_result",
        // The close op carries the tool name; the handle is the join key.
        label: metadataString(op, "toolName") ?? toolCallId,
        detail: toolResultDetail(op.output, failed),
        tsMs,
        toolCallId,
        ...(startedAt === undefined ? {} : { durationMs: tsMs - startedAt }),
      }];
    }
  }
  if (op.op === "start" && op.type === "agent") {
    const input = asRecord(op.input);
    const stageId = typeof input?.stageId === "string" ? input.stageId : undefined;
    const iteration = loopIteration(metadataString(op, "invocationId"));
    const stageLabel = stageId === undefined
      ? "agent"
      : `${stageId}${iteration === undefined ? "" : ` #${iteration + 1}`}`;
    return [{
      seq,
      kind: "spawn",
      label: stageLabel,
      detail: spawnIdentity(op),
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
 * cap as `applyTrajectoryEvent`; only the vocabulary differs. A second `emit`
 * on a handle already on the ledger is dropped — a born-closed point has no
 * payload left to refine. A second `start` opens no second row but does refine
 * the open one's payload, which is how Claude's tool-call re-report reaches the
 * ledger (mirroring `toEntry`). */
export function applyObservationOps(
  state: TrajectoryState,
  ops: readonly ObservationOp[],
): TrajectoryState {
  if (ops.length === 0) return state;
  const entries = [...state.entries];
  let changed = false;
  // Open handles and, for tools, the start time a close op turns into
  // `durationMs`. Only rows a later `start` can still refine enter `open`.
  const open = new Set<string>();
  const openStarts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind === "tool_call" && entry.toolCallId !== undefined) {
      const handle = `tool:${entry.toolCallId}`;
      open.add(handle);
      openStarts.set(handle, entry.tsMs);
    } else if (entry.kind === "spawn" && entry.handle !== undefined) {
      open.add(entry.handle);
    }
  }
  for (const op of ops) {
    if (op.op === "start" || op.op === "emit") {
      if (open.has(op.handle)) {
        // A second `start` refines the open row's payload; a second `emit` is
        // a born-closed point with nothing left to add.
        if (op.op === "start") changed = refineOpenRow(entries, op) || changed;
        continue;
      }
      open.add(op.handle);
      if (op.op === "start" && op.type === "tool") openStarts.set(op.handle, Date.parse(op.timestamp));
    }
    for (const entry of opToEntries({ entries, maxEntries: state.maxEntries }, op, openStarts)) {
      // Only spawn rows need the op handle back: tools join on `toolCallId`,
      // and every other row is a born-closed point nothing can refine.
      if (entry.kind === "spawn") entry.handle = op.handle;
      appendEntry(entries, entry, state.maxEntries);
      if (entry.kind === "tool_result" && entry.toolCallId !== undefined) openStarts.delete(`tool:${entry.toolCallId}`);
      if (entry.kind === "tool_call" && entry.toolCallId !== undefined) openStarts.set(`tool:${entry.toolCallId}`, entry.tsMs);
      changed = true;
    }
  }
  return changed ? { entries, maxEntries: state.maxEntries } : state;
}

/** A re-reported `start` on an open row: fold its payload into the row the
 * first `start` already opened. Tool rows take the real args (Claude names
 * them after opening with an empty input); a spawn row takes the model and
 * harness the later `spawn` announces. Returns whether the ledger changed. */
function refineOpenRow(
  entries: TrajectoryEntry[],
  op: Extract<ObservationOp, { op: "start" }>,
): boolean {
  const toolCallId = toolCallIdFromHandle(op.handle);
  if (toolCallId !== undefined) {
    const folded = foldToolReReport(entries, toolCallId, op.name, argText(op.input));
    if (folded === undefined) return false;
    entries[folded.index] = withModel(folded.row, op.model);
    return true;
  }
  const index = entries.findIndex((entry) => entry.handle === op.handle);
  const open = index === -1 ? undefined : entries[index];
  if (open === undefined) return false;
  // Only `input` replaces the detail; a bare model refine keeps the label.
  const detail = op.input === undefined ? open.detail : spawnIdentity(op);
  if (op.model === open.model && detail === open.detail) return false;
  entries[index] = withModel({ ...open, detail }, op.model);
  return true;
}

/** The one model-merge write: a re-reported `start`'s model wins when present. */
function withModel(row: TrajectoryEntry, model: string | undefined): TrajectoryEntry {
  return model === undefined || model === row.model ? row : { ...row, model };
}

/** Index of the open `tool_call` row for `toolCallId`, or undefined when the
 * call is closed or absent. Shared by both ledger feeders so the pairing rule
 * cannot drift: the newest row for the id decides, and only a `tool_call` can
 * still be open. */
function openToolRow(
  entries: readonly TrajectoryEntry[],
  toolCallId: string,
): number | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.toolCallId !== toolCallId) continue;
    return entry.kind === "tool_call" ? i : undefined;
  }
  return undefined;
}

/** The row a re-reported tool start folds into: the open row renamed and with
 * the real args, keeping the row's detail when the re-report carries none. */
function foldToolReReport(
  entries: readonly TrajectoryEntry[],
  toolCallId: string,
  label: string,
  args: string,
): { readonly index: number; readonly row: TrajectoryEntry } | undefined {
  const index = openToolRow(entries, toolCallId);
  if (index === undefined) return undefined;
  const open = entries[index];
  if (open === undefined || open.kind !== "tool_call") return undefined;
  return {
    index,
    row: { ...open, label, detail: args === "" ? open.detail : sanitizeDetail(args) },
  };
}
