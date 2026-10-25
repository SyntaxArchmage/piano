/**
 * The run's state, as one document.
 *
 * A run records what the agent said in the append-only `trajectory.jsonl`
 * ledger and keeps the workflow's own bookkeeping — jobs, accepted
 * invocations, the actor table — here, in the one mutable document. Every
 * reader asks for the run's state here instead of folding its own, so "how is
 * this run doing" has exactly one answer and cannot disagree with itself
 * between the log picker, the TUI and a resume.
 *
 * The trajectory ledger stays the evidence for the narrative fields; the
 * orchestrator writes the rest as it schedules, so the document is the source
 * for them rather than a second view that could drift.
 */

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { parseTrajectory, type TrajectoryDocument } from "@piano/logging";
import { z } from "zod";
import {
  runStatusPath,
  trajectoryStreamPath,
  writeFileAtomic,
  type JobOutcome,
  type RunLifecycleStatus,
  type TurnOutcome,
} from "@piano/base";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";

import {
  type WorkflowProgressCurrent,
  type WorkflowProgressInvocationTime,
  type WorkflowProgressRegionFinalizedRecord,
  type WorkflowProgressStageCount,
} from "./progress.js";
import type { ResumeActorState } from "./resume-state.js";
import {
  parseInvocationId,
  type WorkflowRuntimeFrame,
} from "./workflow-runtime.js";

/** One accepted invocation of a job, as the state document holds it.
 *
 * `invocationId` is the key a continue matches on — the workflow's
 * persistence contract. The fields beside it restate that key's identity as
 * structure (`tune.propose@tune/iter-2` → stage, frames, iteration) so a
 * reader of this document never has to parse it. */
export interface RunAcceptedInvocation {
  readonly invocationId: string;
  /** Static dotted stage identity from the compiled workflow. */
  readonly stageId: string;
  /** The runtime frames the key carries (`[{regionId, iteration}, …]`), or
   * absent for a root invocation or a key this build cannot parse. */
  readonly frames?: readonly WorkflowRuntimeFrame[];
  /** Innermost loop iteration, when the invocation ran inside a loop. */
  readonly iteration?: number;
}

/** The state document's accepted entry for one invocation id: the key,
 * spelled back out as structure. */
export function acceptedInvocationOf(invocationId: string): RunAcceptedInvocation {
  const { stageId, frames, iteration } = parseInvocationId(invocationId);
  return {
    invocationId,
    stageId,
    ...(frames === undefined ? {} : { frames }),
    ...(iteration === undefined ? {} : { iteration }),
  };
}

/** One job, as the state document holds it.
 *
 * A job is history and a cursor, never a second lifecycle: whether the run is
 * working, paused, or finished is `RunStatus.status` alone. `accepted` and
 * `attempts` are a set and a map while a run is live; a JSON document holds
 * them as a list and a table. */
export interface RunJob {
  readonly jobOrdinal: number;
  /** The verdict of a job that ended, kept for history and for finding the
   * slots a restart abandoned. Absent while the job is the run's live or
   * paused one. */
  readonly outcome?: JobOutcome;
  /** Invocations accepted across every span of this job — what a continue of
   * this job skips. */
  readonly accepted: readonly RunAcceptedInvocation[];
  /** Highest attempt number recorded per invocation across the job's spans, so
   * a continue's re-run follows the attempts already on disk. */
  readonly attempts: Readonly<Record<string, number>>;
  /** The input the job runs. */
  readonly input?: string;
  /** Regions that already finalized in this job, keyed by runtime instance.
   * The `/continue` path rebuilds those boundaries instead of re-entering
   * their workers. */
  readonly regions?: Readonly<Record<string, WorkflowProgressRegionFinalizedRecord>>;
}

/** The ordinal the next job takes: one past the latest the table records.
 * The table is the only source — evidence rows and caller hints never mint
 * one. */
export function nextJobOrdinal(jobs: readonly RunJob[]): number {
  return (jobs.at(-1)?.jobOrdinal ?? 0) + 1;
}

/** One turn as the state document records it: what the turn was asked and how
 * it ended. Where its events begin and end is a question about the evidence —
 * `eventCount` — and the answer comes from folding the trajectory, which is
 * what the replay does. The view does not carry it. */
export interface RunTurn {
  readonly prompt: string;
  readonly status: TurnOutcome;
}

/** The run's state: identity, lifecycle status, error, and the job/actor
 * tables — everything a reader asks for, in one document. */
