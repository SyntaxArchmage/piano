// Generic mid-turn steering contract for Piano harness backends.
//
// The interface is defined once, at the harness boundary, and every backend
// gets a dedicated implementation (or none): a backend that can deliver a
// message into a live agent session `bind`s its session to the channel; a
// backend that cannot simply never binds, and the channel answers
// "no-active-turn". Callers (the TUI, the CLI session) never branch on the
// harness name — they ask the channel, and the channel's capability state is
// the only decision point. This mirrors how `signal` threads the same way
// down `executeWorkflow → executeWorker → AgentRequest`.
//
// v1 bindings: the pi SDK adapter (its `AgentSession.steer` delivers the
// message before the next LLM call of the running turn) and claude's
// streaming-input stdin (a frame written while tool calls run reaches the
// model at the next tool boundary of the same turn). dsh/pi-cli do not bind
// yet — their dedicated implementations are follow-up work, and steering
// through the channel is how they will attach without touching the callers.

/** Outcome of a steering attempt: `delivered` means a live bound session
 * accepted the text into its running turn; `no-active-turn` means nothing was
 * listening (no turn running, or the active backend has no steering
 * implementation) and the caller should keep its queue semantics. A rejected
 * promise is a third answer: a live session refused the text (never swallow
 * it — surface it to the developer). */
export type SteerDelivery = "delivered" | "no-active-turn";

/** What a harness backend binds: the live session's delivery primitive. Kept
 * minimal so a backend can adapt any native API (pi `session.steer`, a future
 * CLI control frame, an RPC call) behind it. */
export interface SteeringTarget {
  steer(text: string): Promise<void>;
}

/** The channel threaded from the CLI down to the running worker. `steer`
 * answers for the caller; `bind` is used by harness backends while a session
 * is live. Binding is last-write-wins and unbinding checks ownership, so
 * overlapping stage sessions (retry, fan-out) never steal each other's
 * channel. */
export interface SteeringChannel {
  steer(text: string): Promise<SteerDelivery>;
  /** Attach a live session; returns the unbind. Call `bind(undefined)` (or
   * skip binding) when the backend cannot steer — the channel stays
   * reportably silent. */
  bind(target: SteeringTarget | undefined): () => void;
}

/** Create an unbound channel. One per prompt, created by the CLI session and
 * threaded to whichever worker session comes to life during it. */
export function createSteeringChannel(): SteeringChannel {
  let bound: SteeringTarget | undefined;
  let generation = 0;
  return {
    async steer(text: string): Promise<SteerDelivery> {
      if (text.trim() === "" || bound === undefined) return "no-active-turn";
      await bound.steer(text);
      return "delivered";
    },
    bind(target: SteeringTarget | undefined): () => void {
      const token = ++generation;
      bound = target;
      return () => {
        // Ownership check: a stale unbind (older session's cleanup) must not
        // drop a newer session's binding.
        if (generation === token) bound = undefined;
      };
    },
  };
}
