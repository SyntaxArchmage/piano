// The two job-level commands beside a prompt: `/continue` resumes the latest
// job from its cursor, and `/restart` closes the latest job and runs its input
// again as a fresh one. Both read the job's input from the job itself — the
// state document records it with the job — so turn positions, which continues
// make ambiguous, are never consulted. One run has at most one unfinished job,
// and it is the latest: an older paused job is retired and never offered.
import { type RunJob, type RunStatus } from "@piano/orchestrator";

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
export interface ContinueCommand {
  readonly input: string;
  readonly jobOrdinal: number;
  readonly accepted: ReadonlySet<string>;
  readonly attempts: ReadonlyMap<string, number>;
}

/** What `/restart` resolved to: run the input again as a fresh job, closing
 * the paused job it replaces first. */
export interface RestartCommand {
  readonly input: string;
  /** Absent when the latest job already ended and only the re-run is left. */
  readonly closeOrdinal?: number;
}

/** A command that can be run, or the reason there is nothing to run. */
export type Resolved<Command> =
  | { readonly kind: "run"; readonly command: Command }
  | { readonly kind: "refused"; readonly reason: string };

/** Resolve `/continue`: only the latest job can be paused work. An older
 * paused job was left behind by the run's progress and is retired — continuing
 * it would run evidence the newer job has already superseded. */
export function resolveContinueCommand(
  jobList: readonly RunJob[],
): Resolved<ContinueCommand> {
  const latest = jobList.at(-1);
  if (latest?.state !== "paused") return { kind: "refused", reason: "no paused job to continue" };
  if (latest.input === undefined) return { kind: "refused", reason: "the paused job's input is not recorded" };
  return {
    kind: "run",
    command: {
      input: latest.input,
      jobOrdinal: latest.jobOrdinal,
      accepted: new Set(latest.accepted.map((item) => item.invocationId)),
      attempts: new Map(Object.entries(latest.attempts)),
    },
  };
}

/** Resolve `/restart`: the latest job's input runs again as a fresh job. A
 * paused job is closed explicitly, because only that makes it stop being
 * offered to `/continue`; a finished one has nothing left to close. */
export function resolveRestartCommand(
  jobList: readonly RunJob[],
): Resolved<RestartCommand> {
  const latest = jobList.at(-1);
  if (latest === undefined) return { kind: "refused", reason: "this run has no job to restart" };
  if (latest.state === "alive") return { kind: "refused", reason: "a job is running; interrupt it first" };
  if (latest.input === undefined) return { kind: "refused", reason: "the job's input is not recorded" };
  return {
    kind: "run",
    command: {
      input: latest.input,
      ...(latest.state === "paused" ? { closeOrdinal: latest.jobOrdinal } : {}),
    },
  };
}
