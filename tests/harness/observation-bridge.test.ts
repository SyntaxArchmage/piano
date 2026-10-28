import { describe, expect, it } from "vitest";
import {
  advanceBridgeContext,
  bridgeAgentEvent,
  type AgentEvent,
  type BridgeContext,
} from "@piano/harness";

const T = "2026-10-28T10:00:00.000Z";

const workflow = {
  stageId: "loop.measure",
  invocationId: "measure@loop/iter-1",
  worker: "benchmark-worker",
  attempt: 2,
} as const;

const context: BridgeContext = {
  model: "test-model",
  usageDetails: { input: 3, output: 2, total: 5 },
  sequence: 0,
};

describe("bridgeAgentEvent", () => {
  it("exports an assistant message_end as a generation under its attempt", () => {
    const event: AgentEvent = {
      type: "message_end",
      message: { role: "assistant", content: "measured 12.3" },
      workflow,
    };
    expect(bridgeAgentEvent(event, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "msg:0:measure@loop/iter-1:2",
      op: "emit",
      type: "generation",
      name: "agent.message",
      parent: "attempt:measure@loop/iter-1:2",
      input: { role: "assistant" },
      output: { role: "assistant", text: "measured 12.3" },
      model: "test-model",
      usageDetails: { input: 3, output: 2, total: 5 },
      metadata: expect.objectContaining({
        role: "assistant",
        sequence: 0,
        invocationId: "measure@loop/iter-1",
        attempt: 2,
      }),
    }]);
  });

  it("keeps working from the AgentEvent dialect and skips the high-frequency stream", () => {
    const user: AgentEvent = {
      type: "message_end",
      message: { role: "user", content: "go" },
      workflow,
    };
    const update: AgentEvent = {
      type: "message_update",
      message: { role: "assistant", content: "partial" },
      assistantMessageEvent: { type: "text_delta", delta: "partial" },
      workflow,
    };
    const toolUpdate: AgentEvent = {
      type: "tool_execution_update",
      toolCallId: "call-1",
      toolName: "bash",
      args: {},
      partialResult: "chunk",
      workflow,
    };
    const toolStart: AgentEvent = {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "ls" },
      workflow,
    };
    expect(bridgeAgentEvent(user, context, () => T)).toEqual([]);
    expect(bridgeAgentEvent(update, context, () => T)).toEqual([]);
    expect(bridgeAgentEvent(toolUpdate, context, () => T)).toEqual([]);
    // Tool executions already arrive as tool_call_* workflow observations.
    expect(bridgeAgentEvent(toolStart, context, () => T)).toEqual([]);
  });

  it("exports error and done as point events", () => {
    const error: AgentEvent = {
      type: "error",
      errorType: "ProviderError",
      message: "rate limited",
      workflow,
    };
    const done: AgentEvent = {
      type: "done",
      exitStatus: 0,
      sessionId: "session-1",
      transcriptPath: "/tmp/session-1.jsonl",
      workflow,
    };
    expect(bridgeAgentEvent(error, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "err:0:measure@loop/iter-1:2",
      op: "emit",
      type: "event",
      name: "agent.error",
      metadata: expect.objectContaining({ errorType: "ProviderError", message: "rate limited" }),
    }]);
    expect(bridgeAgentEvent(done, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "done:measure@loop/iter-1:2",
      op: "emit",
      type: "event",
      name: "agent.done",
      metadata: expect.objectContaining({ exitStatus: 0 }),
    }]);
  });
});

describe("advanceBridgeContext", () => {
  it("carries spawn model and usage counters into the next message, then clears them", () => {
    let state: BridgeContext = { sequence: 0 };
    state = advanceBridgeContext({
      type: "spawn",
      harness: "pi",
      model: "test-model",
      skills: [],
    }, state);
    expect(state.model).toBe("test-model");

    state = advanceBridgeContext({
      type: "usage",
      usage: { input: 3, output: 2, totalTokens: 5 },
    }, state);
    expect(state.usageDetails).toEqual({ input: 3, output: 2, total: 5 });

    state = advanceBridgeContext({
      type: "message_end",
      message: { role: "assistant", content: "done" },
    }, state);
    expect(state.sequence).toBe(1);
    expect(state.usageDetails).toBeUndefined();
    expect(state.model).toBe("test-model");
  });
});
