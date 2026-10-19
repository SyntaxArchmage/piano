import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { join } from "node:path";
import type { WorkflowError } from "./errors.js";
import { readRunStatus, runStatusPath, writeRunStatus, type RunJob, type RunStatus } from "./run-status.js";
import type { SelectionIncumbent } from "./selection.js";
import type { WorkflowWorkspaceBinding } from "./workspace.js";
import type { WorkerContractReference } from "./contract-snapshot.js";
import type { AgentContinuation } from "@piano/harness";
import type { ContractProjection } from "@piano/contract";

/** Orchestrator-owned, worker-neutral progress projection. Iteration is
 * zero-based to match runtime invocation records; stageIndex is one-based for
 * human-facing `n/m` displays. */
export interface WorkflowProgressProjection {
  readonly status: "accepted";
  /** Number of validated stage invocations accepted so far. Kept for
   * compatibility with the append-only evidence stream; use completedStages
   * and plannedStages for a user-facing progress bar. */
  readonly acceptedStages: number;
  readonly completedStages: number;
  readonly plannedStages: number;
  readonly remainingStages: number;
  /** Static stage ids are workflow-owned, not worker-owned. Their planned
   * counts include loop/map expansion and completed counts come only from
   * accepted invocations. */
  readonly stageCounts: Readonly<Record<string, WorkflowProgressStageCount>>;
  readonly stageIndex?: number;
  readonly stageCount?: number;
  readonly iteration?: number;
  readonly iterations?: number;
  readonly scope?: string;
  readonly mapSlot?: number;
  readonly mapSlots?: number;
  readonly hint: string;
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

export interface WorkflowProgressCurrent {
  readonly status: "running" | "accepted" | "failed";
  readonly invocationId: string;
  readonly stageId: string;
  readonly stage: string;
  readonly worker: string;
  readonly attempt: number;
  /** Runtime instance id of this invocation, so a snapshot reader can tell a
   * map lane from a loop iteration without re-deriving the runtime frames. */
  readonly instanceId?: string;
  readonly iteration?: number;
  readonly mapSlot?: number;
  readonly mapSlots?: number;
  readonly scope?: string;
  readonly error?: string;
  readonly progress?: WorkflowProgressProjection;
  readonly projections?: readonly ContractProjection[];
}

/** Durable, machine-readable progress emitted after each accepted stage
 * invocation. This is separate from the agent transcript: the transcript
 * explains how the worker reasoned, while this record states what the
 * orchestrator accepted and what evidence downstream stages may consume. */
export interface WorkflowProgressRecord {
  readonly version: 1;
  readonly timestamp: string;
  readonly runId: string;
  readonly invocationId: string;
  readonly stageId: string;
  readonly stage: string;
  readonly worker: string;
  readonly instanceId?: string;
  readonly iteration?: number;
  readonly attempt: number;
  readonly workspace: WorkflowWorkspaceBinding;
  /** Actor this turn belongs to, as produced by `workflowActorKey`. Stored
   * rather than derived: the key's lane covers map frames only, while
   * `instanceId` also covers loop frames, so the two are not interchangeable
   * and a resume cannot reconstruct the key from this record's other fields. */
  readonly actorKey: string;
  /** Harness that owns `sessionId`/`transcriptPath`, so a resume can rebuild an
   * `AgentContinuation` without guessing which harness wrote them. */
  readonly harness: string;
  /** Harness session used for this accepted turn; repeated loop invocations
   * of the same actor keep the same value when continuation is supported. */
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly resultPath?: string;
  readonly handoffRecordPath: string;
  /** Configuration requested by the workflow before provider capability
   * resolution. Keep it separate from the effective harness values below. */
  readonly requestedModel?: string;
  readonly requestedThinkingLevel?: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  /** Stable aggregate hint for monitors; the full payload remains below. */
  readonly progress?: WorkflowProgressProjection;
  /** Accepted validator payload retained verbatim as stage evidence. */
  readonly resultPayload?: unknown;
  /** Contract-declared values available to workflow consumers. */
  readonly projections?: readonly ContractProjection[];
  /** Immutable worker contract used to accept this result. */
  readonly contract?: WorkerContractReference;
}

/** Append-only record of one invocation *starting*.
 *
 * The stream records starts as well as acceptances because "which invocation is
 * in flight, and since when" is not derivable from acceptance records alone.
 * Without a start record that fact lived only in the snapshot, which made the
 * snapshot the sole authority for information no log held — and forced its
 * accumulated stage time to be carried forward from the snapshot's own
 * previous value instead of from evidence. */
export interface WorkflowProgressStartRecord {
  readonly version: 1;
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
  /** Fan-out coordinates, carried so a start record names its own lane rather
   * than leaving a reader to derive it from the invocation id. */
  readonly mapSlot?: number;
  readonly mapSlots?: number;
  readonly scope?: string;
  /** Why this attempt is running: set when a failed validation reopened the
   * actor for a repair turn. */
  readonly error?: string;
}

/** Append-only record of one workflow execution beginning.
 *
 * Marks where this execution's progress starts — and, once one session hosts
 * more than one execution, where one execution ends and the next begins.
 *
 * It carries the plan because planned stage counts come from the compiled
 * workflow, not from anything a stage could report: without this record a
 * reader rebuilding the snapshot from the stream would still have to be handed
 * the plan from outside. */
export interface WorkflowProgressExecutionStartRecord {
  readonly version: 1;
  readonly kind: "execution-started";
  readonly timestamp: string;
  readonly runId: string;
  /** The job this span belongs to: one prompt's workflow execution. A fresh
   * job takes the next ordinal; a span that resumes a paused job repeats its
   * predecessor's, which is what ties a continue back to the job it continues.
   * Absent in streams written before jobs existed, where every span is its own
   * job. */
  readonly jobOrdinal?: number;
  /** The input this job runs — the prompt the human submitted. Kept with the
   * job so `/continue` and `/restart` can re-run it without chasing turn
   * positions, which continues make ambiguous. Absent in pre-existing
   * streams. */
  readonly prompt?: string;
  /** True when this execution continues actors a previous one left behind. */
  readonly resumed: boolean;
  readonly plan: WorkflowProgressPlan;
}

/** Append-only record of one workflow execution ending.
 *
 * The stream carries the outcome itself rather than only a view of it. The
 * snapshot write is best-effort and a hard exit can skip it entirely, so "how
 * did this end" has to be answerable from evidence rather than from a file a
 * wedged finalizer may never have reached. */
export interface WorkflowProgressExecutionFinishRecord {
  readonly version: 1;
  readonly kind: "execution-finished";
  readonly timestamp: string;
  readonly runId: string;
  readonly status: "completed" | "failed" | "paused";
  readonly error?: string;
}

/** Append-only record that a job is closed by the human's own action rather
 * than by the work ending — today only `/restart`, which abandons a paused job
 * in favour of a fresh one. The job's spans keep their own truth (the last one
 * still says `paused`); this record is what makes the job read as finished
 * with that outcome, and what keeps its cursor from being offered again. */
export interface WorkflowProgressJobClosedRecord {
  readonly version: 1;
  readonly kind: "job-closed";
  readonly timestamp: string;
  readonly runId: string;
  readonly jobOrdinal: number;
  readonly outcome: "restarted";
}

/** One line of the append-only progress stream. */
/** One region's exit, recorded exactly once when the region leaves the
 * schedule: which instance ended, why, and — for a tournament — who won.
 * A continue reads it to skip a completed region instead of re-running its
 * workers, and a monitor reads it to see why a loop stopped. */
export interface WorkflowProgressRegionFinalizedRecord {
  readonly version: 1;
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
    | "bound-duration"
    | "feedback-stop";
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
}

/** Everything a writer must supply for a `region-finalized` line; the append
 * seam stamps version/timestamp, the execution stamps identity. */
export type WorkflowRegionFinalizedPayload = Omit<
  WorkflowProgressRegionFinalizedRecord,
  "version" | "kind" | "timestamp" | "runId" | "jobOrdinal"
>;

/** One actor's conversation state after a turn that changed it. The record
 * exists so the actor table a resume reads can be folded from this one ledger
 * instead of a second, parallel file: newest record per `actorKey` wins.
 * `continuation` is the harness's own pointer into the conversation and is
 * copied verbatim — never synthesized — because a fabricated one would resume
 * the wrong session silently. Unlike the newness record, which is a complete
 * table, this is a delta: the fields are exactly what the writer set. */
export interface WorkflowProgressActorTurnRecord {
  readonly version: 1;
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

export type WorkflowProgressStreamRecord =
  | WorkflowProgressRecord
  | WorkflowProgressStartRecord
  | WorkflowProgressExecutionStartRecord
  | WorkflowProgressExecutionFinishRecord
  | WorkflowProgressJobClosedRecord
  | WorkflowProgressRegionFinalizedRecord
  | WorkflowProgressActorTurnRecord;

/** Kind of one progress-stream line.
 *
 * `"stage-accepted"` is the historical shape and carries no discriminator: the
 * stream predates it, and every record written before it is an accepted stage.
 *
 * A record that DOES carry a `kind` this function does not recognize was
 * written by a newer writer, and answers `undefined`: the only safe reading of
 * a record whose meaning a reader does not know is to skip it, because folding
 * it into the historical shape would count a marker as accepted work.
 *
 * Accepts any parsed line rather than the writer's own types, because the two
 * callers hold different things — a writer holds a typed record, a reader holds
 * whatever `JSON.parse` returned. Readers ask this function rather than testing
 * `kind` themselves, so the compatibility rule lives in exactly one place. */
export function progressRecordKind(record: object | null | undefined):
  | WorkflowProgressStartRecord["kind"]
  | WorkflowProgressExecutionStartRecord["kind"]
  | WorkflowProgressExecutionFinishRecord["kind"]
  | WorkflowProgressJobClosedRecord["kind"]
  | WorkflowProgressRegionFinalizedRecord["kind"]
  | WorkflowProgressActorTurnRecord["kind"]
  | "stage-accepted"
  | undefined {
  const kind = (record as { readonly kind?: unknown } | null | undefined)?.kind;
  if (kind === undefined) return "stage-accepted";
  if (kind === "stage-started") return "stage-started";
  if (kind === "execution-started") return "execution-started";
  if (kind === "execution-finished") return "execution-finished";
  if (kind === "job-closed") return "job-closed";
  if (kind === "region-finalized") return "region-finalized";
  if (kind === "actor-turn") return "actor-turn";
  return undefined;
}

/** The declared top-level fields of every record kind, keyed the way
 * `progressRecordKind` spells kinds (`"stage-accepted"` for the kind-less
 * historical line). The writer-side half of the reader contract — undeclared
 * fields are ignored on read and forbidden on write — lives here as a runtime
 * table because the interfaces above are compile-time only. Kept in the same
 * file, beside the types it mirrors; the drift test in tests/workflow builds a
 * maximal record of every kind and pins the two directions against each other.
 * Consumers: `--check`'s `undeclared-field` report. The `extra` envelope the
 * contract allows for experiments is itself a declared field of no kind yet —
 * experimental fields go inside it, not beside the declared ones. */
export const progressRecordDeclaredFields: Readonly<Record<string, readonly string[]>> = {
  "stage-accepted": [
    "version", "timestamp", "runId", "invocationId", "stageId", "stage", "worker",
    "instanceId", "iteration", "attempt", "workspace", "actorKey", "harness",
    "sessionId", "transcriptPath", "resultPath", "handoffRecordPath",
    "requestedModel", "requestedThinkingLevel", "model", "thinkingLevel",
    "progress", "resultPayload", "projections", "contract",
  ],
  "stage-started": [
    "version", "kind", "timestamp", "runId", "invocationId", "stageId", "stage",
    "worker", "attempt", "instanceId", "iteration", "mapSlot", "mapSlots", "scope", "error",
  ],
  "execution-started": [
    "version", "kind", "timestamp", "runId", "jobOrdinal", "prompt", "resumed", "plan",
  ],
  "execution-finished": [
    "version", "kind", "timestamp", "runId", "status", "error",
  ],
  "job-closed": [
    "version", "kind", "timestamp", "runId", "jobOrdinal", "outcome",
  ],
  "region-finalized": [
    "version", "kind", "timestamp", "runId", "jobOrdinal", "instance", "regionId",
    "regionKind", "outcome", "notCarriedReason", "winnerInstanceId", "incumbent", "iterations",
  ],
  "actor-turn": [
    "version", "kind", "timestamp", "runId", "jobOrdinal", "invocationId", "attempt",
    "actorKey", "harness", "worker", "lane", "sessionId", "transcriptPath", "turn", "continuation",
  ],
};

export interface WorkflowProgressSnapshot {
  readonly version: 1;
  readonly updatedAt: string;
  readonly runId: string;
  /** "paused": the run stopped at a human interrupt (Escape / `/exit`) with
   * resumable state on disk; the next prompt continues the same execution. */
  readonly status: "running" | "completed" | "failed" | "paused";
  readonly plannedStages: number;
  readonly completedStages: number;
  readonly acceptedStages: number;
  readonly remainingStages: number;
  readonly stageCounts: Readonly<Record<string, WorkflowProgressStageCount>>;
  /** Invocation id -> cumulative worker time, so the footer can show a stage's
   * accumulated duration without replaying the append-only stream. */
  readonly invocationTime?: Readonly<Record<string, WorkflowProgressInvocationTime>>;
  readonly current?: WorkflowProgressCurrent;
  readonly error?: string;
}

export function workflowProgressPath(runDir: string): string {
  return join(runDir, "progress.jsonl");
}

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
 * The whole point of `applyProgressRecord`'s ownership contract: a per-record
 * copy of this map is what turned the fold quadratic, and every caller of the
 * reducer already owns the accumulator it is updating. */
function accrueInto(
  times: Readonly<Record<string, WorkflowProgressInvocationTime>> | undefined,
  invocationId: string,
  time: WorkflowProgressInvocationTime,
): Readonly<Record<string, WorkflowProgressInvocationTime>> {
  const owned = (times ?? {}) as Record<string, WorkflowProgressInvocationTime>;
  owned[invocationId] = time;
  return owned;
}

/** A snapshot with nothing folded into it yet. */
function emptyProgressSnapshot(runId: string, updatedAt: string): WorkflowProgressSnapshot {
  return {
    version: 1,
    updatedAt,
    runId,
    status: "running",
    plannedStages: 0,
    completedStages: 0,
    acceptedStages: 0,
    remainingStages: 0,
    stageCounts: {},
  };
}

/** Fold one stream record into the snapshot it produces.
 *
 * The single definition of what a record means, shared by the two paths that
 * need it: the writers apply it to the snapshot they last wrote — one small
 * file read per record, so a long run stays linear — and a reader can reduce a
 * whole stream with it to rebuild a snapshot a hard exit never reached. Both
 * paths produce the same document, which is what makes the snapshot a view of
 * the stream rather than a second account of it.
 *
 * Folding into `undefined` is the same as folding into the empty snapshot:
 * every case establishes the identity and timestamp it needs from the record.
 *
 * The reducer TAKES OWNERSHIP of `previous`'s `invocationTime` map and returns
 * a snapshot that owns it. Every caller hands it an accumulator it owns (the
 * reduce in `run-status`, the snapshot rewrite in `progress`) and must not read
 * `previous` afterwards. Updating that map in place is what keeps a long fold
 * linear: copying it once per record was measured at 99% of the fold's cost —
 * 228 ms of a 237 ms fold over a thousand records, against 1.5 ms without the
 * copy. */
export function applyProgressRecord(
  previous: WorkflowProgressSnapshot | undefined,
  record: WorkflowProgressStreamRecord,
): WorkflowProgressSnapshot {
  const kind = progressRecordKind(record);
  if (kind === undefined) {
    // A kind this reducer does not know (a record from a newer writer): the
    // snapshot carries only what it understands. An empty fold still gets its
    // identity established, so a known record after this one has a base.
    return previous ?? emptyProgressSnapshot(record.runId, record.timestamp);
  }
  if (kind === "region-finalized") {
    // Region evidence a continue reads; the live snapshot has no field for
    // it, so the fold only advances its timestamp.
    return previous === undefined
      ? emptyProgressSnapshot(record.runId, record.timestamp)
      : { ...previous, updatedAt: record.timestamp };
  }
  if (kind === "actor-turn") {
    // The actor table's own fold (`foldActorTurns`) reads these; the progress
    // snapshot carries no actor fields, so only its timestamp advances.
    return previous === undefined
      ? emptyProgressSnapshot(record.runId, record.timestamp)
      : { ...previous, updatedAt: record.timestamp };
  }
  if (kind === "execution-started") {
    const started = record as WorkflowProgressExecutionStartRecord;
    // A record whose plan is missing is one this fold cannot use. The reader
    // contract is that a reader skips what it cannot read rather than failing
    // the whole view on it — a torn or hand-written line must not take the
    // document down, and the ledger keeps the line for whoever repairs it.
    if ((started as { plan?: unknown }).plan === undefined) {
      return previous === undefined
        ? emptyProgressSnapshot(started.runId, started.timestamp)
        : previous;
    }
    // A resumed execution keeps the counts the previous one reached; a fresh
    // one starts them over. The flag rides the record rather than being
    // inferred from whether a snapshot happens to exist on disk.
    const carried = started.resumed ? previous : undefined;
    return {
      version: 1,
      updatedAt: started.timestamp,
      runId: started.runId,
      status: "running",
      plannedStages: started.plan.plannedStages,
      completedStages: carried?.completedStages ?? 0,
      acceptedStages: carried?.acceptedStages ?? 0,
      remainingStages: started.plan.plannedStages - (carried?.acceptedStages ?? 0),
      stageCounts: carried?.stageCounts ?? emptyStageCounts(started.plan),
      ...(carried?.invocationTime === undefined ? {} : { invocationTime: carried.invocationTime }),
    };
  }
  if (kind === "stage-started") {
    const started = record as WorkflowProgressStartRecord;
    const base = previous ?? emptyProgressSnapshot(started.runId, started.timestamp);
    const invocationTime = accrueInto(base.invocationTime, started.invocationId, {
      ...accrueInvocationTime(base.invocationTime?.[started.invocationId], started, started.timestamp),
      runningSince: started.timestamp,
    });
    return {
      ...base,
      updatedAt: started.timestamp,
      runId: started.runId,
      status: "running",
      invocationTime,
      current: {
        status: "running",
        invocationId: started.invocationId,
        stageId: started.stageId,
        stage: started.stage,
        worker: started.worker,
        attempt: started.attempt,
        ...(started.instanceId === undefined ? {} : { instanceId: started.instanceId }),
        ...(started.iteration === undefined ? {} : { iteration: started.iteration }),
        ...(started.mapSlot === undefined ? {} : { mapSlot: started.mapSlot }),
        ...(started.mapSlots === undefined ? {} : { mapSlots: started.mapSlots }),
        ...(started.scope === undefined ? {} : { scope: started.scope }),
        ...(started.error === undefined ? {} : { error: started.error }),
      },
    };
  }
  if (kind === "execution-finished") {
    const finished = record as WorkflowProgressExecutionFinishRecord;
    const base = previous ?? emptyProgressSnapshot(finished.runId, finished.timestamp);
    return {
      ...base,
      updatedAt: finished.timestamp,
      status: finished.status,
      ...(base.invocationTime === undefined
        ? {}
        : { invocationTime: closeOpenSpans(base.invocationTime, finished.timestamp) }),
      ...(base.current === undefined ? {} : {
        current: {
          ...base.current,
          // The pointer folds but keeps naming the last active stage, so a
          // paused run still shows where it stopped.
          status: finished.status === "failed" ? "failed" as const : "accepted" as const,
        },
      }),
      ...(finished.error === undefined ? {} : { error: finished.error }),
    };
  }
  if (kind === "job-closed") {
    const closed = record as WorkflowProgressJobClosedRecord;
    // The snapshot describes the latest span; a job closed by an action the
    // viewer may not even be showing moves only its timestamp.
    const base = previous ?? emptyProgressSnapshot(closed.runId, closed.timestamp);
    return { ...base, updatedAt: closed.timestamp };
  }
  const accepted = record as WorkflowProgressRecord;
  const projection = accepted.progress;
  const base = previous ?? emptyProgressSnapshot(accepted.runId, accepted.timestamp);
  return {
    ...base,
    updatedAt: accepted.timestamp,
    runId: accepted.runId,
    status: "running",
    plannedStages: projection?.plannedStages ?? base.plannedStages,
    completedStages: projection?.completedStages ?? base.completedStages,
    acceptedStages: projection?.acceptedStages ?? base.acceptedStages,
    remainingStages: projection?.remainingStages ?? base.remainingStages,
    stageCounts: projection?.stageCounts ?? base.stageCounts,
    invocationTime: accrueInto(base.invocationTime, accepted.invocationId, accrueInvocationTime(
      base.invocationTime?.[accepted.invocationId],
      accepted,
      accepted.timestamp,
    )),
    current: {
      status: "accepted",
      invocationId: accepted.invocationId,
      stageId: accepted.stageId,
      stage: accepted.stage,
      worker: accepted.worker,
      attempt: accepted.attempt,
      ...(accepted.instanceId === undefined ? {} : { instanceId: accepted.instanceId }),
      ...(accepted.iteration === undefined ? {} : { iteration: accepted.iteration }),
      ...(projection?.mapSlot === undefined ? {} : { mapSlot: projection.mapSlot }),
      ...(projection?.mapSlots === undefined ? {} : { mapSlots: projection.mapSlots }),
      ...(projection?.scope === undefined ? {} : { scope: projection.scope }),
      ...(projection === undefined ? {} : { progress: projection }),
      ...(accepted.projections === undefined ? {} : { projections: accepted.projections }),
    },
  };
}

/** The state document's fields that are also the progress snapshot's. */
function snapshotOf(status: RunStatus): WorkflowProgressSnapshot {
  return {
    version: 1,
    updatedAt: status.updatedAt,
    runId: status.runId,
    status: status.status === "cancelled" ? "paused" : status.status,
    plannedStages: status.plannedStages,
    completedStages: status.completedStages,
    acceptedStages: status.acceptedStages,
    remainingStages: status.remainingStages,
    stageCounts: status.stageCounts,
    ...(status.invocationTime === undefined ? {} : { invocationTime: status.invocationTime }),
    ...(status.current === undefined ? {} : { current: status.current }),
    ...(status.error === undefined ? {} : { error: typeof status.error === "string" ? status.error : JSON.stringify(status.error) }),
  };
}

function emptyRunStatus(runId: string, timestamp: string): RunStatus {
  return {
    version: 1,
    runId,
    updatedAt: timestamp,
    status: "running",
    promptLength: 0,
    plannedStages: 0,
    completedStages: 0,
    acceptedStages: 0,
    remainingStages: 0,
    stageCounts: {},
    jobs: [],
    jobOrdinal: 0,
    actors: {},
  };
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

function bumpAttempt(
  attempts: Readonly<Record<string, number>>,
  invocationId: string,
  attempt: unknown,
): Readonly<Record<string, number>> {
  if (typeof attempt !== "number" || !Number.isFinite(attempt)) return attempts;
  return { ...attempts, [invocationId]: Math.max(attempts[invocationId] ?? 0, attempt) };
}

/** Fold one record into the run's state document.
 *
 * The snapshot fields reuse {@link applyProgressRecord}; the record families
 * that document alone cannot express — jobs, their finalized regions and the
 * actor table — are applied alongside it. This is the whole state machine a
 * run has: there is no second stream to reconcile, and writing the document is
 * the commit. */
export function applyRunStatusRecord(
  previous: RunStatus | undefined,
  record: WorkflowProgressStreamRecord,
): RunStatus {
  const snapshot = applyProgressRecord(previous === undefined ? undefined : snapshotOf(previous), record);
  const base = previous ?? emptyRunStatus(record.runId, record.timestamp);
  const next: RunStatus = {
    ...base,
    runId: snapshot.runId,
    updatedAt: snapshot.updatedAt,
    status: snapshot.status,
    plannedStages: snapshot.plannedStages,
    completedStages: snapshot.completedStages,
    acceptedStages: snapshot.acceptedStages,
    remainingStages: snapshot.remainingStages,
    stageCounts: snapshot.stageCounts,
    ...(snapshot.invocationTime === undefined ? {} : { invocationTime: snapshot.invocationTime }),
    ...(snapshot.current === undefined ? {} : { current: snapshot.current }),
    ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
  };
  const kind = progressRecordKind(record);
  if (kind === "execution-started") {
    const started = record as WorkflowProgressExecutionStartRecord;
    const ordinal = started.jobOrdinal ?? (next.jobs.at(-1)?.jobOrdinal ?? 0) + 1;
    const existing = next.jobs.find((job) => job.jobOrdinal === ordinal);
    const input = existing?.input ?? started.prompt;
    const job: RunJob = {
      jobOrdinal: ordinal,
      state: "alive",
      accepted: existing?.accepted ?? [],
      attempts: existing?.attempts ?? {},
      ...(input === undefined ? {} : { input }),
      ...(existing?.regions === undefined ? {} : { regions: existing.regions }),
    };
    const jobs = [...next.jobs.filter((candidate) => candidate.jobOrdinal !== ordinal), job]
      .sort((left, right) => left.jobOrdinal - right.jobOrdinal);
    return { ...next, jobs, jobOrdinal: ordinal };
  }
  if (kind === "stage-started") {
    const started = record as WorkflowProgressStartRecord;
    return {
      ...next,
      jobs: updateJob(next.jobs, next.jobOrdinal, (job) => ({
        ...job,
        state: "alive",
        attempts: bumpAttempt(job.attempts, started.invocationId, started.attempt),
      })),
    };
  }
  if (kind === "stage-accepted") {
    const accepted = record as WorkflowProgressRecord;
    return {
      ...next,
      jobs: updateJob(next.jobs, next.jobOrdinal, (job) => ({
        ...job,
        state: "alive",
        accepted: job.accepted.includes(accepted.invocationId) ? job.accepted : [...job.accepted, accepted.invocationId],
        attempts: bumpAttempt(job.attempts, accepted.invocationId, accepted.attempt),
      })),
    };
  }
  if (kind === "region-finalized") {
    const finalized = record as WorkflowProgressRegionFinalizedRecord;
    return {
      ...next,
      jobs: updateJob(next.jobs, finalized.jobOrdinal, (job) => ({
        ...job,
        regions: { ...job.regions, [finalized.instance]: finalized },
      })),
    };
  }
  if (kind === "actor-turn") {
    const turn = record as WorkflowProgressActorTurnRecord;
    return {
      ...next,
      jobOrdinal: turn.jobOrdinal,
      actors: {
        ...next.actors,
        [turn.actorKey]: {
          harness: turn.harness,
          sessionId: turn.sessionId,
          transcriptPath: turn.transcriptPath,
          turns: turn.turn,
          ...(turn.continuation === undefined ? {} : { continuation: turn.continuation }),
        },
      },
    };
  }
  if (kind === "job-closed") {
    const closed = record as WorkflowProgressJobClosedRecord;
    return {
      ...next,
      jobs: updateJob(next.jobs, closed.jobOrdinal, (job) => ({ ...job, state: "finished", outcome: closed.outcome })),
    };
  }
  if (kind === "execution-finished") {
    const finished = record as WorkflowProgressExecutionFinishRecord;
    if (finished.status === "paused") {
      return { ...next, jobs: updateJob(next.jobs, next.jobOrdinal, (job) => ({ ...job, state: "paused" })) };
    }
    const outcome = finished.status;
    return { ...next, jobs: updateJob(next.jobs, next.jobOrdinal, (job) => ({ ...job, state: "finished", outcome })) };
  }
  return next;
}

/** Create the initial snapshot before the first worker turn. This makes a
 * long-running workflow observable even while no stage has validated yet. */
export function initializeWorkflowProgress(
  runDir: string,
  runId: string,
  plan: WorkflowProgressPlan,
  jobOrdinal: number,
  prompt: string,
  resume: boolean,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = runStatusPath(runDir);
  return Effect.gen(function* () {
    yield* appendAndFold(runDir, {
      version: 1,
      kind: "execution-started",
      timestamp: new Date().toISOString(),
      runId,
      jobOrdinal,
      prompt,
      resumed: resume,
      plan,
    });
    return path;
  });
}

/** Apply one record to the run's state document and write it atomically.
 *
 * The one path every writer takes. The document is the record: there is no
 * stream beside it to keep in step, and the atomic write makes a crash leave
 * either the previous state or the next one, never a torn line. */
function appendAndFold(
  runDir: string,
  record: WorkflowProgressStreamRecord,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const current = yield* readRunStatus(runDir);
    yield* writeRunStatus(runDir, applyRunStatusRecord(current, record));
  });
}

/** Record that a stage/attempt started on the stream.
 *
 * The stream is written first on purpose: the state document is a view of the
 * record, so a failure between the two must leave the view stale rather than
 * the record missing. Viewing the order the other way would let a crash lose
 * the start. */
export function markWorkflowStageStarted(
  runDir: string,
  runId: string,
  current: Omit<WorkflowProgressCurrent, "status" | "progress">,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = runStatusPath(runDir);
  return Effect.gen(function* () {
    yield* appendAndFold(runDir, {
      version: 1,
      kind: "stage-started",
      timestamp: new Date().toISOString(),
      runId,
      invocationId: current.invocationId,
      stageId: current.stageId,
      stage: current.stage,
      worker: current.worker,
      attempt: current.attempt,
      ...(current.instanceId === undefined ? {} : { instanceId: current.instanceId }),
      ...(current.iteration === undefined ? {} : { iteration: current.iteration }),
      ...(current.mapSlot === undefined ? {} : { mapSlot: current.mapSlot }),
      ...(current.mapSlots === undefined ? {} : { mapSlots: current.mapSlots }),
      ...(current.scope === undefined ? {} : { scope: current.scope }),
      ...(current.error === undefined ? {} : { error: current.error }),
    });
    return path;
  });
}

/** Append one accepted progress record. The file is safe to read while a long
 * workflow loop is still running, so monitors can observe completed iterations. */
export function appendWorkflowProgress(
  runDir: string,
  record: Omit<WorkflowProgressRecord, "version" | "timestamp">
    | Omit<WorkflowProgressRegionFinalizedRecord, "version" | "timestamp">
    | Omit<WorkflowProgressActorTurnRecord, "version" | "timestamp">,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = runStatusPath(runDir);
  return Effect.gen(function* () {
    yield* appendAndFold(runDir, {
      version: 1,
      timestamp: new Date().toISOString(),
      ...record,
    });
    return path;
  });
}

/** Record that an execution ended on the stream.
 *
 * Best-effort callers may catch this error so a convenience view never hides
 * the canonical workflow result. The state document is folded from this record
 * like every other; with nothing to correct there, the record above is the
 * outcome. */
export function finalizeWorkflowProgress(
  runDir: string,
  runId: string,
  status: "completed" | "failed" | "paused",
  error?: string,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = runStatusPath(runDir);
  return Effect.gen(function* () {
    yield* appendAndFold(runDir, {
      version: 1,
      kind: "execution-finished",
      timestamp: new Date().toISOString(),
      runId,
      status,
      ...(error === undefined ? {} : { error }),
    });
    return path;
  });
}

/** Close one job by the human's own action, so its paused spans read as
 * finished with that outcome. Appends the marker and folds it like every
 * other record; the job's own spans keep saying how they stopped. */
export function closeWorkflowJob(
  runDir: string,
  runId: string,
  jobOrdinal: number,
  outcome: "restarted",
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = runStatusPath(runDir);
  return Effect.gen(function* () {
    yield* appendAndFold(runDir, {
      version: 1,
      kind: "job-closed",
      timestamp: new Date().toISOString(),
      runId,
      jobOrdinal,
      outcome,
    });
    return path;
  });
}
