/**
 * One writer per run across processes.
 *
 * The run directory holds a `.piano-run.lock` created with O_EXCL. A second
 * process that opens the same run reads the owner and refuses while that pid
 * is alive on this host; a dead pid (a crashed process) is reclaimed. The lock
 * is advisory and file-based: it protects the state document and the append
 * logs that a second writer would interleave, and it needs no daemon.
 *
 * Same-process reacquisition is allowed: the CLI reopens a run in the same
 * process when it resumes, and the cross-process case is the one this lock
 * exists for.
 */
import { Data, Effect } from "effect";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import { createExclusive, isMissingPathError, readText, rm, type IoError } from "./io.js";

const LOCK_NAME = ".piano-run.lock";
/** A lock from another host cannot be pid-checked; it goes stale after a day. */
const FOREIGN_STALE_MS = 24 * 60 * 60 * 1000;

export class RunLockedError extends Data.TaggedError("RunLockedError")<{
  readonly path: string;
  readonly message: string;
  readonly ownerPid?: number;
  readonly ownerHost?: string;
}> {}

export interface RunLock {
  readonly path: string;
  readonly token: string;
  /** Best effort: remove only this owner's lock. */
  readonly release: Effect.Effect<void>;
}

interface LockOwner {
  readonly pid?: number;
  readonly host?: string;
  readonly token?: string;
  readonly startedAt?: string;
}

function parseOwner(raw: string | undefined): LockOwner | undefined {
  if (raw === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null ? (value as LockOwner) : undefined;
  } catch {
    return undefined;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isStale(owner: LockOwner | undefined): boolean {
  if (owner === undefined) return true;
  const host = owner.host ?? "";
  if (host !== hostname()) {
    const started = owner.startedAt === undefined ? NaN : Date.parse(owner.startedAt);
    return !Number.isFinite(started) || Date.now() - started > FOREIGN_STALE_MS;
  }
  if (owner.pid === undefined) return true;
  // Same process: the CLI reopens a run when it resumes. Cross-process is the
  // case this lock protects, so do not make same-process reopen impossible.
  if (owner.pid === process.pid) return true;
  return !pidAlive(owner.pid);
}

function release(path: string, token: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    const raw = yield* readText(path).pipe(Effect.orElseSucceed(() => undefined));
    if (parseOwner(raw)?.token !== token) return;
    yield* rm(path, { force: true });
  }).pipe(Effect.catchAll(() => Effect.void));
}

export function acquireRunLock(runDir: string): Effect.Effect<RunLock, RunLockedError | IoError> {
  const path = join(runDir, LOCK_NAME);
  const token = randomUUID();
  const content = JSON.stringify({
    pid: process.pid,
    host: hostname(),
    token,
    startedAt: new Date().toISOString(),
  });
  return Effect.gen(function* () {
    if (yield* createExclusive(path, content)) {
      return { path, token, release: release(path, token) };
    }
    const owner = parseOwner(yield* readText(path).pipe(Effect.orElseSucceed(() => undefined)));
    if (!isStale(owner)) {
      return yield* Effect.fail(new RunLockedError({
        path,
        message: `run is already open${owner?.pid === undefined ? "" : ` by pid ${owner.pid}`}${owner?.host === undefined ? "" : ` on ${owner.host}`}`,
        ...(owner?.pid === undefined ? {} : { ownerPid: owner.pid }),
        ...(owner?.host === undefined ? {} : { ownerHost: owner.host }),
      }));
    }
    // Reclaim: remove the stale (or same-process) lock, then race once more.
    yield* rm(path, { force: true }).pipe(Effect.catchIf((cause) => isMissingPathError(cause.cause), () => Effect.void));
    if (yield* createExclusive(path, content)) {
      return { path, token, release: release(path, token) };
    }
    return yield* Effect.fail(new RunLockedError({
      path,
      message: "run lock raced with another process",
    }));
  });
}
