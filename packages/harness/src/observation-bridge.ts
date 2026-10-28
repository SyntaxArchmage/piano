import { attemptHandle, type ObservationOp } from "@piano/logging";
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
  readonly usageDetails?: Record<string, number>;
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
 * matching `shouldPersistAgentEvent`. Tool executions are skipped too: they
 * already arrive as `tool_call_*` workflow observations, and a second tool span
 * would duplicate them. Attempt totals come from `token_usage`, so a lone
 * `usage` event with no following message is dropped.
 */
export function bridgeAgentEvent(
  event: AgentEvent,
  context: BridgeContext,
  timestamp: () => string,
): readonly ObservationOp[] {
  switch (event.type) {
    case "message_end": {
      if (event.message.role !== "assistant") return [];
      const text = messageText(event.message);
      const parent = event.workflow === undefined ? undefined : attemptHandle(event.workflow);
      return [{
        version: 1,
        timestamp: timestamp(),
        handle: `msg:${context.sequence}:${attemptSuffix(event)}`,
        op: "emit",
        type: "generation",
        name: "agent.message",
        ...(parent === undefined ? {} : { parent }),
        input: { role: "assistant" },
        ...(text === undefined ? {} : { output: { role: "assistant", text } }),
        ...(context.model === undefined ? {} : { model: context.model }),
        ...(context.usageDetails === undefined ? {} : { usageDetails: context.usageDetails }),
        metadata: {
          ...(event.workflow ?? {}),
          role: "assistant",
          sequence: context.sequence,
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
        name: "agent.error",
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
        name: "agent.done",
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

/** Carry `spawn`'s model and `usage`'s counters forward to the next message. */
export function advanceBridgeContext(
  event: AgentEvent,
  context: BridgeContext,
): BridgeContext {
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
