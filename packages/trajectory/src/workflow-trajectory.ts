import { Effect } from "effect";
import {
  BenchmarkRecorder,
  DurationRecorder,
  SelectionRecorder,
  TokenUsageRecorder,
  ToolCallRecorder,
} from "./recorders.js";
import { trajectoryIndexSchema } from "./schemas.js";
import { readTrajectoryIndex, writeTrajectoryIndex } from "./storage.js";
import type {
  TrajectoryIndex,
  TrajectoryIndexStream,
  WorkflowObservation,
  WorkflowObservationRecorder,
} from "./types.js";

export type WorkflowTrajectoryStatus = "completed" | "failed" | "cancelled";

export class WorkflowTrajectory {
  private status: TrajectoryIndex["status"] = "running";
  private readonly streams: TrajectoryIndexStream[];
  private readonly semaphore = Effect.unsafeMakeSemaphore(1);

  private constructor(
    readonly runDir: string,
    readonly runId: string,
    readonly recorders: readonly WorkflowObservationRecorder[],
  ) {
    this.streams = recorders.map((recorder) => ({
      ...recorder.descriptor,
      status: "running",
      errors: [],
    }));
  }

  static open(
    runDir: string,
    runId: string,
    recorders: readonly WorkflowObservationRecorder[] = defaultTrajectoryRecorders(runDir),
  ): Effect.Effect<WorkflowTrajectory, never, import("@effect/platform").FileSystem.FileSystem> {
    const trajectory = new WorkflowTrajectory(runDir, runId, recorders);
    return Effect.gen(function* () {
      const previous = yield* readTrajectoryIndex(runDir, trajectoryIndexSchema).pipe(Effect.either);
      if (previous._tag === "Left") {
        trajectory.recordIndexError(`resume read: ${previous.left.message}`);
      } else if (previous.right !== undefined) {
        if (previous.right.runId !== runId) {
          trajectory.recordIndexError(
            `existing index belongs to execution ${previous.right.runId}, not ${runId}`,
          );
        } else {
          if (previous.right.status === "running") {
            trajectory.recordIndexError("existing trajectory was not closed before resume");
          }
          for (const prior of previous.right.streams) {
            const current = trajectory.streams.find((stream) => stream.id === prior.id);
            if (current === undefined) {
              trajectory.streams.push(prior.status === "running"
                ? {
                    ...prior,
                    status: "error",
                    errors: [...prior.errors, "stream was left running and has no recorder on resume"],
                  }
                : prior);
              continue;
            }
            if (current.schema !== prior.schema || current.path !== prior.path) {
              trajectory.recordStreamError(
                current.id,
                `descriptor changed from ${prior.schema} at ${prior.path}`,
              );
            }
            if (prior.status === "running") {
              trajectory.recordStreamError(current.id, "stream was left running before resume");
            }
            if (prior.status === "error") {
              const errors = prior.errors.length === 0
                ? ["stream previously failed without an error detail"]
                : prior.errors;
              for (const error of errors) trajectory.recordStreamError(current.id, error);
            }
          }
        }
      }
      for (const recorder of recorders) {
        if (recorder.initialize === undefined) continue;
        const initialized = yield* recorder.initialize(runDir).pipe(Effect.either);
        if (initialized._tag === "Left") trajectory.recordStreamError(recorder.descriptor.id, initialized.left.message);
      }
      yield* trajectory.persistIndex().pipe(
        Effect.catchAll((error) => Effect.sync(() => trajectory.recordIndexError(error.message))),
      );
      return trajectory;
    });
  }

  observe(
    observation: WorkflowObservation,
  ): Effect.Effect<void, never, import("@effect/platform").FileSystem.FileSystem> {
    return this.semaphore.withPermits(1)(Effect.gen(this, function* () {
      for (const recorder of this.recorders) {
        const result = yield* recorder.observe(observation).pipe(Effect.either);
        if (result._tag === "Left") this.recordStreamError(recorder.descriptor.id, result.left.message);
      }
      yield* this.persistIndex().pipe(Effect.catchAll((error) => Effect.sync(() => this.recordIndexError(error.message))));
    }));
  }

  close(
    status: WorkflowTrajectoryStatus,
  ): Effect.Effect<void, never, import("@effect/platform").FileSystem.FileSystem> {
    return this.semaphore.withPermits(1)(Effect.gen(this, function* () {
      this.status = status;
      for (let index = 0; index < this.streams.length; index += 1) {
        const stream = this.streams[index];
        if (stream?.status === "running") this.streams[index] = { ...stream, status: "completed" };
      }
      yield* this.persistIndex().pipe(
        Effect.catchAll((error) => Effect.sync(() => this.recordIndexError(error.message))),
      );
    }));
  }

  snapshot(): TrajectoryIndex {
    return {
      version: 1,
      runId: this.runId,
      updatedAt: new Date().toISOString(),
      status: this.status,
      streams: this.streams,
    };
  }

  private persistIndex() {
    return writeTrajectoryIndex(this.runDir, this.snapshot());
  }

  private recordStreamError(id: string, message: string): void {
    const index = this.streams.findIndex((stream) => stream.id === id);
    const stream = this.streams[index];
    if (index < 0 || stream === undefined) return;
    this.streams[index] = {
      ...stream,
      status: "error",
      errors: stream.errors.includes(message) ? stream.errors : [...stream.errors, message],
    };
  }

  private recordIndexError(message: string): void {
    for (let index = 0; index < this.streams.length; index += 1) {
      const stream = this.streams[index];
      if (stream === undefined) continue;
      this.streams[index] = {
        ...stream,
        status: "error",
        errors: stream.errors.includes(`trajectory index: ${message}`)
          ? stream.errors
          : [...stream.errors, `trajectory index: ${message}`],
      };
    }
  }
}

export function defaultTrajectoryRecorders(runDir: string): readonly WorkflowObservationRecorder[] {
  return [
    new BenchmarkRecorder(runDir),
    new DurationRecorder(runDir),
    new TokenUsageRecorder(runDir),
    new ToolCallRecorder(runDir),
    new SelectionRecorder(runDir),
  ];
}
