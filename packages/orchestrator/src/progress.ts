import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type { WorkflowError } from "./errors.js";
import {
  acceptedInvocationOf,
  emptyRunStatus,
  nextJobOrdinal,
  readRunStatus,
  runStatusPath,
  writeRunStatus,
  type RunJob,
  type RunStatus,
} from "./run-status.js";
import type { SelectionIncumbent } from "./selection.js";
import type { AgentContinuation } from "@piano/harness";
import type { ExecutionOutcome, InvocationStatus } from "@piano/base";

/** Orchestrator-owned, worker-neutral progress counters. The fold takes the
 * counts from here and writes them to the run document; the labels and lane
 * coordinates a monitor used to build from this object had no reader, so they
 * are gone. */
export interface WorkflowProgressProjection {
  /** Number of validated stage invocations accepted so far. Nothing counts
   * "completed" separately: an acceptance IS the completion. */
  readonly completedStages: number;
  readonly plannedStages: number;
  /** Static stage ids are workflow-owned, not worker-owned. Their planned
   * counts include loop/map expansion and completed counts come only from
   * accepted invocations. */
  readonly stageCounts: Readonly<Record<string, WorkflowProgressStageCount>>;
}

export interface WorkflowProgressStageCount {
  readonly planned: number;
  readonly completed: number;
}

/** Cumulative worker time for one runtime invocation. Keyed by invocation id
 * because that is the only key that keeps work apart where it belongs apart:
 * summing every invocation of one static stage accumulates a loop's iterations
 * (`iter 0 + iter 1 + ...`), while `instanceId` still identifies the
 * concurrent lane of a map invocation. */
export interface WorkflowProgressInvocationTime {
  /** Static stage this invocation belongs to. */
  readonly stageId: string;
  /** Runtime instance id (`regionId/iter-N`, `regionId/slot-N/…`) when the
   * invocation runs inside a loop or map region. Mirrors
   * `WorkflowProgressRecord.instanceId`. */
  readonly instanceId?: string;
  /** Sum of the spans already finished, in milliseconds. A retried invocation
   * accumulates here instead of overwriting the attempt it replaced. */
  readonly completedMs?: number;
  /** ISO start of the span in flight. A live viewer adds `now - runningSince`,
   * which is what lets the footer tick a running stage between snapshots. */
  readonly runningSince?: string;
}

export interface WorkflowProgressPlan {
  readonly plannedStages: number;
  readonly stageCounts: Readonly<Record<string, WorkflowProgressStageCount>>;
}

/** The invocation in flight, or the last one accepted. Readers use it to say
 * where a run is: `stageId` and `status` for the workflow graph, `invocationId`
 * for the evidence, `iteration` for a loop's iteration. */
export interface WorkflowProgressCurrent {
  readonly status: InvocationStatus;
  readonly invocationId: string;
  readonly stageId: string;
  readonly stage: string;
  readonly worker: string;
  readonly attempt: number;
  /** Runtime instance id of this invocation, so a status reader can tell a
   * map lane from a loop iteration without re-deriving the runtime frames. */
  readonly instanceId?: string;
  readonly iteration?: number;
  readonly error?: string;
}

/** One accepted stage's payload, folded into the state document's counters
 * and current pointer. This is separate from the agent transcript: the
 * transcript explains how the worker reasoned, while this states what the
 * orchestrator accepted.
 *
 * It carries what the fold reads and nothing else. The rest of an acceptance
 * — the workspace binding, the harness and session, the result file and its
 * content pin, the metrics, the projections, the requested and effective
 * model, the contract — is evidence the `invocation-accepted` row and the
 * result file already hold, and the fold never asks this record for it. */
export interface WorkflowProgressRecord {
  readonly timestamp: string;
  readonly runId: string;
  readonly invocationId: string;
  readonly stageId: string;
  readonly stage: string;
  readonly worker: string;
  readonly instanceId?: string;
  readonly iteration?: number;
  readonly attempt: number;
  /** The counters the fold writes into the document. */
  readonly progress: WorkflowProgressProjection;
}

/** One invocation starting.
 *
 * The document records starts as well as acceptances because "which invocation
 * is in flight, and since when" is not derivable from acceptance records
 * alone. */
