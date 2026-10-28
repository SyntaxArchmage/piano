import {
  AGENT_CONTEXT_NAME,
  AGENT_DONE_NAME,
  AGENT_ERROR_NAME,
  AGENT_NAME,
  AGENT_RETRY_NAME,
  AGENT_USAGE_NAME,
  attemptHandle,
  contextCounts,
  messageName,
  toolCallEndOp,
  toolCallStartOp,
  type ObservationOp,
  type ObservationOpSink,
} from "@piano/logging";
import { messageText, textDelta } from "./events.js";
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
  /** True while an assistant generation span is open, so `message_end` closes
   * it instead of re-stating the `start`, and a repeated `message_start` (the
   * subprocess adapter re-arms one per text block) emits nothing. */
  readonly messageSpanOpened?: boolean;
  /** The unattributed agent span a `spawn` opened, so `done` can close it.
   * Workflow attempts close theirs via `stage_attempt_finished` and never set
   * this. */
  readonly agentSpanHandle?: string;
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

/** The one wall-clock spelling every op timestamp uses. */
const wallClock = (): string => new Date().toISOString();

function attemptSuffix(event: AgentEvent): string {
  const workflow = event.workflow;
  return `${workflow?.invocationId ?? "root"}:${workflow?.attempt ?? 0}`;
}

/** The handle an unattributed agent turn's span wears. Sequence keeps two
 * side turns apart; workflow attempts use `attempt:` handles instead. */
function agentSpanHandle(event: AgentEvent, context: BridgeContext): string {
  return `agent:${context.sequence}:${attemptSuffix(event)}`;
}

/** The handle one conversation turn's facts share. Role is not part of the
 * handle — `name` / `metadata.role` carry it. */
function messageHandle(event: AgentEvent, context: BridgeContext): string {
  return `msg:${context.sequence}:${attemptSuffix(event)}`;
}

/** Open the generation span an assistant turn is spoken into. */
function generationStart(
  event: AgentEvent,
  context: BridgeContext,
  timestamp: () => string,
): ObservationOp {
  return {
    version: 1,
    timestamp: timestamp(),
    handle: messageHandle(event, context),
    op: "start",
    type: "generation",
    name: messageName("assistant"),
    ...(event.workflow === undefined ? {} : { parent: attemptHandle(event.workflow) }),
    input: { role: "assistant" },
    ...(context.model === undefined ? {} : { model: context.model }),
    metadata: {
      ...(event.workflow ?? {}),
      role: "assistant",
      sequence: context.sequence,
    },
  };
}

/**
 * Map one harness agent event to observation ops.
 *
 * High-frequency `*_update` events stay in the transcript and are skipped,
 * matching `shouldPersistAgentEvent`, except the text deltas the chat
 * streams. Every fact a turn produces is one op here, tools included: every
 * tool execution is born an `AgentEvent`, so this is the one producer of its
 * op shape. Per-call `usage` is its own `emit` op (the SDK emits it after
 * `message_end`, so it cannot ride the generation it belongs to); attempt
 * totals stay on `token_usage`.
 */
