import {
  AGENT_DONE_NAME,
  AGENT_ERROR_NAME,
  AGENT_USAGE_NAME,
  attemptHandle,
  messageName,
  toolHandle,
  type ObservationOp,
} from "@piano/logging";
import { messageText } from "./events.js";
import type { AgentEvent } from "./events.js";

/** Bridge from the harness's current `AgentEvent` dialect onto the
 * Langfuse-aligned `ObservationOp` vocabulary.
 *
 * `AgentEvent` keeps working — this is the migration seam, not a replacement.
 * A later hop lets each harness emit ops natively and retires this translator;
 * until then every consumer of the new model goes through here. */

export interface BridgeContext {
  readonly model?: string;
  readonly sequence: number;
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

function attemptSuffix(event: AgentEvent): string {
  const workflow = event.workflow;
  return `${workflow?.invocationId ?? "root"}:${workflow?.attempt ?? 0}`;
}

/**
 * Map one harness agent event to observation ops.
 *
 * High-frequency `*_update` events stay in the transcript and are skipped,
 * matching `shouldPersistAgentEvent`. Tools ride the bridge (`tool_execution_*`);
 * the workflow mapper drops its `tool_call_*` copy so one fact has one
 * elevation. Per-call `usage` is its own `update` op (the SDK emits it after
 * `message_end`, so it cannot ride the generation it belongs to); attempt
 * totals stay on `token_usage`.
 */
export function bridgeAgentEvent(
  event: AgentEvent,
  context: BridgeContext,
  timestamp: () => string,
): readonly ObservationOp[] {
  switch (event.type) {
    case "message_end": {
      const role = event.message.role;
      // Only the two conversation roles are facts of the ledger. Tool-result
      // turns (and any other role) belong to the transcript.
      if (role !== "assistant" && role !== "user") return [];
      const assistant = role === "assistant";
      const text = messageText(event.message);
      const parent = event.workflow === undefined ? undefined : attemptHandle(event.workflow);
      return [{
        version: 1,
        timestamp: timestamp(),
        handle: `${assistant ? "msg" : "user"}:${context.sequence}:${attemptSuffix(event)}`,
        op: "emit" as const,
        type: assistant ? ("generation" as const) : ("event" as const),
        name: messageName(role),
        ...(parent === undefined ? {} : { parent }),
        ...(assistant ? { input: { role: "assistant" } } : {}),
        ...(text === undefined ? {} : { output: { role, text } }),
        ...(assistant && context.model !== undefined ? { model: context.model } : {}),
        metadata: {
          ...(event.workflow ?? {}),
          role,
          sequence: context.sequence,
        },
      }];
    }
    case "usage": {
      // One API call's counters are a point fact of the turn. The SDK emits
      // them after `message_end`, so they cannot ride the generation they
      // belong to; the attempt's cumulative total still lands via `token_usage`.
      return [{
        version: 1,
        timestamp: timestamp(),
        handle: `usage:${context.sequence}:${attemptSuffix(event)}`,
        op: "emit" as const,
        type: "event" as const,
        name: AGENT_USAGE_NAME,
        ...(event.workflow === undefined ? {} : { parent: attemptHandle(event.workflow) }),
        usageDetails: usageDetails(event.usage) ?? {},
        metadata: { ...(event.workflow ?? {}), sequence: context.sequence },
      }];
    }
    case "tool_execution_start": {
      const parent = event.workflow === undefined ? undefined : attemptHandle(event.workflow);
      return [{
        version: 1,
        timestamp: timestamp(),
        handle: toolHandle(event.toolCallId),
        op: "start" as const,
        type: "tool" as const,
        name: event.toolName,
        ...(parent === undefined ? {} : { parent }),
        metadata: {
          ...(event.workflow ?? {}),
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        },
      }];
    }
    case "tool_execution_end": {
      return [{
        version: 1,
        timestamp: timestamp(),
        handle: toolHandle(event.toolCallId),
        op: "end" as const,
        ...(event.isError ? { level: "ERROR" as const, statusMessage: "tool failed" } : {}),
        metadata: {
          ...(event.workflow ?? {}),
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
        },
      }];
    }
    case "error": {
      return [{
        version: 1,
        timestamp: timestamp(),
        handle: `err:${context.sequence}:${attemptSuffix(event)}`,
        op: "emit",
        type: "event",
        name: AGENT_ERROR_NAME,
        metadata: {
          ...(event.workflow ?? {}),
          errorType: event.errorType,
          message: event.message,
        },
      }];
    }
    case "done": {
      return [{
        version: 1,
        timestamp: timestamp(),
        handle: `done:${attemptSuffix(event)}`,
        op: "emit",
        type: "event",
        name: AGENT_DONE_NAME,
        metadata: {
          ...(event.workflow ?? {}),
          exitStatus: event.exitStatus,
        },
      }];
    }
    default:
      return [];
  }
}

/** Carry `spawn`'s model forward to the next message. Usage is its own op, so
 * it is not carried: the SDK emits it after `message_end`. */
export function advanceBridgeContext(
  event: AgentEvent,
  context: BridgeContext,
): BridgeContext {
  if (event.type === "spawn" && typeof event.model === "string") {
    return { ...context, model: event.model };
  }
  if (event.type === "message_end") {
    return { ...context, sequence: context.sequence + 1 };
  }
  return context;
}
