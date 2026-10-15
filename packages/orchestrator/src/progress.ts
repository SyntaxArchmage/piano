import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";
import { refreshRunStatus } from "./run-status.js";
import type { WorkflowWorkspaceBinding } from "./workspace.js";
import type { WorkerContractReference } from "./contract-snapshot.js";
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
  readonly executionId: string;
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
  readonly executionId: string;
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
  readonly executionId: string;
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
  readonly executionId: string;
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
  readonly executionId: string;
  readonly jobOrdinal: number;
  readonly outcome: "restarted";
}

/** One line of the append-only progress stream. */
export type WorkflowProgressStreamRecord =
  | WorkflowProgressRecord
  | WorkflowProgressStartRecord
  | WorkflowProgressExecutionStartRecord
  | WorkflowProgressExecutionFinishRecord
  | WorkflowProgressJobClosedRecord;

/** Kind of one progress-stream line.
 *
 * `"stage-accepted"` is the historical shape and carries no discriminator: the
 * stream predates it, and every record written before it is an accepted stage.
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
  | "stage-accepted" {
  const kind = (record as { readonly kind?: unknown } | null | undefined)?.kind;
  if (kind === "stage-started") return "stage-started";
  if (kind === "execution-started") return "execution-started";
  if (kind === "execution-finished") return "execution-finished";
  if (kind === "job-closed") return "job-closed";
  return "stage-accepted";
}

/** Parse one stream line into a record, or `undefined` for a blank, torn, or
 * shapeless line. The single definition of the line format's acceptance rule,
 * shared by every stream reader (the snapshot fallback and the job fold) so
 * they cannot disagree about what a line means. */
