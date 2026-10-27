/**
 * The one Effect interface to the outside world.
 *
 * Every filesystem, process, and HTTP call in Piano goes through this module:
 * our code never returns, stores, or composes a `Promise`. The adapters below
 * may hold one inside their implementation, but their exported surface is an
 * Effect with a typed `IoError`. Process calls also own their lifetime: an
 * interrupted fiber kills the child instead of leaking it.
 */
import { Data, Effect } from "effect";
import { execFile as execFileCallback, spawn } from "node:child_process";
import * as fsSync from "node:fs";
import { constants as fsConstants } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import * as fsp from "node:fs/promises";

/** A failed external operation. Call sites map this into their module's own
 * typed failure, keeping the original operation, path, and message. */
export class IoError extends Data.TaggedError("IoError")<{
  readonly operation: string;
  readonly path?: string;
  readonly message: string;
  readonly cause?: unknown;
  /** Captured output on a failed process call, when the child produced any. */
  readonly stdout?: string;
  readonly stderr?: string;
}> {}

export function ioError(operation: string, path: string | undefined, cause: unknown): IoError {
  return new IoError({
    operation,
    ...(path === undefined ? {} : { path }),
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

/** The Node missing-path predicates call sites already branch on. */
export function isMissingPathError(cause: unknown): boolean {
  const code = typeof cause === "object" && cause !== null ? (cause as NodeJS.ErrnoException).code : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

function fsCall<A>(operation: string, path: string | undefined, run: () => Promise<A>): Effect.Effect<A, IoError> {
  return Effect.tryPromise({ try: run, catch: (cause) => ioError(operation, path, cause) });
}

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

export function readFile(path: string): Effect.Effect<Uint8Array, IoError> {
  return fsCall("readFile", path, () => fsp.readFile(path));
}

/** UTF-8 text, byte-for-byte the decoding `fs.readFile(path, "utf8")` gives
 * (a leading BOM is preserved). */
export function readText(path: string): Effect.Effect<string, IoError> {
  return fsCall("readFile", path, () => fsp.readFile(path, "utf8"));
}

export function writeFile(path: string, data: string | Uint8Array): Effect.Effect<void, IoError> {
  return fsCall("writeFile", path, async () => {
    await fsp.writeFile(path, data);
  });
}

/** Atomically create a file. `false` when it already exists; any other
 * failure is an IoError. The lock module builds on this. */
export function createExclusive(path: string, text: string): Effect.Effect<boolean, IoError> {
  return fsCall("writeFile", path, () => fsp.writeFile(path, text, { flag: "wx" })).pipe(
    Effect.as(true),
    Effect.catchIf(
      (cause) => (cause.cause as NodeJS.ErrnoException | undefined)?.code === "EEXIST",
      () => Effect.succeed(false),
    ),
  );
}

/** Append without reading the file back. Creates a missing file, exactly like
 * the `flag: "a"` write this replaces. */
export function appendText(path: string, text: string): Effect.Effect<void, IoError> {
  return fsCall("appendFile", path, async () => {
    await fsp.appendFile(path, text);
  });
}

export function lstat(path: string): Effect.Effect<Stats, IoError> {
  return fsCall("lstat", path, () => fsp.lstat(path));
}

export function stat(path: string): Effect.Effect<Stats, IoError> {
  return fsCall("stat", path, () => fsp.stat(path));
}

/** Directory entries with their types, the shape every caller here needs. */
export function readdir(path: string): Effect.Effect<readonly Dirent[], IoError> {
  return fsCall("readdir", path, () => fsp.readdir(path, { withFileTypes: true }));
}

export function readdirNames(path: string): Effect.Effect<readonly string[], IoError> {
  return fsCall("readdir", path, () => fsp.readdir(path));
}

export function realpath(path: string): Effect.Effect<string, IoError> {
  return fsCall("realpath", path, () => fsp.realpath(path));
}

export function mkdir(path: string, options: { recursive?: boolean; mode?: number } = {}): Effect.Effect<void, IoError> {
  return fsCall("mkdir", path, async () => {
    await fsp.mkdir(path, options);
  });
}

export function mkdtemp(prefix: string): Effect.Effect<string, IoError> {
  return fsCall("mkdtemp", prefix, () => fsp.mkdtemp(prefix));
}

export function rm(path: string, options: { recursive?: boolean; force?: boolean } = {}): Effect.Effect<void, IoError> {
  return fsCall("rm", path, async () => {
    await fsp.rm(path, options);
  });
}

export function rmdir(path: string): Effect.Effect<void, IoError> {
  return fsCall("rmdir", path, async () => {
    await fsp.rmdir(path);
  });
}

export function chmod(path: string, mode: number): Effect.Effect<void, IoError> {
  return fsCall("chmod", path, async () => {
    await fsp.chmod(path, mode);
  });
}

export function rename(from: string, to: string): Effect.Effect<void, IoError> {
  return fsCall("rename", from, async () => {
    await fsp.rename(from, to);
  });
}

export function symlink(target: string, path: string): Effect.Effect<void, IoError> {
  return fsCall("symlink", path, async () => {
    await fsp.symlink(target, path);
  });
}

export function readlink(path: string): Effect.Effect<string, IoError> {
  return fsCall("readlink", path, () => fsp.readlink(path));
}

export function cp(
  source: string,
  destination: string,
  options: { recursive?: boolean; dereference?: boolean; force?: boolean; errorOnExist?: boolean } = {},
): Effect.Effect<void, IoError> {
  return fsCall("cp", source, async () => {
    await fsp.cp(source, destination, options);
  });
}

/** `existsSync` semantics: any failure means "not there". */
export function exists(path: string): Effect.Effect<boolean, never> {
  return fsCall("stat", path, () => fsp.stat(path)).pipe(
    Effect.as(true),
    Effect.catchAll(() => Effect.succeed(false)),
  );
}

/** Read a regular file without following a final symlink. This is the
 * O_NOFOLLOW/O_NONBLOCK read the workspace rollback needs; the handle is
 * closed on every exit path. */
export function readFileNoFollow(
  path: string,
): Effect.Effect<{ readonly info: Stats; readonly content: Uint8Array }, IoError> {
  return Effect.gen(function* () {
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);
    const handle = yield* fsCall("open", path, () => fsp.open(path, flags));
    return yield* Effect.gen(function* () {
      const info = yield* fsCall("stat", path, () => handle.stat());
      const content = yield* fsCall("readFile", path, () => handle.readFile());
      return { info, content };
    }).pipe(Effect.ensuring(
      // A close failure must not replace the operation's result.
      fsCall("close", path, () => handle.close()).pipe(Effect.catchAll(() => Effect.void)),
    ));
  });
}

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

export interface CommandOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly maxBuffer?: number;
}

/** A command that never started reports this instead of an exit status. A
 * spawn error carries a string `code`, and treating it as `1` would make
 * "the binary is missing" look like "the command failed". */
export const NOT_STARTED = -1;

/** A command the caller's timeout killed. Distinct from `NOT_STARTED` so a
 * caller can tell "the CLI is not installed" from "the CLI hung"; the same
 * value `runShell` reports. */
export const TIMED_OUT = 124;

export interface CommandResult {
  /** The exit status, `NOT_STARTED` when the command never ran, or `TIMED_OUT`
   * when the caller's timeout killed it. */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run a command and fail on a non-zero exit. The child is killed when the
 * fiber is interrupted, so cancellation does not leave it running. */
export function execFile(file: string, args: readonly string[], options: CommandOptions = {}): Effect.Effect<CommandResult, IoError> {
  return runCommand(file, args, options, true) as Effect.Effect<CommandResult, IoError>;
}

/** Run a command whose non-zero exit is data, not failure. */
export function execFileResult(
  file: string,
  args: readonly string[],
  options: CommandOptions = {},
): Effect.Effect<CommandResult, IoError> {
  return runCommand(file, args, options, false);
}

function runCommand(
  file: string,
  args: readonly string[],
  options: CommandOptions,
  failOnNonZero: boolean,
): Effect.Effect<CommandResult, IoError> {
  return Effect.async<CommandResult, IoError>((resume) => {
    let settled = false;
    const child = execFileCallback(file, [...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      ...(options.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      if (settled) return;
      settled = true;
      const out = String(stdout ?? "");
      const err = String(stderr ?? "");
      if (error === null) {
        resume(Effect.succeed({ code: 0, stdout: out, stderr: err }));
        return;
      }
      const code = typeof (error as { code?: unknown }).code === "number"
        ? (error as { code: number }).code
        // Node reports a timeout by killing the child: `code` is null and
        // `killed` is set, which is not the same as a command that never ran.
        : (error as { killed?: unknown }).killed === true || (error as { signal?: unknown }).signal === "SIGTERM"
          ? TIMED_OUT
          // A spawn failure (`ENOENT`, `EACCES`) never ran the command, so it
          // has no exit status of its own.
          : NOT_STARTED;
      if (!failOnNonZero) {
        resume(Effect.succeed({ code, stdout: out, stderr: err }));
        return;
      }
      resume(Effect.fail(new IoError({
        operation: "execFile",
        path: file,
        message: error.message,
        cause: error,
        stdout: out,
        stderr: err,
      })));
    });
    return Effect.sync(() => {
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // The child already exited.
      }
    });
  });
}

/** Run a shell command with timeout and process-group termination. Non-zero
 * exits are data; interruption kills the whole group. */
export function runShell(command: string, cwd: string, timeoutMs?: number): Effect.Effect<CommandResult, IoError> {
  return Effect.async<CommandResult, IoError>((resume) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const terminate = (signal: NodeJS.Signals): void => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          // The process already exited.
        }
      }
    };
    const timeout = timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      setTimeout(() => terminate("SIGKILL"), 5_000).unref();
    }, timeoutMs);
    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      resume(Effect.succeed(result));
    };
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => finish({ code: NOT_STARTED, stdout, stderr: `${stderr}${String(error)}` }));
    child.on("exit", (code) => finish({ code: timedOut ? 124 : code ?? 1, stdout, stderr }));
    return Effect.sync(() => {
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      terminate("SIGKILL");
    });
  });
}

