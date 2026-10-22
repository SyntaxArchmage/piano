// The two job-level commands beside a prompt: `/continue` resumes the latest
// job from its cursor, and `/restart` runs the latest job's input again as a
// fresh one (closing the paused job in the same state transition). Legality is
// the run's status alone — the one lifecycle every module reads; the job table
// only supplies the input and the cursor. One run has at most one unfinished
// job, and it is the latest: an older paused job is retired and never offered.
import {
  type RunStatus,
  type WorkflowProgressRegionFinalizedRecord,
} from "@piano/orchestrator";

/** The two job-level commands beside a prompt. */
export type JobCommand = "continue" | "restart";

/** Whether a job command applies to a run in this status.
 *
 * Status is the whole test: a fresh run has none, a running one has nothing
 * to act on yet, and both commands are about work that already stopped.
 * `/continue` resumes a paused job; `/restart` re-runs the last one, so it
 * accepts a paused or finished run. `cancelled` is a run with no job to name.
 */
export function jobCommandAllowed(
  command: JobCommand,
  status: RunStatus["status"] | undefined,
): boolean {
  return command === "continue"
    ? status === "paused"
    : status === "paused" || status === "completed" || status === "failed";
}

/** What `/continue` resolved to: resume this job from the cursor it left. */
interface ContinueCommand {
  readonly input: string;
  readonly jobOrdinal: number;
  readonly accepted: ReadonlySet<string>;
  readonly attempts: ReadonlyMap<string, number>;
  readonly regions?: ReadonlyMap<string, WorkflowProgressRegionFinalizedRecord>;
}

/** What `/restart` resolved to: run the input again as a fresh job. */
interface RestartCommand {
  readonly input: string;
  /** Present when the run is paused: the job the restart closes in its one
   * state transition. Absent when the latest job already ended. */
  readonly restartOrdinal?: number;
}

/** A command that can be run, or the reason there is nothing to run. */
export type Resolved<Command> =
  | { readonly kind: "run"; readonly command: Command }
  | { readonly kind: "refused"; readonly reason: string };

/** Resolve `/continue` from the run's status. The status is the whole
 * legality test; the latest job supplies the cursor. */
export function resolveContinueCommand(
  status: RunStatus | undefined,
): Resolved<ContinueCommand> {
  if (!jobCommandAllowed("continue", status?.status)) {
    return { kind: "refused", reason: "no paused job to continue" };
  }
  const latest = status?.jobs.at(-1);
  if (latest?.input === undefined) return { kind: "refused", reason: "the paused job's input is not recorded" };
  return {
    kind: "run",
    command: {
      input: latest.input,
      jobOrdinal: latest.jobOrdinal,
      accepted: new Set(latest.accepted.map((item) => item.invocationId)),
      attempts: new Map(Object.entries(latest.attempts)),
      ...(latest.regions === undefined ? {} : { regions: new Map(Object.entries(latest.regions)) }),
    },
  };
}

/** Resolve `/restart` from the run's status: the latest job's input runs again
 * as a fresh job. A paused run hands the engine the ordinal to close in the
 * same transition; a finished one has nothing left to close. */
export function resolveRestartCommand(
  status: RunStatus | undefined,
): Resolved<RestartCommand> {
  if (!jobCommandAllowed("restart", status?.status)) {
    return {
      kind: "refused",
      reason: status?.status === "running"
        ? "a job is running; interrupt it first"
        : "this run has no job to restart",
    };
  }
  const latest = status?.jobs.at(-1);
  if (latest?.input === undefined) return { kind: "refused", reason: "the job's input is not recorded" };
  return {
    kind: "run",
    command: {
      input: latest.input,
      ...(status?.status === "paused" ? { restartOrdinal: latest.jobOrdinal } : {}),
    },
  };
}
