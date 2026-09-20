/** Harness-neutral event contract shared by every adapter. */

/** Pi's portable reasoning/thinking levels. The harness keeps this name
 * provider-neutral at the workflow boundary; Pi maps it to provider-specific
 * reasoning effort when the selected model supports it. */
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface AgentMessage {
  readonly role?: string;
  readonly [key: string]: unknown;
}

export interface AgentMessageEvent {
  readonly type?: string;
  readonly [key: string]: unknown;
}

export interface AgentContext {
  readonly systemPromptPath?: string;
  readonly contextFilePaths?: readonly string[];
  readonly systemPrompt?: string;
  readonly contextFiles?: readonly { readonly path: string; readonly content: string }[];
  readonly skills?: readonly string[];
  readonly userMessage?: string;
}

export type AgentResourceKind = "system-prompt" | "context-file" | "skill";

export interface AgentResourceInfo {
  readonly kind: AgentResourceKind;
  readonly status: "requested" | "loaded" | "failed";
  readonly path?: string;
  readonly source?: "workflow" | "sdk-default";
  readonly name?: string;
  readonly bytes?: number;
  readonly error?: string;
}

export interface AgentResourceEvent {
  readonly type: "resource";
  readonly resource: AgentResourceInfo;
}

export interface AgentUsage {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly cacheWrite1h?: number;
  readonly reasoning?: number;
  readonly totalTokens?: number;
  readonly contextTokens?: number;
  readonly turns?: number;
  readonly cost?: unknown;
}

export interface AgentWorkflowMetadata {
  /** Logical stage that owns this event; supplied by the workflow executor. */
  readonly stageId: string;
  /** Concrete loop/map expansion that owns this event. */
  readonly invocationId: string;
  readonly worker: string;
  readonly attempt: number;
  /** Workspace attribution for every workflow invocation. Root/loop stages
   * use the shared caller workspace; map slots additionally carry a record. */
  readonly workspaceKey?: string;
  readonly workspaceCwd?: string;
  readonly workspaceRecordPath?: string;
}

type AgentEventPayload =
  | {
      readonly type: "spawn";
      readonly harness: string;
      readonly model?: string;
      readonly thinkingLevel?: ThinkingLevel;
      readonly skills: readonly string[];
      readonly memory?: string;
    }
  | { readonly type: "context"; readonly context: AgentContext }
  | AgentResourceEvent
  | { readonly type: "agent_start" }
  | {
      readonly type: "agent_end";
      readonly messages: readonly AgentMessage[];
      readonly willRetry: boolean;
    }
  | { readonly type: "agent_settled" }
  | { readonly type: "turn_start" }
  | {
      readonly type: "turn_end";
      readonly message: AgentMessage;
      readonly toolResults: readonly AgentMessage[];
    }
  | { readonly type: "message_start"; readonly message: AgentMessage }
  | {
      readonly type: "message_update";
      readonly message: AgentMessage;
      readonly assistantMessageEvent: AgentMessageEvent;
    }
  | { readonly type: "message_end"; readonly message: AgentMessage }
  | {
      readonly type: "tool_execution_start";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly args: unknown;
    }
  | {
      readonly type: "tool_execution_update";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly args: unknown;
      readonly partialResult: unknown;
    }
  | {
      readonly type: "tool_execution_end";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly result: unknown;
      readonly isError: boolean;
    }
  | { readonly type: "usage"; readonly usage: AgentUsage }
  | {
      readonly type: "queue_update";
      readonly steering: readonly string[];
      readonly followUp: readonly string[];
    }
  | { readonly type: "compaction_start"; readonly reason: string }
  | { readonly type: "entry_appended"; readonly entry: unknown }
  | { readonly type: "session_info_changed"; readonly name: string | undefined }
  | { readonly type: "thinking_level_changed"; readonly level: string }
  | {
      readonly type: "compaction_end";
      readonly reason: string;
      readonly result: unknown;
      readonly aborted: boolean;
      readonly willRetry: boolean;
      readonly errorMessage?: string;
    }
  | {
      readonly type: "auto_retry_start";
      readonly attempt: number;
      readonly maxAttempts: number;
      readonly delayMs: number;
      readonly errorMessage: string;
    }
  | {
      readonly type: "auto_retry_end";
      readonly success: boolean;
      readonly attempt: number;
      readonly finalError?: string;
    }
  | {
      readonly type: "summarization_retry_scheduled";
      readonly attempt: number;
      readonly maxAttempts: number;
      readonly delayMs: number;
      readonly errorMessage: string;
    }
  | {
      readonly type: "summarization_retry_attempt_start";
      readonly source: string;
      readonly reason?: string;
    }
  | { readonly type: "summarization_retry_finished" }
  | { readonly type: "bash_execution_update"; readonly id?: string; readonly delta: string }
  | { readonly type: "unknown"; readonly sourceType: string; readonly data: unknown }
  | { readonly type: "error"; readonly errorType: string; readonly message: string }
  | {
      /** The shared retry boundary announcing a transient failure it will
       * retry, or the later attempt that recovered. Emitted alongside, never
       * instead of, the per-attempt `error` event. */
      readonly type: "retry";
      readonly event: "scheduled" | "recovered";
      readonly attempt: number;
      readonly nextAttempt?: number;
      readonly totalAttempts: number;
      readonly delayMs?: number;
      readonly errorType?: string;
      readonly message?: string;
    }
  | {
      readonly type: "done";
      readonly exitStatus: number;
      readonly sessionId: string;
      readonly transcriptPath: string;
    };

