import {
  messageText,
  type AgentEvent,
  type AgentMessage,
  type AgentWorkflowMetadata,
} from "./events.js";

/**
 * The bounded, non-content view of an event that logs and side panels read.
 *
 * Every event becomes one flat row of numbers and identifiers — counts, ids,
 * lengths — never the text itself, because a run's log is read long after the
 * transcript it summarizes and must not duplicate it (`shouldPersistAgentEvent`
 * is the other half of that decision, keeping the highest-frequency streams out
 * of the log entirely).
 *
 * Two rules shape the code below, and both are load-bearing:
 *
 * - **A case's fields are read as a group.** An event may be a proxy, or a
 *   revoked one, and any property access can throw; when one does, the row
 *   falls back to the base metadata rather than reporting a half-filled row
 *   that reads like a fact. Cases that genuinely tolerate a missing field read
 *   each field on its own and default it.
 * - **The base metadata is always there.** Workflow attribution is read field
 *   by field so one unreadable field costs only itself: the rest of the
 *   attribution — which stage, which worker, which attempt — is exactly what
 *   makes a failure findable in a log of a thousand rows.
 */
export function eventMetadata(event: AgentEvent): Record<string, unknown> {
  const workflow = readFields((): AgentWorkflowMetadata | undefined => event.workflow);
  const workflowStageId = readFields(() => workflow?.stageId);
  const workflowInvocationId = readFields(() => workflow?.invocationId);
  const workflowWorker = readFields(() => workflow?.worker);
  const workflowWorkspaceKey = readFields(() => workflow?.workspaceKey);
  const workflowWorkspaceCwd = readFields(() => workflow?.workspaceCwd);
  const workflowWorkspaceRecordPath = readFields(() => workflow?.workspaceRecordPath);
  const workflowAttempt = readFields(() => workflow?.attempt);
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

  /** This case's fields, or the base row when any of them could not be read. */
  const withBase = <T extends Record<string, unknown>>(fields: T | undefined): Record<string, unknown> =>
    fields === undefined ? metadata : { ...metadata, ...fields };

  switch (event.type) {
    case "resource":
      return withBase(readFields(() => ({ ...event.resource })));
    case "spawn":
      return withBase(readFields(() => ({
        harness: event.harness,
        ...(event.model === undefined ? {} : { model: event.model }),
        ...(event.thinkingLevel === undefined ? {} : { thinkingLevel: event.thinkingLevel }),
        skillCount: event.skills.length,
      })));
    case "context": {
      const systemPromptPath = readFields(() => event.context.systemPromptPath);
      const contextFilePaths = readFields(() => event.context.contextFilePaths);
      const skillCount = readFields(() => event.context.skills?.length) ?? 0;
      const fallbackContextFilePaths = contextFilePaths === undefined
        ? readFields(() => event.context.contextFiles?.map((file) => file.path))
        : undefined;
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
    case "entry_appended":
      return { ...metadata };
    case "compaction_start": {
      const fields = readFields(() => ({ reason: event.reason }));
      return fields === undefined ? metadata : { ...metadata, reason: fields.reason };
    }
    case "agent_end":
      return withBase(readFields(() => ({ messageCount: event.messages.length, willRetry: event.willRetry })));
    case "turn_end":
      return withBase(readFields(() => ({
        ...messageMetadata(event.message),
        toolResultCount: event.toolResults.length,
      })));
    case "message_start":
    case "message_end":
      return { ...metadata, ...messageMetadata(event.message) };
    case "message_update": {
      const assistantEventType = readFields(() => event.assistantMessageEvent.type);
      const delta = readFields(() => event.assistantMessageEvent.delta);
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
    case "usage":
      return withBase(readFields(() => Object.fromEntries(
        Object.entries(event.usage).filter(([, value]) => typeof value === "number"),
      )));
    case "queue_update":
      return withBase(readFields(() => ({
        steeringCount: event.steering.length,
        followUpCount: event.followUp.length,
      })));
    case "session_info_changed": {
      const fields = readFields(() => ({ name: event.name }));
      return fields === undefined || fields.name === undefined
        ? metadata
        : { ...metadata, name: fields.name };
    }
    case "thinking_level_changed": {
      const fields = readFields(() => ({ level: event.level }));
      return fields === undefined ? metadata : { ...metadata, level: fields.level };
    }
    case "compaction_end":
      return withBase(readFields(() => ({
        reason: event.reason,
        aborted: event.aborted,
        willRetry: event.willRetry,
        ...(event.errorMessage === undefined ? {} : { errorMessage: event.errorMessage }),
      })));
    case "auto_retry_start":
    case "summarization_retry_scheduled":
      return withBase(readFields(() => ({
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage,
      })));
    case "auto_retry_end":
      return withBase(readFields(() => ({
        success: event.success,
        attempt: event.attempt,
        ...(event.finalError === undefined ? {} : { finalError: event.finalError }),
      })));
    case "summarization_retry_attempt_start":
      return withBase(readFields(() => ({
        source: event.source,
        ...(event.reason === undefined ? {} : { reason: event.reason }),
      })));
    case "bash_execution_update": {
      const id = event.id;
      const deltaLength = readFields(() => event.delta.length);
      return {
        ...metadata,
        ...(id === undefined ? {} : { id }),
        ...(deltaLength === undefined ? {} : { deltaLength }),
      };
    }
    case "unknown": {
      const fields = readFields(() => ({ sourceType: event.sourceType }));
      return fields === undefined ? metadata : { ...metadata, sourceType: fields.sourceType };
    }
    case "error": {
      const fields = readFields(() => ({ errorType: event.errorType, message: event.message }));
      return fields === undefined ? metadata : { ...metadata, errorType: fields.errorType, message: fields.message };
    }
    case "retry":
      return withBase(readFields(() => ({
        retryEvent: event.event,
        attempt: event.attempt,
        totalAttempts: event.totalAttempts,
      })));
    case "done":
      return withBase(readFields(() => ({
        exitStatus: event.exitStatus,
        sessionId: event.sessionId,
        transcriptPath: event.transcriptPath,
      })));
  }
}

/** The identifier-length view of one message: who said it and how much, never
 * what. */
function messageMetadata(message: AgentMessage): Record<string, unknown> {
  const text = messageText(message);
  const role = readFields(() => message.role);
  return {
    ...(role === undefined ? {} : { role }),
    ...(text === undefined ? {} : { textLength: text.length }),
  };
}

/** Read as one group: a property access on a proxied or revoked event can
 * throw, and a group that cannot be read whole is reported as unread rather
 * than as a row of defaults. */
function readFields<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}
