import type { TurnOutcome } from "@piano/base";
import { Effect } from "effect";
import {
  BenchmarkRecorder,
  DurationRecorder,
  SelectionRecorder,
  TokenUsageRecorder,
  ToolCallRecorder,
} from "./recorders.js";
import type {
  TrajectoryStreamDescriptor,
  WorkflowObservation,
  WorkflowObservationRecorder,
} from "./types.js";
import type { WorkflowObservationExport } from "./export.js";

/** One recorder stream's health while the run is live. Nothing is persisted:
 * the stream files are the evidence, and a reader derives their health by
 * reading them. */
export interface WorkflowTrajectoryStream extends TrajectoryStreamDescriptor {
  readonly status: "running" | "completed" | "error";
  readonly errors: readonly string[];
}

export interface WorkflowTrajectorySnapshot {
  readonly status: TurnOutcome | "running";
  readonly streams: readonly WorkflowTrajectoryStream[];
}

/** The run's eval-metric recorders, held in memory for the run's lifetime.
 *
 * The recorders append to their own stream files under `eval-metrics/`; this
 * class only fans observations out to them and remembers which stream failed,
 * so the orchestrator can log an incomplete-evidence warning. There is no
 * index document: a stream's health is a property of its file, not a second
 * record that can disagree with it.
 */
export class WorkflowTrajectory {
  private status: TurnOutcome | "running" = "running";
  private readonly streams: WorkflowTrajectoryStream[];
  private readonly semaphore = Effect.unsafeMakeSemaphore(1);

  private constructor(
    readonly runDir: string,
    readonly runId: string,
    readonly recorders: readonly WorkflowObservationRecorder[],
    readonly exports: readonly WorkflowObservationExport[] = [],
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
    exports: readonly WorkflowObservationExport[] = [],
  ): Effect.Effect<WorkflowTrajectory, never, import("@effect/platform").FileSystem.FileSystem> {
    const trajectory = new WorkflowTrajectory(runDir, runId, recorders, exports);
    return Effect.gen(function* () {
      for (const recorder of recorders) {
        if (recorder.initialize === undefined) continue;
        const initialized = yield* recorder.initialize(runDir).pipe(Effect.either);
        if (initialized._tag === "Left") trajectory.recordStreamError(recorder.descriptor.id, initialized.left.message);
      }
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
      // Export sinks are best-effort: a network failure or defect must not
      // mark the local stream incomplete, so it never touches stream health.
      for (const exporter of this.exports) {
        yield* exporter.export(observation).pipe(Effect.catchAllCause(() => Effect.void));
      }
    }));
  }

  close(
    status: TurnOutcome,
  ): Effect.Effect<void, never, import("@effect/platform").FileSystem.FileSystem> {
    return this.semaphore.withPermits(1)(Effect.sync(() => {
      this.status = status;
      for (let index = 0; index < this.streams.length; index += 1) {
        const stream = this.streams[index];
        if (stream?.status === "running") this.streams[index] = { ...stream, status: "completed" };
      }
    }));
  }

  snapshot(): WorkflowTrajectorySnapshot {
    return { status: this.status, streams: this.streams };
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
