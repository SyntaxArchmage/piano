import type { Effect } from "effect";
import type { WorkflowObservation } from "./types.js";

/** External export sink for workflow observations.
 *
 * Sibling to `WorkflowObservationRecorder`, not a recorder: a recorder's
 * failure marks the local `eval-metrics` stream incomplete, while an export
 * sink is best-effort and must never fail the run or the local evidence. */
export interface WorkflowObservationExport {
  readonly id: string;
  export(observation: WorkflowObservation): Effect.Effect<void, never>;
  /** Push pending work now. Optional: a sink with nothing buffered may omit it. */
  flush?(): Effect.Effect<void, never>;
}
