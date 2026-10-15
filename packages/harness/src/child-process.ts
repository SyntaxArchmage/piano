import { spawn, type ChildProcess } from "node:child_process";
import type { AgentRequest } from "./agent-contract.js";
import { AgentError } from "./errors.js";
import { asRecord, nonEmptyString, type JsonRecord } from "./json-narrowing.js";

/**
 * Running one adapter process, and talking to it while it runs.
 *
 * `runChild` owns the child's lifetime — spawn, stdio framing, the abort
 * signal, the exit outcome — and hands the live child to whichever stdin
 * protocol its harness speaks. Two of those protocols acknowledge what Piano
 * writes (pi RPC answers on stdout, Piano's own dsh runner answers on stderr),
 * so their brokers live here too: a steer is reported delivered only once the
 * far end said so, and a child that closes before answering fails the writes it
 * still owed rather than leaving them pending forever.
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

/** One NDJSON stdin frame for Piano's dsh runner: the runner forwards `text` to
 * the host agent's `Agent.steer`, which joins it into the running turn as a
 * user interjection.
 *
 * The `id` is what makes `delivered` an honest answer. A write to the pipe only
 * proves the runner received the frame; whether it could hand the text to a live
 * turn is the runner's to decide, and it answers on the ack channel below. */
function dshSteerFrame(text: string, id: string): string {
  return JSON.stringify({ type: "steer", id, text });
}

/** The runner's reply to a steer frame, read off its stderr because stdout
 * carries the turn's answer. One line per decision, so a caller learns whether
 * the running turn actually took the text (`accepted`) or the frame arrived
 * with no turn to join (`refused`, which is the runner's own honest
 * `no-active-turn`). */
const DSH_STEER_ACK_PREFIX = "piano-steer:";

/** Correlates dsh steer frames with the runner's acks. The runner is the only
 * party that knows whether a live turn took the text, so a write alone must not
 * resolve a steer: the ack does, and a refusal rejects the caller's promise
 * instead of being reported as delivered. */
export class DshSteerAcks {
  private nextId = 0;
  private readonly pending = new Map<string, {
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }>();

  frame(text: string): { readonly json: string; readonly settled: Promise<void> } {
    this.nextId += 1;
    const id = `steer-${this.nextId}`;
    const settled = new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    settled.catch(() => undefined);
    return { json: dshSteerFrame(text, id), settled };
  }

  /** One stderr line, settling the frame it answers if it is an ack. */
  accept(line: string): void {
    const ack = dshSteerAck(line);
    if (ack === undefined) return;
    const pending = this.pending.get(ack.id);
    if (pending === undefined) return;
    this.pending.delete(ack.id);
    if (ack.accepted) {
      pending.resolve();
      return;
    }
    pending.reject(new AgentError({
      kind: "request-rejected",
      message: ack.reason ?? "the dsh turn had already ended, so the steer was dropped",
    }));
  }

  /** The child is gone: nothing can still be acknowledged. */
  abort(reason: string): void {
    const error = new AgentError({ kind: "harness-unavailable", message: reason });
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
  }
}

function dshSteerAck(line: string): { readonly id: string; readonly accepted: boolean; readonly reason?: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith(DSH_STEER_ACK_PREFIX)) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(DSH_STEER_ACK_PREFIX.length));
    const record = asRecord(parsed);
    const id = nonEmptyString(record?.id);
    if (record === undefined || id === undefined || typeof record.accepted !== "boolean") return undefined;
    const reason = nonEmptyString(record.reason);
    return { id, accepted: record.accepted, ...(reason === undefined ? {} : { reason }) };
  } catch {
    return undefined;
  }
}

/** Whether a stderr line is a steering ack rather than something the run said.
 * Checked before the line becomes an event: an ack is the answer to one of
 * Piano's own writes, so reporting it as run output would hand the caller an
 * event while its own steer is still in flight. */
function isSteerAckLine(line: string): boolean {
  return line.trim().startsWith(DSH_STEER_ACK_PREFIX);
}

