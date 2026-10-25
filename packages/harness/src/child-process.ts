import { spawn, type ChildProcess } from "node:child_process";
import { Effect } from "effect";
import type { AgentRequest } from "./agent-contract.js";
import { isSteerAckLine } from "./child-protocols.js";
import { AgentError, agentError } from "./errors.js";
import { asRecord, nonEmptyString, type JsonRecord } from "./json-narrowing.js";

/**
 * Running one adapter process, and talking to it while it runs.
 *
 * `runChild` owns the child's lifetime — spawn, stdio framing, the abort
 * signal, the exit outcome — and hands the live child to whichever stdin
 * protocol its harness speaks. The two protocols that acknowledge what Piano
 * writes (pi RPC answers on stdout, Piano's own dsh runner answers on stderr)
 * live in `child-protocols`; here is only their shared plumbing: a steering
 * frame reaches the child, a response line settles a write, and a child that
 * closes before answering fails the writes it still owed rather than leaving
 * them pending forever.
 */

export interface ChildOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly rawLines: readonly string[];
  readonly spawnError?: Error;
  readonly aborted: boolean;
  /** The child closed after our own post-`result` wind-down (stdin end, then
   * a bounded SIGTERM). An exit signal from that shutdown is a clean
   * completion, not a harness failure. */
  readonly gracefulShutdown?: boolean;
}


export interface ChildStdinControl {
  /** Deliver one steering frame. Succeeds when the child has acknowledged
   * acceptance where its protocol can say so (pi RPC correlates by request id);
   * fails when the child refused it or the stdin is gone, so the caller — not
   * the whole attempt — owns that outcome. */
  writeFrame(text: string): Effect.Effect<void, AgentError>;
  windDown(): void;
}

/** Per-harness stdin wiring. `initialFrame` is the task frame written as the
 * first stdin line at spawn (claude streaming input; pi RPC `prompt`); a
 * harness whose task travels as argv (dsh) leaves it undefined and uses stdin
 * purely for steering frames, shaped by `frame`. */
export interface ChildStdinBridge {
  readonly initialFrame?: string;
  /** Builds a steering frame, returning the line to write and — where the
   * protocol has acknowledgments — the effect they settle. */
  readonly frame: (text: string) => { readonly json: string; readonly settled?: Effect.Effect<void, AgentError> };
  /** Given a response record, the pending frame it settles, if any. */
  readonly settle?: (value: JsonRecord) => boolean;
  /** One line of the child's stderr, read as it arrives — the channel a backend
   * whose acknowledgments cannot travel on stdout answers on. */
  readonly onStderr?: (line: string) => void;
  /** Called when the child's stream ends: whatever the protocol still owed an
   * acknowledgment must fail instead of waiting forever. */
  readonly onClose?: (reason: string) => void;
  onControl(control: ChildStdinControl): void;
}

/** Offer one stdout line to the bridge as a possible response frame. Returns
 * true when a pending write claimed it. */
function consumeResponse(line: string, settle: (value: JsonRecord) => boolean): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return false;
  }
  const record = asRecord(parsed);
  return record !== undefined && nonEmptyString(record.type) === "response" && settle(record);
}

