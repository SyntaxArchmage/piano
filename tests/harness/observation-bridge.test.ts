import { describe, expect, it } from "vitest";
import {
  advanceBridgeContext,
  agentEventExporter,
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
  it("exports an assistant message_end as a generation span under its attempt", () => {
    const event: AgentEvent = {
      type: "message_end",
      message: { role: "assistant", content: "measured 12.3" },
      workflow,
    };
    expect(bridgeAgentEvent(event, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "msg:0:measure@loop/iter-1:2",
      op: "start",
      type: "generation",
      name: "assistant.message",
      parent: "attempt:measure@loop/iter-1:2",
      input: { role: "assistant" },
      model: "test-model",
      metadata: expect.objectContaining({
        role: "assistant",
        sequence: 0,
        invocationId: "measure@loop/iter-1",
        attempt: 2,
      }),
    }, {
      version: 1,
      timestamp: T,
      handle: "msg:0:measure@loop/iter-1:2",
      op: "end",
      name: "assistant.message",
      output: { role: "assistant", text: "measured 12.3" },
      metadata: expect.objectContaining({ role: "assistant", sequence: 0 }),
    }]);
  });

  it("opens the generation span when the harness starts streaming it", () => {
    const started: AgentEvent = {
      type: "message_start",
      message: { role: "assistant", content: "" },
      workflow,
    };
    expect(bridgeAgentEvent(started, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "msg:0:measure@loop/iter-1:2",
      op: "start",
      type: "generation",
      name: "assistant.message",
      parent: "attempt:measure@loop/iter-1:2",
      input: { role: "assistant" },
      model: "test-model",
      metadata: expect.objectContaining({ role: "assistant", sequence: 0 }),
    }]);
  });

  it("closes an already-open generation without restating its start", () => {
    const ended: AgentEvent = {
      type: "message_end",
      message: { role: "assistant", content: "measured 12.3" },
      workflow,
    };
    const open: BridgeContext = { ...context, messageSpanOpened: true };
    expect(bridgeAgentEvent(ended, open, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "msg:0:measure@loop/iter-1:2",
      op: "end",
      name: "assistant.message",
      output: { role: "assistant", text: "measured 12.3" },
      metadata: expect.objectContaining({ role: "assistant", sequence: 0 }),
    }]);
  });

  it("exports the retry boundary as its own point event", () => {
    const scheduled: AgentEvent = {
      type: "retry",
      event: "scheduled",
      attempt: 1,
      nextAttempt: 2,
      totalAttempts: 3,
      delayMs: 1500,
      errorType: "ProviderError",
      message: "rate limited",
      workflow,
    };
    expect(bridgeAgentEvent(scheduled, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "retry:0:measure@loop/iter-1:2",
      op: "emit",
      type: "event",
      name: "agent.retry",
      parent: "attempt:measure@loop/iter-1:2",
      metadata: expect.objectContaining({
        event: "scheduled",
        attempt: 1,
        nextAttempt: 2,
        totalAttempts: 3,
        delayMs: 1500,
      }),
    }]);
  });

  it("opens an agent span for a turn no workflow attributes", () => {
    const spawned: AgentEvent = {
      type: "spawn",
      harness: "pi",
      model: "gpt-4o",
      skills: ["s1"],
    };
    expect(bridgeAgentEvent(spawned, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "agent:0:root:0",
      op: "start",
      type: "agent",
      name: "agent",
      model: "gpt-4o",
      input: { harness: "pi", skills: ["s1"] },
      metadata: { sequence: 0 },
    }]);
  });

  it("exports tools for a turn no workflow mapper observes", () => {
    const started: AgentEvent = {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "ls" },
    };
    const ended: AgentEvent = {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "bash",
      result: "ok",
      isError: false,
    };
    expect(bridgeAgentEvent(started, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "tool:call-1",
      op: "start",
      type: "tool",
      name: "bash",
      input: { command: "ls" },
      metadata: expect.objectContaining({ toolCallId: "call-1", toolName: "bash" }),
    }]);
    expect(bridgeAgentEvent(ended, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "tool:call-1",
      op: "end",
      level: "DEFAULT",
      output: "ok",
      metadata: expect.objectContaining({ toolCallId: "call-1", toolName: "bash", isError: false }),
    }]);
  });

  it("closes the unattributed agent span at done and still speaks the done fact", () => {
    const done: AgentEvent = {
      type: "done",
      exitStatus: 0,
      sessionId: "session-1",
      transcriptPath: "/tmp/session-1.jsonl",
    };
    expect(bridgeAgentEvent(done, { ...context, agentSpanHandle: "agent:0:root:0" }, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "agent:0:root:0",
      op: "end",
      output: { exitStatus: 0 },
      metadata: expect.objectContaining({ exitStatus: 0 }),
    }, {
      version: 1,
      timestamp: T,
      handle: "done:root:0",
      op: "emit",
      type: "event",
      name: "agent.done",
      metadata: expect.objectContaining({ exitStatus: 0 }),
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
      handle: "msg:0:measure@loop/iter-1:2",
      op: "emit",
      type: "event",
      name: "user.message",
      parent: "attempt:measure@loop/iter-1:2",
      output: { role: "user", text: "go" },
      metadata: expect.objectContaining({ role: "user", sequence: 0 }),
    }]);
  });

  it("emits tool facts with the attempt as parent when the turn is attributed", () => {
    const started: AgentEvent = {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "ls" },
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
      input: { command: "ls" },
      metadata: expect.objectContaining({ toolCallId: "call-1", toolName: "bash" }),
    }]);
  });

  it("streams text deltas as display-only updates and still skips tool noise", () => {
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
    expect(bridgeAgentEvent(update, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "msg:0:measure@loop/iter-1:2",
      op: "update",
      output: { delta: "partial" },
      metadata: expect.objectContaining({ role: "assistant", sequence: 0 }),
    }]);
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

  it("refines the attempt with the harness and model the spawn announces", () => {
    const spawned: AgentEvent = {
      type: "spawn",
      harness: "pi",
      model: "gpt-4o",
      thinkingLevel: "high",
      skills: ["s1", "s2"],
      workflow,
    };
    expect(bridgeAgentEvent(spawned, context, () => T)).toEqual([{
      version: 1,
      timestamp: T,
      handle: "attempt:measure@loop/iter-1:2",
      op: "start",
      type: "agent",
      name: "stage.attempt:loop.measure",
      model: "gpt-4o",
      input: {
        stageId: "loop.measure",
        attempt: 2,
        harness: "pi",
        thinkingLevel: "high",
        skills: ["s1", "s2"],
      },
      metadata: expect.objectContaining({ worker: "benchmark-worker" }),
    }]);
  });

  it("exports what a turn loaded as a context event with counts only", () => {
    const loaded: AgentEvent = {
      type: "context",
      context: {
        systemPromptPath: "/sys.md",
        contextFilePaths: ["a.ts", "b.ts"],
        skills: ["s1"],
        userMessage: "hello world",
        contextFiles: [{ path: "a.ts", content: "secret" }],
      },
      workflow,
    };
    const ops = bridgeAgentEvent(loaded, context, () => T);
    expect(ops).toEqual([{
      version: 1,
      timestamp: T,
      handle: "ctx:0:measure@loop/iter-1:2",
      op: "emit",
      type: "event",
      name: "agent.context",
      parent: "attempt:measure@loop/iter-1:2",
      metadata: expect.objectContaining({
        systemPromptPath: "/sys.md",
        files: 2,
        skills: 1,
        userMessageLength: 11,
      }),
    }]);
    // File contents stay in the transcript, not on the op.
    expect(JSON.stringify(ops)).not.toContain("secret");
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

  it("opens the generation flag on message_start and closes it on message_end", () => {
    let state: BridgeContext = { sequence: 0 };
    state = advanceBridgeContext({
      type: "message_start",
      message: { role: "assistant", content: "" },
    }, state);
    expect(state.messageSpanOpened).toBe(true);

    state = advanceBridgeContext({
      type: "message_end",
      message: { role: "assistant", content: "done" },
    }, state);
    expect(state.messageSpanOpened).toBeUndefined();
    expect(state.sequence).toBe(1);
  });

  it("tracks an unattributed agent span from spawn to done", () => {
    let state: BridgeContext = { sequence: 0 };
    state = advanceBridgeContext({ type: "spawn", harness: "pi", skills: [] }, state);
    expect(state.agentSpanHandle).toBe("agent:0:root:0");

    state = advanceBridgeContext({
      type: "done",
      exitStatus: 0,
      sessionId: "s",
      transcriptPath: "/t",
    }, state);
    expect(state.agentSpanHandle).toBeUndefined();
  });
});

describe("agentEventExporter", () => {
  it("bridges then advances, so a turn's handles never interleave", () => {
    const batches: string[][] = [];
    const emit = agentEventExporter(
      (ops) => batches.push(ops.map((op) => `${op.op}:${op.handle}`)),
      () => T,
    );
    emit({ type: "spawn", harness: "pi", skills: [] });
    emit({ type: "message_end", message: { role: "assistant", content: "hi" } });
    expect(batches).toEqual([
      ["start:agent:0:root:0"],
      ["start:msg:0:root:0", "end:msg:0:root:0"],
    ]);
  });

});