export interface WorkflowProgressStartRecord {
  readonly kind: "stage-started";
  readonly timestamp: string;
  readonly runId: string;
  readonly invocationId: string;
  readonly stageId: string;
  readonly stage: string;
  readonly worker: string;
  readonly attempt: number;
  readonly instanceId?: string;
  readonly iteration?: number;
  /** Why this attempt is running: set when a failed validation reopened the
   * actor for a repair turn. */
  readonly error?: string;
}

/** One workflow execution beginning.
 *
 * Marks where this execution's progress starts — and, once one session hosts
 * more than one execution, where one execution ends and the next begins.
 *
 * It carries the plan because planned stage counts come from the compiled
 * workflow, not from anything a stage could report. */
export interface WorkflowProgressExecutionStartRecord {
  readonly kind: "execution-started";
  readonly timestamp: string;
  readonly runId: string;
  /** The job this span belongs to: one prompt's workflow execution. A fresh
   * job takes the next ordinal; a span that resumes a paused job repeats its
   * predecessor's, which is what ties a continue back to the job it continues.
   * Absent in pre-job documents, where every span is its own job. */
  readonly jobOrdinal?: number;
  /** The input this job runs — the prompt the human submitted. Kept with the
   * job so `/continue` and `/restart` can re-run it without chasing turn
   * positions, which continues make ambiguous. Absent in older documents. */
  readonly prompt?: string;
  /** True when this execution continues actors a previous one left behind. */
  readonly resumed: boolean;
  /** The job this span replaces: `/restart` closes it as `restarted` in the
   * same transition that starts this one. Present only on a restart, so a
   * closed-alone job is not expressible. */
  readonly closesJobOrdinal?: number;
  /** The run's lane namespace (`<task-slug>-<runId>`), recorded so a continue
   * reuses it instead of re-summarizing the prompt. Absent in older documents. */
  readonly mnemonic?: string;
  readonly plan: WorkflowProgressPlan;
}

/** The transition that ends one execution. It carries the outcome itself, so
 * a hard exit before any other evidence lands still says how the run stopped. */
export interface WorkflowProgressExecutionFinishRecord {
  readonly kind: "execution-finished";
  readonly timestamp: string;
  readonly runId: string;
  readonly status: ExecutionOutcome;
  readonly error?: string;
}

/** One loop iteration's orchestrator commit: the iteration index and the hash
 * the iteration's workspace changes landed in. Recorded on the loop's
 * `region-finalized` evidence so a resumed or audited run can find the
 * commit without reading the log. */
export interface WorkflowLoopCommitRecord {
  readonly iteration: number;
  readonly commit: string;
}

/** One region's exit, recorded exactly once when the region leaves the
 * schedule: which instance ended, why, and — for a tournament — who won.
 * A continue reads it to skip a completed region instead of re-running its
 * workers, and a monitor reads it to see why a loop stopped. */
export interface WorkflowProgressRegionFinalizedRecord {
  readonly kind: "region-finalized";
  readonly timestamp: string;
  readonly runId: string;
  readonly jobOrdinal: number;
  /** `<frame chain>/<regionId>` — `runtimeRegionInstanceId`'s output, whose
   * inverse is `runtimeFramesFromInstanceId`: the chain is `root` (no frames)
   * or `regionId/iter-N` / `regionId/slot-K` pairs joined by `/`. Written and
   * read through those two functions so the two can never disagree. */
  readonly instance: string;
  readonly regionId: string;
  readonly regionKind: "map" | "loop";
  /** How the region's schedule ended. "the region ended early" is derived,
   * not stored: `outcome === "terminal-blocked"` for a blocked region, or
   * `notCarriedReason === "stopped"` for a tournament whose winner was
   * stopped/blocked and could not be carried. */
  readonly outcome:
    | "carried"
    | "admitted-not-carried"
    | "no-winner"
    | "terminal-blocked"
    | "bound-iterations"
    | "bound-duration";
  /** Orthogonal to `outcome`: why the winning slot was not carried —
   * the admission gate rejected it, or the winner itself was stopped. */
  readonly notCarriedReason?: "admission" | "stopped";
  /** The winning slot's runtime instance — the identity a skip filters the
   * boundary by. The workspace key is deliberately not stored: it is a path
   * spelling, derivable from the instance where a consumer needs it. */
  readonly winnerInstanceId?: string;
  /** The tournament incumbent the admission gate compares against, as the
   * region left it. A skipped region restores it so a later iteration's
   * admission check compares against the same basis. */
  readonly incumbent?: SelectionIncumbent;
  /** Completed iterations for a loop region at the moment it exited. */
  readonly iterations?: number;
  /** Commits the loop made, in iteration order. A non-git workspace records
   * none: it has no commit target. */
  readonly commits?: readonly WorkflowLoopCommitRecord[];
}

