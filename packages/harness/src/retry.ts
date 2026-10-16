import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { logger, type Logging, type Source } from "@piano/logging";
import type { AgentContinuation, AgentResult } from "./agent-contract.js";
import { AgentError } from "./errors.js";

/** Hardcoded reliability floor for failed agent exits: one initial attempt
 * plus up to two retries with escalating backoff. Deliberately not user
 * configurable — retries are invisible reliability, not a knob. */
export const AGENT_RETRY_DELAYS_MS: readonly number[] = [5_000, 20_000];

const RETRYABLE_KINDS: ReadonlySet<string> = new Set([
  "rate-limit",
  "timeout",
  "max-tokens",
  "harness-unavailable",
  "request-rejected",
]);

const RETRY_SOURCE: Source = {
  module: "harness",
  file: "retry.ts",
  function: "withAgentRetries",
};

const RETRY_LOG = logger(RETRY_SOURCE, { namespace: "harness" });

export interface AgentRetryAttempt {
  /** Zero-based attempt ordinal; 0 is the initial attempt. */
  readonly attempt: number;
  /** Continuation of the failed attempt's session, when one exists. The
   * next attempt reopens that session instead of starting a new one. */
  readonly continuation?: AgentContinuation;
}

export interface AgentRetryOutcome {
  readonly result: AgentResult;
}

/** A caller-visible signal from the retry boundary: the attempt that just
 * failed and its schedule, or the later attempt that succeeded. Emitted for
 * frontends to show that a scary transient error was handled; the full
 * record always exists in the run's log and trace. */
export type AgentRetryNotice =
  | {
      readonly event: "scheduled";
      readonly attempt: number;
      readonly nextAttempt: number;
      readonly totalAttempts: number;
      readonly delayMs: number;
      readonly errorType: string;
      readonly message: string;
    }
  | {
      readonly event: "recovered";
      readonly attempt: number;
      readonly totalAttempts: number;
    };

export interface AgentContinuationFlag {
  /** Marks a continuation that cannot be reopened (for example an SDK without
   * session-reopen support). Retrying with it would fail identically. */
  readonly unresolvable?: boolean;
}

/** Attach a failed attempt's session identity to its error. The retry
 * boundary reads it to continue the same session on the next attempt. */
export function withFailedContinuation(
  error: AgentError,
  continuation: AgentContinuation & AgentContinuationFlag,
): AgentError {
  return Object.assign(error, { failedContinuation: continuation });
}

/**
 * Shared retry boundary for agent adapter exits. `runAttempt` is invoked
 * with the current attempt ordinal and the continuation captured from the
 * previous failed attempt (if any), so retries continue the same session
 * rather than starting fresh. Retryability is decided by the AgentError
 * kind; aborts and permanent failures surface unchanged. An abort signal
 * that fires during a backoff wait ends the wait immediately with a typed
 * `cancelled` error.
 */
