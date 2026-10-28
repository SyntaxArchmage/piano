import { describe, expect, it } from "vitest";
import { agentEventExporter, type AgentEvent } from "@piano/harness";
import type { ObservationOp } from "@piano/logging";
import {
  applyObservationOps,
  applyTrajectoryEvent,
  emptyTrajectoryState,
  type TrajectoryEntry,
} from "../../packages/cli/src/trajectory.js";

/** The ledger the panel draws is the migration's contract: `AgentEvent` is
 * still the harness dialect and `applyTrajectoryEvent` still folds it, while
 * under `--langfuse` the same turns arrive as `ObservationOp` and
 * `applyObservationOps` draws them. Both paths must match these rows exactly —
 * comparing the two to each other alone would still pass if they were wrong in
 * the same way. */

const T = new Date("2026-10-28T10:00:00.000Z").toISOString();
const tsMs = Date.parse(T);

const workflow = {
  stageId: "loop.measure",
  invocationId: "measure@loop/iter-1",
  worker: "benchmark-worker",
  attempt: 2,
} as const;

/** A workflow-attributed turn: the spawn refines the attempt span, tools carry
 * the attempt as parent, and `done` speaks only the point fact. */
const attributed: readonly AgentEvent[] = [
  { type: "spawn", harness: "pi", model: "gpt-4o", skills: ["s1"], workflow },
  {
    type: "context",
    context: {
      systemPromptPath: "/sys.md",
      contextFilePaths: ["a.ts", "b.ts"],
      skills: ["s1"],
      userMessage: "run the benchmark",
    },
    workflow,
  },
  { type: "message_end", message: { role: "user", content: "run the benchmark" }, workflow },
  {
    type: "tool_execution_start",
    toolCallId: "c1",
    toolName: "bash",
    args: { command: "ls" },
    workflow,
  },
  {
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "bash",
    result: "a.ts",
    isError: false,
    workflow,
  },
  { type: "message_end", message: { role: "assistant", content: "measured 12.3" }, workflow },
  { type: "usage", usage: { input: 3, output: 2, cacheRead: 1 }, workflow },
  { type: "error", errorType: "ProviderError", message: "rate limited", workflow },
  {
    type: "retry",
    event: "scheduled",
    attempt: 1,
    nextAttempt: 2,
    totalAttempts: 3,
    delayMs: 1500,
    errorType: "ProviderError",
    message: "rate limited",
    workflow,
  },
  { type: "done", exitStatus: 0, sessionId: "s", transcriptPath: "/t", workflow },
];

const attributedLedger = [
  { kind: "spawn", label: "loop.measure #2", detail: "pi · benchmark-worker", model: "gpt-4o" },
  { kind: "context", label: "context", detail: "sys prompt · 2 files · 1 skill · user 17ch" },
  { kind: "user_message", label: "user", detail: "run the benchmark" },
  { kind: "tool_call", label: "bash", detail: '{"command":"ls"}', toolCallId: "c1" },
  { kind: "tool_result", label: "bash", detail: "a.ts", toolCallId: "c1", durationMs: 0 },
  { kind: "agent_message", label: "agent", detail: "measured 12.3" },
  { kind: "usage", label: "usage", detail: "↑3 ↓2 C1" },
  { kind: "error", label: "error", detail: "ProviderError: rate limited" },
  { kind: "done", label: "done", detail: "exit 0" },
] as const;

/** A turn no workflow attributes (the side agent): the spawn opens the agent
 * span and `done` closes it. */
const unattributed: readonly AgentEvent[] = [
  { type: "spawn", harness: "claude", model: "sonnet", skills: [] },
  { type: "message_end", message: { role: "user", content: "what changed?" } },
  { type: "tool_execution_start", toolCallId: "c2", toolName: "read", args: { path: "a.ts" } },
  {
    type: "tool_execution_end",
    toolCallId: "c2",
    toolName: "read",
    result: "export const a = 1;",
    isError: false,
  },
  { type: "message_end", message: { role: "assistant", content: "one export." } },
  { type: "done", exitStatus: 0, sessionId: "s", transcriptPath: "/t" },
];

const unattributedLedger = [
  { kind: "spawn", label: "agent", detail: "claude", model: "sonnet" },
  { kind: "user_message", label: "user", detail: "what changed?" },
  { kind: "tool_call", label: "read", detail: '{"path":"a.ts"}', toolCallId: "c2" },
  {
    kind: "tool_result",
    label: "read",
    detail: "export const a = 1;",
    toolCallId: "c2",
    durationMs: 0,
  },
  { kind: "agent_message", label: "agent", detail: "one export." },
  { kind: "done", label: "done", detail: "exit 0" },
] as const;

/** The comparable shape of a row: identity and content, not the wall clock or
 * the op handle that only the ops path carries. */
function shape(entry: TrajectoryEntry) {
  const { seq: _seq, tsMs: _tsMs, handle: _handle, ...rest } = entry;
  return rest;
}

function fromEvents(stream: readonly AgentEvent[]): readonly TrajectoryEntry[] {
  let state = emptyTrajectoryState();
  for (const event of stream) state = applyTrajectoryEvent(state, event, tsMs);
  return state.entries;
}

function fromOps(stream: readonly AgentEvent[]): readonly TrajectoryEntry[] {
  const ops: ObservationOp[] = [];
  const emit = agentEventExporter((batch) => ops.push(...batch), () => T);
  for (const event of stream) emit(event);
  return applyObservationOps(emptyTrajectoryState(), ops).entries;
}

describe("trajectory vocabulary parity", () => {
  it("draws the recorded ledger from AgentEvent", () => {
    expect(fromEvents(attributed).map(shape)).toEqual(attributedLedger);
    expect(fromEvents(unattributed).map(shape)).toEqual(unattributedLedger);
  });

  it("draws the same recorded ledger from the bridged ops", () => {
    expect(fromOps(attributed).map(shape)).toEqual(attributedLedger);
    expect(fromOps(unattributed).map(shape)).toEqual(unattributedLedger);
  });
});