/** Everything a writer must supply for a `region-finalized` transition; the
 * commit seam stamps the timestamp, the execution stamps identity. */
export type WorkflowRegionFinalizedPayload = Omit<
  WorkflowProgressRegionFinalizedRecord,
  "kind" | "timestamp" | "runId" | "jobOrdinal"
>;

/** One actor's conversation state after a turn that changed it. The transition
 * exists so the actor table a resume reads has one source: newest record per
 * `actorKey` wins.
 * `continuation` is the harness's own pointer into the conversation and is
 * copied verbatim — never synthesized — because a fabricated one would resume
 * the wrong session silently. Unlike the document's complete actor table,
 * this is a delta: the fields are exactly what the writer set. */
export interface WorkflowProgressActorTurnRecord {
  readonly kind: "actor-turn";
  readonly timestamp: string;
  readonly runId: string;
  readonly jobOrdinal: number;
  readonly invocationId: string;
  readonly attempt: number;
  readonly actorKey: string;
  readonly harness: string;
  readonly worker: string;
  /** The map-frame lane the actor belongs to (`root` when it has none): the
   * lane part of `actorKey`, spelled once by `actorLaneSegments`. */
  readonly lane: string;
  readonly sessionId: string;
  readonly transcriptPath: string;
  /** The actor's completed turn count at this record. */
  readonly turn: number;
  readonly continuation?: AgentContinuation;
}

/** One in-process state transition. The writers construct these and fold them
 * straight into the run's state document; there is no persisted record stream
 * to dispatch or tolerate, so every variant names its kind. */
export type WorkflowTransition =
  | ({ readonly kind: "stage-accepted" } & WorkflowProgressRecord)
  | WorkflowProgressStartRecord
  | WorkflowProgressExecutionStartRecord
  | WorkflowProgressExecutionFinishRecord
  | WorkflowProgressRegionFinalizedRecord
  | WorkflowProgressActorTurnRecord;

function emptyStageCounts(plan: WorkflowProgressPlan): Readonly<Record<string, WorkflowProgressStageCount>> {
  return Object.fromEntries(Object.entries(plan.stageCounts).map(([stageId, count]) => [stageId, {
    planned: count.planned,
    completed: 0,
  }])) as Readonly<Record<string, WorkflowProgressStageCount>>;
}

function elapsedMs(from: string, to: string): number {
  const started = Date.parse(from);
  const finished = Date.parse(to);
  return Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, finished - started) : 0;
}

/** Close the span in flight for one invocation at `now` and keep the total.
 * Called once per attempt, so a retried stage reports the work of every attempt
 * instead of only the one that was accepted. */
function accrueInvocationTime(
  previous: WorkflowProgressInvocationTime | undefined,
  identity: Pick<WorkflowProgressInvocationTime, "stageId" | "instanceId">,
  now: string,
): WorkflowProgressInvocationTime {
  const open = previous?.runningSince;
  const completedMs = (previous?.completedMs ?? 0) + (open === undefined ? 0 : elapsedMs(open, now));
  return {
    stageId: identity.stageId,
    ...(identity.instanceId === undefined ? {} : { instanceId: identity.instanceId }),
    ...(completedMs === 0 ? {} : { completedMs }),
  };
}

/** Fold every span still in flight into its total. A finished or paused run is
 * not working, so the human's pause must never be reported as stage time; the
 * interrupted invocation restarts its clock on its next attempt. */