export function runChild(
  binPath: string,
  argv: readonly string[],
  request: AgentRequest,
  emitLine: (line: string) => void,
  env: NodeJS.ProcessEnv,
  stdin?: ChildStdinBridge,
  /** One line of the child's stderr, read as it arrives. The ack channel rides
   * on stderr and a steer waits on it while the turn still runs, so this cannot
   * be deferred to close; it is also the run's only mid-turn signal. */
  onStderrLine?: (line: string) => void,
): Effect.Effect<ChildOutcome, AgentError> {
  return Effect.async<ChildOutcome, AgentError>((resume) => {
    let child: ChildProcess;
    try {
      child = spawn(binPath, [...argv], {
        cwd: request.cwd,
        env,
        stdio: stdin === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
        // A CLI harness may launch its own shell/tool children. Keeping the
        // process group separate lets abort terminate the whole adapter tree.
        detached: process.platform !== "win32",
      });
    } catch (cause) {
      resume(Effect.fail(agentError("harness-unavailable", cause)));
      return;
    }
    const rawLines: string[] = [];
    let lineBuffer = "";
    let stderr = "";
    let aborted = false;
    let spawnError: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let windDownArmed = false;
    let windDownTimer: NodeJS.Timeout | undefined;
    let settled = false;
    const terminate = (signal: NodeJS.Signals): void => {
      if (process.platform !== "win32" && child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall back to the direct child when a platform/runtime rejects a
          // process-group signal (for example after the group leader exits).
        }
      }
      child.kill(signal);
    };
    const onAbort = (): void => {
      if (settled || aborted) return;
      aborted = true;
      terminate("SIGTERM");
      killTimer = setTimeout(() => terminate("SIGKILL"), 2000);
    };
    const consume = (line: string): void => {
      const trimmed = line.trim();
      if (trimmed === "") return;
      rawLines.push(trimmed);
      // A response frame answers a frame Piano wrote, so the bridge gets first
      // refusal on it: it settles the pending write that asked. Only a frame no
      // request claims continues into the ordinary event path.
      if (stdin?.settle !== undefined && consumeResponse(trimmed, stdin.settle)) return;
      emitLine(trimmed);
    };
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (lineBuffer.trim() !== "") consume(lineBuffer);
      lineBuffer = "";
      // The child is gone, so no response can still arrive: anything still
      // awaiting an acknowledgment must fail rather than hang the attempt.
      stdin?.onClose?.(`${binPath} closed before acknowledging`);
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (windDownTimer !== undefined) clearTimeout(windDownTimer);
      request.signal?.removeEventListener("abort", onAbort);
      resume(Effect.succeed({
        code, signal, stderr, rawLines,
        ...(spawnError === undefined ? {} : { spawnError }),
        aborted,
        ...(windDownArmed ? { gracefulShutdown: true } : {}),
      }));
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted) onAbort();
    if (stdin !== undefined) {
      // The CLI exits on stdin EOF itself almost always; the grace timer
      // bounds the case where it does not, so a hung post-`result` process
      // can never keep the worker (and the run's stage) open forever.
      const control: ChildStdinControl = {
        // The write and its acknowledgment are Effect-native all the way out;
        // only the Pi/UI contracts wrapped around it are Promise-shaped.
        writeFrame: (text: string): Effect.Effect<void, AgentError> => Effect.gen(function* () {
          const stream = child.stdin;
          if (settled || windDownArmed || stream === null || stream.destroyed || stream.writableEnded) {
            return yield* Effect.fail(new AgentError({
              kind: "harness-unavailable",
              message: `${binPath} stdin is closed; the turn has ended`,
            }));
          }
          const { json, settled: acknowledged } = stdin.frame(text);
          // Write first, then wait: a protocol with acknowledgments only
          // reports success through a response frame that can arrive before the
          // write call itself has returned.
          const written = stream.write(`${json}\n`);
          if (acknowledged === undefined) return;
          // Backpressure is irrelevant next to the ack, but an error on the
          // stream is not: without this the wait would outlive the child.
          if (written === false) {
            yield* Effect.async<void>((resumeDrain) => {
              const onDrain = (): void => resumeDrain(Effect.void);
              stream.once("drain", onDrain);
              return Effect.sync(() => stream.off("drain", onDrain));
            });
          }
          yield* acknowledged;
        }),
        windDown: (): void => {
          if (settled || windDownArmed) return;
          windDownArmed = true;
          try {
            child.stdin?.end();
          } catch {
            // EPIPE here only means the child is already gone; close settles.
          }
          windDownTimer = setTimeout(() => terminate("SIGTERM"), 2000);
        },
      };
      // A stdin stream error (child gone mid-write) must not surface as an
      // unhandled 'error' event; writeFrame's guards report the closure.
      child.stdin?.on("error", () => undefined);
      stdin.onControl(control);
      if (stdin.initialFrame !== undefined) {
        try {
          child.stdin?.write(`${stdin.initialFrame}\n`);
        } catch {
          // A synchronous spawn failure follows on the 'error'/'close' events.
        }
      }
    }
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      lineBuffer += chunk;
      let newline = lineBuffer.indexOf("\n");
      while (newline >= 0) {
        consume(lineBuffer.slice(0, newline));
        lineBuffer = lineBuffer.slice(newline + 1);
        newline = lineBuffer.indexOf("\n");
      }
    });
    child.stderr?.setEncoding("utf8");
    // stderr is kept whole for the failure message, but the steering ack channel
    // rides on it and has to be read as it arrives: a steer waits on its answer
    // while the turn is still running, long before the child closes and the
    // buffered copy becomes readable. The same live read is what surfaces the
    // runner's own notes (`dsh: ...`) as events while the turn runs, so a caller
    // watching the run can see the turn go live rather than only its obituary.
    let stderrBuffer = "";
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
      stderrBuffer += chunk;
      while (true) {
        const newline = stderrBuffer.indexOf("\n");
        if (newline === -1) break;
        const line = stderrBuffer.slice(0, newline);
        stderrBuffer = stderrBuffer.slice(newline + 1);
        stdin?.onStderr?.(line);
        // An ack is protocol metadata answering a write, not something the run
        // said: emitting it would re-enter the caller's event handler while its
        // own steer is still in flight. It settles the pending write instead,
        // and only the runner's notes become events.
        if (isSteerAckLine(line)) continue;
        onStderrLine?.(line);
      }
    });
    child.on("error", (cause) => { spawnError = cause; });
    child.on("close", finish);
    // A killed harness may have handed its stdout/stderr write ends to a
    // detached grandchild, so `close` would wait on a pipe that never EOFs.
    // Once the direct child is gone, an aborted run has no output worth that
    // wait: destroy the read ends so a wedged pipe can neither strand the
    // outcome promise nor hold Node's event loop open past the user's exit.
    // Un-aborted runs keep draining `close` normally — destroying early would
    // truncate the transcript on a clean exit.
    child.on("exit", () => {
      if (aborted) {
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
    });
    // An interrupted run never reaches a normal close, so the child would keep
    // running past the effect that owns it. Terminate the adapter tree on the
    // way out; a run that already answered has nothing left to stop.
    return Effect.sync(() => {
      if (!settled) onAbort();
      request.signal?.removeEventListener("abort", onAbort);
    });
  });
}