/** The id the initial `prompt` frame carries, so the broker can tell the
 * attempt's own task frame apart from every `steer` it later injects. */
const PI_PROMPT_REQUEST_ID = "piano-prompt";

/**
 * The far end of pi RPC's request/response protocol.
 *
 * Every frame Piano writes carries an `id` and every reply pi sends is a
 * `type:"response"` record carrying that same id back, so a write is only
 * really delivered when its own response arrives — a successful pipe write
 * proves nothing about whether the agent accepted the message. The broker owns
 * that correlation: `request` resolves on the matching `success:true`, rejects
 * with the child's own error text on `success:false`, and rejects everything
 * still pending when the stream ends, so a caller can never await an answer
 * that has already become impossible.
 */
export class PiRpcClient {
  private nextId = 0;
  private readonly pending = new Map<string, {
    readonly command: string;
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }>();

  /** Called when pi refuses the attempt's own prompt. The refusal is answered
   * on the response frame, which the broker claims before it can reach the
   * ordinary event path, so whoever owns the child's stdin has to be told from
   * here — pi keeps its stdin loop alive after declining and only an explicit
   * wind-down ends it. */
  onPromptRefusal: (() => void) | undefined;

  /** Next request id in this client's own sequence. */
  private id(): string {
    this.nextId += 1;
    return `piano-${this.nextId}`;
  }

  /** Record one response frame. Returns true when it belonged to a pending
   * request, false when nothing was waiting for it (a stray or duplicate
   * frame, which the caller then handles as an ordinary event). */
  settle(value: JsonRecord): boolean {
    const id = nonEmptyString(value.id);
    if (id === undefined) return false;
    const pending = this.pending.get(id);
    if (pending === undefined) return false;
    this.pending.delete(id);
    if (value.success === true) {
      pending.resolve();
      return true;
    }
    const reason = nonEmptyString(value.error) ?? "unknown reason";
    const error = new AgentError({
      kind: "request-rejected",
      message: `pi rejected the ${pending.command} request: ${reason}`,
    });
    // The request the attempt itself depends on (the task prompt) fails the
    // attempt; a refused injection belongs to its own caller.
    if (id === PI_PROMPT_REQUEST_ID) {
      this.promptRejection = error;
      // pi answers a declined prompt and then goes straight back to waiting for
      // the next command — its stdin loop never ends on its own. The response
      // frame that carries this refusal is claimed by the broker before it can
      // reach the ordinary event path, so the wind-down has to be driven from
      // here: there is no later stdout line that would carry the hook.
      this.onPromptRefusal?.();
    }
    pending.reject(error);
    return true;
  }

  /** Build a frame whose acknowledgment this client will await. */
  frame(text: string): { readonly id: string; readonly json: string } {
    const id = this.id();
    return { id, json: JSON.stringify({ id, type: "steer", message: text }) };
  }

  /**
   * Write one frame and resolve only once pi has acknowledged it.
   *
   * pi acknowledges a `steer` as soon as the message is queued, not when the
   * model reads it: the protocol has no later signal, so "accepted into the
   * running turn's steering queue" is the strongest delivery this backend can
   * honestly report. A refusal rejects here and stops at this caller instead
   * of failing the whole conversation.
   */
  async request(text: string, write: (json: string) => void): Promise<void> {
    const { id, json } = this.frame(text);
    const settled = new Promise<void>((resolve, reject) => {
      this.pending.set(id, { command: "steer", resolve, reject });
    });
    try {
      write(json);
    } catch (cause) {
      this.pending.delete(id);
      throw cause instanceof Error ? cause : new Error(String(cause));
    }
    return settled;
  }

  /** Build the task frame and the promise pi's acknowledgment settles. The id
   * is the shared prompt id so a refusal is attributable to the attempt. */
  prompt(text: string): { readonly json: string; readonly settled: Promise<void> } {
    const settled = new Promise<void>((resolve, reject) => {
      this.pending.set(PI_PROMPT_REQUEST_ID, { command: "prompt", resolve, reject });
    });
    // A rejection the caller never awaits (the attempt may die from an abort or
    // an exit first) must not surface as an unhandled rejection.
    settled.catch(() => undefined);
    return {
      json: JSON.stringify({ id: PI_PROMPT_REQUEST_ID, type: "prompt", message: text }),
      settled,
    };
  }

