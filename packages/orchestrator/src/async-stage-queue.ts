/**
 * Run-scoped queue for async stages.
 *
 * One worker slot: async tasks execute one at a time even when several loop
 * iterations enqueue them. The queue owns only scheduling and the ready-result
 * registry; the stage runner owns acceptance, progress, and actor state.
 */
import { FileSystem } from "@effect/platform";
import { Effect, Fiber } from "effect";
import { failureDetails, type Logging } from "@piano/logging";
import { WORKFLOW_LOG } from "./execution-logs.js";
import type { InternalStageResult } from "./execution-types.js";
import type { WorkflowExecutionError } from "./workflow-execution.js";

export interface AsyncStageTask {
  readonly stageId: string;
  readonly run: Effect.Effect<
    InternalStageResult,
    WorkflowExecutionError,
    FileSystem.FileSystem | Logging
  >;
}

/** FIFO-by-submission, serial execution. `collect` never waits: a consumer
 * takes whatever has finished and starts without the rest. */
export class AsyncStageQueue {
  private readonly slot: Effect.Semaphore = Effect.unsafeMakeSemaphore(1);
  private readonly results = new Map<string, InternalStageResult[]>();
  private readonly pending = new Map<string, number>();
  private readonly fibers: Fiber.RuntimeFiber<void, never>[] = [];

  submit(task: AsyncStageTask): Effect.Effect<void, never, FileSystem.FileSystem | Logging> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const queue = this;
    return Effect.gen(function* () {
      queue.pending.set(task.stageId, (queue.pending.get(task.stageId) ?? 0) + 1);
      const worker: Effect.Effect<void, never, FileSystem.FileSystem | Logging> = queue.slot.withPermits(1)(Effect.gen(function* () {
        const outcome = yield* Effect.either(task.run);
        if (outcome._tag === "Right") {
          const existing = queue.results.get(task.stageId) ?? [];
          existing.push(outcome.right);
          queue.results.set(task.stageId, existing);
        } else {
          yield* WORKFLOW_LOG.warn("stage.async.failed", {
            outcome: "failure",
            data: {
              stageId: task.stageId,
              error: failureDetails(outcome.left),
            },
          }).pipe(Effect.catchAll(() => Effect.void));
        }
        const remaining = (queue.pending.get(task.stageId) ?? 1) - 1;
        if (remaining <= 0) queue.pending.delete(task.stageId);
        else queue.pending.set(task.stageId, remaining);
      }));
      const fiber = yield* Effect.fork(worker);
      queue.fibers.push(fiber);
    });
  }

  /** All completed results for the requested static stage ids, oldest first. */
  collect(stageIds: readonly string[]): Effect.Effect<readonly InternalStageResult[]> {
    return Effect.sync(() => stageIds.flatMap((stageId) => this.results.get(stageId) ?? []));
  }

  /** Static stage ids with at least one task still queued or running. */
  pendingFor(stageIds: readonly string[]): Effect.Effect<readonly string[]> {
    return Effect.sync(() => stageIds.filter((stageId) => (this.pending.get(stageId) ?? 0) > 0));
  }

  /** Interrupt every queued/running task. Completed results stay readable but
   * are no longer joined after the run has ended. */
  shutdown(): Effect.Effect<void> {
    return Effect.forEach(this.fibers, (fiber) => Fiber.interrupt(fiber), { discard: true });
  }
}
