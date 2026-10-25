import { Deferred, Effect, FiberId } from "effect";
import { AgentError } from "./errors.js";
import { asRecord, nonEmptyString, type JsonRecord } from "./json-narrowing.js";

/**
 * The two request/response protocols Piano speaks over a child's stdio.
 *
 * A pipe write proves only that the child received bytes; both of these
 * protocols carry an explicit acknowledgment, so a write becomes an effect
 * that settles on the child's own answer. They share one correlation table
 * (`PendingAcks`) and differ only in how a reply is decoded: the dsh runner
 * answers steer frames on stderr (`piano-steer:` lines), pi RPC answers every
 * frame on stdout (`type:"response"` records).
 */

/** The correlation table both brokers share: one entry per write awaiting the
 * child's acknowledgment. `take` removes and returns one by id; `abortAll`
 * fails whatever is still open when the child dies, so no caller waits for an
 * answer that has become impossible. The entry is completed through a
 * `Deferred` rather than a promise, so an answer nobody ever awaits is simply
 * a completed effect — it can never surface as an unhandled rejection. */
interface PendingAck {
  readonly command: string;
  readonly deferred: Deferred.Deferred<void, AgentError>;
}

class PendingAcks {
  private nextId = 0;
  private readonly pending = new Map<string, PendingAck>();

  /** Next id in this table's own sequence, spelled the way the protocol does. */
  next(prefix: string): string {
    this.nextId += 1;
    return `${prefix}-${this.nextId}`;
  }

  /** Register one write awaiting the child's answer and return the effect that
   * settles with it. The entry exists as soon as the frame is built: a
   * protocol with acknowledgments may answer the write before the caller
   * reaches its wait, so registration cannot be deferred until then. */
  open(id: string, command: string): Effect.Effect<void, AgentError> {
    const deferred = Deferred.unsafeMake<void, AgentError>(FiberId.none);
    this.pending.set(id, { command, deferred });
    // A Deferred is itself the effect that suspends until the answer arrives.
    return deferred;
  }

  take(id: string): PendingAck | undefined {
    const entry = this.pending.get(id);
    if (entry === undefined) return undefined;
    this.pending.delete(id);
    return entry;
  }

  abortAll(reason: string): void {
    const error = new AgentError({ kind: "harness-unavailable", message: reason });
    for (const [, pending] of this.pending) Deferred.unsafeDone(pending.deferred, Effect.fail(error));
    this.pending.clear();
  }
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
 * resolve a steer: the ack does, and a refusal fails the caller's wait
 * instead of being reported as delivered. */
export class DshSteerAcks {
  private readonly acks = new PendingAcks();

  frame(text: string): { readonly json: string; readonly settled: Effect.Effect<void, AgentError> } {
    const id = this.acks.next("steer");
    const settled = this.acks.open(id, "steer");
    return { json: dshSteerFrame(text, id), settled };
  }

  /** One stderr line, settling the frame it answers if it is an ack. */
  accept(line: string): void {
    const ack = dshSteerAck(line);
    if (ack === undefined) return;
    const pending = this.acks.take(ack.id);
    if (pending === undefined) return;
    if (ack.accepted) {
      Deferred.unsafeDone(pending.deferred, Effect.succeed(undefined));
      return;
    }
    Deferred.unsafeDone(pending.deferred, Effect.fail(new AgentError({
      kind: "request-rejected",
      message: ack.reason ?? "the dsh turn had already ended, so the steer was dropped",
    })));
  }

  /** The child is gone: nothing can still be acknowledged. */
  abort(reason: string): void {
    this.acks.abortAll(reason);
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
export function isSteerAckLine(line: string): boolean {
  return line.trim().startsWith(DSH_STEER_ACK_PREFIX);
}

/** The id the initial `prompt` frame carries, so the broker can tell the
 * attempt's own task frame apart from every `steer` it later injects. */
const PI_PROMPT_REQUEST_ID = "piano-prompt";

/**
 * The far end of pi RPC's request/response protocol.
 *
 * Every frame Piano writes carries an `id` and every reply pi sends is a
 * `type:"response"` record carrying that same id back (verified on the
 * installed CLI: prompt and steer both answered), so a write is only really
 * delivered when its own response arrives — a successful pipe write proves
 * nothing about whether the agent accepted the message. The broker owns that
 * correlation: the steer effect resolves on the matching `success:true`,
 * fails with the child's own error text on `success:false`, and fails
 * everything still pending when the stream ends, so a caller can never wait on
 * an answer that has already become impossible.
 */
export class PiRpcClient {
  private readonly acks = new PendingAcks();

  /** Called when pi refuses the attempt's own prompt. The refusal is answered
   * on the response frame, which the broker claims before it can reach the
   * ordinary event path, so whoever owns the child's stdin has to be told from
   * here — pi keeps its stdin loop alive after declining and only an explicit
   * wind-down ends it. */
  onPromptRefusal: (() => void) | undefined;

  /** Record one response frame. Returns true when it belonged to a pending
   * request, false when nothing was waiting for it (a stray or duplicate
   * frame, which the caller then handles as an ordinary event). */
  settle(value: JsonRecord): boolean {
    const id = nonEmptyString(value.id);
    if (id === undefined) return false;
    const pending = this.acks.take(id);
    if (pending === undefined) return false;
    if (value.success === true) {
      Deferred.unsafeDone(pending.deferred, Effect.succeed(undefined));
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
    Deferred.unsafeDone(pending.deferred, Effect.fail(error));
    return true;
  }

  /** Build one steer frame and the effect its acknowledgment settles. The id
   * is this client's own sequence so a wrong answer cannot resolve a later
   * steer; pi acknowledges a `steer` as soon as the message is queued, not when
   * the model reads it — "accepted into the running turn's steering queue" is
   * the strongest delivery this protocol can honestly report. A refusal fails
   * here and stops at this caller instead of failing the whole conversation. */
  frame(text: string): { readonly json: string; readonly settled: Effect.Effect<void, AgentError> } {
    const id = this.acks.next("piano");
    const settled = this.acks.open(id, "steer");
    return { json: JSON.stringify({ id, type: "steer", message: text }), settled };
  }

  /** Build the task frame and the effect pi's acknowledgment settles. The id
   * is the shared prompt id so a refusal is attributable to the attempt. */
  prompt(text: string): { readonly json: string; readonly settled: Effect.Effect<void, AgentError> } {
    const settled = this.acks.open(PI_PROMPT_REQUEST_ID, "prompt");
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
    this.acks.abortAll(reason);
  }
}