  /** A refusal of the attempt's task frame, once observed. Deliberately not
   * shared with a refused `steer`: that refusal belongs to the steering call
   * that asked for it (which rejects, and the caller keeps its queue
   * semantics), not to the turn. Folding both into one flag is what made an
   * accepted conversation die over a mid-turn injection. */
  get promptRefusal(): AgentError | undefined {
    return this.promptRejection;
  }

  private promptRejection: AgentError | undefined;

  /** Settle every pending request as a failure. Called when stdout closes: the
   * child is gone, so no response can still arrive. */
  abort(reason: string): void {
    const error = new AgentError({ kind: "harness-unavailable", message: reason });
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
  }
}

/** The pi session file a turn opens or resumes.
 *
 * pi owns this file: it appends entries and reads them back on the next turn.
 * Piano only decides the name — a continuation hands back the same path so the
 * conversation continues instead of starting over — and never writes into it,
 * which is why the audit trail is written to a sibling path instead.
 *
 * Always named, never left to pi. Letting pi choose means it opens a file under
 * its own default directory, and the continuation still has to hand back
 * *something* pi can reopen: the only path Piano holds is the audit trail, which
 * pi did not write and cannot continue from. The next turn would then pass pi a
 * file it does not recognise and the conversation would silently restart. The
 * directory is already created for the audit trail, so the name is always
 * placeable. */
export interface ChildStdinControl {
  /** Deliver one steering frame. Resolves when the child has acknowledged
   * acceptance where its protocol can say so (pi RPC correlates by request id);
   * rejects when the child refused it, so the caller — not the whole attempt —
   * owns that outcome. */
  writeFrame(text: string): Promise<void>;
  windDown(): void;
}

/** Per-harness stdin wiring. `initialFrame` is the task frame written as the
 * first stdin line at spawn (claude streaming input; pi RPC `prompt`); a
 * harness whose task travels as argv (dsh) leaves it undefined and uses stdin
 * purely for steering frames, shaped by `frame`. */
export interface ChildStdinBridge {
  readonly initialFrame?: string;
  /** Builds a steering frame, returning the line to write and — where the
   * protocol has acknowledgments — the promise they settle. */
  readonly frame: (text: string) => { readonly json: string; readonly settled?: Promise<void> };
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
): Promise<ChildOutcome> {
  return new Promise((resolve, reject) => {
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
      reject(cause);
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
      resolve({
        code, signal, stderr, rawLines,
        ...(spawnError === undefined ? {} : { spawnError }),
        aborted,
        ...(windDownArmed ? { gracefulShutdown: true } : {}),
      });
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted) onAbort();
    if (stdin !== undefined) {
      // The CLI exits on stdin EOF itself almost always; the grace timer
      // bounds the case where it does not, so a hung post-`result` process
      // can never keep the worker (and the run's stage) open forever.
      const control: ChildStdinControl = {
        writeFrame: async (text: string): Promise<void> => {
          const stream = child.stdin;
          if (settled || windDownArmed || stream === null || stream.destroyed || stream.writableEnded) {
            throw new Error(`${binPath} stdin is closed; the turn has ended`);
          }
          const { json, settled: acknowledged } = stdin.frame(text);
          // Write first, then await: a protocol with acknowledgments only
          // reports success through a response frame that can arrive before the
          // write call itself has returned.
          const written = stream.write(`${json}\n`);
          if (acknowledged === undefined) return;
          // Backpressure is irrelevant next to the ack, but an error on the
          // stream is not: without this the promise would outlive the child.
          if (written === false) await new Promise<void>((resolve) => stream.once("drain", resolve));
          await acknowledged;
        },
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
  });
}

