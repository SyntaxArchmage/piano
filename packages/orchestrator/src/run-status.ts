/**
 * The run's state, as one document.
 *
 * A run records its work in append-only ledgers — `progress.jsonl` for what the
 * workflow did, `trajectory.jsonl` for what the agent said, `resume.jsonl` for
 * which harness sessions hold the conversations. This is the one view of them.
 * Every reader asks for the run's state here instead of folding its own, so
 * "how is this run doing" has exactly one answer and cannot disagree with
 * itself between the log picker, the TUI and a resume.
 *
 * The ledgers stay the only evidence. Nothing here is written that cannot be
 * rebuilt by folding them, which is what lets the per-source documents
 * (`progress.json`, `resume.json`, `trajectory.json`) go away without losing
 * a run.
 */

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { join } from "node:path";
import { parseTrajectory, trajectoryStreamPath, type TrajectoryTurn } from "@piano/logging";
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
import { resumeStreamPath, type ResumeActorState, type ResumeState } from "./resume-state.js";

/** The run's state.
 *
 * One of each thing a run used to say once per file: `runId` (which the
 * progress and resume documents called `executionId`), one `status`, one
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
  /** One entry per turn, so a replay slices its events by `eventCount`. */
  readonly turns?: readonly TrajectoryTurn[];
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
  readonly jobs: readonly JobView[];
  /** The actor registry: which harness session holds each conversation. */
  readonly promptIndex: number;
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
  readonly resume?: string;
  readonly trajectoryStream?: string;
  readonly trajectoryDocument?: string;
}): RunStatus | undefined {
  const records = parseProgressLines(parts.progressStream);
  const progress = records.reduce<WorkflowProgressSnapshot | undefined>(
    (folded, record) => applyProgressRecord(folded, record),
    undefined,
  );
  const resume = parts.resume === undefined ? undefined : parseResumeTable(parts.resume);
  const trajectory = parseTrajectory({
    ...(parts.trajectoryStream === undefined ? {} : { stream: parts.trajectoryStream }),
    ...(parts.trajectoryDocument === undefined ? {} : { document: parts.trajectoryDocument }),
  });
  if (progress === undefined && resume === undefined && trajectory === undefined) return undefined;

  const runId = progress?.executionId ?? resume?.executionId ?? trajectory?.runId;
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
    ...(trajectory?.turns === undefined ? {} : { turns: trajectory.turns }),
    plannedStages: progress?.plannedStages ?? 0,
    completedStages: progress?.completedStages ?? 0,
    acceptedStages: progress?.acceptedStages ?? 0,
    remainingStages: progress?.remainingStages ?? 0,
    stageCounts: progress?.stageCounts ?? {},
    ...(progress?.invocationTime === undefined ? {} : { invocationTime: progress.invocationTime }),
    ...(progress?.current === undefined ? {} : { current: progress.current }),
    jobs: jobs(foldJobSpans(records)),
    promptIndex: resume?.promptIndex ?? 0,
    actors: resume?.actors ?? {},
  } satisfies RunStatus;
}

/** Read a run's state by folding its ledgers. */
export function readRunStatus(
  runDir: string,
): Effect.Effect<RunStatus | undefined, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const read = (path: string) => fileSystem.readFileString(path).pipe(Effect.orElseSucceed(() => undefined));
    const [progressStream, resume, trajectoryStream, trajectoryDocument] = yield* Effect.all([
      read(workflowProgressPath(runDir)),
      read(resumeStreamPath(runDir)),
      read(trajectoryStreamPath(join(runDir, "trajectory.json"))),
      read(join(runDir, "trajectory.json")),
    ], { concurrency: "unbounded" });
    return runStatusFromParts({
      ...(progressStream === undefined ? {} : { progressStream }),
      ...(resume === undefined ? {} : { resume }),
      ...(trajectoryStream === undefined ? {} : { trajectoryStream }),
      ...(trajectoryDocument === undefined ? {} : { trajectoryDocument }),
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
    const status = yield* readRunStatus(runDir);
    if (status !== undefined) yield* writeRunStatus(runDir, status);
  });
}

/** Write a run's state whole. The ledgers stay the evidence; this is the view. */
export function writeRunStatus(
  runDir: string,
  status: RunStatus,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  const path = runStatusPath(runDir);
  return writeFileAtomic(path, `${JSON.stringify(status, null, 2)}\n`, {
    temporaryPath: () => `${path}.tmp-${process.pid}`,
    mapError: (cause, step) => workflowError("schedule", path, `status ${step}: ${errorMessage(cause)}`),
  });
}

function parseProgressLines(raw: string | undefined): readonly WorkflowProgressStreamRecord[] {
  if (raw === undefined) return [];
  const records: WorkflowProgressStreamRecord[] = [];
  for (const line of raw.split("\n")) {
    const record = parseProgressStreamRecord(line);
    if (record !== undefined) records.push(record);
  }
  return records;
}

/** The resume stream's newest table, or the document a pre-stream run left.
 *
 * The document is one table whole; the stream appends one per write and the
 * newest is the state. */
function parseResumeTable(raw: string): ResumeState | undefined {
  const whole = tryParseObject(raw);
  if (whole !== undefined && typeof whole.executionId === "string") return whole as unknown as ResumeState;
  for (const line of raw.split("\n").reverse()) {
    const table = tryParseObject(line);
    if (table !== undefined && typeof table.executionId === "string") return table as unknown as ResumeState;
  }
  return undefined;
}

function tryParseObject(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
