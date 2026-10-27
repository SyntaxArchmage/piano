/**
 * Run-scoped queue for async stages.
 *
 * One worker slot: async tasks execute one at a time even when several loop
 * iterations enqueue them. Each completed task is delivered to every direct
 * consumer stage exactly once; a consumer never takes another consumer's copy.
 * The queue owns scheduling and the ready-result registry; the stage runner
 * owns acceptance, progress, and actor state.
 */
import { FileSystem } from "@effect/platform";
import { Effect, Fiber } from "effect";
import { failureDetails, type Logging } from "@piano/logging";
import { WORKFLOW_LOG } from "./execution-logs.js";
import type { InternalStageResult } from "./execution-types.js";
import type { WorkflowExecutionError } from "./workflow-execution.js";

export interface AsyncStageTask {
  readonly stageId: string;
  /** Static consumer stage ids. Each receives this task's result once. */
  readonly consumers: readonly string[];
  readonly run: Effect.Effect<
    InternalStageResult,
    WorkflowExecutionError,
    FileSystem.FileSystem | Logging
  >;
}

interface AsyncTaskRecord {
  readonly stageId: string;
  readonly consumers: readonly string[];
  readonly consumedBy: Set<string>;
  settled: boolean;
  result?: InternalStageResult;
  failure?: WorkflowExecutionError;
}

/** FIFO-by-submission, serial execution. `consume` never waits: a consumer
 * takes its own completed copies and starts without the rest. */
export class AsyncStageQueue {
  private readonly slot: Effect.Semaphore = Effect.unsafeMakeSemaphore(1);
  private readonly tasks = new Map<string, AsyncTaskRecord[]>();
  private readonly fibers: Fiber.RuntimeFiber<void, never>[] = [];

  submit(task: AsyncStageTask): Effect.Effect<void, never, FileSystem.FileSystem | Logging> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const queue = this;
    return Effect.gen(function* () {
      const record: AsyncTaskRecord = {
        stageId: task.stageId,
        consumers: task.consumers,
        consumedBy: new Set(),
        settled: false,
      };
      const existing = queue.tasks.get(task.stageId) ?? [];
      existing.push(record);
      queue.tasks.set(task.stageId, existing);
      const worker: Effect.Effect<void, never, FileSystem.FileSystem | Logging> = queue.slot.withPermits(1)(Effect.gen(function* () {
        const outcome = yield* Effect.either(task.run);
        if (outcome._tag === "Right") {
          record.result = outcome.right;
        } else {
          record.failure = outcome.left;
          yield* WORKFLOW_LOG.warn("stage.async.failed", {
            outcome: "failure",
            data: {
              stageId: task.stageId,
              error: failureDetails(outcome.left),
            },
          }).pipe(Effect.catchAll(() => Effect.void));
        }
        record.settled = true;
        if (record.consumers.length === 0) queue.prune(task.stageId);
      }));
      const fiber = yield* Effect.fork(worker);
      queue.fibers.push(fiber);
    });
  }

  /** Take the completed tasks this consumer stage has not received yet. The
   * task remains available to its other direct consumers. */
  consume(
    stageIds: readonly string[],
    consumerStageId: string,
  ): Effect.Effect<readonly InternalStageResult[], WorkflowExecutionError> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const queue = this;
    return Effect.gen(function* () {
      const consumed: InternalStageResult[] = [];
      let failure: WorkflowExecutionError | undefined;
      for (const stageId of stageIds) {
        const records = queue.tasks.get(stageId) ?? [];
        for (const record of records) {
          if (!record.settled ||
            !record.consumers.includes(consumerStageId) ||
            record.consumedBy.has(consumerStageId)) {
            continue;
          }
          record.consumedBy.add(consumerStageId);
          if (record.failure !== undefined) failure ??= record.failure;
          else if (record.result !== undefined) consumed.push(record.result);
        }
        queue.prune(stageId);
      }
      if (failure !== undefined) return yield* Effect.fail(failure);
      return consumed;
    });
  }

  /** Stage ids with at least one task this consumer is still waiting for. */
  pendingFor(
    stageIds: readonly string[],
    consumerStageId: string,
  ): Effect.Effect<readonly string[]> {
    return Effect.sync(() => stageIds.filter((stageId) =>
      (this.tasks.get(stageId) ?? []).some((record) =>
        !record.settled && record.consumers.includes(consumerStageId))));
  }

  /** Fail the run when a settled async task has no consumer left to report it.
   * The stage runner surfaces targeted failures through `consume`; this is the
   * final backstop for a task none of its consumers reached. */
  assertHealthy(): Effect.Effect<void, WorkflowExecutionError> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const queue = this;
    return Effect.gen(function* () {
      for (const records of queue.tasks.values()) {
        for (const record of records) {
          if (record.failure !== undefined) return yield* Effect.fail(record.failure);
        }
      }
    });
  }

  /** Wait for all submitted tasks to settle. Used by tests and by a caller
   * that wants a clean boundary before consuming another batch. */
  idle(): Effect.Effect<void> {
    return Effect.forEach(this.fibers, (fiber) => Fiber.await(fiber), { discard: true });
  }

  /** Interrupt every queued/running task. Completed results stay readable but
   * are no longer joined after the run has ended. */
  shutdown(): Effect.Effect<void> {
    return Effect.forEach(this.fibers, (fiber) => Fiber.interrupt(fiber), { discard: true });
  }

  private prune(stageId: string): void {
    const records = this.tasks.get(stageId);
    if (records === undefined) return;
    const remaining = records.filter((record) =>
      !record.settled || record.consumedBy.size < record.consumers.length);
    if (remaining.length === 0) this.tasks.delete(stageId);
    else this.tasks.set(stageId, remaining);
  }
}
