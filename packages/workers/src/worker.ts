import { Effect } from "effect";
import type { FileSystem } from "@effect/platform";
import type { Logging } from "@piano/logging";
import { logger, type Source } from "@piano/logging";
import {
  executeAgent,
  executeSubprocessAgent,
  isHarnessName,
  type AgentEvent,
  type AgentContinuation,
  type AgentHarnessOptions,
  type AgentRunner,
  type SteeringChannel,
  type ThinkingLevel,
} from "@piano/harness";
import { Data } from "effect";

export interface WorkerRequest {
  readonly stage: string;
  readonly worker: string;
  readonly harness?: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly systemPromptPath?: string;
  readonly contextFilePaths?: readonly string[];
  readonly skillPaths?: readonly string[];
  readonly tools?: readonly string[];
  readonly model?: string;
  readonly thinkingLevel?: ThinkingLevel;
  readonly sessionDir?: string;
  readonly continuation?: AgentContinuation;
  readonly onEvent?: (event: AgentEvent) => void;
  /** Called by the harness the moment the attempt has a session worth coming
   * back to. Transport only — the worker never interprets it. */
  readonly onContinuation?: (continuation: AgentContinuation) => void;
  /** Mid-turn steering channel, threaded through to the harness request.
   * Transport only — the worker never interprets it. */
  readonly steering?: SteeringChannel;
  /** Supervisor discussion callback for the `discuss` primitive. */
  readonly discuss?: (question: string) => Effect.Effect<string, unknown>;
  /** Test/runtime injection point; production uses the configured default adapter. */
  readonly agentRunner?: AgentRunner;
}

export interface WorkerResult {
  readonly stage: string;
  readonly worker: string;
  readonly text: string;
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly model?: string;
  readonly thinkingLevel?: ThinkingLevel;
  readonly continuation?: AgentContinuation;
}

export class WorkerError extends Data.TaggedError("WorkerError")<{
  readonly stage: string;
  readonly worker: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

const HARNESS_SOURCE: Source = {
  module: "harness",
  file: "pi.ts",
  function: "executeAgent",
};
const HARNESS_LOG = logger(HARNESS_SOURCE, { namespace: "harness" });
const PI_HARNESS = "pi";

export function executeWorker(
  request: WorkerRequest,
  options: AgentHarnessOptions = {},
): Effect.Effect<WorkerResult, WorkerError, Logging | FileSystem.FileSystem> {
  const harness = request.harness ?? PI_HARNESS;
  if (!isHarnessName(harness)) {
    return Effect.fail(new WorkerError({
      stage: request.stage,
      worker: request.worker,
      message: `worker "${request.worker}" requested unsupported harness "${request.harness}"`,
    }));
  }
  const runAgent = request.agentRunner ?? ((agentRequest, agentOptions) =>
    harness === PI_HARNESS
      ? executeAgent(agentRequest, agentOptions)
      : executeSubprocessAgent(harness, agentRequest, agentOptions));
  return runAgent({
    cwd: request.cwd,
    prompt: request.prompt,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    ...(request.systemPromptPath === undefined ? {} : { systemPromptPath: request.systemPromptPath }),
    ...(request.contextFilePaths === undefined ? {} : { contextFilePaths: request.contextFilePaths }),
    ...(request.skillPaths === undefined ? {} : { skillPaths: request.skillPaths }),
    ...(request.tools === undefined ? {} : { tools: request.tools }),
    ...(request.model === undefined ? {} : { model: request.model }),
    ...(request.thinkingLevel === undefined ? {} : { thinkingLevel: request.thinkingLevel }),
    ...(request.sessionDir === undefined ? {} : { sessionDir: request.sessionDir }),
    ...(request.continuation === undefined ? {} : { continuation: request.continuation }),
    ...(request.onEvent === undefined ? {} : { onEvent: request.onEvent }),
    ...(request.onContinuation === undefined ? {} : { onContinuation: request.onContinuation }),
    ...(request.steering === undefined ? {} : { steering: request.steering }),
    ...(request.discuss === undefined ? {} : { discuss: request.discuss }),
  }, options).pipe(
    Effect.tapError((error) =>
      HARNESS_LOG.error("harness.failed", {
        stage: request.stage,
        agent: request.worker,
        outcome: "failure",
        data: { kind: error.kind, error: error.message },
      })
    ),
    Effect.map((result) => ({
      stage: request.stage,
      worker: request.worker,
      text: result.text,
      sessionId: result.sessionId,
      transcriptPath: result.transcriptPath,
      ...(result.model === undefined ? {} : { model: result.model }),
      ...(result.thinkingLevel === undefined ? {} : { thinkingLevel: result.thinkingLevel }),
      ...(result.continuation === undefined ? {} : { continuation: result.continuation }),
    })),
    Effect.mapError((cause) => {
      return new WorkerError({
        stage: request.stage,
        worker: request.worker,
        message: `worker "${request.worker}" failed at stage "${request.stage}": [${cause.kind}] ${cause.message}`,
        cause,
      });
    }),
  );
}