export function parseProgressStreamRecord(line: string): WorkflowProgressStreamRecord | undefined {
  if (line.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // Torn mid-append: it describes a write that never finished, and the
    // records before it are still good.
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  // Every kind carries these two, whichever shape it is.
  const record = parsed as { executionId?: unknown; timestamp?: unknown };
  if (typeof record.executionId !== "string" || typeof record.timestamp !== "string") return undefined;
  return parsed as WorkflowProgressStreamRecord;
}

export interface WorkflowProgressSnapshot {
  readonly version: 1;
  readonly updatedAt: string;
  readonly executionId: string;
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
  readonly latest?: {
    readonly invocationId: string;
    readonly stageId: string;
    readonly stage: string;
    readonly worker: string;
    readonly attempt: number;
    readonly iteration?: number;
    readonly progress?: WorkflowProgressProjection;
    readonly projections?: readonly ContractProjection[];
    readonly decision?: string;
    readonly benchmark?: unknown;
  };
  readonly error?: string;
}

export function workflowProgressPath(runDir: string): string {
  return join(runDir, "progress.jsonl");
}

/** Current, human-readable projection for `watch`/TUI consumers. The JSONL
 * stream remains the immutable evidence source; this file is only the latest
 * state and is safe to replace after every accepted stage. */
export function workflowProgressSnapshotPath(runDir: string): string {
  return join(runDir, "progress.json");
}

function progressError(path: string, operation: string, cause: unknown): WorkflowError {
  return workflowError("schedule", path, `${operation}: ${errorMessage(cause)}`);
}

/** Adapt the pre-projection progress API at its persistence boundary. New
 * canonical records carry explicit projections; only historical/named callers
 * without a contract snapshot may recover the two legacy convenience hints
 * from resultPayload. */
function legacyProgressProjections(
  payload: unknown,
): readonly ContractProjection[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return [];
  const value = payload as Record<string, unknown>;
  return [
    ...(typeof value.decision === "string"
      ? [{ id: "round.decision", pointer: "/decision", format: "string" as const, value: value.decision }]
      : []),
    ...(value.benchmark === undefined
      ? []
      : [{ id: "benchmark.evidence", pointer: "/benchmark", format: "json" as const, value: value.benchmark }]),
  ];
}

function progressProjectionHint(
  projections: readonly ContractProjection[],
  persistProjections: boolean,
): Pick<NonNullable<WorkflowProgressSnapshot["latest"]>, "decision" | "benchmark" | "projections"> {
  const value = new Map(projections.map((projection) => [projection.id, projection.value]));
  return {
    ...(typeof value.get("round.decision") === "string" ? { decision: value.get("round.decision") as string } : {}),
    ...(value.has("benchmark.evidence") ? { benchmark: value.get("benchmark.evidence") } : {}),
    ...(persistProjections ? { projections } : {}),
  };
}

function writeSnapshotAtomic(
  path: string,
  snapshot: WorkflowProgressSnapshot,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return writeFileAtomic(path, `${JSON.stringify(snapshot, null, 2)}\n`, {
    temporaryPath: () => `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    mapError: (cause, step) => progressError(path, `snapshot ${step}`, cause),
  });
}

function readSnapshot(
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<WorkflowProgressSnapshot | undefined, WorkflowError, never> {
  return Effect.gen(function* () {
    const exists = yield* fileSystem.exists(path).pipe(
      Effect.mapError((cause) => progressError(path, "snapshot exists", cause)),
    );
    if (!exists) return undefined;
    const raw = yield* fileSystem.readFileString(path).pipe(
      Effect.mapError((cause) => progressError(path, "snapshot read", cause)),
    );
    try {
      return JSON.parse(raw) as WorkflowProgressSnapshot;
    } catch {
      // An unreadable view is no view. The stream holds the record of the run
      // and this file is only its projection, so a run must not fail because
      // the projection could not be parsed — a fresh one discards it anyway.
      return undefined;
    }
  });
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

/** A snapshot with nothing folded into it yet. */
function emptyProgressSnapshot(executionId: string, updatedAt: string): WorkflowProgressSnapshot {
  return {
    version: 1,
    updatedAt,
    executionId,
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
 * every case establishes the identity and timestamp it needs from the record. */
export function applyProgressRecord(
  previous: WorkflowProgressSnapshot | undefined,
  record: WorkflowProgressStreamRecord,
): WorkflowProgressSnapshot {
  const kind = progressRecordKind(record);
  if (kind === "execution-started") {
    const started = record as WorkflowProgressExecutionStartRecord;
    // A resumed execution keeps the counts the previous one reached; a fresh
    // one starts them over. The flag rides the record rather than being
    // inferred from whether a snapshot happens to exist on disk.
    const carried = started.resumed ? previous : undefined;
    return {
      version: 1,
      updatedAt: started.timestamp,
      executionId: started.executionId,
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
    const base = previous ?? emptyProgressSnapshot(started.executionId, started.timestamp);
    return {
      ...base,
      updatedAt: started.timestamp,
      executionId: started.executionId,
      status: "running",
      invocationTime: {
        ...base.invocationTime,
        [started.invocationId]: {
          ...accrueInvocationTime(base.invocationTime?.[started.invocationId], started, started.timestamp),
          runningSince: started.timestamp,
        },
      },
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
    const base = previous ?? emptyProgressSnapshot(finished.executionId, finished.timestamp);
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
    const base = previous ?? emptyProgressSnapshot(closed.executionId, closed.timestamp);
    return { ...base, updatedAt: closed.timestamp };
  }
  const accepted = record as WorkflowProgressRecord;
  const projection = accepted.progress;
  const explicitProjections = accepted.projections;
  const hintProjections = explicitProjections ?? (accepted.contract === undefined
    ? legacyProgressProjections(accepted.resultPayload)
    : []);
  const payloadHint = progressProjectionHint(hintProjections, explicitProjections !== undefined);
  const base = previous ?? emptyProgressSnapshot(accepted.executionId, accepted.timestamp);
  return {
    ...base,
    updatedAt: accepted.timestamp,
    executionId: accepted.executionId,
    status: "running",
    plannedStages: projection?.plannedStages ?? base.plannedStages,
    completedStages: projection?.completedStages ?? base.completedStages,
    acceptedStages: projection?.acceptedStages ?? base.acceptedStages,
    remainingStages: projection?.remainingStages ?? base.remainingStages,
    stageCounts: projection?.stageCounts ?? base.stageCounts,
    invocationTime: {
      ...base.invocationTime,
      [accepted.invocationId]: accrueInvocationTime(
        base.invocationTime?.[accepted.invocationId],
        accepted,
        accepted.timestamp,
      ),
    },
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
    latest: {
      invocationId: accepted.invocationId,
      stageId: accepted.stageId,
      stage: accepted.stage,
      worker: accepted.worker,
      attempt: accepted.attempt,
      ...(accepted.iteration === undefined ? {} : { iteration: accepted.iteration }),
      ...(projection === undefined ? {} : { progress: projection }),
      ...payloadHint,
    },
  };
}

/** Create the initial snapshot before the first worker turn. This makes a
 * long-running workflow observable even while no stage has validated yet. */
export function initializeWorkflowProgress(
  runDir: string,
  executionId: string,
  plan: WorkflowProgressPlan,
  jobOrdinal: number,
  prompt: string,
  resume: boolean,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = workflowProgressSnapshotPath(runDir);
  return Effect.gen(function* () {
    yield* appendAndFold(runDir, {
      version: 1,
      kind: "execution-started",
      timestamp: new Date().toISOString(),
      executionId,
      jobOrdinal,
      prompt,
      resumed: resume,
      plan,
    });
    return path;
  });
}

/** Append one record to the run's progress stream.
 *
 * The stream's single writer seam: every record type goes through it, so the
 * file has one place that knows its line format. */
function appendProgressLine(
  fileSystem: FileSystem.FileSystem,
  path: string,
  record: WorkflowProgressStreamRecord,
): Effect.Effect<void, WorkflowError, never> {
  return Effect.gen(function* () {
    const line = yield* Effect.try({
      try: () => `${JSON.stringify(record)}\n`,
      catch: (cause) => progressError(path, "serialize", cause),
    });
    yield* fileSystem.makeDirectory(dirname(path), { recursive: true }).pipe(
      Effect.mapError((cause) => progressError(path, "mkdir", cause)),
    );
    yield* fileSystem.writeFileString(path, line, { flag: "a" }).pipe(
      Effect.mapError((cause) => progressError(path, "append", cause)),
    );
  });
}

/** Append one record, then fold it into the snapshot beside it.
 *
 * The one path every writer takes. The record is written first on purpose: the
 * snapshot is a projection of it, so a failure between the two must leave the
 * projection stale rather than the record missing. */
function appendAndFold(
  runDir: string,
  record: WorkflowProgressStreamRecord,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const snapshotPath = workflowProgressSnapshotPath(runDir);
    yield* appendProgressLine(fileSystem, workflowProgressPath(runDir), record);
    const previous = yield* readSnapshot(fileSystem, snapshotPath);
    yield* writeSnapshotAtomic(snapshotPath, applyProgressRecord(previous, record));
    // The run's one state document stays in step with the ledger it is a view
    // of. `run-status` folds this module's records back, which is why the two
    // import each other's functions rather than one owning the other.
    yield* refreshRunStatus(runDir);
  });
}

/** Record that a stage/attempt started, in the stream and then in the snapshot.
 *
 * The stream is written first on purpose: the snapshot is a view of the record,
 * so a failure between the two must leave the view stale rather than the record
 * missing. Viewing the order the other way would let a crash lose the start. */
export function markWorkflowStageStarted(
  runDir: string,
  executionId: string,
  current: Omit<WorkflowProgressCurrent, "status" | "progress">,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = workflowProgressSnapshotPath(runDir);
  return Effect.gen(function* () {
    yield* appendAndFold(runDir, {
      version: 1,
      kind: "stage-started",
      timestamp: new Date().toISOString(),
      executionId,
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
  record: Omit<WorkflowProgressRecord, "version" | "timestamp">,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = workflowProgressPath(runDir);
  return Effect.gen(function* () {
    yield* appendAndFold(runDir, {
      version: 1,
      timestamp: new Date().toISOString(),
      ...record,
    });
    return path;
  });
}

/** Record that an execution ended, in the stream and then in the snapshot.
 *
 * Best-effort callers may catch this error so a convenience view never hides
 * the canonical workflow result. When snapshot.current is present its status
 * is folded: "accepted" for completed/paused (a human stop is not a failure;
 * resume.jsonl is the sole continuation authority), "failed" for a failed run.
 * `current.stageId` is never rewritten — it still names the last active stage.
 * Readers must tolerate legacy on-disk shapes (stale current.status:"running"
 * under a terminal snapshot) written before this fold was introduced. */
/** Record that an execution ended, in the stream and then in the snapshot.
 *
 * Best-effort callers may catch this error so a convenience view never hides
 * the canonical workflow result. The snapshot stays a view: with no snapshot to
 * correct there is nothing to write, and the record above is the outcome. */
export function finalizeWorkflowProgress(
  runDir: string,
  executionId: string,
  status: "completed" | "failed" | "paused",
  error?: string,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = workflowProgressSnapshotPath(runDir);
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const record: WorkflowProgressExecutionFinishRecord = {
      version: 1,
      kind: "execution-finished",
      timestamp: new Date().toISOString(),
      executionId,
      status,
      ...(error === undefined ? {} : { error }),
    };
    yield* appendProgressLine(fileSystem, workflowProgressPath(runDir), record);
    const previous = yield* readSnapshot(fileSystem, path);
    if (previous === undefined) return path;
    yield* writeSnapshotAtomic(path, applyProgressRecord(previous, record));
    return path;
  });
}

/** Close one job by the human's own action, so its paused spans read as
 * finished with that outcome. Appends the marker and folds it like every
 * other record; the job's own spans keep saying how they stopped. */
export function closeWorkflowJob(
  runDir: string,
  executionId: string,
  jobOrdinal: number,
  outcome: "restarted",
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = workflowProgressPath(runDir);
  return Effect.gen(function* () {
    yield* appendAndFold(runDir, {
      version: 1,
      kind: "job-closed",
      timestamp: new Date().toISOString(),
      executionId,
      jobOrdinal,
      outcome,
    });
    return path;
  });
}