export interface RunStatus {
  readonly runId: string;
  readonly updatedAt: string;
  readonly status: RunLifecycleStatus;
  readonly error?: unknown;
  /** Human-assigned run name (set via the TUI `/rename` command). */
  readonly name?: string;
  /** The run's lane namespace (`<task-slug>-<runId>`), recorded so a continue
   * reuses it instead of re-summarizing the prompt. */
  readonly mnemonic?: string;
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
  /** Accepted invocations so far: acceptance is the completion, so there is
   * no second counter to keep in step. */
  readonly completedStages: number;
  readonly stageCounts: Readonly<Record<string, WorkflowProgressStageCount>>;
  /** Invocation id -> cumulative worker time, so the footer can show a stage's
   * accumulated duration without replaying the events. */
  readonly invocationTime?: Readonly<Record<string, WorkflowProgressInvocationTime>>;
  /** The invocation in flight, if any. */
  readonly current?: WorkflowProgressCurrent;
  /** The jobs this run has run, latest last. A continue keeps its ordinal; a
   * new prompt or a restart starts the next one. */
  readonly jobs: readonly RunJob[];
  /** Which harness session holds each conversation. One run is one execution,
   * so the registry is run-scoped: every prompt after the first reopens what
   * the previous one left. */
  readonly actors: Readonly<Record<string, ResumeActorState>>;
}

export { runStatusPath };

/** The state document's one schema. Readers validate; writers validate before
 * serializing, so a malformed document is never produced. Missing collection
 * fields default to empty so a run written by an older build still loads;
 * unknown keys pass through. */
const RuntimeFrameSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("loop"), regionId: z.string(), iteration: z.number() }).passthrough(),
  z.object({ kind: z.literal("map"), regionId: z.string(), slot: z.number() }).passthrough(),
]);

const AcceptedInvocationSchema = z.object({
  invocationId: z.string(),
  stageId: z.string(),
  frames: z.array(RuntimeFrameSchema).optional(),
  iteration: z.number().optional(),
}).passthrough();

