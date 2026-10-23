// Read side of `/resume` and `piano resume`: turn a run's state document into
// the picker row, and its recorded trajectory into the chat replay.
//
// Two different questions, two different sources. The row is a state question
// and answers from `status.json`, the one document a run keeps — the trajectory
// it also holds is evidence of what happened, not an account of how the run is
// doing. The replay is an evidence question and reads the trajectory itself.
//
// Both readers are deliberately tolerant. A run directory may predate its state
// document, may hold a partially written document from a killed process, or may
// hold no trajectory at all — none of that should make a resumable run
// unlistable or unresumable, so missing pieces degrade to `undefined` rather
// than an error. Only a malformed (unparseable) trajectory surfaces as a typed
// failure, and only for the run the user explicitly asked to resume.

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { TurnOutcome } from "@piano/base";
import type { AgentEvent } from "@piano/harness";
import { parseTrajectory, trajectoryStreamPathCandidates, type FailureDetails, type TrajectoryDocument } from "@piano/logging";
import { parseRunStatus, runStatusPath, type RunStatus } from "@piano/orchestrator";
import { LogsStorageError } from "./errors.js";

/** One replayable prompt and the events it produced. */
interface ResumeTurn {
  readonly prompt: string;
  readonly status: TurnOutcome;
  readonly events: readonly AgentEvent[];
  /** Recorded failure. Only the final turn can carry one: the trajectory
   * records a single `error`, overwritten each turn. */
  readonly error?: FailureDetails;
}

/** Everything a resume needs from one run's trajectory. */
interface ResumeContext {
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

/** One picker row for a run, or `undefined` when the run recorded no trajectory
 * at all — a directory left by a session that was opened and closed without a
 * prompt. The picker resumes runs, so a run it could not replay is clutter,
 * not history, and leaves the list.
 *
 * The row's metadata is the run's state document. A run that predates one, or
 * whose state document will not parse, stays listed as an id-only row: hiding
 * history the user could be looking for is worse than showing it without
 * metadata. */
export async function readRunRow(runDir: string): Promise<RunSummary | undefined> {
  const [resumable, status] = await Promise.all([hasTrajectory(runDir), readRunState(runDir)]);
  if (!resumable) return undefined;
  return summarizeRun(basename(runDir), status);
}

/** Whether the run recorded a trajectory to replay. Only a trajectory that is
 * not there at all counts against it — one that cannot be read is not evidence
 * of absence, so the run stays listed. */
async function hasTrajectory(runDir: string): Promise<boolean> {
  for (const path of trajectoryStreamPathCandidates(runDir)) {
    try {
      await readFile(path, "utf8");
      return true;
    } catch (cause) {
      // A candidate that is not there is simply the wrong layout; any other
      // failure still counts as evidence the run recorded something.
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") return true;
    }
  }
  return false;
}

/** The run's state document, or `undefined` when it is missing, unreadable, or
 * will not parse. Never fails: a state document that answers is the row, and
 * one that does not is no row — not a reason to refuse the run. */
async function readRunState(runDir: string): Promise<Partial<RunStatus> | undefined> {
  try {
    return parseRunStatus(await readFile(runStatusPath(runDir), "utf8"));
  } catch {
    return undefined;
  }
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

/** Read and fold a run's trajectory, failing when it is absent or malformed. */
function readTrajectory(
  runsRoot: string,
  runId: string,
): Effect.Effect<Partial<TrajectoryDocument>, LogsStorageError, FileSystem.FileSystem> {
  const candidates = trajectoryStreamPathCandidates(join(runsRoot, runId));
  const path = candidates[0]!;
  const storageError = (message: string): LogsStorageError =>
    new LogsStorageError({ operation: "read-trajectory", path, message });
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const read = (candidate: string) =>
      fileSystem.readFileString(candidate).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    // Current layout first, then the pre-audience layout: old runs stay
    // replayable, while new runs only ever write the first candidate.
    const stream = (yield* read(candidates[0]!)) ?? (yield* read(candidates[1]!));
    const parsed = parseTrajectory(stream);
    if (parsed !== undefined) return parsed;
    return yield* Effect.fail(storageError(
      stream === undefined ? "no trajectory recorded for this run" : "the recorded trajectory could not be parsed",
    ));
  });
}

/** Metadata for one picker row, from a run's state document. Pure and total so
 * the picker (which reads with `node:fs/promises`, off the Effect runtime) and
 * any other row consumer share one interpretation of a run's state. A run whose
 * state is missing or unparsable still yields a row: hiding it would
 * misrepresent what the runs root contains. */
export function summarizeRun(runId: string, status: Partial<RunStatus> | undefined): RunSummary {
  if (status === undefined) return { runId };
  const turns = Array.isArray(status.turns) ? status.turns : [];
  const firstPrompt = typeof turns[0]?.prompt === "string" ? turns[0].prompt : undefined;
  return {
    runId,
    ...(typeof status.name === "string" ? { name: status.name } : {}),
    ...(firstPrompt === undefined ? {} : { prompt: stripStageContext(firstPrompt) }),
    ...(typeof status.workflowPath === "string"
      ? { workflow: basename(status.workflowPath).replace(/\.ya?ml$/i, "") }
      : {}),
    ...(typeof status.workspaceCwd === "string" ? { workspaceCwd: status.workspaceCwd } : {}),
    ...(typeof status.status === "string" ? { status: status.status } : {}),
    ...(typeof status.updatedAt === "string" ? { updatedAt: status.updatedAt } : {}),
  };
}

/** Full replay context for the run the user chose. Fails when the run has no
 * trajectory or it cannot be parsed: the user named this run, so silently
 * resuming an empty conversation would be worse than saying why. */
export function readResumeContext(
  runsRoot: string,
  runId: string,
): Effect.Effect<ResumeContext, LogsStorageError, FileSystem.FileSystem> {
  return readTrajectory(runsRoot, runId).pipe(Effect.map((document): ResumeContext => {
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
