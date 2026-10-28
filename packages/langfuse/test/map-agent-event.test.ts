import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@piano/harness";
import {
  advanceAgentEventContext,
  mapAgentEvent,
  type AgentEventExportContext,
} from "../src/map-agent-event.js";

const T = "2026-10-28T10:00:00.000Z";

const workflow = {
  stageId: "loop.measure",
  invocationId: "measure@loop/iter-1",
  worker: "benchmark-worker",
  attempt: 2,
} as const;

const context: AgentEventExportContext = {
  model: "test-model",
  usageDetails: { input: 3, output: 2, total: 5 },
  sequence: 0,
};

describe("mapAgentEvent", () => {
  it("exports an assistant message_end as a generation under its attempt", () => {
    const event: AgentEvent = {
      type: "message_end",
      message: { role: "assistant", content: "measured 12.3" },
      workflow,
    };
    expect(mapAgentEvent(event, context, T)).toEqual([{
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

  it("skips user messages and high-frequency update events", () => {
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
    expect(mapAgentEvent(user, context, T)).toEqual([]);
    expect(mapAgentEvent(update, context, T)).toEqual([]);
    expect(mapAgentEvent(toolUpdate, context, T)).toEqual([]);
  });

  it("skips tool executions already exported as tool_call workflow observations", () => {
    const started: AgentEvent = {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "ls" },
      workflow,
    };
    expect(mapAgentEvent(started, context, T)).toEqual([]);
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
    expect(mapAgentEvent(error, context, T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "err:0:measure@loop/iter-1:2",
      op: "emit",
      type: "event",
      name: "agent.error",
      metadata: expect.objectContaining({ errorType: "ProviderError", message: "rate limited" }),
    }]);
    expect(mapAgentEvent(done, context, T)).toEqual([{
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

describe("advanceAgentEventContext", () => {
  it("carries spawn model and usage counters into the next message, then clears them", () => {
    let state: AgentEventExportContext = { sequence: 0 };
    state = advanceAgentEventContext({
      type: "spawn",
      harness: "pi",
      model: "test-model",
      skills: [],
    }, state);
    expect(state.model).toBe("test-model");

    state = advanceAgentEventContext({
      type: "usage",
      usage: { input: 3, output: 2, totalTokens: 5 },
    }, state);
    expect(state.usageDetails).toEqual({ input: 3, output: 2, total: 5 });

    state = advanceAgentEventContext({
      type: "message_end",
      message: { role: "assistant", content: "done" },
    }, state);
    expect(state.sequence).toBe(1);
    expect(state.usageDetails).toBeUndefined();
    expect(state.model).toBe("test-model");
  });
});
