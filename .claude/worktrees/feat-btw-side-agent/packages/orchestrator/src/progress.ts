import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname, join } from "node:path";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";
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
  fileSystem: FileSystem.FileSystem,
  path: string,
  snapshot: WorkflowProgressSnapshot,
): Effect.Effect<void, WorkflowError, never> {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return Effect.gen(function* () {
    yield* fileSystem.makeDirectory(dirname(path), { recursive: true }).pipe(
      Effect.mapError((cause) => progressError(path, "snapshot mkdir", cause)),
    );
    yield* fileSystem.writeFileString(temporary, `${JSON.stringify(snapshot, null, 2)}\n`).pipe(
      Effect.mapError((cause) => progressError(path, "snapshot write", cause)),
    );
    yield* fileSystem.rename(temporary, path).pipe(
      Effect.mapError((cause) => progressError(path, "snapshot rename", cause)),
      Effect.ensuring(fileSystem.remove(temporary).pipe(Effect.ignore)),
    );
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
    } catch (cause) {
      return yield* Effect.fail(progressError(path, "snapshot parse", cause));
    }
  });
}

function emptyStageCounts(plan: WorkflowProgressPlan): Readonly<Record<string, WorkflowProgressStageCount>> {
  return Object.fromEntries(Object.entries(plan.stageCounts).map(([stageId, count]) => [stageId, {
    planned: count.planned,
    completed: 0,
  }])) as Readonly<Record<string, WorkflowProgressStageCount>>;
}

/** Create the initial snapshot before the first worker turn. This makes a
 * long-running workflow observable even while no stage has validated yet. */
export function initializeWorkflowProgress(
  runDir: string,
  executionId: string,
  plan: WorkflowProgressPlan,
  resume: boolean,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = workflowProgressSnapshotPath(runDir);
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const previous = resume ? yield* readSnapshot(fileSystem, path) : undefined;
    yield* writeSnapshotAtomic(fileSystem, path, {
      version: 1,
      updatedAt: new Date().toISOString(),
      executionId,
      status: "running",
      plannedStages: plan.plannedStages,
      completedStages: previous?.completedStages ?? 0,
      acceptedStages: previous?.acceptedStages ?? 0,
      remainingStages: plan.plannedStages - (previous?.acceptedStages ?? 0),
      stageCounts: previous?.stageCounts ?? emptyStageCounts(plan),
    });
    return path;
  });
}

/** Update the convenience snapshot when a stage/attempt starts. The
 * append-only progress stream intentionally remains acceptance-only. */
export function markWorkflowStageStarted(
  runDir: string,
  current: Omit<WorkflowProgressCurrent, "status" | "progress">,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = workflowProgressSnapshotPath(runDir);
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const previous = yield* readSnapshot(fileSystem, path);
    const fallback: WorkflowProgressSnapshot = previous ?? {
      version: 1,
      updatedAt: new Date().toISOString(),
      executionId: current.invocationId.split("@", 1)[0] ?? current.invocationId,
      status: "running",
      plannedStages: 0,
      completedStages: 0,
      acceptedStages: 0,
      remainingStages: 0,
      stageCounts: {},
    };
    yield* writeSnapshotAtomic(fileSystem, path, {
      ...fallback,
      updatedAt: new Date().toISOString(),
      status: "running",
      current: { ...current, status: "running" },
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
    const fileSystem = yield* FileSystem.FileSystem;
    const timestamp = new Date().toISOString();
    const fullRecord = {
      version: 1 as const,
      timestamp,
      ...record,
    };
    const line = yield* Effect.try({
      try: () => `${JSON.stringify(fullRecord)}\n`,
      catch: (cause) => progressError(path, "serialize", cause),
    });
    yield* fileSystem.makeDirectory(dirname(path), { recursive: true }).pipe(
      Effect.mapError((cause) => progressError(path, "mkdir", cause)),
    );
    yield* fileSystem.writeFileString(path, line, { flag: "a" }).pipe(
      Effect.mapError((cause) => progressError(path, "append", cause)),
    );
    const snapshotPath = workflowProgressSnapshotPath(runDir);
    const explicitProjections = record.projections;
    const hintProjections = explicitProjections ?? (record.contract === undefined
      ? legacyProgressProjections(record.resultPayload)
      : []);
    const payloadHint = progressProjectionHint(hintProjections, explicitProjections !== undefined);
    const previous = yield* readSnapshot(fileSystem, snapshotPath);
    const projection = record.progress;
    const snapshot: WorkflowProgressSnapshot = {
      version: 1,
      updatedAt: timestamp,
      executionId: record.executionId,
      status: "running",
      plannedStages: projection?.plannedStages ?? previous?.plannedStages ?? record.progress?.acceptedStages ?? 0,
      completedStages: projection?.completedStages ?? record.progress?.acceptedStages ?? previous?.completedStages ?? 0,
      acceptedStages: projection?.acceptedStages ?? previous?.acceptedStages ?? 0,
      remainingStages: projection?.remainingStages ?? previous?.remainingStages ?? 0,
      stageCounts: projection?.stageCounts ?? previous?.stageCounts ?? {},
      current: {
        status: "accepted",
        invocationId: record.invocationId,
        stageId: record.stageId,
        stage: record.stage,
        worker: record.worker,
        attempt: record.attempt,
        ...(record.iteration === undefined ? {} : { iteration: record.iteration }),
        ...(projection?.mapSlot === undefined ? {} : { mapSlot: projection.mapSlot }),
        ...(projection?.mapSlots === undefined ? {} : { mapSlots: projection.mapSlots }),
        ...(projection?.scope === undefined ? {} : { scope: projection.scope }),
        ...(projection === undefined ? {} : { progress: projection }),
        ...(record.projections === undefined ? {} : { projections: record.projections }),
      },
      latest: {
        invocationId: record.invocationId,
        stageId: record.stageId,
        stage: record.stage,
        worker: record.worker,
        attempt: record.attempt,
        ...(record.iteration === undefined ? {} : { iteration: record.iteration }),
        ...(projection === undefined ? {} : { progress: projection }),
        ...payloadHint,
      },
    };
    yield* writeSnapshotAtomic(fileSystem, snapshotPath, snapshot);
    return path;
  });
}

/** Mark the latest snapshot terminal without changing the append-only stream.
 * Best-effort callers may catch this error so a convenience view never hides
 * the canonical workflow result. A "paused" finalization is not a failure: the
 * interrupted stage stays recorded as running so the resume view points at the
 * exact stage the human stopped. */
export function finalizeWorkflowProgress(
  runDir: string,
  status: "completed" | "failed" | "paused",
  error?: string,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = workflowProgressSnapshotPath(runDir);
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const snapshot = yield* readSnapshot(fileSystem, path);
    if (snapshot === undefined) return path;
    yield* writeSnapshotAtomic(fileSystem, path, {
      ...snapshot,
      updatedAt: new Date().toISOString(),
      status,
      ...(snapshot.current === undefined || status !== "failed" ? {} : {
        current: {
          ...snapshot.current,
          status: "failed" as const,
        },
      }),
      ...(error === undefined ? {} : { error }),
    });
    return path;
  });
}
