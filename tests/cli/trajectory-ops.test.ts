import { describe, expect, it } from "vitest";
import type { ObservationOp } from "@piano/logging";
import { applyObservationOps, emptyTrajectoryState } from "../../packages/cli/src/trajectory.js";

const T = (ms: number) => new Date(ms).toISOString();

function start(over: Partial<Extract<ObservationOp, { op: "start" }>> = {}): Extract<ObservationOp, { op: "start" }> {
  return {
    version: 1,
    timestamp: T(1_000),
    handle: "attempt:measure@loop/iter-1:1",
    op: "start",
    type: "agent",
    name: "stage.attempt:loop.measure",
    ...over,
  };
}

describe("applyObservationOps", () => {
  it("folds an attempt, a tool pair, and an agent message into the ledger", () => {
    const state = applyObservationOps(emptyTrajectoryState(), [
      start({
        input: { stageId: "loop.measure", attempt: 1 },
        metadata: { worker: "benchmark-worker", invocationId: "measure@loop/iter-2" },
      }),
      {
        version: 1,
        timestamp: T(1_100),
        handle: "tool:call-1",
        op: "start",
        type: "tool",
        name: "bash",
        parent: "attempt:measure@loop/iter-1:1",
      },
      {
        version: 1,
        timestamp: T(1_400),
        handle: "tool:call-1",
        op: "end",
        level: "DEFAULT",
        metadata: { toolName: "bash" },
      },
      {
        version: 1,
        timestamp: T(1_500),
        handle: "msg:0:measure@loop/iter-1:1",
        op: "emit",
        type: "generation",
        name: "assistant.message",
        output: { role: "assistant", text: "measured 12.3\nmore" },
      },
    ]);

    expect(state.entries.map((entry) => entry.kind)).toEqual([
      "spawn",
      "tool_call",
      "tool_result",
      "agent_message",
    ]);
    expect(state.entries[0]).toMatchObject({ label: "loop.measure #3", detail: "benchmark-worker" });
    expect(state.entries[1]).toMatchObject({ label: "bash", toolCallId: "call-1" });
    expect(state.entries[2]).toMatchObject({ label: "bash", detail: "ok", toolCallId: "call-1" });
    expect(state.entries[3]).toMatchObject({ label: "agent", detail: "measured 12.3" });
  });

  it("folds user turns, errors, done, and usage the way the AgentEvent reducer does", () => {
    const state = applyObservationOps(emptyTrajectoryState(), [
      {
        version: 1,
        timestamp: T(1),
        handle: "user:0:root:0",
        op: "emit",
        type: "event",
        name: "user.message",
        output: { role: "user", text: "run the benchmark" },
      },
      {
        version: 1,
        timestamp: T(2),
        handle: "attempt:a:1",
        op: "update",
        usageDetails: { input: 3, output: 2, cacheRead: 1 },
      },
      {
        version: 1,
        timestamp: T(3),
        handle: "err:0:root:0",
        op: "emit",
        type: "event",
        name: "agent.error",
        metadata: { errorType: "ProviderError", message: "rate limited" },
      },
      {
        version: 1,
        timestamp: T(4),
        handle: "done:root:0",
        op: "emit",
        type: "event",
        name: "agent.done",
        metadata: { exitStatus: 0 },
      },
    ]);

    expect(state.entries.map((entry) => entry.kind)).toEqual([
      "user_message",
      "usage",
      "error",
      "done",
    ]);
    expect(state.entries[0]).toMatchObject({ label: "user", detail: "run the benchmark" });
    expect(state.entries[1]).toMatchObject({ detail: "↑3 ↓2 C1" });
    expect(state.entries[2]).toMatchObject({ detail: "ProviderError: rate limited" });
    expect(state.entries[3]).toMatchObject({ detail: "exit 0" });
  });

  it("drops structural ops that carry no single-action row", () => {
    const state = applyObservationOps(emptyTrajectoryState(), [
      start(),
      {
        version: 1,
        timestamp: T(2),
        handle: "accepted:a:1",
        op: "emit",
        type: "event",
        name: "stage.accepted",
        parent: "attempt:measure@loop/iter-1:1",
        metadata: { metrics: [] },
      },
    ]);
    expect(state.entries.map((entry) => entry.kind)).toEqual(["spawn"]);
  });
});