function closeOpenSpans(
  times: Readonly<Record<string, WorkflowProgressInvocationTime>>,
  now: string,
): Readonly<Record<string, WorkflowProgressInvocationTime>> {
  const open = Object.entries(times).filter(([, time]) => time.runningSince !== undefined);
  if (open.length === 0) return times;
  const closed = { ...times };
  for (const [invocationId, time] of open) closed[invocationId] = accrueInvocationTime(time, time, now);
  return closed;
}

/** Record one invocation's time in the map the fold owns, updating it in place.
 *
 * A per-record copy of this map is what turned the fold quadratic; the fold
 * owns the accumulator it updates. */
function accrueInto(
  times: Readonly<Record<string, WorkflowProgressInvocationTime>> | undefined,
  invocationId: string,
  time: WorkflowProgressInvocationTime,
): Readonly<Record<string, WorkflowProgressInvocationTime>> {
  const owned = (times ?? {}) as Record<string, WorkflowProgressInvocationTime>;
  owned[invocationId] = time;
  return owned;
}

function updateJob(
  jobs: readonly RunJob[],
  ordinal: number,
  update: (job: RunJob) => RunJob,
): readonly RunJob[] {
  const index = jobs.findIndex((job) => job.jobOrdinal === ordinal);
  if (index < 0) return jobs;
  const next = [...jobs];
  next[index] = update(next[index]!);
  return next;
}

/** Apply a transition to the run's latest job — the only one a transition can
 * target when it carries no ordinal of its own. */
function updateLatestJob(
  jobs: readonly RunJob[],
  update: (job: RunJob) => RunJob,
): readonly RunJob[] {
  const latest = jobs.at(-1);
  return latest === undefined ? jobs : [...jobs.slice(0, -1), update(latest)];
}

function bumpAttempt(
  attempts: Readonly<Record<string, number>>,
  invocationId: string,
  attempt: number,
): Readonly<Record<string, number>> {
  return { ...attempts, [invocationId]: Math.max(attempts[invocationId] ?? 0, attempt) };
}

/** Fold one transition into the run's state document.
 *
 * This is the whole state machine a run has: the counters, the current
 * invocation, the job table, the actor table and the run's status all live in
 * one document, and writing it is the commit. The job table is history and a
 * cursor; whether the run is working, paused, or finished is `status` alone.
 * Only `execution-started` and `execution-finished` write the status; stage
 * records touch jobs and counters only.
 *
 * The fold TAKES OWNERSHIP of `previous.invocationTime` and updates it in
 * place: a per-record copy was measured at 99% of the fold's cost. */