/** Start a process that outlives the caller and returns its pid. Used for
 * local model services: the service owns its own lifetime; the caller only
 * needs a reliable "it started" signal. */
export interface DetachedProcess {
  readonly pid: number;
}

export function spawnDetached(
  file: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {},
): Effect.Effect<DetachedProcess, IoError> {
  return Effect.async<DetachedProcess, IoError>((resume) => {
    let settled = false;
    const child = spawn(file, [...args], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      detached: true,
      stdio: "ignore",
    });
    const finish = (effect: Effect.Effect<DetachedProcess, IoError>): void => {
      if (settled) return;
      settled = true;
      resume(effect);
    };
    child.once("error", (cause) => finish(Effect.fail(ioError("spawn", file, cause))));
    child.once("spawn", () => {
      const pid = child.pid;
      if (pid === undefined) {
        finish(Effect.fail(new IoError({ operation: "spawn", path: file, message: "spawned process has no pid" })));
        return;
      }
      child.unref();
      finish(Effect.succeed({ pid }));
    });
    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // The child already exited.
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Synchronous adapters (pre-runtime bootstrap and synchronous UI contracts)
// ---------------------------------------------------------------------------

export function readTextSync(path: string): Effect.Effect<string, IoError> {
  return Effect.try({ try: () => fsSync.readFileSync(path, "utf8"), catch: (cause) => ioError("readFile", path, cause) });
}

export function writeTextSync(path: string, text: string): Effect.Effect<void, IoError> {
  return Effect.try({
    try: () => {
      fsSync.writeFileSync(path, text);
    },
    catch: (cause) => ioError("writeFile", path, cause),
  });
}

export function existsSync(path: string): Effect.Effect<boolean, never> {
  return Effect.sync(() => fsSync.existsSync(path));
}

export function mkdirSync(path: string, options: { recursive?: boolean; mode?: number } = {}): Effect.Effect<void, IoError> {
  return Effect.try({
    try: () => {
      fsSync.mkdirSync(path, options);
    },
    catch: (cause) => ioError("mkdir", path, cause),
  });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly text: string;
}

function fetchCall<A>(url: string, init: RequestInit | undefined, run: (signal: AbortSignal) => Promise<A>): Effect.Effect<A, IoError> {
  return Effect.tryPromise({
    try: (signal) => run(combineSignal(init?.signal, signal)),
    catch: (cause) => ioError("fetch", url, cause),
  });
}

/** The caller's signal (if any) plus the fiber's interruption signal. */
function combineSignal(caller: AbortSignal | null | undefined, fiber: AbortSignal): AbortSignal {
  if (caller === undefined || caller === null) return fiber;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([caller, fiber]);
  return fiber;
}

export function fetchText(url: string, init?: RequestInit): Effect.Effect<HttpResponse, IoError> {
  return fetchCall(url, init, async (signal) => {
    const response = await fetch(url, { ...init, signal });
    return { status: response.status, ok: response.ok, text: await response.text() };
  });
}

export interface JsonResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly json: unknown;
}

export function fetchJson(url: string, init?: RequestInit): Effect.Effect<JsonResponse, IoError> {
  return Effect.gen(function* () {
    const response = yield* fetchCall(url, init, async (signal) => {
      const result = await fetch(url, { ...init, signal });
      return { status: result.status, ok: result.ok, text: await result.text() };
    });
    // A non-2xx body is not a result: callers decide on status before they
    // would parse, so a non-JSON error page never turns a status verdict into
    // a generic parse failure.
    const json = response.ok
      ? yield* Effect.try({
        try: () => JSON.parse(response.text) as unknown,
        catch: (cause) => ioError("json", url, cause),
      })
      : undefined;
    return { status: response.status, ok: response.ok, json };
  });
}

export interface CappedResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly contentType: string;
  readonly text: string;
  readonly truncated: boolean;
}

/** Fetch a textual body while staying under a byte cap; the streaming read
 * itself is an adapter concern, not the caller's. */
export function fetchCappedText(
  url: string,
  init: RequestInit | undefined,
  maxBytes: number,
): Effect.Effect<CappedResponse, IoError> {
  return fetchCall(url, init, async (signal) => {
    const response = await fetch(url, { ...init, signal });
    const contentType = response.headers.get("content-type") ?? "";
    const reader = response.body?.getReader();
    if (reader === undefined) {
      return { status: response.status, ok: response.ok, contentType, text: "", truncated: false };
    }
    const decoder = new TextDecoder();
    let text = "";
    let total = 0;
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        text += decoder.decode(value.subarray(0, remaining), { stream: true });
        truncated = true;
        break;
      }
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { status: response.status, ok: response.ok, contentType, text, truncated };
  });
}
