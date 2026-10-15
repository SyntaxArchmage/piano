// The two job-level commands beside a prompt: `/continue` resumes the most
// recent paused job from its cursor, and `/restart` closes the latest job and
// runs its input again as a fresh one. Both read the job's input from the job
// itself — the stream records it with the job — so turn positions, which
// continues make ambiguous, are never consulted.
import { type RunJob } from "@piano/orchestrator";

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

/** Resolve `/continue`: the most recent paused job wins, even when a newer job
 * has since finished — the alive job is by construction the latest, so any
 * paused job is an older one waiting for exactly this command. */
export function resolveContinueCommand(
  jobList: readonly RunJob[],
): Resolved<ContinueCommand> {
  const paused = jobList.filter((job) => job.state === "paused").at(-1);
  if (paused === undefined) return { kind: "refused", reason: "no paused job to continue" };
  if (paused.input === undefined) return { kind: "refused", reason: "the paused job's input is not recorded" };
  return {
    kind: "run",
    command: {
      input: paused.input,
      jobOrdinal: paused.jobOrdinal,
      accepted: new Set(paused.accepted),
      attempts: new Map(Object.entries(paused.attempts)),
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