/** Harness events may be annotated by the workflow boundary without changing
 * their native payload. This lets concurrent stage streams remain attributable
 * in logs, trajectories, and headless JSON. */
export type AgentEvent = AgentEventPayload & {
  readonly workflow?: AgentWorkflowMetadata;
};

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  try {
    return !Array.isArray(value);
  } catch {
    return false;
  }
}

export function asAgentMessage(value: unknown): AgentMessage {
  return isNonArrayObject(value)
    ? value as AgentMessage
    : { value };
}

export function asAgentMessageEvent(value: unknown): AgentMessageEvent {
  return isNonArrayObject(value)
    ? value as AgentMessageEvent
    : { value };
}

export function messageText(message: AgentMessage): string | undefined {
  try {
    const content = message.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return undefined;
    const text = content
      .map((part) => {
        try {
          if (typeof part !== "object" || part === null) return "";
          const partText = (part as { text?: unknown }).text;
          return typeof partText === "string" ? partText : "";
        } catch {
          return "";
        }
      })
      .join("");
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}

export function textDelta(event: AgentEvent): string | undefined {
  if (event.type !== "message_update") return undefined;
  let assistantMessageEvent: AgentMessageEvent;
  try {
    assistantMessageEvent = event.assistantMessageEvent;
  } catch {
    return undefined;
  }
  let assistantEventType: string | undefined;
  try {
    assistantEventType = assistantMessageEvent.type;
  } catch {
    return undefined;
  }
  if (assistantEventType !== "text_delta") return undefined;
  try {
    const delta = assistantMessageEvent.delta;
    return typeof delta === "string" ? delta : undefined;
  } catch {
    return undefined;
  }
}

/** Return bounded, non-content metadata suitable for logs and side panels. */
export function eventMetadata(event: AgentEvent): Record<string, unknown> {
  let workflow: AgentWorkflowMetadata | undefined;
  try {
    workflow = event.workflow;
  } catch {
    workflow = undefined;
  }
  let workflowStageId: string | undefined;
  try {
    workflowStageId = workflow?.stageId;
  } catch {
    workflowStageId = undefined;
  }
  let workflowInvocationId: string | undefined;
  try {
    workflowInvocationId = workflow?.invocationId;
  } catch {
    workflowInvocationId = undefined;
  }
  let workflowWorker: string | undefined;
  try {
    workflowWorker = workflow?.worker;
  } catch {
    workflowWorker = undefined;
  }
  let workflowWorkspaceKey: string | undefined;
  try {
    workflowWorkspaceKey = workflow?.workspaceKey;
  } catch {
    workflowWorkspaceKey = undefined;
  }
  let workflowWorkspaceCwd: string | undefined;
  try {
    workflowWorkspaceCwd = workflow?.workspaceCwd;
  } catch {
    workflowWorkspaceCwd = undefined;
  }
  let workflowWorkspaceRecordPath: string | undefined;
  try {
    workflowWorkspaceRecordPath = workflow?.workspaceRecordPath;
  } catch {
    workflowWorkspaceRecordPath = undefined;
  }
  let workflowAttempt: number | undefined;
  try {
    workflowAttempt = workflow?.attempt;
  } catch {
    workflowAttempt = undefined;
  }
  const metadata: Record<string, unknown> = {
    eventType: event.type,
    ...(workflow === undefined ? {} : {
      ...(workflowStageId === undefined ? {} : { workflowStageId }),
      ...(workflowInvocationId === undefined ? {} : { workflowInvocationId }),
      ...(workflowWorker === undefined ? {} : { workflowWorker }),
      ...(workflowAttempt === undefined ? {} : { workflowAttempt }),
      ...(workflowWorkspaceKey === undefined ? {} : { workflowWorkspaceKey }),
      ...(workflowWorkspaceCwd === undefined ? {} : { workflowWorkspaceCwd }),
      ...(workflowWorkspaceRecordPath === undefined ? {} : { workflowWorkspaceRecordPath }),
    }),
  };
  const messageMetadata = (message: AgentMessage): Record<string, unknown> => {
    const text = messageText(message);
    let role: string | undefined;
    try {
      role = message.role;
    } catch {
      role = undefined;
    }
    return {
      ...(role === undefined ? {} : { role }),
      ...(text === undefined ? {} : { textLength: text.length }),
    };
  };
  switch (event.type) {
    case "resource":
      try {
        return { ...metadata, ...event.resource };
      } catch {
        return metadata;
      }
    case "spawn":
      try {
        return {
          ...metadata,
          harness: event.harness,
          ...(event.model === undefined ? {} : { model: event.model }),
          ...(event.thinkingLevel === undefined ? {} : { thinkingLevel: event.thinkingLevel }),
          skillCount: event.skills.length,
        };
      } catch {
        return metadata;
      }
    case "context": {
      let systemPromptPath: string | undefined;
      try {
        systemPromptPath = event.context.systemPromptPath;
      } catch {
        systemPromptPath = undefined;
      }
      let contextFilePaths: readonly string[] | undefined;
      try {
        contextFilePaths = event.context.contextFilePaths;
      } catch {
        contextFilePaths = undefined;
      }
      let skillCount = 0;
      try {
        skillCount = event.context.skills?.length ?? 0;
      } catch {
        skillCount = 0;
      }
      let fallbackContextFilePaths: readonly string[] | undefined;
      if (contextFilePaths === undefined) {
        try {
          fallbackContextFilePaths = event.context.contextFiles?.map((file) => file.path);
        } catch {
          fallbackContextFilePaths = undefined;
        }
      }
      return {
        ...metadata,
        ...(systemPromptPath === undefined ? {} : { systemPromptPath }),
        contextFilePaths: contextFilePaths ?? fallbackContextFilePaths ?? [],
        skillCount,
      };
    }
    case "agent_start":
    case "agent_settled":
    case "turn_start":
    case "summarization_retry_finished":
      return { ...metadata };
    case "compaction_start": {
      let reason: string;
      try {
        reason = event.reason;
      } catch {
        return metadata;
      }
      return { ...metadata, reason };
    }
    case "agent_end":
      try {
        return { ...metadata, messageCount: event.messages.length, willRetry: event.willRetry };
      } catch {
        return metadata;
      }
    case "turn_end":
      try {
        return { ...metadata, ...messageMetadata(event.message), toolResultCount: event.toolResults.length };
      } catch {
        return metadata;
      }
    case "message_start":
    case "message_end":
      return { ...metadata, ...messageMetadata(event.message) };
    case "message_update": {
      let assistantEventType: string | undefined;
      try {
        assistantEventType = event.assistantMessageEvent.type;
      } catch {
        assistantEventType = undefined;
      }
      let delta: unknown;
      try {
        delta = event.assistantMessageEvent.delta;
      } catch {
        delta = undefined;
      }
      return {
        ...metadata,
        ...messageMetadata(event.message),
        assistantEventType,
        ...(typeof delta === "string" ? { deltaLength: delta.length } : {}),
      };
    }
    case "tool_execution_start":
      return { ...metadata, toolCallId: event.toolCallId, toolName: event.toolName };
    case "tool_execution_update":
      return { ...metadata, toolCallId: event.toolCallId, toolName: event.toolName };
    case "tool_execution_end":
      return { ...metadata, toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError };
    case "usage": {
      try {
        return {
          ...metadata,
          ...Object.fromEntries(Object.entries(event.usage).filter(([, value]) => typeof value === "number")),
        };
      } catch {
        return metadata;
      }
    }
    case "queue_update":
      try {
        return { ...metadata, steeringCount: event.steering.length, followUpCount: event.followUp.length };
      } catch {
        return metadata;
      }
    case "entry_appended":
      return { ...metadata };
    case "session_info_changed": {
      let name: string | undefined;
      try {
        name = event.name;
      } catch {
        return metadata;
      }
      return { ...metadata, ...(name === undefined ? {} : { name }) };
    }
    case "thinking_level_changed": {
      let level: string;
      try {
        level = event.level;
      } catch {
        return metadata;
      }
      return { ...metadata, level };
    }
    case "compaction_end": {
      let reason: string;
      let aborted: boolean;
      let willRetry: boolean;
      let errorMessage: string | undefined;
      try {
        reason = event.reason;
        aborted = event.aborted;
        willRetry = event.willRetry;
        errorMessage = event.errorMessage;
      } catch {
        return metadata;
      }
      return {
        ...metadata,
        reason,
        aborted,
        willRetry,
        ...(errorMessage === undefined ? {} : { errorMessage }),
      };
    }
    case "auto_retry_start": {
      let attempt: number;
      let maxAttempts: number;
      let delayMs: number;
      let errorMessage: string;
      try {
        attempt = event.attempt;
        maxAttempts = event.maxAttempts;
        delayMs = event.delayMs;
        errorMessage = event.errorMessage;
      } catch {
        return metadata;
      }
      return { ...metadata, attempt, maxAttempts, delayMs, errorMessage };
    }
    case "auto_retry_end": {
      let success: boolean;
      let attempt: number;
      let finalError: string | undefined;
      try {
        success = event.success;
        attempt = event.attempt;
        finalError = event.finalError;
      } catch {
        return metadata;
      }
      return { ...metadata, success, attempt, ...(finalError === undefined ? {} : { finalError }) };
    }
    case "summarization_retry_scheduled": {
      let attempt: number;
      let maxAttempts: number;
      let delayMs: number;
      let errorMessage: string;
      try {
        attempt = event.attempt;
        maxAttempts = event.maxAttempts;
        delayMs = event.delayMs;
        errorMessage = event.errorMessage;
      } catch {
        return metadata;
      }
      return { ...metadata, attempt, maxAttempts, delayMs, errorMessage };
    }
    case "summarization_retry_attempt_start": {
      let source: string;
      let reason: string | undefined;
      try {
        source = event.source;
        reason = event.reason;
      } catch {
        return metadata;
      }
      return { ...metadata, source, ...(reason === undefined ? {} : { reason }) };
    }
    case "bash_execution_update": {
      const id = event.id;
      try {
        return { ...metadata, ...(id === undefined ? {} : { id }), deltaLength: event.delta.length };
      } catch {
        return { ...metadata, ...(id === undefined ? {} : { id }) };
      }
    }
    case "unknown": {
      let sourceType: string;
      try {
        sourceType = event.sourceType;
      } catch {
        return metadata;
      }
      return { ...metadata, sourceType };
    }
    case "error": {
      let errorType: string;
      let message: string;
      try {
        errorType = event.errorType;
        message = event.message;
      } catch {
        return metadata;
      }
      return { ...metadata, errorType, message };
    }
    case "retry": {
      let attempt: number;
      let totalAttempts: number;
      let retryEvent: string;
      try {
        attempt = event.attempt;
        totalAttempts = event.totalAttempts;
        retryEvent = event.event;
      } catch {
        return metadata;
      }
      return { ...metadata, retryEvent, attempt, totalAttempts };
    }
    case "done": {
      let exitStatus: number;
      let sessionId: string;
      let transcriptPath: string;
      try {
        exitStatus = event.exitStatus;
        sessionId = event.sessionId;
        transcriptPath = event.transcriptPath;
      } catch {
        return metadata;
      }
      return { ...metadata, exitStatus, sessionId, transcriptPath };
    }
  }
}
