import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  errorMessage,
  SessionCreateError,
  type LogWriteError,
  TrajectoryWriteError,
  type TraceWriteError,
} from "./errors.js";
import { AsyncLogWriter, type ILogWriter, LogWriter } from "./log.js";
import { AsyncTraceWriter, type ITraceWriter, TraceWriter } from "./trace.js";
import { AsyncTrajectoryWriter, trajectoryStreamPath, type ITrajectoryWriter, TrajectoryWriter } from "./trajectory.js";

const SOURCE = { module: "logging", file: "session.ts", function: "createSession" } as const;

export const defaultRoot = join(homedir(), ".piano");

// Run data is user-level persistent state, not a project artifact: it must live
// under the user's home (`~/.piano/runs`), matching the established run
// directory contract, never
// under `process.cwd()` (which leaks `.piano.runs/` into whatever directory the
// CLI happens to be invoked from — e.g. a repo root during smoke tests).
export function defaultRunsRoot(): string {
  return join(homedir(), ".piano", "runs");
}

export interface Session {
  id: string;
  traceId: string;
  cwd: string;
  runDir: string;
  root: string;
  log: ILogWriter;
  trace: ITraceWriter;
  trajectory: ITrajectoryWriter;
}

export interface CreateSessionOptions {
  cwd?: string;
  root?: string;
  runsRoot?: string;
  prompt?: string;
  /** Reuse an existing run directory by id (resume); its runDir = runsRoot/<id>. */
  id?: string;
}

export type SessionError = SessionCreateError | LogWriteError | TraceWriteError | TrajectoryWriteError;

/** Allocate the Piano session and its logging surface as one typed Effect. */
export function createSession(
  opts: CreateSessionOptions = {},
): Effect.Effect<Session, SessionError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const values = yield* Effect.try({
      try: () => {
        const cwd = resolve(opts.cwd ?? process.cwd());
        const root = resolve(opts.root ?? defaultRoot);
        const runsRoot = resolve(opts.runsRoot ?? defaultRunsRoot());
        const id = opts.id ?? `${new Date().toISOString().slice(0, 19).replace(/[^0-9T]/g, "")}-${Math.random().toString(16).slice(2, 8)}`;
        const traceId = randomBytes(16).toString("hex");
        const runDir = join(runsRoot, id);
        return { root, id, traceId, cwd, runDir };
      },
      catch: (cause) => new SessionCreateError({
        operation: "prepare",
        path: opts.root ?? defaultRoot,
        message: errorMessage(cause),
      }),
    });
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(values.runDir, { recursive: true }).pipe(
      Effect.mapError((cause) => new SessionCreateError({
        operation: "mkdir",
        path: values.runDir,
        message: errorMessage(cause),
      })),
    );
    const log = new LogWriter(values.id, join(values.runDir, "log.jsonl"), values.traceId);
    const trace = new TraceWriter(values.id, join(values.runDir, "trace.jsonl"), values.traceId);
    const trajectory = new TrajectoryWriter(values.id, trajectoryStreamPath(values.runDir));
    const span = yield* trace.enter("createSession", undefined, SOURCE);
    yield* log.append("run.created", {
      module: SOURCE.module,
      file: SOURCE.file,
      function: "createSession",
      level: "info",
      namespace: "logging",
      message: "Run created",
      data: { runDir: values.runDir, ...(opts.prompt === undefined ? {} : { promptLength: opts.prompt.length }) },
    });
    yield* trace.exit(span, { id: values.id, runDir: values.runDir });
    return { ...values, log, trace, trajectory };
  });
}

export interface StagingSession extends Session {
  /** Flush buffered log/trace/trajectory entries to the real run directory.
   * Creates the run directory, then replays all staged entries in order.
   * Must be called exactly once, before the first prompt is submitted. */
  commit(): Effect.Effect<void, SessionError, FileSystem.FileSystem>;
}

/** Allocate a session whose writers buffer entries in memory.  No filesystem
 * I/O occurs until {@link StagingSession.commit} is called.  Use this to avoid
 * creating a run directory for users who open Piano but never send a prompt
 * (e.g. they open the picker and then close the app). */
export function createStagingSession(
  opts: Omit<CreateSessionOptions, "id"> = {},
): StagingSession {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const root = resolve(opts.root ?? defaultRoot);
  const runsRoot = resolve(opts.runsRoot ?? defaultRunsRoot());
  const id = `${new Date().toISOString().slice(0, 19).replace(/[^0-9T]/g, "")}-${Math.random().toString(16).slice(2, 8)}`;
  const traceId = randomBytes(16).toString("hex");
  const runDir = join(runsRoot, id);

  const log = new AsyncLogWriter(id, traceId);
  const trace = new AsyncTraceWriter(id, traceId);
  const trajectory = new AsyncTrajectoryWriter(id, "");

  const session: StagingSession = {
    id,
    traceId,
    cwd,
    runDir,
    root,
    log,
    trace,
    trajectory,
    commit: () => Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      yield* fileSystem.makeDirectory(runDir, { recursive: true }).pipe(
        Effect.mapError((cause) => new SessionCreateError({
          operation: "mkdir",
          path: runDir,
          message: errorMessage(cause),
        })),
      );
      yield* log.commit(join(runDir, "log.jsonl"));
      yield* trace.commit(join(runDir, "trace.jsonl"));
      yield* trajectory.commit(trajectoryStreamPath(runDir));
    }),
  };
  return session;
}
