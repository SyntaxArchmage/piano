import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import type { Logging } from "@piano/logging";
import { AgentError } from "./errors.js";
import type { AgentEvent, ThinkingLevel } from "./events.js";
import type { SteeringChannel } from "./steering.js";

/**
 * The vocabulary a caller and a harness adapter agree on: what to run, which
 * conversation to continue, what came back, and how an adapter is configured.
 *
 * These shapes are every adapter's, not one adapter's, so they live apart from
 * the Pi SDK adapter that first defined them. While they sat in `pi.ts`, the
 * package had exactly one import cycle — `pi.ts` reached into `retry.ts` for
 * the retry boundary while `retry.ts` reached back into `pi.ts` for a
 * continuation — and it existed only because the shared vocabulary had no home
 * of its own.
 *
 * The event vocabulary adapters *produce* is the other half, and lives in
 * `events.ts`.
 */

export interface AgentRequest {
  readonly cwd: string;
  readonly prompt: string;
  readonly systemPromptPath?: string;
  readonly contextFilePaths?: readonly string[];
  readonly skillPaths?: readonly string[];
  readonly tools?: readonly string[];
  readonly model?: string;
  /** Pi reasoning level; request value overrides harness/config defaults. */
  readonly thinkingLevel?: ThinkingLevel;
  readonly provider?: string;
  readonly agentDir?: string;
  readonly sessionDir?: string;
  /** Harness-owned continuation from an earlier turn in the same Piano run.
   * The opaque handle is intentionally not interpreted by the orchestrator. */
  readonly continuation?: AgentContinuation;
  /** Called the moment this attempt has a session worth coming back to, before
   * the turn ends — and again if the identity becomes more precise (Claude
   * announces its own session id in its first frame). A turn that is
   * interrupted returns no result and no error to carry a continuation, so a
   * caller that only reads the result loses a session the harness has already
   * created. Called synchronously; it must not block. */
  readonly onContinuation?: (continuation: AgentContinuation) => void;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: AgentEvent) => void;
  /** Mid-turn steering channel. This backend binds the live SDK session to it
   * (pi `AgentSession.steer` delivers before the next LLM call of the running
   * turn); an SDK without `steer` leaves it unbound. */
  readonly steering?: SteeringChannel;
  /** Supervisor discussion callback exposed by the Piano `discuss` tool. The
   * callback is Effect-native; only the Pi tool contract it feeds is a
   * Promise, and `pi-tools` adapts at that leaf. */
  readonly discuss?: (question: string) => Effect.Effect<string, unknown>;
}

export interface AgentContinuation {
  readonly harness: string;
  /** Piano's own logical id for the actor this continuation belongs to. Piano
   * mints one (`<harness>-<uuid>`) when the harness never reported a session
   * of its own, so no harness may treat this as its own session handle. */
  readonly sessionId: string;
  /** The harness's own session handle, present only once an attempt actually
   * observed one. A harness that resumes by native id (Claude's `--resume`)
   * reads this and never {@link sessionId}: Claude rejects an unknown id and
   * fails the whole run. */
  readonly nativeSessionId?: string;
  readonly transcriptPath: string;
}

export interface AgentResult {
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly text: string;
  readonly model?: string;
  readonly thinkingLevel?: ThinkingLevel;
  readonly continuation?: AgentContinuation;
}

export interface AgentHarnessOptions {
  readonly agentDir?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly apiKey?: string;
  /** Native credential environment-variable name (for example dsh's
   * `apiKeyEnv` setting). */
  readonly apiKeyEnv?: string;
  /** Adapter-specific API gateway URL for subprocess harnesses. */
  readonly baseUrl?: string;
  /** Adapter-specific proxy auth token for subprocess harnesses. */
  readonly authToken?: string;
  /** Native configuration home/profile overrides for subprocess harnesses. */
  readonly homePath?: string;
  readonly profile?: string;
  /** Additional directories a sandboxed subprocess may write, such as Piano's
   * run-owned contract/evidence root alongside the task workspace. */
  readonly additionalWritableDirs?: readonly string[];
  readonly thinkingLevel?: ThinkingLevel;
  /** Child-process environment for subprocess adapters. */
  readonly env?: NodeJS.ProcessEnv;
  /** Selected subprocess executable. Ignored by the SDK adapter. */
  readonly binPath?: string;
  /** Test seam: override the hardcoded failed-exit retry backoff. Production
   * callers never set it; the default is the reliability floor. */
  readonly retryDelaysMs?: readonly number[];
}

export type AgentRunner = (
  request: AgentRequest,
  options?: AgentHarnessOptions,
) => Effect.Effect<AgentResult, AgentError, Logging | FileSystem.FileSystem>;
