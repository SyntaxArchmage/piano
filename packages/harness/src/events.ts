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
  /** One API call's token counters, for the live counter and the trajectory
   * panel. Accounting does not read this stream: token totals come from the
   * actor transcript at attempt end (`transcriptTokenUsage`), because a series
   * of per-call values cannot state what the attempt cost. */
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

/**
 * Stream updates are already durable in the harness transcript and are
 * delivered to the live UI through onEvent. Persisting every token/tool chunk
 * in the run log makes turn cleanup scale with response length and can delay
 * stage completion. Keep the lifecycle and terminal tool events in the log;
 * the transcript remains the source of truth for these streams.
 */
export function shouldPersistAgentEvent(event: AgentEvent): boolean {
  return event.type !== "message_update"
    && event.type !== "tool_execution_update"
    && event.type !== "bash_execution_update";
}
