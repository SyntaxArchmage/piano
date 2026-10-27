import type { StageAttemptOutcome, TrajectoryRecordContext, WorkflowObservation } from "@piano/trajectory";

/** One export intent the sink executes against Langfuse.
 *
 * Pure data: the mapper never imports OTel, so the mapping is unit-testable
 * and the sink is the only place that opens spans. */
export type LangfuseAction =
  | {
    readonly action: "start";
    readonly handle: string;
    readonly type: "agent" | "tool" | "span";
    readonly name: string;
    readonly parentHandle?: string;
    readonly input?: unknown;
    readonly metadata: Record<string, unknown>;
  }
  | {
    readonly action: "update";
    readonly handle: string;
    readonly metadata: Record<string, unknown>;
  }
  | {
    readonly action: "end";
    readonly handle: string;
    readonly output?: unknown;
    readonly level?: "DEFAULT" | "WARNING" | "ERROR";
    readonly statusMessage?: string;
    readonly metadata?: Record<string, unknown>;
  }
  | {
    readonly action: "emit";
    readonly type: "event" | "generation";
    readonly name: string;
    readonly parentHandle?: string;
    readonly input?: unknown;
    readonly output?: unknown;
    readonly model?: string;
    readonly usageDetails?: Record<string, number>;
    readonly metadata: Record<string, unknown>;
  };

export function attemptHandle(context: Pick<TrajectoryRecordContext, "invocationId" | "attempt">): string {
  return `attempt:${context.invocationId}:${context.attempt}`;
}

export function toolHandle(toolCallId: string): string {
  return `tool:${toolCallId}`;
}

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

/** Map one workflow observation to the export actions it implies. */
export function mapWorkflowObservation(
  observation: WorkflowObservation,
): readonly LangfuseAction[] {
  switch (observation.type) {
    case "stage_attempt_started": {
      const handle = attemptHandle(observation.context);
      return [{
        action: "start",
        handle,
        type: "agent",
        name: `stage.attempt:${observation.context.stageId}`,
        input: { stageId: observation.context.stageId, attempt: observation.context.attempt },
        metadata: { ...contextMetadata(observation.context), monotonicMs: observation.monotonicMs },
      }];
    }
    case "stage_attempt_finished": {
      const handle = attemptHandle(observation.context);
      return [{
        action: "end",
        handle,
        level: outcomeLevel(observation.outcome),
        statusMessage: observation.outcome,
        output: { outcome: observation.outcome },
        metadata: { ...contextMetadata(observation.context), monotonicMs: observation.monotonicMs },
      }];
    }
    case "token_usage": {
      return [{
        action: "update",
        handle: attemptHandle(observation.context),
        metadata: {
          ...contextMetadata(observation.context),
          usage: {
            input: observation.usage.input,
            output: observation.usage.output,
            cacheRead: observation.usage.cacheRead,
            cacheWrite: observation.usage.cacheWrite,
            total: observation.usage.total,
          },
        },
      }];
    }
    case "tool_call_started": {
      return [{
        action: "start",
        handle: toolHandle(observation.toolCallId),
        type: "tool",
        name: observation.toolName,
        parentHandle: attemptHandle(observation.context),
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
        action: "end",
        handle: toolHandle(observation.toolCallId),
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
        action: "emit",
        type: "event",
        name: "stage.accepted",
        parentHandle: attemptHandle(observation.context),
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
        action: "emit",
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