export function bridgeAgentEvent(
  event: AgentEvent,
  context: BridgeContext,
  timestamp: () => string,
): readonly ObservationOp[] {
  switch (event.type) {
    case "message_update": {
      // The live display stream: one `update` per text delta, on the same
      // handle the generation span wears. The payload is `output.delta`, not
      // `output.text` — a delta is the incremental fragment, never the
      // replacement output a fold would set — and `withoutDeltas` keeps it
      // out of the evidence sinks, matching `shouldPersistAgentEvent`.
      const delta = textDelta(event);
      if (delta === undefined) return [];
      return [{
        version: 1,
        timestamp: timestamp(),
        handle: messageHandle(event, context),
        op: "update",
        output: { delta },
        metadata: { role: "assistant", sequence: context.sequence },
      }];
    }
    case "message_start": {
      // An assistant turn is a generation span, not a point: open it when the
      // harness starts streaming so the close carries a real duration. User
      // turns stay born-closed points at `message_end`.
      if (event.message.role !== "assistant" || context.messageSpanOpened === true) return [];
      return [generationStart(event, context, timestamp)];
    }
    case "message_end": {
      const role = event.message.role;
      // Only the two conversation roles are facts of the ledger. Tool-result
      // turns (and any other role) belong to the transcript.
      if (role !== "assistant" && role !== "user") return [];
      const text = messageText(event.message);
      const close = {
        version: 1 as const,
        timestamp: timestamp(),
        handle: messageHandle(event, context),
        name: messageName(role),
        ...(text === undefined ? {} : { output: { role, text } }),
        metadata: { ...(event.workflow ?? {}), role, sequence: context.sequence },
      };
      if (role === "user") {
        return [{
          ...close,
          op: "emit" as const,
          type: "event" as const,
          ...(event.workflow === undefined ? {} : { parent: attemptHandle(event.workflow) }),
        }];
      }
      // Close the generation. A harness that skipped `message_start` gets the
      // `start` synthesized here so the pair is still complete.
      return [
        ...(context.messageSpanOpened === true ? [] : [generationStart(event, context, timestamp)]),
        { ...close, op: "end" as const },
      ];
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
    case "retry": {
      // The retry boundary is its own fact: `error` says what broke, this says
      // what Piano is doing about it. The chat reads both.
      const { type: _type, workflow, ...notice } = event;
      return [{
        version: 1,
        timestamp: timestamp(),
        handle: `retry:${context.sequence}:${attemptSuffix(event)}`,
        op: "emit",
        type: "event",
        name: AGENT_RETRY_NAME,
        ...(workflow === undefined ? {} : { parent: attemptHandle(workflow) }),
        metadata: { ...(workflow ?? {}), sequence: context.sequence, ...notice },
      }];
    }
    case "spawn": {
      // The harness announces what it is running with. Under a workflow it
      // arrives after the attempt span opened, so it refines that handle:
      // `startRefineFields` carries `input`/`model` — run-level config
      // (harness, resolved model) folded onto the attempt span that is
      // already open. An unattributed turn (the side agent) has no attempt
      // span, so the spawn opens one of its own.
      const input = {
        harness: event.harness,
        ...(event.thinkingLevel === undefined ? {} : { thinkingLevel: event.thinkingLevel }),
        skills: event.skills,
      };
      if (event.workflow === undefined) {
        return [{
          version: 1,
          timestamp: timestamp(),
          handle: agentSpanHandle(event, context),
          op: "start",
          type: "agent",
          name: AGENT_NAME,
          ...(event.model === undefined ? {} : { model: event.model }),
          input,
          metadata: { sequence: context.sequence },
        }];
      }
      return [{
        version: 1,
        timestamp: timestamp(),
        handle: attemptHandle(event.workflow),
        op: "start",
        type: "agent",
        name: `stage.attempt:${event.workflow.stageId}`,
        ...(event.model === undefined ? {} : { model: event.model }),
        input: { stageId: event.workflow.stageId, attempt: event.workflow.attempt, ...input },
        metadata: { ...event.workflow, sequence: context.sequence },
      }];
    }
    case "tool_execution_start":
    case "tool_execution_end": {
      const parent = event.workflow === undefined ? undefined : attemptHandle(event.workflow);
      const metadata = { ...(event.workflow ?? {}), sequence: context.sequence };
      return [event.type === "tool_execution_start"
        ? toolCallStartOp({
          timestamp: timestamp(),
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          ...(parent === undefined ? {} : { parent }),
          metadata,
        })
        : toolCallEndOp({
          timestamp: timestamp(),
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
          metadata,
        })];
    }
    case "context": {
      // The ledger's `context` row: what the turn loaded. Counts only — the
      // file contents stay in the transcript.
      const { contextFilePaths, contextFiles, skills, systemPromptPath, userMessage } = event.context;
      const counts = contextCounts({ contextFilePaths, contextFiles, skills });
      return [{
        version: 1,
        timestamp: timestamp(),
        handle: `ctx:${context.sequence}:${attemptSuffix(event)}`,
        op: "emit",
        type: "event",
        name: AGENT_CONTEXT_NAME,
        ...(event.workflow === undefined ? {} : { parent: attemptHandle(event.workflow) }),
        metadata: {
          ...(event.workflow ?? {}),
          sequence: context.sequence,
          ...(systemPromptPath === undefined ? {} : { systemPromptPath }),
          files: counts.files,
          skills: counts.skills,
          ...(userMessage === undefined ? {} : { userMessageLength: userMessage.length }),
        },
      }];
    }
    case "done": {
      const closed = context.agentSpanHandle;
      return [
        // Close the unattributed turn's span; a workflow attempt's is closed
        // by `stage_attempt_finished` and leaves `agentSpanHandle` unset.
        ...(closed === undefined
          ? []
          : [{
            version: 1 as const,
            timestamp: timestamp(),
            handle: closed,
            op: "end" as const,
            output: { exitStatus: event.exitStatus },
            metadata: { sequence: context.sequence, exitStatus: event.exitStatus },
          }]),
        {
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
        },
      ];
    }
    default:
      return [];
  }
}

/** Carry `spawn`'s model forward to the next message, and track whether an
 * assistant generation span is open. Usage is its own op, so it is not
 * carried: the SDK emits it after `message_end`. */
export function advanceBridgeContext(
  event: AgentEvent,
  context: BridgeContext,
): BridgeContext {
  if (event.type === "spawn") {
    return {
      ...context,
      ...(typeof event.model === "string" ? { model: event.model } : {}),
      ...(event.workflow === undefined
        ? { agentSpanHandle: agentSpanHandle(event, context) }
        : {}),
    };
  }
  if (event.type === "message_start") {
    return event.message.role === "assistant"
      ? { ...context, messageSpanOpened: true }
      : context;
  }
  if (event.type === "message_end") {
    return {
      ...context,
      messageSpanOpened: undefined,
      sequence: context.sequence + 1,
    };
  }
  if (event.type === "done") {
    return { ...context, agentSpanHandle: undefined };
  }
  return context;
}

/** Bridge one conversation's events onto an op sink as they arrive. Each
 * caller owns its context, so two conversations cannot interleave handles —
 * this is the one place the bridge-then-advance protocol lives. */
export function agentEventExporter(
  emitOps: ObservationOpSink,
  timestamp: () => string = wallClock,
): (event: AgentEvent) => void {
  let context: BridgeContext = { sequence: 0 };
  return (event) => {
    emitOps(bridgeAgentEvent(event, context, timestamp));
    context = advanceBridgeContext(event, context);
  };
}

/** Bridge a recorded conversation's events to ops. Replay uses this so the
 * chat and the panel project the same vocabulary the live path does. */
export function bridgeAgentEvents(
  events: readonly AgentEvent[],
  timestamp: () => string = wallClock,
): readonly ObservationOp[] {
  const ops: ObservationOp[] = [];
  const emit = agentEventExporter((batch) => ops.push(...batch), timestamp);
  for (const event of events) emit(event);
  return ops;
}
