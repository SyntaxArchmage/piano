import {
  attemptHandle,
  toolHandle,
  type ObservationOp,
  type ObservationType,
  type EmitObservationType,
} from "@piano/logging";
import type {
  StageAttemptOutcome,
  TrajectoryRecordContext,
  WorkflowObservation,
} from "@piano/trajectory";

export { attemptHandle, toolHandle };

/** Identity fields every exported observation carries so a Langfuse view can
 * be joined back to `~/.piano/runs/<runId>/` and `inv-<ref>`. */
export function contextMetadata(
  context: TrajectoryRecordContext,
): Record<string, unknown> {
  return {
    runId: context.runId,
    invocationId: context.invocationId,
    stageId: context.stageId,
    stage: context.stage,
    worker: context.worker,
    attempt: context.attempt,
    ...(context.iteration === undefined ? {} : { iteration: context.iteration }),
    ...(context.instanceId === undefined ? {} : { instanceId: context.instanceId }),
    ...(context.mapSlot === undefined ? {} : { mapSlot: context.mapSlot }),
    ...(context.actorKey === undefined ? {} : { actorKey: context.actorKey }),
    ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
  };
}

function outcomeLevel(outcome: StageAttemptOutcome): "DEFAULT" | "WARNING" | "ERROR" {
  if (outcome === "accepted") return "DEFAULT";
  if (outcome === "failed") return "ERROR";
  return "WARNING";
}

/** Map one workflow observation to the observation ops it implies. */
export function mapWorkflowObservation(
  observation: WorkflowObservation,
  timestamp: string,
): readonly ObservationOp[] {
  switch (observation.type) {
    case "stage_attempt_started": {
      const handle = attemptHandle(observation.context);
      return [{
        version: 1,
        timestamp,
        handle,
        op: "start",
        type: "agent",
        name: `stage.attempt:${observation.context.stageId}`,
        input: { stageId: observation.context.stageId, attempt: observation.context.attempt },
        metadata: { ...contextMetadata(observation.context), monotonicMs: observation.monotonicMs },
      }];
    }
    case "stage_attempt_finished": {
      return [{
        version: 1,
        timestamp,
        handle: attemptHandle(observation.context),
        op: "end",
        level: outcomeLevel(observation.outcome),
        statusMessage: observation.outcome,
        output: { outcome: observation.outcome },
        metadata: { ...contextMetadata(observation.context), monotonicMs: observation.monotonicMs },
      }];
    }
    case "token_usage": {
      return [{
        version: 1,
        timestamp,
        handle: attemptHandle(observation.context),
        op: "update",
        usageDetails: {
          input: observation.usage.input,
          output: observation.usage.output,
          cacheRead: observation.usage.cacheRead,
          cacheWrite: observation.usage.cacheWrite,
          total: observation.usage.total,
        },
        metadata: contextMetadata(observation.context),
      }];
    }
    case "tool_call_started": {
      // Tools are produced here and only here: the bridge does not emit them.
      return [{
        version: 1,
        timestamp,
        handle: toolHandle(observation.toolCallId),
        op: "start",
        type: "tool",
        name: observation.toolName,
        parent: attemptHandle(observation.context),
        metadata: {
          ...contextMetadata(observation.context),
          toolCallId: observation.toolCallId,
          toolName: observation.toolName,
          monotonicMs: observation.monotonicMs,
        },
      }];
    }
    case "tool_call_finished": {
      return [{
        version: 1,
        timestamp,
        handle: toolHandle(observation.toolCallId),
        op: "end",
        level: observation.isError ? "ERROR" : "DEFAULT",
        ...(observation.isError ? { statusMessage: "tool failed" } : {}),
        metadata: {
          ...contextMetadata(observation.context),
          toolCallId: observation.toolCallId,
          toolName: observation.toolName,
          isError: observation.isError,
          monotonicMs: observation.monotonicMs,
        },
      }];
    }
    case "stage_accepted": {
      return [{
        version: 1,
        timestamp,
        handle: `accepted:${observation.context.invocationId}:${observation.context.attempt}`,
        op: "emit",
        type: "event",
        name: "stage.accepted",
        parent: attemptHandle(observation.context),
        metadata: {
          ...contextMetadata(observation.context),
          metrics: observation.metrics.map((metric) => ({
            pointer: metric.pointer,
            value: metric.value,
          })),
        },
      }];
    }
    case "selection": {
      return [{
        version: 1,
        timestamp,
        handle: `selection:${observation.runId}:${timestamp}`,
        op: "emit",
        type: "event",
        name: "selection",
        metadata: {
          runId: observation.runId,
          outcome: observation.outcome,
          ...(observation.referee === undefined ? {} : { referee: observation.referee }),
          ...(observation.winnerKey === undefined ? {} : { winnerKey: observation.winnerKey }),
          ...(observation.commit === undefined ? {} : { commit: observation.commit }),
          ...(observation.skipped === undefined ? {} : { skipped: observation.skipped }),
          ...(observation.carrying === undefined ? {} : { carrying: observation.carrying }),
        },
      }];
    }
  }
}

/** Re-exported so callers can name the span kinds without importing logging. */
export type { EmitObservationType, ObservationType };
