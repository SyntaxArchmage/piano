import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname, join } from "node:path";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";
import { refreshRunStatus } from "./run-status.js";
import type { AgentContinuation } from "@piano/harness";

/** The legacy single-document form. Read for runs written before the stream
 * existed; never written now. */
/** The append-only form: one complete table per line, newest last. */
const RESUME_STREAM_NAME = "resume.jsonl";

export interface ResumeActorState {
  readonly harness: string;
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly turns: number;
  readonly continuation?: AgentContinuation;
}

export interface ResumeState {
  readonly version: 1;
  readonly runId: string;
  readonly promptIndex: number;
  readonly actors: Record<string, ResumeActorState>;
}

/** Path of the legacy document. Kept for readers that predate the stream. */
export function resumeStreamPath(runDir: string): string {
  return join(runDir, RESUME_STREAM_NAME);
}

function resumeError(path: string, operation: string) {
  return (cause: unknown) => workflowError("schedule", path, `${operation}: ${errorMessage(cause)}`);
}

/** Write the run's resume state as one more line of the stream.
 *
 * Appending is the whole write. The document this replaced was read, merged and
 * renamed over atomically, which meant a crash could land between its bytes and
 * the rename — so the writer kept a staged copy beside it and the reader had to
 * recover from that copy. A record that is only ever appended has neither a
 * half-written state to avoid nor a previous copy to rescue.
 *
 * The record is a complete table, not a delta: the caller holds every actor it
 * knows, and `readResumeState` folds the stream with the same merge rule the
 * writer used to apply by hand. */
export function writeResumeState(
  runDir: string,
  state: ResumeState,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  const path = resumeStreamPath(runDir);
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const line = yield* Effect.try({
      try: () => `${JSON.stringify(state)}\n`,
      catch: resumeError(path, "resume state serialize"),
    });
    yield* fs.makeDirectory(dirname(path), { recursive: true }).pipe(
      Effect.mapError(resumeError(path, "resume state mkdir")),
    );
    yield* fs.writeFileString(path, line, { flag: "a" }).pipe(
      Effect.mapError(resumeError(path, "resume state append")),
    );
    // The run's one state document stays in step with the ledger it is a view
    // of.
    yield* refreshRunStatus(runDir);
  });
}

/** Actors already on disk survive a record that does not mention them, newest
 * record winning per actor. A table belonging to another execution is not this
 * execution's history and is replaced outright. */
function mergeResumeState(existing: ResumeState | undefined, next: ResumeState): ResumeState {
  if (existing === undefined || existing.runId !== next.runId) return next;
  return { ...next, actors: { ...existing.actors, ...next.actors } };
}

/** Read the run's actor table: the stream folded by the writer's own rule. */
export function readResumeState(
  runDir: string,
): Effect.Effect<ResumeState | undefined, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const records = yield* readStream(fs, resumeStreamPath(runDir));
    return records.reduce<ResumeState | undefined>(mergeResumeState, undefined);
  });
}

/** A missing stream is no actors; one that cannot be read is an error —
 * starting every actor over is a worse answer than saying so. */
function readStream(
  fs: FileSystem.FileSystem,
  path: string,
): Effect.Effect<readonly ResumeState[], WorkflowError, never> {
  return Effect.gen(function* () {
    const raw = yield* fs.readFileString(path).pipe(
      Effect.catchAll((cause) => cause._tag === "SystemError" && cause.reason === "NotFound"
        ? Effect.succeed("")
        : Effect.fail(resumeError(path, "resume state read")(cause))),
    );
    return raw.split("\n")
      .map(parseResumeState)
      .filter((record): record is ResumeState => record !== undefined);
  });
}

function parseResumeState(raw: string): ResumeState | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const doc = value as Record<string, unknown>;
  if (typeof doc.runId !== "string") return undefined;
  if (typeof doc.promptIndex !== "number") return undefined;
  if (typeof doc.actors !== "object" || doc.actors === null) return undefined;
  return value as ResumeState;
}
