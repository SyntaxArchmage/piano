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

import { Effect } from "effect";
import { basename, join } from "node:path";
import { io, observationStreamPath, type TurnOutcome } from "@piano/base";
import type { AgentEvent } from "@piano/harness";
import {
  attemptSuffix,
  attemptSuffixFromHandle,
  parseObservationOps,
  parseTrajectory,
  trajectoryStreamPath,
  type FailureDetails,
  type ObservationOp,
  type TrajectoryDocument,
} from "@piano/logging";
import { parseRunStatus, runStatusPath, type RunStatus } from "@piano/orchestrator";
import { LogsStorageError } from "./errors.js";

/** One replayable prompt and the events it produced. */
interface ResumeTurn {
  readonly prompt: string;
  readonly status: TurnOutcome;
  readonly events: readonly AgentEvent[];
  /** The same turn in the op vocabulary, when the run recorded one. Replay
   * reads these under `--langfuse` and leaves `events` for the old path. */
  readonly ops?: readonly ObservationOp[];
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
export function readRunRow(runDir: string): Effect.Effect<RunSummary | undefined> {
  return Effect.gen(function* () {
    // Both reads are independent and read-only, so they may run together.
    const [resumable, status] = yield* Effect.all(
      [hasTrajectory(runDir), readRunState(runDir)],
      { concurrency: "unbounded" },
    );
    if (!resumable) return undefined;
    return summarizeRun(basename(runDir), status);
  });
}

/** Whether the run recorded a trajectory to replay. Only a trajectory that is
 * not there at all counts against it — one that cannot be read is not evidence
 * of absence, so the run stays listed. */
function hasTrajectory(runDir: string): Effect.Effect<boolean> {
  return io.readText(trajectoryStreamPath(runDir)).pipe(
    Effect.map(() => true),
    // Absence is simply no trajectory; any other failure still counts as
    // evidence the run recorded something.
    Effect.catchAll((error) => Effect.succeed(!io.isMissingPathError(error.cause))),
  );
}

/** The run's state document, or `undefined` when it is missing, unreadable, or
 * will not parse. Never fails: a state document that answers is the row, and
 * one that does not is no row — not a reason to refuse the run. */
function readRunState(runDir: string): Effect.Effect<Partial<RunStatus> | undefined> {
  return Effect.gen(function* () {
    const raw = yield* io.readText(runStatusPath(runDir));
    return yield* Effect.try({
      try: () => parseRunStatus(raw),
      catch: (cause) => cause,
    });
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
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
): Effect.Effect<Partial<TrajectoryDocument>, LogsStorageError> {
  const path = trajectoryStreamPath(join(runsRoot, runId));
  const storageError = (message: string): LogsStorageError =>
    new LogsStorageError({ operation: "read-trajectory", path, message });
  return Effect.gen(function* () {
    const stream = yield* io.readText(path).pipe(
      Effect.catchAll(() => Effect.succeed(undefined)),
    );
    const parsed = parseTrajectory(stream);
    if (parsed !== undefined) return parsed;
    return yield* Effect.fail(storageError(
      stream === undefined ? "no trajectory recorded for this run" : "the recorded trajectory could not be parsed",
    ));
  });
}

/** Metadata for one picker row, from a run's state document. Pure and total so
 * the picker and any other row consumer share one interpretation of a run's
 * state. A run whose state is missing or unparsable still yields a row: hiding
 * it would misrepresent what the runs root contains. */
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

/** One attempt a turn ran, as the handle vocabulary spells it. */
interface Attempt {
  readonly invocationId: string;
  readonly attempt: number;
}

/** The attempts one turn ran, in the order its events name them. */
function attemptsOf(events: readonly AgentEvent[]): readonly Attempt[] {
  const seen = new Set<string>();
  const attempts: Attempt[] = [];
  for (const event of events) {
    const workflow = event.workflow;
    if (workflow === undefined) continue;
    const suffix = attemptSuffix(workflow);
    if (seen.has(suffix)) continue;
    seen.add(suffix);
    attempts.push({ invocationId: workflow.invocationId, attempt: workflow.attempt });
  }
  return attempts;
}

/** An attempt's span: the op that opens the run of facts one stage attempt
 * speaks, and the attempt it belongs to. */
function attemptSpanSuffix(op: ObservationOp): string | undefined {
  return op.op === "start" ? attemptSuffixFromHandle(op.handle) : undefined;
}

/** Slice a recorded op stream into one batch per recorded turn.
 *
 * The unit is the attempt: one stage attempt speaks one run of facts, and a
 * turn's own events say which attempts it ran. A run is matched to the
 * earliest turn still owing that attempt, so a map, loop, or repair turn keeps
 * all of its attempts — one `user.message` per attempt included — and two
 * turns that re-run the same stage stay apart even though they wear the same
 * attempt handle.
 *
 * Returns `undefined` when the stream and the turns do not describe each other:
 * a run that matches no turn still owing it, a turn left owing part of what it
 * ran, or a turn that spoke nothing after one that did — the last being the
 * tell that an earlier turn swallowed its run. An unpaired turn must replay
 * from the events rather than from a mis-cut slice. */
export function splitOpsByTurns(
  ops: readonly ObservationOp[],
  attemptsByTurn: readonly (readonly Attempt[])[],
): readonly (readonly ObservationOp[])[] | undefined {
  // A turn whose events name no attempt cannot place any fact, so the whole
  // stream falls back to events rather than leave that turn empty.
  if (attemptsByTurn.some((attempts) => attempts.length === 0)) return undefined;

  const turns = attemptsByTurn.map((attempts) => ({
    owed: new Set(attempts.map(attemptSuffix)),
    ops: [] as ObservationOp[],
  }));
  let turn = 0;
  let opened = false;
  for (const op of ops) {
    const suffix = attemptSpanSuffix(op);
    if (suffix !== undefined) {
      while (turn < turns.length && !(turns[turn]?.owed.has(suffix) ?? false)) turn += 1;
      const target = turns[turn];
      if (target === undefined) return undefined;
      target.owed.delete(suffix);
      target.ops.push(op);
      opened = true;
      continue;
    }
    // Everything until the next span belongs to the attempt already open.
    if (!opened) return undefined;
    (turns[turn]?.ops ?? []).push(op);
  }

  let spoke = false;
  for (const turn of turns) {
    const empty = turn.ops.length === 0;
    if (empty && spoke) return undefined;
    if (!empty && turn.owed.size > 0) return undefined;
    spoke = spoke || !empty;
  }
  return turns.map((turn) => turn.ops);
}

/** Full replay context for the run the user chose. Fails when the run has no
 * trajectory or it cannot be parsed: the user named this run, so silently
 * resuming an empty conversation would be worse than saying why.
 *
 * `wantOps` says the caller will replay from the op vocabulary. Without it the
 * observation stream is not read at all: parsing a whole run's ops to drop them
 * is pure cost. */
export function readResumeContext(
  runsRoot: string,
  runId: string,
  options: { readonly wantOps?: boolean } = {},
): Effect.Effect<ResumeContext, LogsStorageError> {
  const runDir = join(runsRoot, runId);
  return Effect.gen(function* () {
    const document = yield* readTrajectory(runsRoot, runId);
    const allEvents = Array.isArray(document.events) ? document.events : [];
    const recorded = document.turns ?? [];
    const failure = failureOf(document.error);
    // Under `--langfuse` the run's own op stream is the replay source: the same
    // facts the live panel and chat drew. Absent or unpaired, the turns keep
    // the events they were cut from.
    const ops = options.wantOps !== true ? [] : parseObservationOps(yield* io.readText(observationStreamPath(runDir)).pipe(
      Effect.catchAll(() => Effect.succeed(undefined)),
    ));
    const eventsByTurn: (readonly AgentEvent[])[] = [];
    const turns: ResumeTurn[] = [];
    let start = 0;
    recorded.forEach((turn, index) => {
      // eventCount is cumulative, so a turn owns the slice between the
      // previous boundary and its own. Clamp: a truncated stream must not
      // produce a reversed slice.
      const end = Math.min(Math.max(turn.eventCount, start), allEvents.length);
      const last = index === recorded.length - 1;
      const events = allEvents.slice(start, end).filter(isEvent);
      eventsByTurn.push(events);
      turns.push({
        prompt: stripStageContext(turn.prompt),
        status: turn.status,
        events,
        ...(last && failure !== undefined && turn.status !== "completed" ? { error: failure } : {}),
      });
      start = end;
    });
    // The turn boundary is structural: a turn owns the attempts its own events
    // name. Unpaired, the turns keep the events they were cut from.
    const slices = ops.length === 0
      ? undefined
      : splitOpsByTurns(ops, eventsByTurn.map(attemptsOf));
    return {
      runId,
      ...(typeof document.name === "string" ? { name: document.name } : {}),
      ...(typeof document.workflowPath === "string" ? { workflowPath: document.workflowPath } : {}),
      ...(typeof document.workspaceCwd === "string" ? { workspaceCwd: document.workspaceCwd } : {}),
      // A turn with no facts of its own keeps its events: replaying an empty
      // op batch would show the prompt and nothing else.
      turns: turns.map((turn, index) => {
        const ops = slices?.[index];
        return ops === undefined || ops.length === 0 ? turn : { ...turn, ops };
      }),
    };
  });
}
