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
      name: "assistant.message",
      parent: "attempt:measure@loop/iter-1:2",
      input: { role: "assistant" },
      output: { role: "assistant", text: "measured 12.3" },
      model: "test-model",
      metadata: expect.objectContaining({
        role: "assistant",
        sequence: 0,
        invocationId: "measure@loop/iter-1",
        attempt: 2,
      }),
    }]);
  });

  it("emits a user turn as a point event so the chat ledger can fold from ops alone", () => {
    const user: AgentEvent = {
      type: "message_end",
      message: { role: "user", content: "go" },
      workflow,
    };
    expect(bridgeAgentEvent(user, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "user:0:measure@loop/iter-1:2",
      op: "emit",
      type: "event",
      name: "user.message",
      parent: "attempt:measure@loop/iter-1:2",
      output: { role: "user", text: "go" },
      metadata: expect.objectContaining({ role: "user", sequence: 0 }),
    }]);
  });

  it("emits tool executions as tool spans under their attempt", () => {
    const started: AgentEvent = {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "ls" },
      workflow,
    };
    const ended: AgentEvent = {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "bash",
      result: "ok",
      isError: true,
      workflow,
    };
    expect(bridgeAgentEvent(started, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "tool:call-1",
      op: "start",
      type: "tool",
      name: "bash",
      parent: "attempt:measure@loop/iter-1:2",
      metadata: expect.objectContaining({ toolCallId: "call-1", toolName: "bash" }),
    }]);
    expect(bridgeAgentEvent(ended, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "tool:call-1",
      op: "end",
      level: "ERROR",
      statusMessage: "tool failed",
      metadata: expect.objectContaining({ isError: true }),
    }]);
  });

  it("skips the high-frequency stream", () => {
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
    expect(bridgeAgentEvent(update, context, () => T)).toEqual([]);
    expect(bridgeAgentEvent(toolUpdate, context, () => T)).toEqual([]);
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
    // Usage is its own `agent.usage` op, not carried on the context.
    expect(state.model).toBe("test-model");

    state = advanceBridgeContext({
      type: "message_end",
      message: { role: "assistant", content: "done" },
    }, state);
    expect(state.sequence).toBe(1);
    expect(state.model).toBe("test-model");
  });
});
