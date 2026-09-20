// Scripted AgentRunner turns for engine/session tests that mock "sending the
// prompt" at the harness adapter boundary — the same seam the Escape tests in
// tests/workflow/esc-pauses-run.test.ts drive by hand. Two behaviours are
// shared here so the session-arc tests reuse one copy:
//
//  - `settledResult`: a worker reply that stays inside one actor conversation
//    — it continues whatever session the request was asked to reopen, or opens
//    a fresh one when the request carried no continuation;
//  - `hangUntilAbort`: a turn that hangs until the request's abort signal
//    fires and then fails exactly like a real interrupted turn — a `cancelled`
//    AgentError stashing the session the attempt opened (see pi.ts /
//    subprocess.ts), which is what the engine adopts into resume.json.

import { Effect } from "effect";
import {
  AgentError,
  withFailedContinuation,
  type AgentContinuation,
  type AgentResult,
} from "@piano/harness";

/** The actor conversation identity one turn opened or reopened. */
export interface ActorSession {
  readonly harness: string;
  readonly sessionId: string;
  readonly transcriptPath: string;
}

/** Which actor conversation a request belongs to: the one it was asked to
 * reopen, or a brand-new one. */
export function sessionOf(
  request: { readonly continuation?: AgentContinuation },
  fallback: ActorSession,
): ActorSession {
  return request.continuation === undefined
    ? fallback
    : {
        harness: request.continuation.harness,
        sessionId: request.continuation.sessionId,
        transcriptPath: request.continuation.transcriptPath,
      };
}

/** A successful reply that keeps running the same conversation. */
export function settledResult(
  request: { readonly continuation?: AgentContinuation },
  text: string,
  fallback: ActorSession,
): Effect.Effect<AgentResult, AgentError> {
  const session = sessionOf(request, fallback);
  return Effect.succeed<AgentResult>({
    sessionId: session.sessionId,
    transcriptPath: session.transcriptPath,
    text,
    continuation: session,
  });
}

/** A turn that hangs until the caller's abort signal fires, failing exactly
 * like a real interrupted turn: the `cancelled` AgentError stashes the session
 * this attempt was running in. */
export function hangUntilAbort(
  request: { readonly signal?: AbortSignal },
  stash: ActorSession,
): Effect.Effect<AgentResult, AgentError> {
  return Effect.async<AgentResult, AgentError>((resume) => {
    const abort = (): void => resume(Effect.fail(withFailedContinuation(
      new AgentError({ kind: "cancelled", message: "pi request cancelled" }),
      stash,
    )));
    if (request.signal?.aborted) {
      abort();
      return;
    }
    request.signal?.addEventListener("abort", abort, { once: true });
    return Effect.sync(() => {
      request.signal?.removeEventListener("abort", abort);
    });
  });
}
