import {
  messageText,
  type AgentEvent,
  type AgentMessage,
} from "@piano/harness";
import type { LangfuseAction } from "./map-workflow-observation.js";

/** Values the sink carries across events: `spawn` names the model, `usage`
 * reports the latest per-call counters, and the next assistant `message_end`
 * is the generation those belong to. */
export interface AgentEventExportContext {
  readonly model?: string;
  readonly usageDetails?: Record<string, number>;
  readonly sequence: number;
}

function roleOf(message: AgentMessage): string {
  return typeof message.role === "string" ? message.role : "unknown";
}

function usageDetails(usage: {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly totalTokens?: number;
}): Record<string, number> | undefined {
  const details: Record<string, number> = {};
  if (usage.input !== undefined) details.input = usage.input;
  if (usage.output !== undefined) details.output = usage.output;
  if (usage.cacheRead !== undefined) details.cacheRead = usage.cacheRead;
  if (usage.cacheWrite !== undefined) details.cacheWrite = usage.cacheWrite;
  if (usage.totalTokens !== undefined) details.total = usage.totalTokens;
  return Object.keys(details).length === 0 ? undefined : details;
}

function workflowMetadata(event: AgentEvent): Record<string, unknown> {
  const workflow = event.workflow;
  if (workflow === undefined) return {};
  return {
    stageId: workflow.stageId,
    invocationId: workflow.invocationId,
    worker: workflow.worker,
    attempt: workflow.attempt,
    ...(workflow.workspaceKey === undefined ? {} : { workspaceKey: workflow.workspaceKey }),
  };
}

function parentAttemptHandle(event: AgentEvent): string | undefined {
  const workflow = event.workflow;
  if (workflow === undefined) return undefined;
  return `attempt:${workflow.invocationId}:${workflow.attempt}`;
}

/**
 * Map one harness agent event to export actions.
 *
 * High-frequency `*_update` events stay in the transcript and are skipped,
 * matching `shouldPersistAgentEvent`. Tool executions are skipped too: they
 * already reach Langfuse as `tool_call_*` workflow observations, and a second
 * tool span would duplicate them. Attempt totals come from `token_usage`, so a
 * lone `usage` event with no following message is dropped.
 */
export function mapAgentEvent(
  event: AgentEvent,
  context: AgentEventExportContext,
): readonly LangfuseAction[] {
  switch (event.type) {
    case "message_end": {
      const role = roleOf(event.message);
      if (role !== "assistant") return [];
      const text = messageText(event.message);
      const parentHandle = parentAttemptHandle(event);
      return [{
        action: "emit",
        type: "generation",
        name: "agent.message",
        ...(parentHandle === undefined ? {} : { parentHandle }),
        input: { role },
        ...(text === undefined ? {} : { output: { role, text } }),
        ...(context.model === undefined ? {} : { model: context.model }),
        ...(context.usageDetails === undefined ? {} : { usageDetails: context.usageDetails }),
        metadata: {
          ...workflowMetadata(event),
          role,
          sequence: context.sequence,
        },
      }];
    }
    case "error": {
      return [{
        action: "emit",
        type: "event",
        name: "agent.error",
        metadata: {
          ...workflowMetadata(event),
          errorType: event.errorType,
          message: event.message,
        },
      }];
    }
    case "done": {
      return [{
        action: "emit",
        type: "event",
        name: "agent.done",
        metadata: {
          ...workflowMetadata(event),
          exitStatus: event.exitStatus,
        },
      }];
    }
    default:
      return [];
  }
}

/** Carry `spawn`'s model and `usage`'s counters forward to the next message. */
export function advanceAgentEventContext(
  event: AgentEvent,
  context: AgentEventExportContext,
): AgentEventExportContext {
  if (event.type === "spawn" && typeof event.model === "string") {
    return { ...context, model: event.model };
  }
  if (event.type === "usage") {
    const details = usageDetails(event.usage);
    return details === undefined ? context : { ...context, usageDetails: details };
  }
  if (event.type === "message_end") {
    return { ...context, sequence: context.sequence + 1, usageDetails: undefined };
  }
  return context;
}
