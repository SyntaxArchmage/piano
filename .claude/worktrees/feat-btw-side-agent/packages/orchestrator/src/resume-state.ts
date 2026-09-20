import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { join } from "node:path";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";
import type { AgentContinuation } from "@piano/harness";

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
  return join(runDir, "resume.json");
}

export function writeResumeState(
  runDir: string,
  state: ResumeState,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  const path = resumeStatePath(runDir);
  return FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.writeFileString(path, `${JSON.stringify(state, null, 2)}\n`)),
    Effect.mapError((cause) => workflowError("schedule", path, `resume state write: ${errorMessage(cause)}`)),
  );
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
    if (!exists) return undefined;
    const raw = yield* fs.readFileString(path).pipe(
      Effect.mapError((cause) => workflowError("schedule", path, `resume state read: ${errorMessage(cause)}`)),
    );
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
  });
}
