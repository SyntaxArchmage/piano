// What the stage runner needs that is not itself the runner: the retry
// schedule, the trajectory observations an attempt emits, the result
// validation, and the progress projection an acceptance is recorded with.
// Extracted verbatim from workflow-execution.ts ahead of the runner itself,
// so the runner's move has nothing left to import back.

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { abortableSleep, type AgentEvent } from "@piano/harness";
import { TRACE, type Logging } from "@piano/logging";
import type { TrajectoryRecordContext, WorkflowObservation } from "@piano/trajectory";
import type { WorkflowProgressPlan, WorkflowProgressProjection, WorkflowProgressStageCount } from "./progress.js";
import {
  WorkerContractValidationError,
} from "@piano/contract";
import { regionAncestors, regionIndex, type CompiledWorkflow, type WorkflowRetry } from "./workflow.js";
import type { WorkflowRuntimeInvocation } from "./workflow-runtime.js";
import { VALIDATE_SOURCE, WORKFLOW_LOG } from "./execution-logs.js";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";
import { validateStagePayload } from "./stage-validation.js";
import type { InternalStageResult, ResolvedStageValidation, ValidatedStagePayload } from "./execution-types.js";
import { dirname } from "node:path";

/** One resumed repair turn. A stage that declares `retry` keeps its own
 * budget on top of this for worker failures; a contract-validation failure
 * that survives this turn is accepted with a warning instead of retried. */
export const VALIDATE_REPAIR_ATTEMPTS = 1;

/** Retry waits for a stage that opted in with `retry: {}`. Deliberately much
 * longer than the harness's own `AGENT_RETRY_DELAYS_MS` (5s, 20s): by the time
 * an error reaches this layer, the harness has already spent those retries and
 * the engine has already spent its repair turn, so what is left is the
 * persistent failure. The point of the wait is to outlast a provider incident,
 * not to paper over a blip. */
export const RETRY_DEFAULT_BACKOFF_SECONDS = 30;
export const RETRY_DEFAULT_BACKOFF_MAX_SECONDS = 900;
/** Bound on the exponential factor. Without it a long unattended run reaches
 * `Infinity` and the cap stops applying exactly when it matters most. */
const RETRY_MAX_EXPONENT = 16;

/** How long to wait before retry number `retries + 1`, or `undefined` when the
 * policy allows no further retry. `retries` counts retries already performed,
 * so the first one waits `backoff` seconds.
 *
 * Pure, so the schedule is testable without waiting for it — which matters
 * because the whole point of the policy is that it can outlast a person's
 * patience. */
export function retryBackoffSeconds(
  retry: WorkflowRetry | undefined,
  retries: number,
): number | undefined {
  if (retry === undefined) return undefined;
  const attempts = retry.attempts ?? "unbounded";
  if (attempts !== "unbounded" && retries >= attempts) return undefined;
  const base = retry.backoff ?? RETRY_DEFAULT_BACKOFF_SECONDS;
  const cap = retry.backoffMax ?? RETRY_DEFAULT_BACKOFF_MAX_SECONDS;
  return Math.min(base * 2 ** Math.min(retries, RETRY_MAX_EXPONENT), cap);
}

/** Announce and perform one retry wait, returning the waited milliseconds or
 * `undefined` when there is no retry to make — the caller then fails with the
 * error it already holds.
 *
 * A wait ends early when the run is cancelled, and an interrupted wait *is* the
 * cancellation: converting a user's Escape into "retryable failure" would
 * leave a run that cannot be stopped. */
export function scheduleStageRetry(
  stageId: string,
  retry: WorkflowRetry | undefined,
  retries: number,
  reason: unknown,
  signal: AbortSignal | undefined,
): Effect.Effect<number | undefined, never, FileSystem.FileSystem | Logging> {
  const seconds = retryBackoffSeconds(retry, retries);
  if (seconds === undefined) return Effect.succeed(undefined);
  const declared = retry?.attempts;
  const delayMs = seconds * 1000;
  return Effect.gen(function* () {
    yield* WORKFLOW_LOG.warn("stage.retry.scheduled", {
      outcome: "failure",
      data: {
        id: stageId,
        retry: retries + 1,
        nextAttempt: retries + 2,
        delayMs,
        ...(declared === undefined || declared === "unbounded"
          ? { unbounded: true }
          : { remainingRetries: declared - retries - 1 }),
        reason,
      },
    }).pipe(Effect.catchAll(() => Effect.void));
    yield* abortableSleep<never>(delayMs, signal, () => Effect.interrupt);
    return delayMs;
  });
}

/** The observation one agent event implies, or undefined when it carries none.
 *
 * The context is a thunk: streaming noise (`message_update`, tool/bash deltas)
 * must not pay for a `TrajectoryRecordContext` build it will throw away. The
 * type check lives here alone so a future mapping cannot be silently dropped
 * by a gate at the call site. */
export function trajectoryAgentObservation(
  event: AgentEvent,
  context: () => TrajectoryRecordContext,
): WorkflowObservation | undefined {
  if (event.type === "tool_execution_start") {
    return {
      type: "tool_call_started",
      context: context(),
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      monotonicMs: performance.now(),
    };
  }
  if (event.type === "tool_execution_end") {
    return {
      type: "tool_call_finished",
      context: context(),
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      isError: event.isError,
      monotonicMs: performance.now(),
    };
  }
  return undefined;
}

