/**
 * The run's state, as one document.
 *
 * A run records its work in append-only ledgers — `progress.jsonl` for what the
 * workflow did and which harness sessions hold the conversations, and
 * `trajectory.jsonl` for what the agent said. This is the one view of them.
 * Every reader asks for the run's state here instead of folding its own, so
 * "how is this run doing" has exactly one answer and cannot disagree with
 * itself between the log picker, the TUI and a resume.
 *
 * The ledgers stay the only evidence. Nothing here is written that cannot be
 * rebuilt by folding them, which is what lets the per-source documents that
 * used to sit beside them go away without losing a run.
 */

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { join } from "node:path";
import { parseTrajectory, trajectoryStreamPath } from "@piano/logging";
import { writeFileAtomic } from "./atomic-write.js";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";
import { foldJobSpans, jobs, type JobView } from "./job-spans.js";
import {
  applyProgressRecord,
  parseProgressStreamRecord,
  workflowProgressPath,
  type WorkflowProgressCurrent,
  type WorkflowProgressInvocationTime,
  type WorkflowProgressSnapshot,
  type WorkflowProgressStageCount,
  type WorkflowProgressStreamRecord,
} from "./progress.js";
import { actorTableFrom, type ResumeActorState } from "./resume-state.js";

/** One job, as the state document holds it.
 *
 * `accepted` and `attempts` are a set and a map while a run is live; a JSON
 * document holds them as a list and a table. The coordinates stay the same. */
export interface RunJob {
  readonly jobOrdinal: number;
  /** `alive` while the last span runs; `paused` after a human stop; `finished`
   * once a span closed with an outcome. */
  readonly state: "alive" | "paused" | "finished";
  /** Present only when `state` is `finished`. */
  readonly outcome?: "completed" | "failed" | "restarted";
  /** Invocation ids accepted across every span of this job — what a continue
   * of this job skips. */
  readonly accepted: readonly string[];
  /** Highest attempt number recorded per invocation across the job's spans, so
   * a continue's re-run follows the attempts already on disk. */
  readonly attempts: Readonly<Record<string, number>>;
  /** The input the job runs. */
  readonly input?: string;
}

/** One turn as the state document records it: what the turn was asked and how
 * it ended. Where its events begin and end is a question about the evidence —
 * `eventCount` — and the answer comes from folding the trajectory, which is
 * what the replay does. The view does not carry it. */
export interface RunTurn {
  readonly prompt: string;
  readonly status: "completed" | "failed" | "cancelled";
}

/** The run's state.
 *
 * One of each thing a run used to say once per file: `runId` (which the
 * progress and resume documents called `runId`), one `status`, one
 * `error`, one `updatedAt`. Everything else is what a reader asks for. */
export interface RunStatus {
  readonly version: 1;
  readonly runId: string;
  readonly updatedAt: string;
  readonly status: "running" | "completed" | "failed" | "paused" | "cancelled";
  readonly error?: unknown;
  /** Human-assigned run name (set via the TUI `/rename` command). */
  readonly name?: string;
  /** Workflow this run executed, so `resume` reloads the same one. */
  readonly workflowPath?: string;
  /** TUI workspace at the time of the last turn, which may differ from the
   * session cwd after `/workspace`. */
  readonly workspaceCwd?: string;
  readonly transcriptPath?: string;
  readonly sessionId?: string;
  readonly promptLength: number;
  /** The turns this run has run, oldest first. */
  readonly turns?: readonly RunTurn[];
  /** The plan this run was given, and how much of it is done. */
  readonly plannedStages: number;
  readonly completedStages: number;
  readonly acceptedStages: number;
  readonly remainingStages: number;
  readonly stageCounts: Readonly<Record<string, WorkflowProgressStageCount>>;
  /** Invocation id -> cumulative worker time, so the footer can show a stage's
   * accumulated duration without replaying the stream. */
  readonly invocationTime?: Readonly<Record<string, WorkflowProgressInvocationTime>>;
  /** The invocation in flight, if any. */
  readonly current?: WorkflowProgressCurrent;
  /** The jobs this run has run, latest last. A continue keeps its ordinal; a
   * new prompt or a restart starts the next one. */
  readonly jobs: readonly RunJob[];
  /** The job ordinal the actor table belongs to, and the registry itself:
   * which harness session holds each conversation. */
  readonly jobOrdinal: number;
  readonly actors: Readonly<Record<string, ResumeActorState>>;
}

export function runStatusPath(runDir: string): string {
  return join(runDir, "status.json");
}

/** Build the run's state from the raw contents of its ledgers.
 *
 * Pure, so a reader that already has the bytes (a sync picker, a test) folds
 * without going through the filesystem. `undefined` when nothing describes the
 * run — the same answer a run dir with no evidence gives. */
