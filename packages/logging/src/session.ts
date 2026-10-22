import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  errorMessage,
  SessionCreateError,
  type LoggingError,
} from "./errors.js";
import { AsyncLogWriter, type ILogWriter, LogWriter, logStreamPath } from "./log.js";
import { AsyncTraceWriter, type ITraceWriter, TraceWriter, traceStreamPath } from "./trace.js";
import { AsyncTrajectoryWriter, trajectoryStreamPath, type ITrajectoryWriter, TrajectoryWriter } from "./trajectory.js";

const SOURCE = { module: "logging", file: "session.ts", function: "createSession" } as const;

/** Mint a run identity: the timestamp+random id (or the caller's, for a
 * resume), its trace id, and the run directory the id names. One spelling
 * shared by the immediate and the staging session. */
function newRunIdentity(runsRoot: string, id?: string): { id: string; traceId: string; runDir: string } {
  const runId = id ?? `${new Date().toISOString().slice(0, 19).replace(/[^0-9T]/g, "")}-${Math.random().toString(16).slice(2, 8)}`;
  return { id: runId, traceId: randomBytes(16).toString("hex"), runDir: join(runsRoot, runId) };
}

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

/** Allocate the Piano session and its logging surface as one typed Effect. */
export function createSession(
  opts: CreateSessionOptions = {},
): Effect.Effect<Session, LoggingError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const values = yield* Effect.try({
      try: () => {
        const cwd = resolve(opts.cwd ?? process.cwd());
        const root = resolve(opts.root ?? defaultRoot);
        const runsRoot = resolve(opts.runsRoot ?? defaultRunsRoot());
        return { root, cwd, ...newRunIdentity(runsRoot, opts.id) };
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
    const log = new LogWriter(values.id, logStreamPath(values.runDir), values.traceId);
    const trace = new TraceWriter(values.id, traceStreamPath(values.runDir), values.traceId);
    const trajectory = new TrajectoryWriter(values.id, trajectoryStreamPath(values.runDir));
    const span = yield* trace.enter(SOURCE.function, undefined, SOURCE);
    yield* log.append("run.created", {
      module: SOURCE.module,
      file: SOURCE.file,
      function: SOURCE.function,
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
  commit(): Effect.Effect<void, LoggingError, FileSystem.FileSystem>;
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
  const { id, traceId, runDir } = newRunIdentity(runsRoot);

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
      yield* log.commit(logStreamPath(runDir));
      yield* trace.commit(traceStreamPath(runDir));
      yield* trajectory.commit(trajectoryStreamPath(runDir));
    }),
  };
  return session;
}