export function applyRunStatusRecord(
  previous: RunStatus | undefined,
  transition: WorkflowTransition,
): RunStatus {
  const base = previous ?? emptyRunStatus(transition.runId, transition.timestamp);
  const next: RunStatus = { ...base, runId: transition.runId, updatedAt: transition.timestamp };
  switch (transition.kind) {
    case "execution-started": {
      const carried = transition.resumed ? next : undefined;
      const mnemonic = transition.mnemonic ?? carried?.mnemonic;
      const ordinal = transition.jobOrdinal ?? nextJobOrdinal(next.jobs);
      // A restart closes its predecessor in this same transition, so no
      // document can hold a closed job that was not immediately followed by
      // its successor.
      const priorJobs = transition.closesJobOrdinal === undefined
        ? next.jobs
        : updateJob(next.jobs, transition.closesJobOrdinal, (job) => ({ ...job, outcome: "restarted" }));
      const existing = priorJobs.find((job) => job.jobOrdinal === ordinal);
      // The job's input is the work it currently stands for: a plain prompt
      // that continues a one-stage job replaces it, so a later `/restart`
      // re-runs what the human last asked, not the job's first message.
      const input = transition.prompt ?? existing?.input;
      const job: RunJob = {
        jobOrdinal: ordinal,
        accepted: existing?.accepted ?? [],
        attempts: existing?.attempts ?? {},
        ...(input === undefined ? {} : { input }),
        ...(existing?.regions === undefined ? {} : { regions: existing.regions }),
      };
      const jobs = [...priorJobs.filter((candidate) => candidate.jobOrdinal !== ordinal), job]
        .sort((left, right) => left.jobOrdinal - right.jobOrdinal);
      return {
        ...next,
        status: "running",
        plannedStages: transition.plan.plannedStages,
        completedStages: carried?.completedStages ?? 0,
        stageCounts: carried?.stageCounts ?? emptyStageCounts(transition.plan),
        ...(mnemonic === undefined ? {} : { mnemonic }),
        jobs,
      };
    }
    case "stage-started": {
      const invocationTime = accrueInto(next.invocationTime, transition.invocationId, {
        ...accrueInvocationTime(next.invocationTime?.[transition.invocationId], transition, transition.timestamp),
        runningSince: transition.timestamp,
      });
      return {
        ...next,
        invocationTime,
        current: {
          status: "running",
          invocationId: transition.invocationId,
          stageId: transition.stageId,
          stage: transition.stage,
          worker: transition.worker,
          attempt: transition.attempt,
          ...(transition.instanceId === undefined ? {} : { instanceId: transition.instanceId }),
          ...(transition.iteration === undefined ? {} : { iteration: transition.iteration }),
          ...(transition.error === undefined ? {} : { error: transition.error }),
        },
        jobs: updateLatestJob(next.jobs, (job) => ({
          ...job,
          attempts: bumpAttempt(job.attempts, transition.invocationId, transition.attempt),
        })),
      };
    }
    case "stage-accepted": {
      const projection = transition.progress;
      const entry = acceptedInvocationOf(transition.invocationId);
      return {
        ...next,
        plannedStages: projection.plannedStages,
        completedStages: projection.completedStages,
        stageCounts: projection.stageCounts,
        invocationTime: accrueInto(next.invocationTime, transition.invocationId, accrueInvocationTime(
          next.invocationTime?.[transition.invocationId],
          transition,
          transition.timestamp,
        )),
        current: {
          status: "accepted",
          invocationId: transition.invocationId,
          stageId: transition.stageId,
          stage: transition.stage,
          worker: transition.worker,
          attempt: transition.attempt,
          ...(transition.instanceId === undefined ? {} : { instanceId: transition.instanceId }),
          ...(transition.iteration === undefined ? {} : { iteration: transition.iteration }),
        },
        jobs: updateLatestJob(next.jobs, (job) => ({
          ...job,
          accepted: job.accepted.some((item) => item.invocationId === entry.invocationId)
            ? job.accepted
            : [...job.accepted, entry],
          attempts: bumpAttempt(job.attempts, transition.invocationId, transition.attempt),
        })),
      };
    }
    case "execution-finished": {
      const common = {
        ...(next.invocationTime === undefined
          ? {}
          : { invocationTime: closeOpenSpans(next.invocationTime, transition.timestamp) }),
        ...(next.current === undefined ? {} : {
          current: {
            ...next.current,
            // The pointer folds but keeps naming the last active stage, so a
            // paused run still shows where it stopped.
            status: transition.status === "failed" ? "failed" as const : "accepted" as const,
          },
        }),
        ...(transition.error === undefined ? {} : { error: transition.error }),
      };
      if (transition.status === "paused") {
        return { ...next, ...common, status: "paused" };
      }
      // A finished job keeps its verdict as history; the run's status is the
      // same verdict.
      const outcome = transition.status;
      return {
        ...next,
        ...common,
        status: outcome,
        jobs: updateLatestJob(next.jobs, (job) => ({ ...job, outcome })),
      };
    }
    case "region-finalized":
      return {
        ...next,
        jobs: updateJob(next.jobs, transition.jobOrdinal, (job) => ({
          ...job,
          regions: { ...job.regions, [transition.instance]: transition },
        })),
      };
    case "actor-turn":
      return {
        ...next,
        actors: {
          ...next.actors,
          [transition.actorKey]: {
            harness: transition.harness,
            sessionId: transition.sessionId,
            transcriptPath: transition.transcriptPath,
            turns: transition.turn,
            ...(transition.continuation === undefined ? {} : { continuation: transition.continuation }),
          },
        },
      };
  }
}