export function withAgentRetries(
  runAttempt: (attempt: AgentRetryAttempt) => Effect.Effect<
    AgentRetryOutcome,
    AgentError,
    Logging | FileSystem.FileSystem
  >,
  delays: readonly number[] = AGENT_RETRY_DELAYS_MS,
  signal?: AbortSignal,
  onRetry?: (notice: AgentRetryNotice) => void,
): Effect.Effect<AgentRetryOutcome, AgentError, Logging | FileSystem.FileSystem> {
  const cancelledDuringBackoff = () => new AgentError({
    kind: "cancelled",
    message: "agent retry cancelled during backoff",
  });
  const recurse = (
    attempt: number,
    continuation: (AgentContinuation & AgentContinuationFlag) | undefined,
  ): Effect.Effect<AgentRetryOutcome, AgentError, Logging | FileSystem.FileSystem> =>
    runAttempt({ attempt, ...(continuation === undefined ? {} : { continuation }) }).pipe(
      // A later attempt that succeeds is the other half of the story a
      // frontend must tell: the transient failure was recovered from.
      Effect.tap(() => attempt > 0 && onRetry !== undefined
        ? Effect.sync(() => onRetry({
          event: "recovered",
          attempt: attempt + 1,
          totalAttempts: delays.length + 1,
        }))
        : Effect.void),
      Effect.catchAll((error: AgentError) => {
        if (signal?.aborted) return Effect.fail(error);
        if (attempt >= delays.length || !RETRYABLE_KINDS.has(error.kind)) {
          return Effect.fail(error);
        }
        // A retry that must reopen a session but cannot (the SDK reports the
        // continuation unresolvable) would fail identically; stop early.
        const nextContinuation = failedAttemptContinuation(error) ?? continuation;
        if (nextContinuation?.unresolvable === true) return Effect.fail(error);
        const delay = delays[attempt]!;
        const notice = onRetry === undefined ? Effect.void : Effect.sync(() => onRetry({
          event: "scheduled",
          attempt: attempt + 1,
          nextAttempt: attempt + 2,
          totalAttempts: delays.length + 1,
          delayMs: delay,
          errorType: error.kind,
          message: error.message,
        }));
        const scheduled = RETRY_LOG.warn("agent.retry.scheduled", {
          outcome: "failure",
          data: {
            attempt: attempt + 1,
            nextAttempt: attempt + 2,
            totalAttempts: delays.length + 1,
            delayMs: delay,
            ...(nextContinuation === undefined ? {} : { sessionId: nextContinuation.sessionId }),
            error: { kind: error.kind, message: error.message },
          },
        }).pipe(Effect.catchAll(() => Effect.void));
        const backoff = signal === undefined
          ? Effect.sleep(delay)
          : signalAwareSleep(delay, signal, cancelledDuringBackoff);
        return notice.pipe(
          Effect.andThen(scheduled),
          Effect.andThen(backoff),
          Effect.andThen(signal?.aborted
            ? Effect.fail(cancelledDuringBackoff())
            : Effect.void),
          Effect.andThen(recurse(attempt + 1, nextContinuation)),
        );
      }),
    );
  return recurse(0, undefined);
}

/** Extract a session continuation the failed attempt stashed on its error,
 * so the retry reopens that session instead of starting a new one. */
export function failedAttemptContinuation(
  error: unknown,
  depth = 0,
): (AgentContinuation & AgentContinuationFlag) | undefined {
  if (depth > 3 || error === null || typeof error !== "object") return undefined;
  const value = (error as { readonly failedContinuation?: unknown }).failedContinuation;
  if (failedContinuationMatches(value)) return value;
  // Wrappers (e.g. the worker adapter's WorkerError) preserve the harness
  // error under `cause`; the stash lives on the innermost AgentError.
  return failedAttemptContinuation((error as { readonly cause?: unknown }).cause, depth + 1);
}

function failedContinuationMatches(value: unknown): value is AgentContinuation & AgentContinuationFlag {
  return typeof value === "object" && value !== null
    && "harness" in value && "sessionId" in value && "transcriptPath" in value;
}

/** Sleep that ends as soon as `signal` aborts, so a backoff wait never outlives
 * the run that scheduled it. `onAbort` decides what the wait ends with, which
 * is what lets each caller keep its own failure type. Without a signal this is
 * the plain interruptible `Effect.sleep`. */
export function abortableSleep<E>(
  delayMs: number,
  signal: AbortSignal | undefined,
  onAbort: () => Effect.Effect<void, E>,
): Effect.Effect<void, E> {
  if (signal === undefined) return Effect.sleep(delayMs);
  return Effect.async<void, E>((resume) => {
    if (signal.aborted) {
      resume(onAbort());
      return;
    }
    let settled = false;
    const finish = (effect: Effect.Effect<void, E>): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbortListener);
      resume(effect);
    };
    const onAbortListener = (): void => finish(onAbort());
    const timer = setTimeout(() => finish(Effect.succeed(undefined)), delayMs);
    signal.addEventListener("abort", onAbortListener, { once: true });
    return Effect.sync(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbortListener);
    });
  });
}

/** Sleep that ends early with a typed cancellation when the signal aborts.
 * Without a signal the plain interruptible Effect.sleep is used. */
function signalAwareSleep(
  delayMs: number,
  signal: AbortSignal,
  cancelled: () => AgentError,
): Effect.Effect<void, AgentError> {
  return abortableSleep(delayMs, signal, () => Effect.fail(cancelled()));
}
