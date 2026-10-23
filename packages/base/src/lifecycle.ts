// The vocabulary of "how did this end". One spelling per lifecycle, so the same
// words cannot drift between the package that writes a run and the packages
// that read it.
//
// These are the enums, not the modules that own them: a run has a status, a
// turn has an outcome, and a stage's approval is a third. Each is declared once
// and every consumer names it.

/** How a run is doing, as `status.json` records it.
 *
 * This is the whole lifecycle a run has. A name that reads a run must read this
 * one; a second enum describing the same run is the drift this type exists to
 * prevent. */
export type RunLifecycleStatus = "running" | "completed" | "failed" | "paused" | "cancelled";

/** Every run status that is not still working. A paused run is at rest too: the
 * process is gone and the human decides whether to continue, restart, or leave
 * it. */
export const RESTING_RUN_STATUSES: ReadonlySet<RunLifecycleStatus> = new Set([
  "completed",
  "failed",
  "paused",
  "cancelled",
]);

/** Every run status, for the readers that validate a document's value instead
 * of matching on it. Spelled once, so a new status cannot reach one reader and
 * miss another. */
export const RUN_LIFECYCLE_STATUSES: ReadonlySet<RunLifecycleStatus> = new Set<RunLifecycleStatus>([
  "running",
  ...RESTING_RUN_STATUSES,
]);

/** How one prompt's turn ended. A turn is the unit the trajectory replays, so
 * it is also the unit `resume` slices events by. */
export type TurnOutcome = "completed" | "failed" | "cancelled";

/** How one execution ended, when the workflow itself says so. `paused` is a
 * human stop rather than a verdict, so it is a distinct member: a run that
 * paused has no outcome, only a place to continue from. */
export type ExecutionOutcome = "completed" | "failed" | "paused";

/** The verdict a finished job carries as history. `restarted` records a job a
 * `/restart` abandoned, so its evidence stays attributable while it stops being
 * continuable. */
export type JobOutcome = "completed" | "failed" | "restarted";

/** Where one invocation stands. `accepted` means the orchestrator took the
 * worker's result; it is not the same question as whether the run is working. */
export type InvocationStatus = "running" | "accepted" | "failed";