export function runStatusFromParts(parts: {
  readonly progressStream?: string;
  readonly trajectoryStream?: string;
}): RunStatus | undefined {
  const records = parseProgressLines(parts.progressStream);
  const progress = records.reduce<WorkflowProgressSnapshot | undefined>(
    (folded, record) => applyProgressRecord(folded, record),
    undefined,
  );
  const trajectory = parseTrajectory(parts.trajectoryStream);
  if (progress === undefined && trajectory === undefined) return undefined;
  // The actors a run has: the ledger's own `actor-turn` rows.
  const actors = actorTableFrom(records);

  const runId = progress?.runId ?? trajectory?.runId;
  const status = progress?.status ?? trajectory?.status;
  const updatedAt = progress?.updatedAt ?? trajectory?.updatedAt;
  // A run that has said neither when it is nor how it is has not recorded
  // enough to describe; its ledgers are still there for whoever wants them.
  if (runId === undefined || status === undefined || updatedAt === undefined) return undefined;

  const error = trajectory?.error ?? progress?.error;
  return {
    version: 1,
    runId,
    updatedAt,
    status,
    ...(error === undefined ? {} : { error }),
    ...(trajectory?.name === undefined ? {} : { name: trajectory.name }),
    ...(trajectory?.workflowPath === undefined ? {} : { workflowPath: trajectory.workflowPath }),
    ...(trajectory?.workspaceCwd === undefined ? {} : { workspaceCwd: trajectory.workspaceCwd }),
    ...(trajectory?.transcriptPath === undefined ? {} : { transcriptPath: trajectory.transcriptPath }),
    ...(trajectory?.sessionId === undefined ? {} : { sessionId: trajectory.sessionId }),
    promptLength: trajectory?.promptLength ?? 0,
    ...(trajectory?.turns === undefined
      ? {}
      : { turns: trajectory.turns.map((turn): RunTurn => ({ prompt: turn.prompt, status: turn.status })) }),
    plannedStages: progress?.plannedStages ?? 0,
    completedStages: progress?.completedStages ?? 0,
    acceptedStages: progress?.acceptedStages ?? 0,
    remainingStages: progress?.remainingStages ?? 0,
    stageCounts: progress?.stageCounts ?? {},
    ...(progress?.invocationTime === undefined ? {} : { invocationTime: progress.invocationTime }),
    ...(progress?.current === undefined ? {} : { current: progress.current }),
    jobs: jobs(foldJobSpans(records)).map(asRunJob),
    jobOrdinal: actors.jobOrdinal,
    actors: actors.actors,
  } satisfies RunStatus;
}

/** Read a run's state: the one document, whole.
 *
 * No fallback to the ledgers behind it — those are the evidence and the source
 * this document is folded from, not a second way to answer the question. */
export function readRunStatus(
  runDir: string,
): Effect.Effect<RunStatus | undefined, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem.readFileString(runStatusPath(runDir)).pipe(Effect.orElseSucceed(() => undefined));
    return raw === undefined ? undefined : parseRunStatus(raw);
  });
}

/** Fold the ledgers a run has recorded, producing the state document. */
function foldRunStatus(
  runDir: string,
): Effect.Effect<RunStatus | undefined, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const read = (path: string) => fileSystem.readFileString(path).pipe(Effect.orElseSucceed(() => undefined));
    const [progressStream, trajectoryStream] = yield* Effect.all([
      read(workflowProgressPath(runDir)),
      read(trajectoryStreamPath(runDir)),
    ], { concurrency: "unbounded" });
    return runStatusFromParts({
      ...(progressStream === undefined ? {} : { progressStream }),
      ...(trajectoryStream === undefined ? {} : { trajectoryStream }),
    });
  });
}

/** Fold the ledgers and write the view.
 *
 * Called after a record lands so the view a reader picks up is the one the
 * record describes. The fold is the same one a reader performs, so what a
 * write leaves behind is by construction what reading it back would give. */
export function refreshRunStatus(
  runDir: string,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const status = yield* foldRunStatus(runDir);
    if (status !== undefined) yield* writeRunStatus(runDir, status);
  });
}

/** Rebuild a run's state document from its ledgers — the recovery path when the
 * view is missing or torn.
 *
 * Refuses while the latest job is still open: a live run's own writer owns the
 * view, and a second fold racing it could land a stale table over a newer one.
 * `force` folds anyway, for the operator who knows the run is not writing. */
export function rebuildRunStatus(
  runDir: string,
  options: { readonly force?: boolean } = {},
): Effect.Effect<RunStatus | undefined, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const status = yield* foldRunStatus(runDir);
    if (status === undefined) return undefined;
    const latest = status.jobs.at(-1);
    if (latest?.state === "alive" && options.force !== true) {
      return yield* Effect.fail(workflowError(
        "schedule",
        runStatusPath(runDir),
        "the latest job is still running; rebuild with --force to fold the ledgers anyway",
      ));
    }
    yield* writeRunStatus(runDir, status);
    return status;
  });
}

/** Write a run's state whole. The ledgers stay the evidence; this is the view. */export function writeRunStatus(
  runDir: string,
  status: RunStatus,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  const path = runStatusPath(runDir);
  return writeFileAtomic(path, `${JSON.stringify(status, null, 2)}\n`, {
    temporaryPath: () => `${path}.tmp-${process.pid}`,
    mapError: (cause, step) => workflowError("schedule", path, `status ${step}: ${errorMessage(cause)}`),
  });
}

/** The in-memory job, in the shapes a JSON document can hold. */
function asRunJob(job: JobView): RunJob {
  return {
    jobOrdinal: job.jobOrdinal,
    state: job.state,
    ...(job.outcome === undefined ? {} : { outcome: job.outcome }),
    accepted: [...job.accepted],
    attempts: Object.fromEntries(job.attempts),
    ...(job.input === undefined ? {} : { input: job.input }),
  };
}

/** Parse a state document's raw bytes. `undefined` when missing, torn, or not
 * an object — the same tolerance every reader of the document needs, so none
 * of them hand-rolls its own. */
export function parseRunStatus(raw: string): RunStatus | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as RunStatus
      : undefined;
  } catch {
    // Torn mid-write: the ledgers behind it still hold the run.
    return undefined;
  }
}

/** Parse a progress ledger's raw bytes into the records this build reads.
 * Blank and unreadable lines drop; the line acceptance rule lives in
 * `parseProgressStreamRecord`. */
export function parseProgressLines(raw: string | undefined): readonly WorkflowProgressStreamRecord[] {
  if (raw === undefined) return [];
  const records: WorkflowProgressStreamRecord[] = [];
  for (const line of raw.split("\n")) {
    const record = parseProgressStreamRecord(line);
    if (record !== undefined) records.push(record);
  }
  return records;
}