/** Write the run's initial state document before the first worker turn. This
 * makes a long-running workflow observable even while no stage has validated
 * yet.
 *
 * `restartOrdinal` is the job this start replaces: the record gives it
 * `outcome: restarted` in the same atomic write, so the close and the
 * successor's start are never observed apart. */
export function initializeWorkflowProgress(
  runDir: string,
  runId: string,
  plan: WorkflowProgressPlan,
  jobOrdinal: number,
  prompt: string,
  resume: boolean,
  options: {
    readonly mnemonic?: string;
    readonly restartOrdinal?: number;
  } = {},
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = runStatusPath(runDir);
  return Effect.gen(function* () {
    yield* commitTransition(runDir, {
      kind: "execution-started",
      timestamp: new Date().toISOString(),
      runId,
      jobOrdinal,
      prompt,
      resumed: resume,
      ...(options.restartOrdinal === undefined ? {} : { closesJobOrdinal: options.restartOrdinal }),
      ...(options.mnemonic === undefined ? {} : { mnemonic: options.mnemonic }),
      plan,
    });
    return path;
  });
}

/** Fold one transition into the run's state document and write it atomically.
 *
 * The one path every writer takes. There is no stream beside the document to
 * keep in step, and the atomic write makes a crash leave either the previous
 * state or the next one, never a torn line. */
function commitTransition(
  runDir: string,
  transition: WorkflowTransition,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const current = yield* readRunStatus(runDir);
    yield* writeRunStatus(runDir, applyRunStatusRecord(current, transition));
  });
}

/** Record that a stage/attempt started.
 *
 * The transition is folded into the state document and the document is written
 * atomically: a crash leaves either the previous state or the next one, never
 * a torn line. */
export function markWorkflowStageStarted(
  runDir: string,
  runId: string,
  current: Omit<WorkflowProgressStartRecord, "kind" | "timestamp" | "runId">,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = runStatusPath(runDir);
  return Effect.gen(function* () {
    yield* commitTransition(runDir, {
      kind: "stage-started",
      timestamp: new Date().toISOString(),
      runId,
      ...current,
    });
    return path;
  });
}

/** Record one accepted stage, one finalized region, or one actor turn. The
 * document is safe to read while a long workflow loop is still running, so
 * monitors observe completed iterations. */
export function appendWorkflowProgress(
  runDir: string,
  record: Omit<WorkflowProgressRecord, "timestamp">
    | Omit<WorkflowProgressRegionFinalizedRecord, "timestamp">
    | Omit<WorkflowProgressActorTurnRecord, "timestamp">,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = runStatusPath(runDir);
  return Effect.gen(function* () {
    const timestamp = new Date().toISOString();
    // The accepted-stage payload predates the discriminator; the transition
    // names it explicitly. The other two payloads already carry their kind.
    yield* commitTransition(runDir, "kind" in record
      ? { ...record, timestamp }
      : { kind: "stage-accepted", ...record, timestamp });
    return path;
  });
}

/** Record that an execution ended.
 *
 * Best-effort callers may catch this error so a convenience view never hides
 * the canonical workflow result. The fold is the outcome; a failure to write
 * it must not replace the worker's result. */
export function finalizeWorkflowProgress(
  runDir: string,
  runId: string,
  status: ExecutionOutcome,
  error?: string,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = runStatusPath(runDir);
  return Effect.gen(function* () {
    yield* commitTransition(runDir, {
      kind: "execution-finished",
      timestamp: new Date().toISOString(),
      runId,
      status,
      ...(error === undefined ? {} : { error }),
    });
    return path;
  });
}

/** A crashed run reopened: its process died before it could record the end of
 * its execution, so the run still says `running`. Nothing is running it now —
 * one process per run — so fold the missing `execution-finished` and the run
 * reads `paused`, which is the continue-or-restart question a human answers.
 * Returns whether anything was reconciled; a run already at rest is left
 * alone. */
export function reconcileCrashedRun(
  runDir: string,
): Effect.Effect<boolean, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const status = yield* readRunStatus(runDir);
    if (status === undefined || status.status !== "running") return false;
    yield* finalizeWorkflowProgress(runDir, status.runId, "paused");
    return true;
  });
}
