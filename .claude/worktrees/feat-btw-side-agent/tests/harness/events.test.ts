import { describe, expect, it } from "vitest";
import { asAgentMessage, asAgentMessageEvent, eventMetadata, messageText, textDelta, type AgentContext, type AgentMessage, type AgentMessageEvent, type AgentUsage } from "../../packages/harness/src/index.js";

describe("harness message helpers", () => {
  it("wraps revoked proxy values without throwing", () => {
    const messageProxy = Proxy.revocable({ role: "assistant" }, {});
    const eventProxy = Proxy.revocable({ type: "text_delta" }, {});
    messageProxy.revoke();
    eventProxy.revoke();

    const message = asAgentMessage(messageProxy.proxy);
    const event = asAgentMessageEvent(eventProxy.proxy);

    expect(message.value).toBe(messageProxy.proxy);
    expect(event.value).toBe(eventProxy.proxy);
  });

  it("preserves text from strings and content parts", () => {
    expect(messageText({ content: "hello" })).toBe("hello");
    expect(messageText({ content: [{ text: "hello " }, { text: "world" }] })).toBe("hello world");
  });

  it("reads message content once when building metadata", () => {
    let reads = 0;
    const message: AgentMessage = {};
    Object.defineProperty(message, "content", {
      get: () => {
        reads += 1;
        return "hello";
      },
    });

    expect(eventMetadata({ type: "message_end", message })).toEqual({
      eventType: "message_end",
      textLength: 5,
    });
    expect(reads).toBe(1);
  });

  it("keeps base metadata when resource keys cannot be read", () => {
    const resource = new Proxy({ kind: "skill" as const, status: "loaded" as const }, {
      ownKeys: () => { throw new Error("resource keys unavailable"); },
    });

    expect(eventMetadata({ type: "resource", resource })).toEqual({
      eventType: "resource",
    });
  });

  it("keeps base metadata when spawn skills cannot be read", () => {
    const event = { type: "spawn" as const, harness: "pi", skills: [] as string[] };
    Object.defineProperty(event, "skills", {
      get: () => { throw new Error("spawn skills unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "spawn",
    });
  });

  it("keeps base metadata when spawn harness cannot be read", () => {
    const event = { type: "spawn" as const, harness: "pi", skills: [] as string[] };
    Object.defineProperty(event, "harness", {
      get: () => { throw new Error("spawn harness unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "spawn",
    });
  });

  it("keeps base metadata when agent messages cannot be read", () => {
    const event = { type: "agent_end" as const, messages: [], willRetry: false };
    Object.defineProperty(event, "messages", {
      get: () => { throw new Error("agent messages unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "agent_end",
    });
  });

  it("keeps base metadata when agent retry status cannot be read", () => {
    const event = { type: "agent_end" as const, messages: [], willRetry: false };
    Object.defineProperty(event, "willRetry", {
      get: () => { throw new Error("agent retry status unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "agent_end",
    });
  });

  it("keeps base metadata when turn message cannot be read", () => {
    const event = { type: "turn_end" as const, message: {}, toolResults: [] };
    Object.defineProperty(event, "message", {
      get: () => { throw new Error("turn message unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "turn_end",
    });
  });

  it("keeps base metadata when turn results cannot be read", () => {
    const event = { type: "turn_end" as const, message: {}, toolResults: [] };
    Object.defineProperty(event, "toolResults", {
      get: () => { throw new Error("turn results unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "turn_end",
    });
  });

  it("records queued steering and follow-up counts", () => {
    expect(eventMetadata({ type: "queue_update", steering: ["a"], followUp: ["b", "c"] })).toEqual({
      eventType: "queue_update",
      steeringCount: 1,
      followUpCount: 2,
    });
  });

  it("keeps base metadata when queued steering cannot be read", () => {
    const event = { type: "queue_update" as const, steering: [], followUp: [] };
    Object.defineProperty(event, "steering", {
      get: () => { throw new Error("queued steering unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "queue_update",
    });
  });

  it("keeps base metadata when queued follow-up cannot be read", () => {
    const event = { type: "queue_update" as const, steering: [], followUp: [] };
    Object.defineProperty(event, "followUp", {
      get: () => { throw new Error("queued follow-up unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "queue_update",
    });
  });

  it("reads a session name once when building metadata", () => {
    let reads = 0;
    const event = { type: "session_info_changed" as const, name: "run-name" };
    Object.defineProperty(event, "name", {
      get: () => {
        reads += 1;
        return "run-name";
      },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "session_info_changed",
      name: "run-name",
    });
    expect(reads).toBe(1);
  });

  it("keeps base metadata when a session name cannot be read", () => {
    const event = { type: "session_info_changed" as const, name: "run-name" };
    Object.defineProperty(event, "name", {
      get: () => { throw new Error("session name unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "session_info_changed",
    });
  });

  it("records a changed thinking level", () => {
    expect(eventMetadata({ type: "thinking_level_changed", level: "high" })).toEqual({
      eventType: "thinking_level_changed",
      level: "high",
    });
  });

  it("keeps base metadata when a thinking level cannot be read", () => {
    const event = { type: "thinking_level_changed" as const, level: "high" };
    Object.defineProperty(event, "level", {
      get: () => { throw new Error("thinking level unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "thinking_level_changed",
    });
  });

  it("records compaction completion metadata", () => {
    expect(eventMetadata({
      type: "compaction_end",
      reason: "threshold",
      result: { summary: "done" },
      aborted: false,
      willRetry: true,
      errorMessage: "retrying",
    })).toEqual({
      eventType: "compaction_end",
      reason: "threshold",
      aborted: false,
      willRetry: true,
      errorMessage: "retrying",
    });
  });

  it("keeps base metadata when compaction completion cannot be read", () => {
    const event = {
      type: "compaction_end" as const,
      reason: "threshold",
      result: { summary: "done" },
      aborted: false,
      willRetry: false,
    };
    Object.defineProperty(event, "reason", {
      get: () => { throw new Error("compaction reason unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "compaction_end",
    });
  });

  it("records auto-retry completion metadata", () => {
    expect(eventMetadata({
      type: "auto_retry_end",
      success: false,
      attempt: 2,
      finalError: "still busy",
    })).toEqual({
      eventType: "auto_retry_end",
      success: false,
      attempt: 2,
      finalError: "still busy",
    });
  });

  it("keeps base metadata when auto-retry completion cannot be read", () => {
    const event = {
      type: "auto_retry_end" as const,
      success: false,
      attempt: 2,
      finalError: "still busy",
    };
    Object.defineProperty(event, "finalError", {
      get: () => { throw new Error("retry error unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "auto_retry_end",
    });
  });

  it("records a summarization retry attempt", () => {
    expect(eventMetadata({
      type: "summarization_retry_attempt_start",
      source: "compaction",
      reason: "threshold",
    })).toEqual({
      eventType: "summarization_retry_attempt_start",
      source: "compaction",
      reason: "threshold",
    });
  });

  it("keeps base metadata when a summarization retry reason cannot be read", () => {
    const event = {
      type: "summarization_retry_attempt_start" as const,
      source: "compaction",
      reason: "threshold",
    };
    Object.defineProperty(event, "reason", {
      get: () => { throw new Error("retry reason unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "summarization_retry_attempt_start",
    });
  });

  it("records a scheduled summarization retry", () => {
    expect(eventMetadata({
      type: "summarization_retry_scheduled",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 250,
      errorMessage: "busy",
    })).toEqual({
      eventType: "summarization_retry_scheduled",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 250,
      errorMessage: "busy",
    });
  });

  it("keeps base metadata when a scheduled retry error cannot be read", () => {
    const event = {
      type: "summarization_retry_scheduled" as const,
      attempt: 1,
      maxAttempts: 3,
      delayMs: 250,
      errorMessage: "busy",
    };
    Object.defineProperty(event, "errorMessage", {
      get: () => { throw new Error("scheduled retry error unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "summarization_retry_scheduled",
    });
  });

  it("records an auto-retry start", () => {
    expect(eventMetadata({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: "busy",
    })).toEqual({
      eventType: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: "busy",
    });
  });

  it("keeps base metadata when an auto-retry error cannot be read", () => {
    const event = {
      type: "auto_retry_start" as const,
      attempt: 1,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: "busy",
    };
    Object.defineProperty(event, "errorMessage", {
      get: () => { throw new Error("auto-retry error unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "auto_retry_start",
    });
  });

  it("records a compaction start reason", () => {
    expect(eventMetadata({ type: "compaction_start", reason: "threshold" })).toEqual({
      eventType: "compaction_start",
      reason: "threshold",
    });
  });

  it("keeps base metadata when a compaction reason cannot be read", () => {
    const event = { type: "compaction_start" as const, reason: "threshold" };
    Object.defineProperty(event, "reason", {
      get: () => { throw new Error("compaction start reason unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "compaction_start",
    });
  });

  it("records metadata for an unknown event", () => {
    expect(eventMetadata({ type: "unknown", sourceType: "future_event", data: { value: true } })).toEqual({
      eventType: "unknown",
      sourceType: "future_event",
    });
  });

  it("keeps base metadata when an unknown source type cannot be read", () => {
    const event = { type: "unknown" as const, sourceType: "future_event", data: {} };
    Object.defineProperty(event, "sourceType", {
      get: () => { throw new Error("unknown source type unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "unknown",
    });
  });

  it("records error metadata", () => {
    expect(eventMetadata({ type: "error", errorType: "request-rejected", message: "busy" })).toEqual({
      eventType: "error",
      errorType: "request-rejected",
      message: "busy",
    });
  });

  it("keeps base metadata when an error message cannot be read", () => {
    const event = { type: "error" as const, errorType: "request-rejected", message: "busy" };
    Object.defineProperty(event, "message", {
      get: () => { throw new Error("error message unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "error",
    });
  });

  it("records done metadata", () => {
    expect(eventMetadata({
      type: "done",
      exitStatus: 0,
      sessionId: "session-1",
      transcriptPath: "/tmp/session.jsonl",
    })).toEqual({
      eventType: "done",
      exitStatus: 0,
      sessionId: "session-1",
      transcriptPath: "/tmp/session.jsonl",
    });
  });

  it("keeps base metadata when a done transcript path cannot be read", () => {
    const event = {
      type: "done" as const,
      exitStatus: 0,
      sessionId: "session-1",
      transcriptPath: "/tmp/session.jsonl",
    };
    Object.defineProperty(event, "transcriptPath", {
      get: () => { throw new Error("done transcript unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "done",
    });
  });

  it("treats a throwing content getter as unavailable", () => {
    const message: AgentMessage = {};
    Object.defineProperty(message, "content", {
      get: () => { throw new Error("content unavailable"); },
    });

    expect(messageText(message)).toBeUndefined();
    expect(() => eventMetadata({ type: "message_end", message })).not.toThrow();
    expect(eventMetadata({ type: "message_end", message })).toEqual({ eventType: "message_end" });
  });

  it("treats a throwing role getter as unavailable", () => {
    const message: AgentMessage = { content: "hello" };
    Object.defineProperty(message, "role", {
      get: () => { throw new Error("role unavailable"); },
    });

    expect(eventMetadata({ type: "message_end", message })).toEqual({
      eventType: "message_end",
      textLength: 5,
    });
  });

  it("treats a throwing assistant event type as unavailable", () => {
    const assistantMessageEvent: AgentMessageEvent = { delta: "hello" };
    Object.defineProperty(assistantMessageEvent, "type", {
      get: () => { throw new Error("assistant event type unavailable"); },
    });

    const metadata = eventMetadata({
      type: "message_update",
      message: { content: "partial" },
      assistantMessageEvent,
    });
    expect(metadata.assistantEventType).toBeUndefined();
    expect(metadata.deltaLength).toBe(5);
  });

  it("records the assistant event type and delta length", () => {
    expect(eventMetadata({
      type: "message_update",
      message: { content: "partial" },
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
    })).toMatchObject({
      eventType: "message_update",
      assistantEventType: "text_delta",
      deltaLength: 5,
    });
  });

  it("treats a throwing assistant event delta as unavailable", () => {
    const assistantMessageEvent: AgentMessageEvent = { type: "text_delta" };
    Object.defineProperty(assistantMessageEvent, "delta", {
      get: () => { throw new Error("assistant event delta unavailable"); },
    });

    const metadata = eventMetadata({
      type: "message_update",
      message: { content: "partial" },
      assistantMessageEvent,
    });
    expect(metadata.assistantEventType).toBe("text_delta");
    expect(metadata.deltaLength).toBeUndefined();
  });

  it("returns a text delta for a text update", () => {
    expect(textDelta({
      type: "message_update",
      message: { content: "partial" },
      assistantMessageEvent: { type: "text_delta", delta: "hello" },
    })).toBe("hello");
  });

  it("treats a throwing text delta type as unavailable", () => {
    const assistantMessageEvent: AgentMessageEvent = { delta: "hello" };
    Object.defineProperty(assistantMessageEvent, "type", {
      get: () => { throw new Error("text delta type unavailable"); },
    });

    expect(textDelta({
      type: "message_update",
      message: { content: "partial" },
      assistantMessageEvent,
    })).toBeUndefined();
  });

  it("treats a throwing text delta value as unavailable", () => {
    const assistantMessageEvent: AgentMessageEvent = { type: "text_delta" };
    Object.defineProperty(assistantMessageEvent, "delta", {
      get: () => { throw new Error("text delta unavailable"); },
    });

    expect(textDelta({
      type: "message_update",
      message: { content: "partial" },
      assistantMessageEvent,
    })).toBeUndefined();
  });

  it("records bash update delta length once", () => {
    let reads = 0;
    const event = { type: "bash_execution_update" as const, id: "bash-1", delta: "done" };
    Object.defineProperty(event, "delta", {
      get: () => {
        reads += 1;
        return "done";
      },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "bash_execution_update",
      id: "bash-1",
      deltaLength: 4,
    });
    expect(reads).toBe(1);
  });

  it("preserves an empty bash update delta length", () => {
    expect(eventMetadata({ type: "bash_execution_update", delta: "", id: "bash-1" })).toEqual({
      eventType: "bash_execution_update",
      id: "bash-1",
      deltaLength: 0,
    });
  });

  it("treats a throwing bash update delta as unavailable", () => {
    const event = { type: "bash_execution_update" as const, id: "bash-1", delta: "done" };
    Object.defineProperty(event, "delta", {
      get: () => { throw new Error("bash delta unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "bash_execution_update",
      id: "bash-1",
    });
  });

  it("reads an assistant event delta only once", () => {
    let reads = 0;
    const assistantMessageEvent: AgentMessageEvent = { type: "text_delta" };
    Object.defineProperty(assistantMessageEvent, "delta", {
      get: () => {
        reads += 1;
        if (reads > 1) throw new Error("assistant event delta read twice");
        return "hello";
      },
    });

    expect(eventMetadata({
      type: "message_update",
      message: { content: "partial" },
      assistantMessageEvent,
    }).deltaLength).toBe(5);
    expect(reads).toBe(1);
  });

  it("keeps context metadata while reading the system prompt path once", () => {
    let reads = 0;
    const context = { contextFilePaths: ["/context.md"], skills: ["skill"] };
    Object.defineProperty(context, "systemPromptPath", {
      get: () => {
        reads += 1;
        return "/system-prompt.md";
      },
    });

    expect(eventMetadata({ type: "context", context })).toEqual({
      eventType: "context",
      systemPromptPath: "/system-prompt.md",
      contextFilePaths: ["/context.md"],
      skillCount: 1,
    });
    expect(reads).toBe(1);
  });

  it("treats a throwing system prompt path as unavailable", () => {
    const context = { contextFilePaths: ["/context.md"], skills: ["skill"] };
    Object.defineProperty(context, "systemPromptPath", {
      get: () => { throw new Error("system prompt path unavailable"); },
    });

    expect(eventMetadata({ type: "context", context })).toEqual({
      eventType: "context",
      contextFilePaths: ["/context.md"],
      skillCount: 1,
    });
  });

  it("uses context-file fallback when its preferred path getter throws", () => {
    const context: AgentContext = {
      contextFiles: [{ path: "/fallback.md", content: "fallback" }],
      skills: ["skill"],
    };
    Object.defineProperty(context, "contextFilePaths", {
      get: () => { throw new Error("context file paths unavailable"); },
    });

    expect(eventMetadata({ type: "context", context })).toEqual({
      eventType: "context",
      contextFilePaths: ["/fallback.md"],
      skillCount: 1,
    });
  });

  it("uses an empty context-file list when both path sources are absent", () => {
    const context: AgentContext = {};
    Object.defineProperty(context, "contextFilePaths", {
      get: () => { throw new Error("context file paths unavailable"); },
    });

    expect(eventMetadata({ type: "context", context })).toEqual({
      eventType: "context",
      contextFilePaths: [],
      skillCount: 0,
    });
  });

  it("keeps context paths when the skills getter throws", () => {
    const context: AgentContext = {
      contextFilePaths: ["/context.md"],
      systemPromptPath: "/system-prompt.md",
    };
    Object.defineProperty(context, "skills", {
      get: () => { throw new Error("skills unavailable"); },
    });

    expect(eventMetadata({ type: "context", context })).toEqual({
      eventType: "context",
      systemPromptPath: "/system-prompt.md",
      contextFilePaths: ["/context.md"],
      skillCount: 0,
    });
  });

  it("uses an empty context-file list when the fallback getter throws", () => {
    const context: AgentContext = {
      systemPromptPath: "/system-prompt.md",
      skills: ["skill"],
    };
    Object.defineProperty(context, "contextFiles", {
      get: () => { throw new Error("context files unavailable"); },
    });

    expect(eventMetadata({ type: "context", context })).toEqual({
      eventType: "context",
      systemPromptPath: "/system-prompt.md",
      contextFilePaths: [],
      skillCount: 1,
    });
  });

  it("keeps event metadata when the workflow getter throws", () => {
    const event = { type: "agent_start" as const };
    Object.defineProperty(event, "workflow", {
      get: () => { throw new Error("workflow unavailable"); },
    });

    expect(eventMetadata(event)).toEqual({
      eventType: "agent_start",
    });
  });

  it("keeps workflow metadata when the stage getter throws", () => {
    const workflow = {
      stageId: "respond",
      invocationId: "respond-1",
      worker: "worker",
      attempt: 1,
    };
    Object.defineProperty(workflow, "stageId", {
      get: () => { throw new Error("stage unavailable"); },
    });

    expect(eventMetadata({ type: "agent_start", workflow })).toEqual({
      eventType: "agent_start",
      workflowInvocationId: "respond-1",
      workflowWorker: "worker",
      workflowAttempt: 1,
    });
  });

  it("keeps workflow metadata when the invocation getter throws", () => {
    const workflow = {
      stageId: "respond",
      invocationId: "respond-1",
      worker: "worker",
      attempt: 1,
    };
    Object.defineProperty(workflow, "invocationId", {
      get: () => { throw new Error("invocation unavailable"); },
    });

    expect(eventMetadata({ type: "agent_start", workflow })).toEqual({
      eventType: "agent_start",
      workflowStageId: "respond",
      workflowWorker: "worker",
      workflowAttempt: 1,
    });
  });

  it("keeps workflow metadata when the worker getter throws", () => {
    const workflow = {
      stageId: "respond",
      invocationId: "respond-1",
      worker: "worker",
      attempt: 1,
    };
    Object.defineProperty(workflow, "worker", {
      get: () => { throw new Error("worker unavailable"); },
    });

    expect(eventMetadata({ type: "agent_start", workflow })).toEqual({
      eventType: "agent_start",
      workflowStageId: "respond",
      workflowInvocationId: "respond-1",
      workflowAttempt: 1,
    });
  });

  it("keeps workflow metadata when the workspace key getter throws", () => {
    const workflow = {
      stageId: "respond",
      invocationId: "respond-1",
      worker: "worker",
      attempt: 1,
    };
    Object.defineProperty(workflow, "workspaceKey", {
      get: () => { throw new Error("workspace key unavailable"); },
    });

    expect(eventMetadata({ type: "agent_start", workflow })).toEqual({
      eventType: "agent_start",
      workflowStageId: "respond",
      workflowInvocationId: "respond-1",
      workflowWorker: "worker",
      workflowAttempt: 1,
    });
  });

  it("reads the workspace cwd getter once", () => {
    let reads = 0;
    const workflow = {
      stageId: "respond",
      invocationId: "respond-1",
      worker: "worker",
      attempt: 1,
      workspaceKey: "root",
    };
    Object.defineProperty(workflow, "workspaceCwd", {
      get: () => {
        reads += 1;
        return "/tmp/workspace";
      },
    });

    expect(eventMetadata({ type: "agent_start", workflow })).toMatchObject({
      eventType: "agent_start",
      workflowWorkspaceCwd: "/tmp/workspace",
      workflowWorkspaceKey: "root",
    });
    expect(reads).toBe(1);
  });

  it("keeps workflow metadata when the workspace cwd getter throws", () => {
    const workflow = {
      stageId: "respond",
      invocationId: "respond-1",
      worker: "worker",
      attempt: 1,
      workspaceKey: "root",
    };
    Object.defineProperty(workflow, "workspaceCwd", {
      get: () => { throw new Error("workspace cwd unavailable"); },
    });

    expect(eventMetadata({ type: "agent_start", workflow })).toEqual({
      eventType: "agent_start",
      workflowStageId: "respond",
      workflowInvocationId: "respond-1",
      workflowWorker: "worker",
      workflowAttempt: 1,
      workflowWorkspaceKey: "root",
    });
  });

  it("reads the workspace record path getter once", () => {
    let reads = 0;
    const workflow = {
      stageId: "respond",
      invocationId: "respond-1",
      worker: "worker",
      attempt: 1,
    };
    Object.defineProperty(workflow, "workspaceRecordPath", {
      get: () => {
        reads += 1;
        return "/tmp/workspace.json";
      },
    });

    expect(eventMetadata({ type: "agent_start", workflow })).toMatchObject({
      eventType: "agent_start",
      workflowWorkspaceRecordPath: "/tmp/workspace.json",
    });
    expect(reads).toBe(1);
  });

  it("keeps workflow metadata when the workspace record path getter throws", () => {
    const workflow = {
      stageId: "respond",
      invocationId: "respond-1",
      worker: "worker",
      attempt: 1,
      workspaceKey: "root",
    };
    Object.defineProperty(workflow, "workspaceRecordPath", {
      get: () => { throw new Error("workspace record path unavailable"); },
    });

    expect(eventMetadata({ type: "agent_start", workflow })).toEqual({
      eventType: "agent_start",
      workflowStageId: "respond",
      workflowInvocationId: "respond-1",
      workflowWorker: "worker",
      workflowAttempt: 1,
      workflowWorkspaceKey: "root",
    });
  });

  it("keeps workflow metadata when the attempt getter throws", () => {
    const workflow = {
      stageId: "respond",
      invocationId: "respond-1",
      worker: "worker",
      attempt: 1,
      workspaceKey: "root",
    };
    Object.defineProperty(workflow, "attempt", {
      get: () => { throw new Error("attempt unavailable"); },
    });

    expect(eventMetadata({ type: "agent_start", workflow })).toEqual({
      eventType: "agent_start",
      workflowStageId: "respond",
      workflowInvocationId: "respond-1",
      workflowWorker: "worker",
      workflowWorkspaceKey: "root",
    });
  });

  it("treats a throwing content-part text getter as unavailable", () => {
    const part: Record<string, unknown> = {};
    Object.defineProperty(part, "text", {
      get: () => { throw new Error("part text unavailable"); },
    });

    expect(messageText({ content: [part] })).toBeUndefined();
  });

  it("keeps readable content parts when another part getter throws", () => {
    const throwing: Record<string, unknown> = {};
    Object.defineProperty(throwing, "text", {
      get: () => { throw new Error("part text unavailable"); },
    });

    expect(messageText({ content: [{ text: "hello " }, throwing, { text: "world" }] })).toBe("hello world");
  });

  it("keeps usage metadata safe when a provider exposes throwing values", () => {
    expect(eventMetadata({ type: "usage", usage: { input: 120, output: 80 } })).toMatchObject({
      eventType: "usage",
      input: 120,
      output: 80,
    });

    const throwing: AgentUsage = {};
    Object.defineProperty(throwing, "input", {
      enumerable: true,
      get: () => { throw new Error("usage unavailable"); },
    });
    expect(eventMetadata({ type: "usage", usage: throwing })).toEqual({ eventType: "usage" });

    const brokenProxy = new Proxy({}, { ownKeys: () => { throw new Error("usage keys unavailable"); } }) as AgentUsage;
    expect(eventMetadata({ type: "usage", usage: brokenProxy })).toEqual({ eventType: "usage" });
  });
});