export function attributeTrajectoryObservation(
  observation: WorkflowObservation,
  worker: { readonly sessionId: string; readonly transcriptPath: string } | undefined,
): WorkflowObservation {
  if (worker === undefined || !("context" in observation)) return observation;
  return { ...observation, context: { ...observation.context, sessionId: worker.sessionId, transcriptPath: worker.transcriptPath } };
}

/** Read and validate one attempt's result payload. The worker contract is the
 * schema-level success criterion; domain outcomes inside a valid report remain
 * explicit data for downstream stages rather than hidden orchestration rules. */
export function validateStageResult(
  validation: ResolvedStageValidation,
  resultPath: string,
  invocationId: string,
): Effect.Effect<ValidatedStagePayload, WorkerContractValidationError, FileSystem.FileSystem | Logging> {
  return TRACE(VALIDATE_SOURCE, Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem.readFileString(resultPath).pipe(
      Effect.mapError(() => new WorkerContractValidationError({
        contract: validation.id,
        message: `validation result missing: expected "${resultPath}"`,
      })),
    );
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (error) => new WorkerContractValidationError({
        contract: validation.id,
        message: `validation result is not valid JSON: ${errorMessage(error)}`,
      }),
    });
    const result = validateStagePayload(validation, parsed);
    if (!result.success) return yield* Effect.fail(result.error);
    return result.payload;
  }), { validate: validation.id, resultPath, invocationId });
}

export function ensureResultDirectory(
  resultPath: string,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(dirname(resultPath), { recursive: true }).pipe(
      Effect.mapError((cause) => workflowError("schedule", resultPath, String(cause))),
    );
  });
}

/** Build a worker-neutral progress projection from the compiled graph and
 * runtime frames. Domain payloads remain untouched; the fold writes these
 * counters into the run document. */
export function workflowProgressProjection(
  compiled: CompiledWorkflow,
  invocation: WorkflowRuntimeInvocation,
  plan: WorkflowProgressPlan,
  completedByStage: ReadonlyMap<string, number>,
  knownLoopIterations: ReadonlyMap<string, number> = new Map(),
): WorkflowProgressProjection {
  const regionsById = regionIndex(compiled.regions);
  // A duration-bound loop's denominator is only knowable from the run itself,
  // so the plan is re-derived whenever this invocation sits inside one. The
  // frames carry exactly the missing input: which iteration is running now.
  const effectiveLoopIterations = new Map(knownLoopIterations);
  for (const frame of invocation.frames) {
    if (frame.kind !== "loop") continue;
    const frameRegion = regionsById.get(frame.regionId);
    if (frameRegion?.duration !== undefined) {
      effectiveLoopIterations.set(
        frame.regionId,
        Math.max(effectiveLoopIterations.get(frame.regionId) ?? 1, frame.iteration + 1),
      );
    }
  }
  const effectivePlan = effectiveLoopIterations.size === 0
    ? plan
    : workflowProgressPlan(compiled, effectiveLoopIterations);
  const stageCounts: Readonly<Record<string, WorkflowProgressStageCount>> = Object.fromEntries(
    Object.entries(effectivePlan.stageCounts).map(([stageId, count]) => [stageId, {
      planned: count.planned,
      completed: completedByStage.get(stageId) ?? 0,
    }]),
  );
  return {
    // The per-stage counts are the totals: a stage cannot be accepted without
    // being counted, so summing them is the same number kept in one place.
    completedStages: [...completedByStage.values()].reduce((sum, count) => sum + count, 0),
    plannedStages: effectivePlan.plannedStages,
    stageCounts,
  };
}

/** Expand the statically compiled leaf table into a worker-neutral work plan.
 * Loop/map controls are part of the DSL, so a monitor can know the denominator
 * before the first model turn without inspecting a worker payload. */
export function workflowProgressPlan(
  compiled: CompiledWorkflow,
  /** Effective iteration count for loops whose runtime bound is now known.
   * Duration loops grow this count from frames; a contract-requested stop
   * shrinks a fixed loop to the number of iterations actually completed. */
  loopIterations: ReadonlyMap<string, number> = new Map(),
): WorkflowProgressPlan {
  const regionsById = regionIndex(compiled.regions);
  const stageCounts: Record<string, WorkflowProgressStageCount> = {};
  for (const stage of compiled.stages) {
    let planned = 1;
    for (const region of regionAncestors(regionsById, stage.parentId)) {
      if (region.kind === "loop") {
        const effectiveIterations = loopIterations.get(region.id);
        if (effectiveIterations !== undefined || region.duration !== undefined) {
          // `Math.max(1, …)` rather than the raw count: the current iteration is
          // the furthest one that can already hold accepted stages, so the
          // denominator stays ahead of the numerator and the snapshot validator's
          // `completed <= planned` invariant holds while the loop is open.
          planned *= Math.max(1, effectiveIterations ?? 1);
        } else {
          planned *= region.iterations ?? 1;
        }
      } else {
        planned *= region.count ?? 1;
      }
    }
    stageCounts[stage.id] = { planned, completed: 0 };
  }
  return {
    plannedStages: Object.values(stageCounts).reduce((sum, count) => sum + count.planned, 0),
    stageCounts,
  };
}

export function projectionString(result: InternalStageResult, id: string): string | undefined {
  const value = resultProjectionValue(result, id);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function projectionNumber(result: InternalStageResult, id: string): number | undefined {
  const value = resultProjectionValue(result, id);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function resultProjectionValue(result: InternalStageResult, id: string): unknown {
  return result.projections?.find((projection) => projection.id === id)?.value;
}
