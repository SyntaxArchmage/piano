import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import { join } from "node:path";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";
import type { AgentContinuation } from "@piano/harness";

const RESUME_STATE_NAME = "resume.json";

export interface ResumeActorState {
  readonly harness: string;
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly turns: number;
  readonly continuation?: AgentContinuation;
}

export interface ResumeState {
  readonly version: 1;
  readonly executionId: string;
  readonly promptIndex: number;
  readonly actors: Record<string, ResumeActorState>;
}

export function resumeStatePath(runDir: string): string {
  return join(runDir, RESUME_STATE_NAME);
}

/** Where an in-flight write stages its bytes before the atomic rename. Unique
 * per process, so two writers can never interleave their bytes in one staging
 * file; a crash can leave one behind, and {@link readResumeState} reads it as a
 * recovery source rather than ignoring it. */
function stagingPath(path: string): string {
  return `${path}.${process.pid}.tmp`;
}

/** Write the run's resume state.
 *
 * Incremental, not a replacement: the given actors are merged into whatever the
 * file already holds, so a prompt that touches a subset of the actors cannot
 * erase the others' sessions. The orchestrator passes the table it was seeded
 * with, so this is the second line of defense — a caller that lost an actor
 * upstream would otherwise delete it here.
 *
 * The bytes land in a staging file that is then renamed over the target, so a
 * reader sees either the previous table or the new one and never a half-written
 * document: a crash mid-write cannot destroy state that was already durable. */
export function writeResumeState(
  runDir: string,
  state: ResumeState,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  const path = resumeStatePath(runDir);
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const existing = yield* readResumeState(runDir);
    const staged = stagingPath(path);
    yield* fs.writeFileString(staged, `${JSON.stringify(mergeResumeState(existing, state), null, 2)}\n`);
    yield* fs.rename(staged, path);
  }).pipe(
    Effect.mapError((cause) => workflowError("schedule", path, `resume state write: ${errorMessage(cause)}`)),
  );
}

/** Actors already on disk survive a write that does not mention them, newest
 * write winning per actor. A state file belonging to another execution is not
 * this execution's history and is replaced outright. */
function mergeResumeState(existing: ResumeState | undefined, next: ResumeState): ResumeState {
  if (existing === undefined || existing.executionId !== next.executionId) return next;
  return { ...next, actors: { ...existing.actors, ...next.actors } };
}

export function readResumeState(
  runDir: string,
): Effect.Effect<ResumeState | undefined, WorkflowError, FileSystem.FileSystem> {
  const path = resumeStatePath(runDir);
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(path).pipe(
      Effect.mapError((cause) => workflowError("schedule", path, `resume state exists: ${errorMessage(cause)}`)),
    );
    if (exists) {
      const raw = yield* fs.readFileString(path).pipe(
        Effect.mapError((cause) => workflowError("schedule", path, `resume state read: ${errorMessage(cause)}`)),
      );
      const state = parseResumeState(raw);
      if (state !== undefined) return state;
    }
    // Missing, or present but not a readable table. A write that died between
    // its staging file and the rename leaves the only good copy staged, so read
    // that rather than reporting no state at all: "no state" means the next
    // prompt starts every actor over.
    return yield* readStagedResumeState(fs, runDir);
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
  if (typeof doc.executionId !== "string") return undefined;
  if (typeof doc.promptIndex !== "number") return undefined;
  if (typeof doc.actors !== "object" || doc.actors === null) return undefined;
  return value as ResumeState;
}

/** The newest staged table that parses, if a crashed write left one. Unreadable
 * candidates simply lose; recovery is best-effort and must never fail the read
 * that asked for it. */
function readStagedResumeState(
  fs: FileSystem.FileSystem,
  runDir: string,
): Effect.Effect<ResumeState | undefined, never, never> {
  return Effect.gen(function* () {
    const names = yield* fs.readDirectory(runDir).pipe(Effect.orElseSucceed(() => [] as Array<string>));
    const staged = names.filter((name) => name.startsWith(RESUME_STATE_NAME) && name.endsWith(".tmp"));
    if (staged.length === 0) return undefined;
    const stamped = yield* Effect.forEach(staged, (name) => fs.stat(join(runDir, name)).pipe(
      Effect.map((info) => ({ name, at: Option.getOrElse(info.mtime, () => new Date(0)).getTime() })),
      Effect.orElseSucceed(() => ({ name, at: 0 })),
    ));
    for (const candidate of [...stamped].sort((left, right) => right.at - left.at)) {
      const raw = yield* fs.readFileString(join(runDir, candidate.name)).pipe(Effect.orElseSucceed(() => undefined));
      if (raw === undefined) continue;
      const state = parseResumeState(raw);
      if (state !== undefined) return state;
    }
    return undefined;
  });
}
