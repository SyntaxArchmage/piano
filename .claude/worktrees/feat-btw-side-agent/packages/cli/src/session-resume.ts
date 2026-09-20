// Read side of `/resume` and `piano resume`: turn a run's `trajectory.json` into
// the picker row and the chat replay.
//
// Both readers are deliberately tolerant. A run directory may predate the resume
// fields, may hold a partially written document from a killed process, or may
// hold no trajectory at all — none of that should make a run unlistable or
// unresumable, so missing pieces degrade to `undefined` rather than an error.
// Only a malformed (unparseable) document surfaces as a typed failure, and only
// for the run the user explicitly asked to resume.

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { basename, join } from "node:path";
import type { AgentEvent } from "@piano/harness";
import type { FailureDetails, TrajectoryDocument } from "@piano/logging";
import { LogsStorageError } from "./errors.js";

/** One replayable prompt and the events it produced. */
export interface ResumeTurn {
  readonly prompt: string;
  readonly status: "completed" | "failed" | "cancelled";
  readonly events: readonly AgentEvent[];
  /** Recorded failure. Only the final turn can carry one: `trajectory.json`
   * keeps a single document-level `error`, overwritten each turn. */
  readonly error?: FailureDetails;
}

/** Everything a resume needs from one run's trajectory. */
export interface ResumeContext {
  readonly runId: string;
  readonly name?: string;
  readonly workflowPath?: string;
  readonly workspaceCwd?: string;
  readonly turns: readonly ResumeTurn[];
}

/** One picker row. Every field beyond `runId` is best-effort. */
export interface RunSummary {
  readonly runId: string;
  readonly name?: string;
  readonly prompt?: string;
  readonly workflow?: string;
  readonly workspaceCwd?: string;
  readonly status?: string;
  readonly updatedAt?: string;
}

export function trajectoryPath(runsRoot: string, runId: string): string {
  return join(runsRoot, runId, "trajectory.json");
}

/** What looking for one run's trajectory can find, and what each outcome means
 * for resumability. This is the resume layer's own rule, so every reader — the
 * TUI picker, `resume --list`, a future run browser — filters on one verdict
 * instead of re-deciding what a missing file means.
 *
 * - `present`: the document's bytes; summarise and replay as usual.
 * - `absent`: no `trajectory.json` at all, so there is nothing to replay and
 *   `readResumeContext` could only fail. A run in this state is a directory
 *   left by a session that was opened and closed without a prompt — clutter,
 *   not history.
 * - `unreadable`: the file is there but could not be read (permissions, a
 *   transient I/O error). Keep the run listed as an id-only row: hiding
 *   history the user could be looking for is worse than showing it without
 *   metadata. A malformed document is `present` — the bytes were read. */
export type RunTrajectory =
  | { readonly kind: "present"; readonly raw: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable" };

/** Interpret a failed trajectory read. Only ENOENT means "no trajectory", the
 * one outcome that makes a run unresumable; every other failure is treated as
 * transient so the run stays listed. */
export function trajectoryReadFailed(cause: unknown): RunTrajectory {
  return cause instanceof Error && (cause as NodeJS.ErrnoException).code === "ENOENT"
    ? { kind: "absent" }
    : { kind: "unreadable" };
}

/** Collapse a prompt to one line so a row stays one row. */
export function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, Math.max(0, limit - 1))}…`;
}

/** `20260901T070228-591cd0` → `2026-09-01 07:02`. Falls back to the raw id when
 * it does not follow the generated shape (a user could create any directory). */
export function formatRunId(runId: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(runId);
  return match === null
    ? runId
    : `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}

function isEvent(value: unknown): value is AgentEvent {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string";
}

function eventText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (part !== null && typeof part === "object" && (part as { type?: string }).type === "text") {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  return undefined;
}

/** Recover a prompt from a document written before `turns` existed: the stage
 * context event carries the user message, and `message_start` carries it for
 * runs whose events were captured before compaction dropped that type. */
function legacyPrompt(events: readonly unknown[]): string | undefined {
  for (const event of events) {
    if (!isEvent(event)) continue;
    const record = event as unknown as Record<string, unknown>;
    if (record.type === "context") {
      const context = record.context as { userMessage?: unknown } | undefined;
      if (typeof context?.userMessage === "string") return context.userMessage;
    } else if (record.type === "message_start") {
      const message = record.message as { role?: string; content?: unknown } | undefined;
      if (message?.role === "user") {
        const text = eventText(message.content);
        if (text !== undefined) return text;
      }
    }
  }
  return undefined;
}

/** The prompt a stage received carries appended workflow context. Show only the
 * user's own text, which is everything before that marker. */
function stripStageContext(prompt: string): string {
  const marker = prompt.indexOf("\n\n## Workflow stage context");
  return marker < 0 ? prompt : prompt.slice(0, marker);
}

/** `TrajectoryDocument.error` is `unknown`, so accept it only when it carries
 * the two fields the error box needs. */
