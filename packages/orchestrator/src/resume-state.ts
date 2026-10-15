import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { join } from "node:path";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";
import type { AgentContinuation } from "@piano/harness";
import type { WorkflowProgressActorTurnRecord } from "./progress.js";

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

/** One `actor-turn` row from an actor's state, or `undefined` when the state
 * is not durable (no session to reopen). The one place a writer turns actor
 * state into a ledger row, so the stage path and the consolidation path cannot
 * spell the same row differently. */
export function actorTurnRow(input: {
  readonly runId: string;
  readonly jobOrdinal: number;
  readonly invocationId: string;
  readonly attempt: number;
  readonly actorKey: string;
  readonly harness: string;
  readonly worker: string;
  readonly lane: string;
  readonly state: {
    readonly harness?: string;
    readonly sessionId?: string;
    readonly transcriptPath?: string;
    readonly turns: number;
    readonly continuation?: AgentContinuation;
  };
}): Omit<WorkflowProgressActorTurnRecord, "version" | "timestamp"> | undefined {
  const { state } = input;
  if (state.harness === undefined || state.sessionId === undefined || state.transcriptPath === undefined) {
    return undefined;
  }
  return {
    kind: "actor-turn",
    runId: input.runId,
    jobOrdinal: input.jobOrdinal,
    invocationId: input.invocationId,
    attempt: input.attempt,
    actorKey: input.actorKey,
    harness: state.harness,
    worker: input.worker,
    lane: input.lane,
    sessionId: state.sessionId,
    transcriptPath: state.transcriptPath,
    turn: state.turns,
    ...(state.continuation === undefined ? {} : { continuation: state.continuation }),
  };
}

/** The actor table as the run's own ledger records it: one `actor-turn` row per
 * state change, newest row per actor winning. This is the same table
 * `readResumeState` folds from the resume stream — the ledger is the source
 * that can retire the second file — and the two must agree, which is what the
 * equivalence test pins. */
export function foldActorTurns(
  records: readonly { readonly kind?: unknown }[],
): Record<string, ResumeActorState> {
  const actors: Record<string, ResumeActorState> = {};
  for (const record of records) {
    if (record.kind !== "actor-turn") continue;
    const turn = record as WorkflowProgressActorTurnRecord;
    actors[turn.actorKey] = {
      harness: turn.harness,
      sessionId: turn.sessionId,
      transcriptPath: turn.transcriptPath,
      turns: turn.turn,
      ...(turn.continuation === undefined ? {} : { continuation: turn.continuation }),
    };
  }
  return actors;
}

/** The actor table a run's evidence carries, and the prompt index it implies.
 *
 * The ledger's `actor-turn` rows when it has any — those are the run's own
 * record of each conversation-state change — and the resume stream for a run
 * that predates them. One precedence rule, so the view (`status.json`) and the
 * continue path cannot disagree about which actors a run has. */
export function actorTableFrom(
  ledger: readonly unknown[],
  stream: ResumeState | undefined,
): { readonly promptIndex: number; readonly actors: Readonly<Record<string, ResumeActorState>> } {
  const turns = ledger.filter(
    (record): record is WorkflowProgressActorTurnRecord =>
      typeof record === "object" && record !== null && (record as { kind?: unknown }).kind === "actor-turn",
  );
  if (turns.length > 0) {
    const last = turns.at(-1)!;
    return { promptIndex: last.jobOrdinal, actors: foldActorTurns(turns) };
  }
  return { promptIndex: stream?.promptIndex ?? 0, actors: stream?.actors ?? {} };
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