const RunJobSchema = z.object({
  jobOrdinal: z.number(),
  outcome: z.enum(["completed", "failed", "restarted"]).optional(),
  accepted: z.array(AcceptedInvocationSchema).default([]),
  attempts: z.record(z.string(), z.number()).default({}),
  input: z.string().optional(),
  regions: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const RunTurnSchema = z.object({
  prompt: z.string(),
  status: z.enum(["completed", "failed", "cancelled"]),
}).passthrough();

const StageCountSchema = z.object({
  planned: z.number().default(0),
  completed: z.number().default(0),
}).passthrough();

const InvocationTimeSchema = z.object({
  stageId: z.string(),
  instanceId: z.string().optional(),
  completedMs: z.number().optional(),
  runningSince: z.string().optional(),
}).passthrough();

// Partial current entries are read-compatible: older documents and status
// fixtures recorded only the fields a view needed. Readers that require more
// treat a missing field as absent, as they did before this schema.
const CurrentSchema = z.object({
  status: z.enum(["running", "accepted", "failed"]).optional(),
  invocationId: z.string().optional(),
  stageId: z.string().optional(),
  stage: z.string().optional(),
  worker: z.string().optional(),
  attempt: z.number().optional(),
  instanceId: z.string().optional(),
  iteration: z.number().optional(),
  error: z.string().optional(),
}).passthrough();

const ActorSchema = z.object({
  harness: z.string(),
  sessionId: z.string(),
  transcriptPath: z.string(),
  turns: z.number(),
  continuation: z.unknown().optional(),
}).passthrough();

export const RunStatusSchema = z.object({
  // Identity fields are defaulted rather than required: an old or partial
  // document still loads, and a reader that needs the id already has the run
  // directory. Wrong types are still rejected.
  runId: z.string().default(""),
  updatedAt: z.string().default(""),
  status: z.enum(["running", "completed", "failed", "paused", "cancelled"]).default("running"),
  error: z.unknown().optional(),
  name: z.string().optional(),
  mnemonic: z.string().optional(),
  workflowPath: z.string().optional(),
  workspaceCwd: z.string().optional(),
  transcriptPath: z.string().optional(),
  sessionId: z.string().optional(),
  promptLength: z.number().default(0),
  turns: z.array(RunTurnSchema).optional(),
  plannedStages: z.number().default(0),
  completedStages: z.number().default(0),
  stageCounts: z.record(z.string(), StageCountSchema).default({}),
  invocationTime: z.record(z.string(), InvocationTimeSchema).optional(),
  current: CurrentSchema.optional(),
  jobs: z.array(RunJobSchema).default([]),
  actors: z.record(z.string(), ActorSchema).default({}),
}).passthrough();

/** The state document's trajectory-derived fields. One projection, so the
 * bootstrap fold and the per-write refresh cannot drift. */
function trajectoryStatusFields(trajectory: TrajectoryDocument): Partial<RunStatus> {
  return {
    ...(trajectory.name === undefined ? {} : { name: trajectory.name }),
    ...(trajectory.workflowPath === undefined ? {} : { workflowPath: trajectory.workflowPath }),
    ...(trajectory.workspaceCwd === undefined ? {} : { workspaceCwd: trajectory.workspaceCwd }),
    ...(trajectory.transcriptPath === undefined ? {} : { transcriptPath: trajectory.transcriptPath }),
    ...(trajectory.sessionId === undefined ? {} : { sessionId: trajectory.sessionId }),
    promptLength: trajectory.promptLength ?? 0,
    ...(trajectory.turns === undefined
      ? {}
      : { turns: trajectory.turns.map((turn): RunTurn => ({ prompt: turn.prompt, status: turn.status })) }),
  };
}

/** The zero state document. The workflow-owned half (jobs, accepted
 * invocations, stage counts) is written as the run schedules. */
export function emptyRunStatus(runId: string, timestamp: string): RunStatus {
  return {
    runId,
    updatedAt: timestamp,
    status: "running",
    promptLength: 0,
    plannedStages: 0,
    completedStages: 0,
    stageCounts: {},
    jobs: [],
    actors: {},
  };
}

/** Bootstrap the state document from a trajectory when none exists yet.
 *
 * Pure, so a reader that already has the bytes can fold without going through
 * the filesystem. The trajectory's `status` is the status of its newest turn;
 * this is the only place it seeds the run's lifecycle status, and it is a
 * bootstrap, not a merge. */
export function runStatusFromTrajectory(trajectoryStream?: string): RunStatus | undefined {
  const trajectory = parseTrajectory(trajectoryStream);
  return trajectory === undefined ? undefined : runStatusFromTrajectoryDocument(trajectory);
}

function runStatusFromTrajectoryDocument(trajectory: TrajectoryDocument): RunStatus | undefined {
  const runId = trajectory.runId;
  const status = trajectory.status;
  const updatedAt = trajectory.updatedAt;
  // A run that has said neither when it is nor how it is has not recorded
  // enough to describe; its trajectory is still there for whoever wants it.
  if (runId === undefined || status === undefined || updatedAt === undefined) return undefined;
  return {
    ...emptyRunStatus(runId, updatedAt),
    status,
    ...(trajectory.error === undefined ? {} : { error: trajectory.error }),
    ...trajectoryStatusFields(trajectory),
  };
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

/** Bring the trajectory-derived fields of the state document up to date.
 *
 * Called after a trajectory write (a turn, a rename). The job and actor tables
 * are the orchestrator's own writes and are preserved: this only refreshes
 * what the trajectory is the source of, so a rename cannot erase a run.
 * A run with no state document yet is folded whole from its trajectory. */
export function refreshRunStatus(
  runDir: string,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const raw = yield* readTrajectoryText(runDir);
    const trajectory = parseTrajectory(raw);
    const current = yield* readRunStatus(runDir);
    if (current === undefined) {
      if (trajectory === undefined) return;
      const folded = runStatusFromTrajectoryDocument(trajectory);
      if (folded !== undefined) yield* writeRunStatus(runDir, folded);
      return;
    }
    if (trajectory === undefined) return;
    yield* writeRunStatus(runDir, {
      ...current,
      updatedAt: trajectory.updatedAt,
      ...trajectoryStatusFields(trajectory),
      ...(current.error !== undefined || trajectory.error === undefined
        ? (current.error === undefined ? {} : { error: current.error })
        : { error: trajectory.error }),
    });
  });
}

/** The raw trajectory stream, or `undefined` when the run never wrote one. */
function readTrajectoryText(
  runDir: string,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.readFileString(trajectoryStreamPath(runDir)).pipe(
      Effect.orElseSucceed(() => undefined),
    );
  });
}

/** Write a run's state whole. It is the source every reader polls. */
export function writeRunStatus(
  runDir: string,
  status: RunStatus,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  const path = runStatusPath(runDir);
  const parsed = RunStatusSchema.safeParse(status);
  if (!parsed.success) {
    return Effect.fail(workflowError("schedule", path, `status document is invalid: ${parsed.error.message}`));
  }
  return writeFileAtomic(path, `${JSON.stringify(parsed.data, null, 2)}\n`, {
    mapError: (cause, step) => workflowError("schedule", path, `status ${step}: ${errorMessage(cause)}`),
  });
}

/** Parse a state document's raw bytes. `undefined` when missing, torn, or not
 * an object — the same tolerance every reader of the document needs, so none
 * of them hand-rolls its own. */
export function parseRunStatus(raw: string): RunStatus | undefined {
  // A torn write or a document that fails the schema reads as absent; the
  // ledgers behind it still hold the run.
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = RunStatusSchema.safeParse(value);
  return parsed.success ? (parsed.data as RunStatus) : undefined;
}