function failureOf(value: unknown): FailureDetails | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { type, message } = value as { type?: unknown; message?: unknown };
  return typeof type === "string" && typeof message === "string"
    ? value as FailureDetails
    : undefined;
}

/** Read and parse a run's trajectory, failing when it is absent or malformed. */
function readDocument(
  path: string,
): Effect.Effect<Partial<TrajectoryDocument>, LogsStorageError, FileSystem.FileSystem> {
  const storageError = (message: string): LogsStorageError =>
    new LogsStorageError({ operation: "read-trajectory", path, message });
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem.readFileString(path).pipe(
      Effect.mapError((cause) => cause._tag === "SystemError" && cause.reason === "NotFound"
        ? storageError("no trajectory recorded for this run")
        : storageError(String(cause))),
    );
    return yield* Effect.try({
      try: () => JSON.parse(raw) as Partial<TrajectoryDocument>,
      catch: (cause) => storageError(String(cause)),
    });
  });
}

/** Metadata for one picker row, from raw file bytes. Pure and total so both the
 * Effect reader below and the TUI picker (which reads with `node:fs/promises`,
 * off the Effect runtime) share one interpretation of a trajectory. A run that
 * cannot be read or parsed still yields a row: hiding it would misrepresent
 * what the runs root contains. */
export function summarizeRun(runId: string, raw: string | undefined): RunSummary {
  let document: Partial<TrajectoryDocument> | undefined;
  if (raw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        document = parsed as Partial<TrajectoryDocument>;
      }
    } catch {
      // Malformed or half-written document: fall through to the id-only row.
    }
  }
  if (document === undefined) return { runId };
  const turns = Array.isArray(document.turns) ? document.turns : [];
  const firstPrompt = typeof turns[0]?.prompt === "string"
    ? turns[0].prompt
    : legacyPrompt(Array.isArray(document.events) ? document.events : []);
  return {
    runId,
    ...(typeof document.name === "string" ? { name: document.name } : {}),
    ...(firstPrompt === undefined ? {} : { prompt: stripStageContext(firstPrompt) }),
    ...(typeof document.workflowPath === "string"
      ? { workflow: basename(document.workflowPath).replace(/\.ya?ml$/i, "") }
      : {}),
    ...(typeof document.workspaceCwd === "string" ? { workspaceCwd: document.workspaceCwd } : {}),
    ...(typeof document.status === "string" ? { status: document.status } : {}),
    ...(typeof document.updatedAt === "string" ? { updatedAt: document.updatedAt } : {}),
  };
}

/** Metadata for one run, read through the Effect filesystem. Never fails. */
export function readRunSummary(
  runsRoot: string,
  runId: string,
): Effect.Effect<RunSummary, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem.readFileString(trajectoryPath(runsRoot, runId)).pipe(
      Effect.catchAll(() => Effect.succeed(undefined)),
    );
    return summarizeRun(runId, raw);
  });
}

/** Full replay context for the run the user chose. Fails when the run has no
 * trajectory or it cannot be parsed: the user named this run, so silently
 * resuming an empty conversation would be worse than saying why. */
export function readResumeContext(
  runsRoot: string,
  runId: string,
): Effect.Effect<ResumeContext, LogsStorageError, FileSystem.FileSystem> {
  const path = trajectoryPath(runsRoot, runId);
  return readDocument(path).pipe(Effect.map((document): ResumeContext => {
    const allEvents = Array.isArray(document.events) ? document.events : [];
    const recorded = Array.isArray(document.turns) ? document.turns : undefined;
    const status = document.status ?? "completed";
    const failure = failureOf(document.error);
    const turns: ResumeTurn[] = [];
    if (recorded !== undefined && recorded.length > 0) {
      let start = 0;
      recorded.forEach((turn, index) => {
        // eventCount is cumulative, so a turn owns the slice between the
        // previous boundary and its own. Clamp: a document written by an older
        // build, or truncated mid-write, must not produce a reversed slice.
        const end = Math.min(Math.max(turn.eventCount, start), allEvents.length);
        const last = index === recorded.length - 1;
        turns.push({
          prompt: stripStageContext(turn.prompt),
          status: turn.status,
          events: allEvents.slice(start, end).filter(isEvent),
          ...(last && failure !== undefined && turn.status !== "completed" ? { error: failure } : {}),
        });
        start = end;
      });
    } else if (allEvents.length > 0) {
      const events = allEvents.filter(isEvent);
      turns.push({
        prompt: stripStageContext(legacyPrompt(allEvents) ?? ""),
        status,
        events,
        ...(failure !== undefined && status !== "completed" ? { error: failure } : {}),
      });
    }
    return {
      runId,
      ...(typeof document.name === "string" ? { name: document.name } : {}),
      ...(typeof document.workflowPath === "string" ? { workflowPath: document.workflowPath } : {}),
      ...(typeof document.workspaceCwd === "string" ? { workspaceCwd: document.workspaceCwd } : {}),
      turns,
    };
  }));
}
