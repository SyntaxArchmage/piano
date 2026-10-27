import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { io } from "@piano/base";
import type { Logging } from "@piano/logging";
import { AgentError, agentError } from "./errors.js";
import {
  emitMessageEnd,
  normalizeSubprocessLine,
  stripProxyDiagnostic,
  type SubprocessAccumulator,
} from "./subprocess-events.js";
import {
  claudeArguments,
  codexArguments,
  dshArguments,
  dshResumeSessionEnv,
  dshResumeSessionId,
  piArguments,
  piSessionPath,
  userFrame,
  type LoadedResources,
} from "./harness-argv.js";
import { DshSteerAcks, PiRpcClient } from "./child-protocols.js";
import {
  runChild,
  type ChildOutcome,
  type ChildStdinBridge,
  type ChildStdinControl,
} from "./child-process.js";
import { createDshEventMapper } from "./dsh-session-events.js";
import {
  createDshSessionTailer,
  readDshSessionEvidence,
  type DshSessionEvidence,
} from "./dsh-session-storage.js";
import { canonicalTranscriptText, mergeCanonicalTranscript } from "./canonical-transcript.js";
import { DSH_API_KEY_ENV, dshDiscussPatchPath, dshModelPatchPath, dshResumeOverlayPath, dshWebSearchOffPatchPath } from "./harness-home.js";
import { startDiscussBridge, type DiscussBridge } from "./discuss-bridge.js";
import { discussMcpServerPath } from "./discuss-mcp-path.js";
import {
  agentConfigPath,
  resolveHarnessConfig,
  type HarnessName,
  type ResolvedHarnessConfig,
} from "./harness-config.js";
import {
  type AgentEvent,
  type AgentResourceKind,
  type ThinkingLevel,
} from "./events.js";
import { persistAgentEvents } from "./event-observer.js";
import {
  AGENT_RETRY_DELAYS_MS,
  withAgentRetries,
  withFailedContinuation,
  type AgentRetryAttempt,
  type AgentRetryOutcome,
} from "./retry.js";
import type {
  AgentContinuation,
  AgentRequest,
  AgentResult,
  AgentHarnessOptions,
} from "./agent-contract.js";
import { PI_WEB_SEARCH_TOOL_NAME } from "./pi-web-search.js";

function readResource(path: string): Effect.Effect<string, AgentError> {
  return Effect.gen(function* () {
    const info = yield* io.stat(path).pipe(
      Effect.mapError((cause) => agentError("resource-unavailable", cause)),
    );
    return yield* io.readText(info.isDirectory() ? join(path, "SKILL.md") : path).pipe(
      Effect.mapError((cause) => agentError("resource-unavailable", cause)),
    );
  });
}

function loadResources(
  request: AgentRequest,
  emit: (event: AgentEvent) => void,
): Effect.Effect<LoadedResources, AgentError> {
  return Effect.gen(function* () {
    const contextFiles: Array<{ path: string; content: string }> = [];
    const skills: Array<{ path: string; content: string }> = [];
    const requested = (kind: AgentResourceKind, path: string | undefined): void => {
      emit({ type: "resource", resource: { kind, status: "requested", source: "workflow", ...(path === undefined ? {} : { path }) } });
    };
    requested("system-prompt", request.systemPromptPath);
    for (const path of request.contextFilePaths ?? []) requested("context-file", path);
    for (const path of request.skillPaths ?? []) requested("skill", path);
    let failedKind: AgentResourceKind = "system-prompt";
    let failedPath = request.systemPromptPath;
    return yield* Effect.gen(function* () {
      let systemPrompt: string | undefined;
      if (request.systemPromptPath !== undefined) {
        failedKind = "system-prompt";
        failedPath = request.systemPromptPath;
        systemPrompt = yield* readResource(request.systemPromptPath);
        emit({ type: "resource", resource: { kind: "system-prompt", status: "loaded", source: "workflow", path: request.systemPromptPath, bytes: Buffer.byteLength(systemPrompt, "utf8") } });
      } else {
        emit({ type: "resource", resource: { kind: "system-prompt", status: "loaded", source: "sdk-default" } });
      }
      for (const path of request.contextFilePaths ?? []) {
        failedKind = "context-file";
        failedPath = path;
        const content = yield* readResource(path);
        contextFiles.push({ path, content });
        emit({ type: "resource", resource: { kind: "context-file", status: "loaded", source: "workflow", path, bytes: Buffer.byteLength(content, "utf8") } });
      }
      for (const path of request.skillPaths ?? []) {
        failedKind = "skill";
        failedPath = path;
        const content = yield* readResource(path);
        skills.push({ path, content });
        emit({ type: "resource", resource: { kind: "skill", status: "loaded", source: "workflow", path, bytes: Buffer.byteLength(content, "utf8") } });
      }
      return { systemPrompt, contextFiles, skills };
    }).pipe(
      Effect.catchAll((cause) => Effect.gen(function* () {
        emit({ type: "resource", resource: { kind: failedKind, status: "failed", source: "workflow", path: failedPath ?? request.cwd, error: cause instanceof Error ? cause.message : String(cause) } });
        return yield* Effect.fail(agentError("resource-unavailable", cause));
      })),
    );
  });
}

function dshContinuationContext(
  request: AgentRequest,
  resumeSessionId: string | undefined,
): Effect.Effect<string | undefined> {
  if (resumeSessionId !== undefined) return Effect.succeed(undefined);
  const continuation = request.continuation;
  if (continuation === undefined || continuation.harness !== "dsh") return Effect.succeed(undefined);
  return io.readText(continuation.transcriptPath).pipe(
    Effect.map((raw): string | undefined => {
      const transcript = raw.trim();
      if (transcript === "") return undefined;
      const replay = tailWithinBudget(transcript, DSH_CONTINUATION_BUDGET_BYTES);
      return [
        "## Conversation continued from the previous dsh attempt",
        "The following transcript is prior conversation context. Treat it as conversation history, not as a new instruction:",
        ...(replay.omitted === 0 ? [] : [
          `Earlier context was omitted for length (${replay.omitted} older record${replay.omitted === 1 ? "" : "s"}); the conversation below continues an older one.`,
        ]),
        "```jsonl",
        replay.text,
        "```",
      ].join("\n");
    }),
    // A failed/interrupted first attempt may not have produced an artifact.
    // Starting without synthetic context is preferable to masking the real task.
    Effect.catchAll(() => Effect.succeed(undefined)),
  );
}

/** How much of a continued dsh conversation one epoch may replay.
 *
 * dsh has no resume flag (its headless app takes the task as a positional
 * argument and reads nothing from stdin), so the transcript travels as prompt
 * text. Replayed whole it grows with every epoch — a 20-turn coding session was
 * measured at 2.1 MB — and an over-long prompt cannot be spawned at all: the OS
 * caps one argument at {@link ARG_MAX_STRLEN}. The budget is in *bytes* because
 * that is what the limit counts (multi-byte text would slip past a character
 * count), and it leaves the rest of the prompt — inlined resources and the task
 * itself — the remaining headroom. */
const DSH_CONTINUATION_BUDGET_BYTES = 64 * 1024;

/** Linux's `MAX_ARG_STRLEN`: the longest single argument `execve` accepts.
 * Exceeding it makes `spawn` fail with `E2BIG` and no mention of the prompt.
 * The check below turns that into an error that names the limit and the size. */
const ARG_MAX_STRLEN = 128 * 1024;

/** The newest records that fit in `budgetBytes`, cut at record boundaries so
 * the replay never contains half a message. `omitted` counts the records left
 * out, which the caller discloses rather than hiding. */
function tailWithinBudget(transcript: string, budgetBytes: number): { text: string; omitted: number } {
  if (Buffer.byteLength(transcript, "utf8") <= budgetBytes) return { text: transcript, omitted: 0 };
  const records = transcript.split("\n").filter((line) => line.trim() !== "");
  const kept: string[] = [];
  let used = 0;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]!;
    const size = Buffer.byteLength(record, "utf8") + 1;
    if (used + size > budgetBytes) break;
    kept.unshift(record);
    used += size;
  }
  // A single record can exceed the whole budget — a large tool result, say.
  // A truncated newest record beats replaying nothing at all: the task's own
  // last step is what the next epoch has to build on.
  if (kept.length === 0) {
    const newest = records[records.length - 1]!;
    return { text: Buffer.from(newest, "utf8").subarray(0, budgetBytes).toString("utf8"), omitted: records.length };
  }
  return { text: kept.join("\n"), omitted: records.length - kept.length };
}

function childEnv(
  harness: HarnessName,
  config: ResolvedHarnessConfig,
  options: AgentHarnessOptions,
  toolsRequested: boolean,
): NodeJS.ProcessEnv {
  const env = { ...process.env, ...options.env };
  const secret = (value: string): string => /^[A-Z][A-Z0-9_]*$/.test(value) ? (env[value] ?? value) : value;
  if (harness === "claude") {
    if (config.apiKey !== undefined) env.ANTHROPIC_API_KEY = secret(config.apiKey);
    if (config.baseUrl !== undefined) env.ANTHROPIC_BASE_URL = config.baseUrl;
    if (config.authToken !== undefined) env.ANTHROPIC_AUTH_TOKEN = secret(config.authToken);
    if (config.homePath !== undefined && env.CLAUDE_CONFIG_DIR === undefined) env.CLAUDE_CONFIG_DIR = config.homePath;
  } else if (harness === "dsh") {
    const apiKeyEnv = config.apiKeyEnv ?? DSH_API_KEY_ENV;
    if (config.apiKey !== undefined) env[apiKeyEnv] = secret(config.apiKey);
    // The official route uses these names. Generic pi-ai routes use the
    // explicit apiKeyEnv/baseURL values in their native dsh settings file.
    if (config.provider === "deepseek-official" && config.apiKey !== undefined) env.DEEPSEEK_API_KEY = secret(config.apiKey);
    if (config.provider === "deepseek-official" && config.baseUrl !== undefined) env.DEEPSEEK_BASE_URL = config.baseUrl;
    if (config.homePath !== undefined && env.DSH_HOME === undefined) env.DSH_HOME = config.homePath;
    // dsh's default workspace-write policy still asks for approval. A headless
    // Piano worker has no approval reader, so an explicit tool task must use the
    // native non-interactive policy. The task remains bounded by its cwd and
    // the acceptance prompt; callers can override the native policy in env.
    if (toolsRequested && env.DSH_PERMISSION_MODE === undefined) env.DSH_PERMISSION_MODE = "danger-full-access";
  } else if (harness === "codex") {
    // Codex's auth slot is CODEX_API_KEY and its native settings/auth store is
    // selected by CODEX_HOME. Keep the user's logged-in home unless Piano was
    // explicitly given a different one; a generated empty home would erase the
    // provider configuration that commonly routes gpt-5.6-luna through a
    // deployment proxy.
    const apiKeyEnv = config.apiKeyEnv ?? "CODEX_API_KEY";
    if (config.apiKey !== undefined) {
      const value = secret(config.apiKey);
      env[apiKeyEnv] = value;
      env.CODEX_API_KEY = value;
    }
    if (config.authToken !== undefined && env.CODEX_API_KEY === undefined) {
      env.CODEX_API_KEY = secret(config.authToken);
    }
    if (config.homePath !== undefined && env.CODEX_HOME === undefined) env.CODEX_HOME = config.homePath;
  } else {
    if (config.baseUrl !== undefined) env.PI_BASE_URL = config.baseUrl;
    if (config.apiKey !== undefined) env.PI_API_KEY = secret(config.apiKey);
    if (config.model !== undefined) env.PI_MODEL = config.model;
  }
  return env;
}

function plainOutput(rawLines: readonly string[]): string {
  return rawLines.filter((line) => {
    try {
      JSON.parse(line);
      return false;
    } catch {
      return true;
    }
  }).join("\n").trim();
}

function subprocessError(
  harness: HarnessName,
  outcome: ChildOutcome,
  binPath: string,
): AgentError {
  if (outcome.aborted) return new AgentError({ kind: "cancelled", message: `${harness} request cancelled` });
  if (outcome.spawnError) return new AgentError({ kind: "harness-unavailable", message: `failed to start ${harness} (${binPath}): ${outcome.spawnError.message}`, cause: outcome.spawnError });
  const status = outcome.code ?? outcome.signal ?? "unknown";
  const stderr = outcome.stderr.trim();
  return new AgentError({
    kind: "request-rejected",
    message: `${harness} exited with ${status}${stderr === "" ? "" : `: ${stderr.slice(-500)}`}`,
  });
}

/** Live stdin control for a streaming-input child (claude, dsh, pi RPC). Handed
 * to the attempt the moment the child spawns: `writeFrame` delivers one steering
 * frame mid-turn, `windDown` ends stdin after the terminal frame and bounds the
 * exit with a SIGTERM grace. */
export function executeSubprocessAgent(
  harness: HarnessName,
  request: AgentRequest,
  options: AgentHarnessOptions = {},
): Effect.Effect<AgentResult, AgentError, Logging | FileSystem.FileSystem> {
  // Steering: claude binds the live child's stdin (streaming input — see
  // `runSubprocessAttempt`); dsh binds it too, through Piano's own runner, whose
  // stdin protocol forwards each frame to the host agent's `Agent.steer`; and
  // pi/pi-cli bind through their RPC stdin protocol (task as the first `prompt`
  // frame, mid-turn injections as `steer` frames).
  return withAgentRetries(
    (attempt) => runSubprocessAttempt(harness, request, options, attempt),
    options.retryDelaysMs ?? AGENT_RETRY_DELAYS_MS,
    request.signal,
    (notice) => request.onEvent?.({ type: "retry", ...notice }),
  ).pipe(
    Effect.map((outcome) => outcome.result),
  );
}

/** Everything a launch needs, resolved and guarded while no child exists yet.
 *
 * The split is deliberate: a stage that cannot start must fail here, with a
 * message naming what is missing, rather than as an opaque child exit. That is
 * why the harness home's generated overlays and the web-search gateway
 * configuration are probed before anything is spawned, and why the resource
 * events and the attempt's own announcements are emitted on the way — the
 * order a caller sees is resources, then spawn, then context.
 *
 * dsh's branches cluster here: which patch layers its home must carry, the
 * session it should reopen, and how much of a continued conversation travels
 * as prompt text. */
interface AttemptPlan {
  readonly accumulator: SubprocessAccumulator;
  readonly provisionalId: string;
  readonly transcriptPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly argv: readonly string[];
  readonly dshHome: string;
  readonly dshResumeId: string | undefined;
}

/** Fail one attempt the way every failure path does: surface the typed error as
 * an event, persist the events observed so far as the attempt's evidence, then
 * fail — optionally carrying the continuation the retry boundary needs to
 * reopen this attempt's conversation instead of starting over. */
function attemptFailure(
  emit: (event: AgentEvent) => void,
  observed: readonly AgentEvent[],
  provisionalId: string,
): (error: AgentError, continuation?: AgentContinuation) => Effect.Effect<never, AgentError, Logging | FileSystem.FileSystem> {
  return (error, continuation) => Effect.gen(function* () {
    emit({ type: "error", errorType: error.kind, message: error.message });
    yield* persistAgentEvents(observed, provisionalId);
    return yield* Effect.fail(
      continuation === undefined ? error : withFailedContinuation(error, continuation),
    );
  });
}

/** Start the per-attempt discussion bridge only for harnesses whose workers
 * reach it through MCP. `pi` mounts the tool in-process, and headless
 * channels still answer through the same callback. */
function startDiscussBridgeFor(
  harness: HarnessName,
  request: AgentRequest,
): Effect.Effect<DiscussBridge | undefined, AgentError> {
  if (request.discuss === undefined || (harness !== "claude" && harness !== "dsh")) {
    return Effect.succeed(undefined);
  }
  return startDiscussBridge((question) => request.discuss!(question));
}

function prepareAttempt(input: {
  readonly harness: HarnessName;
  readonly request: AgentRequest;
  readonly options: AgentHarnessOptions;
  readonly config: ResolvedHarnessConfig;
  readonly thinking: ThinkingLevel | undefined;
  readonly observed: AgentEvent[];
  readonly emit: (event: AgentEvent) => void;
  readonly discuss: DiscussBridge | undefined;
}): Effect.Effect<AttemptPlan, AgentError, Logging | FileSystem.FileSystem> {
  const { harness, request, options, config, thinking, observed, emit, discuss } = input;
  return Effect.gen(function* () {
    const resources = yield* loadResources(request, emit);
    emit({ type: "spawn", harness, ...(config.model === undefined ? {} : { model: config.model }), ...(thinking === undefined ? {} : { thinkingLevel: thinking }), skills: [...(request.skillPaths ?? [])], ...(request.continuation?.sessionId === undefined ? {} : { memory: request.continuation.sessionId }) });
    emit({ type: "context", context: { ...(request.systemPromptPath === undefined ? {} : { systemPromptPath: request.systemPromptPath }), contextFilePaths: request.contextFilePaths ?? [], skills: request.skillPaths ?? [], userMessage: request.prompt } });
    const accumulator: SubprocessAccumulator = { text: "" };
    const sessionDirectory = request.sessionDir ?? join(tmpdir(), "piano-subprocess");
    const provisionalId = request.continuation?.sessionId ?? `${harness}-${randomUUID()}`;
    const transcriptPath = request.continuation?.transcriptPath ?? join(sessionDirectory, `${provisionalId}.jsonl`);
    yield* io.mkdir(dirname(transcriptPath), { recursive: true }).pipe(
      Effect.mapError((cause) => agentError("session-artifact", cause)),
    );
    const environment = childEnv(harness, config, options, (request.tools?.length ?? 0) > 0);
    // Resolved before argv because dsh's model overlay lives inside this home.
    const dshHome = environment.DSH_HOME ?? join(homedir(), ".dsh");
    if (harness === "dsh" && discuss !== undefined) {
      // The generated patch reads these two variables; the values are unique
      // to this attempt and never reach another process.
      environment.PIANO_DISCUSS_URL = discuss.url;
      environment.PIANO_DISCUSS_TOKEN = discuss.token;
    }
    // Pre-spawn guards keep stale generated homes and incomplete web-search
    // configuration from becoming opaque child failures or memory-only A/B
    // runs.
    const failBeforeSpawn = attemptFailure(emit, observed, provisionalId);
    // `io.exists` keeps the old access-probe classification: an unreadable
    // path counts as absent, and the "missing" message names the overlay the
    // bootstrap has to regenerate.
    const requireOverlay = (
      path: string,
      kind: "model-not-found" | "session-artifact",
      missing: string,
    ) => Effect.gen(function* () {
      if (yield* io.exists(path)) return;
      return yield* failBeforeSpawn(new AgentError({ kind, message: missing }));
    });
    if (harness === "dsh" && config.model !== undefined) {
      const patchPath = dshModelPatchPath(dshHome, config.model);
      yield* requireOverlay(
        patchPath,
        "model-not-found",
        `dsh model "${config.model}" has no generated overlay at ${patchPath}; `
          + `add "${config.model}" to the models list in ${agentConfigPath()} so Piano can route it`,
      );
    }
    if (harness === "dsh" && request.tools?.includes(PI_WEB_SEARCH_TOOL_NAME) !== true) {
      const ablationPath = dshWebSearchOffPatchPath(dshHome);
      yield* requireOverlay(
        ablationPath,
        "session-artifact",
        `dsh web_search ablation overlay is missing at ${ablationPath}; `
          + "re-run the mission bootstrap so Piano regenerates the harness home",
      );
    }
    if ((harness === "claude" || harness === "dsh") && request.discuss !== undefined) {
      if (discuss === undefined) {
        return yield* failBeforeSpawn(new AgentError({
          kind: "session-artifact",
          message: `the ${harness} discussion bridge was not started`,
        }));
      }
      const scriptPath = discussMcpServerPath();
      yield* requireOverlay(
        scriptPath,
        "session-artifact",
        `the discuss MCP server is missing at ${scriptPath}; reinstall or rebuild the Piano CLI`,
      );
      if (harness === "dsh") {
        const patchPath = dshDiscussPatchPath(dshHome);
        yield* requireOverlay(
          patchPath,
          "session-artifact",
          `the dsh discuss overlay is missing at ${patchPath}; `
            + "re-run the mission bootstrap so Piano regenerates the harness home",
        );
      }
    }
    if ((harness === "pi" || harness === "pi-cli")
      && request.tools?.includes(PI_WEB_SEARCH_TOOL_NAME) === true
      && (config.baseUrl === undefined || config.apiKey === undefined)) {
      yield* failBeforeSpawn(new AgentError({
        kind: "configuration",
        message: `web_search needs the endpoint and API key from ${agentConfigPath()} `
          + "(the search runs against the same gateway route as chat)",
      }));
    }
    // What dsh needs to reopen the actor's conversation, resolved once: the id
    // travels to the child as an environment reference and decides both the
    // overlay below and whether the transcript replay is still needed.
    const dshResumeId = harness === "dsh" ? dshResumeSessionId(request) : undefined;
    Object.assign(environment, dshResumeSessionEnv(dshResumeId));
    // Every dsh run drives the turn through the resuming runner (it is the far
    // end of stdin steering, not just a resume helper), so the overlay is
    // required unconditionally — a missing one means the harness home is stale
    // no matter whether this epoch continues a session.
    if (harness === "dsh") {
      const resumeOverlay = dshResumeOverlayPath(dshHome);
      yield* requireOverlay(
        resumeOverlay,
        "session-artifact",
        `dsh resume overlay is missing at ${resumeOverlay}; `
          + "re-run the mission bootstrap so Piano regenerates the harness home",
      );
    }
    const dshContext = harness === "dsh"
      ? yield* dshContinuationContext(request, dshResumeId)
      : undefined;
    const argv = harness === "claude"
      ? claudeArguments(request, config, thinking, resources, discuss)
      : harness === "dsh"
        ? dshArguments(request, config, resources, dshHome, dshContext)
        : harness === "codex"
          ? codexArguments(request, config, thinking, resources, options.additionalWritableDirs ?? [])
          : piArguments(request, config, thinking, resources, transcriptPath, harness === "pi");
    // The OS refuses to spawn when one argument outgrows MAX_ARG_STRLEN, and
    // reports it as a bare `E2BIG` from `spawn` — which reads as "harness
    // unavailable" and says nothing about the prompt. dsh carries its task (and
    // any replayed conversation) as a positional argument, so a large inlined
    // system prompt can trip this on its own; name the limit and the size.
    const oversized = argv.find((argument) => Buffer.byteLength(argument, "utf8") > ARG_MAX_STRLEN);
    if (oversized !== undefined) {
      return yield* failBeforeSpawn(new AgentError({
        kind: "request-rejected",
        message: `the ${harness} prompt is ${Buffer.byteLength(oversized, "utf8")} bytes, over the `
          + `${ARG_MAX_STRLEN}-byte limit for a single process argument; shorten the stage's inlined `
          + "resources, the task, or the replayed conversation",
      }));
    }
    return { accumulator, provisionalId, transcriptPath, environment, argv, dshHome, dshResumeId };
  });
}

/** One subprocess attempt inside the shared retry boundary. The attempt's
 * session identity (provisionalId/transcriptPath) is derived from the active
 * continuation, so a retry reopens the transcript the failed attempt wrote. */
function runSubprocessAttempt(
  harness: HarnessName,
  request: AgentRequest,
  options: AgentHarnessOptions,
  attempt: AgentRetryAttempt,
): Effect.Effect<AgentRetryOutcome, AgentError, Logging | FileSystem.FileSystem> {
  const requestedConfig: ResolvedHarnessConfig = {
    provider: request.provider ?? options.provider,
    model: request.model ?? options.model,
    apiKey: options.apiKey,
    apiKeyEnv: options.apiKeyEnv,
    baseUrl: options.baseUrl,
    authToken: options.authToken,
    binPath: options.binPath,
    homePath: options.homePath,
    profile: options.profile,
  };
  const config = resolveHarnessConfig(harness, {
    ...requestedConfig,
    thinkingLevel: request.thinkingLevel ?? options.thinkingLevel,
  });
  // One resolution feeds argv, the model catalog, and the spawn event, so the
  // level a stage configures is the level the harness receives.
  const thinking = config.thinkingLevel;
  const sourcePath = config.binPath
    ?? (harness === "claude" ? "claude" : harness === "dsh" ? "dsh" : harness === "codex" ? "codex" : "pi");
  return Effect.acquireUseRelease(
    startDiscussBridgeFor(harness, request),
    (discuss) => Effect.gen(function* () {
    if (request.signal?.aborted) return yield* Effect.fail(new AgentError({ kind: "cancelled", message: `${harness} request cancelled` }));
    const observed: AgentEvent[] = [];
    const emit = (event: AgentEvent): void => {
      observed.push(event);
      request.onEvent?.(event);
    };
    const retryRequest: AgentRequest = attempt.continuation === undefined
      ? request
      : { ...request, continuation: attempt.continuation };
    const plan = yield* prepareAttempt({ harness, request: retryRequest, options, config, thinking, observed, emit, discuss });
    const { accumulator, provisionalId, transcriptPath, environment, argv, dshHome, dshResumeId } = plan;
    const failAttempt = attemptFailure(emit, observed, provisionalId);
    const startedAt = Date.now();
    const dshMapper = harness === "dsh" ? createDshEventMapper(accumulator, emit) : undefined;
    // dsh storage is keyed by cwd, and a resumed map slot's cwd embeds the
    // iteration and slot, so `dshResumeId` — not the cwd — is what locates the
    // continued session.
    const dshTailer = dshMapper === undefined
      ? undefined
      : createDshSessionTailer(dshHome, retryRequest.cwd, startedAt, dshMapper, dshResumeId);
    // Steering for the streaming-input backends: the live child's stdin is the
    // delivery path. For claude a frame written mid-turn reaches the model at
    // the next tool boundary; for dsh the frame travels to Piano's runner, which
    // hands it to the host agent's `Agent.steer` (buffered before the task turn
    // starts, noted-and-dropped after it ends); for pi RPC the task itself is
    // the initial `prompt` frame and a `steer` frame is delivered after the
    // running turn's tool calls, before the next LLM call.
    let childControl: ChildStdinControl | undefined;
    let unbindSteering: (() => void) | undefined;
    // Every streaming-input backend steers the same way once the child exists:
    // take the control handle and bind the channel's steer to its write path.
    const adoptControl = (control: ChildStdinControl): void => {
      childControl = control;
      unbindSteering = request.steering?.bind({ steer: (text) => control.writeFrame(text) });
    };
    // pi RPC is acknowledged on stdout and dsh on stderr, so both steer
    // through a broker rather than the raw stdin writer: the channel's `steer`
    // resolves only once the child accepts the frame, and a refusal lands on
    // the caller that asked instead of failing the conversation. claude's
    // streaming input has no acknowledgment at all, so its frame resolves on a
    // successful write — the honest limit of what that protocol reports.
    const piRpc = harness === "pi" ? new PiRpcClient() : undefined;
    const piPrompt = piRpc?.prompt(retryRequest.prompt);
    const dshAcks = harness === "dsh" ? new DshSteerAcks() : undefined;
    const stdinBridge: ChildStdinBridge | undefined = harness === "claude"
      ? {
        initialFrame: userFrame(retryRequest.prompt),
        frame: (text) => ({ json: userFrame(text) }),
        onControl: adoptControl,
      }
      : dshAcks === undefined
        ? piRpc === undefined || piPrompt === undefined
          ? undefined
          : {
            initialFrame: piPrompt.json,
            frame: (text) => piRpc.frame(text),
            settle: (value) => piRpc.settle(value),
            onClose: (reason) => piRpc.abort(reason),
            onControl: (control) => {
              adoptControl(control);
              // pi declines a prompt and then waits for a command that will
              // never come; the refusal arrives on the returned frame, so the
              // only place that can end the child is here.
              piRpc.onPromptRefusal = () => control.windDown();
            },
          }
        : {
          frame: (text) => dshAcks.frame(text),
          onStderr: (line) => dshAcks.accept(line),
          onClose: (reason) => dshAcks.abort(reason),
          onControl: adoptControl,
        };
    // The attempt's resumable identity, announced as soon as it exists and
    // revised when it gets sharper: the transcript path is known before the
    // child starts, while Claude's own session id arrives in its first frame.
    // A turn that is interrupted returns no result and no error to carry a
    // continuation, so waiting for the turn to end would abandon a session the
    // harness has already created.
    let announced: string | undefined;
    const announceContinuation = (): void => {
      const native = accumulator.sessionId;
      const sessionId = native ?? provisionalId;
      if (announced === `${sessionId}|${native ?? ""}`) return;
      announced = `${sessionId}|${native ?? ""}`;
      retryRequest.onContinuation?.({
        harness,
        sessionId,
        ...(native === undefined ? {} : { nativeSessionId: native }),
        transcriptPath,
      });
    };
    announceContinuation();
    const outcome = yield* runChild(sourcePath, argv, retryRequest, (line) => {
      normalizeSubprocessLine(line, harness, emit, accumulator);
      announceContinuation();
      // The turn's terminal frame: the CLI now waits on stdin for a next
      // turn that never comes, so end stdin and bound the exit.
      if (accumulator.turnEnded === true) childControl?.windDown();
    }, environment, stdinBridge, (line) => {
      // The runner's notes are the only thing a dsh run says mid-turn, and
      // a caller steering into the live window has to be able to see that
      // window open. They are reported one line at a time as they arrive;
      // the whole stream still arrives as one event at close, which is what
      // a failure message reads.
      if (line.trim() === "") return;
      emit({ type: "unknown", sourceType: "stderr", data: { stream: "stderr", text: line } });
    }).pipe(
      Effect.ensuring(Effect.gen(function* () {
        yield* Effect.sync(() => unbindSteering?.());
        // Interrupts (timeout, parent cancel) never reach the two explicit
        // finish() calls below, so the tailer is stopped here for every exit
        // path; finish() is memoized, so those calls read the same evidence.
        if (dshTailer !== undefined) yield* dshTailer.finish();
      })),
      Effect.catchAll((cause) => Effect.gen(function* () {
        if (dshTailer !== undefined) yield* dshTailer.finish();
        const error = cause instanceof AgentError ? cause : agentError("harness-unavailable", cause);
        return yield* failAttempt(error);
      })),
    );
    const tailedDshEvidence = dshTailer === undefined
      ? undefined
      : yield* dshTailer.finish();
    let dshEvidence: DshSessionEvidence | undefined = tailedDshEvidence;
    if (harness === "dsh" && dshEvidence === undefined) {
      // A native session may be absent when a dsh process is interrupted before
      // its checkpoint flush. Preserve the child outcome and stdout/stderr
      // evidence rather than fabricating a session id.
      dshEvidence = yield* readDshSessionEvidence(dshHome, retryRequest.cwd, startedAt, dshResumeId);
    }
    // A non-zero exit is a failure — except the SIGTERM our own post-`result`
    // wind-down sends when the CLI lingers after stdin EOF. That closure is
    // the expected end of a streaming-input session.
    const childFailed = (outcome.code !== 0 && outcome.gracefulShutdown !== true)
      || outcome.spawnError !== undefined
      || outcome.aborted
      // pi RPC exits 0 even when the child declined the prompt: the refusal
      // rides the response frame (`success:false`), and pi's stdin loop stays
      // alive afterwards, so the wind-down above is what closes the process.
      // Treat that refusal as the failure it is rather than letting an
      // acknowledged rejection resolve as a completed turn. A refused mid-turn
      // steer is deliberately not included — it belongs to its own caller.
      || piRpc?.promptRefusal !== undefined;
    if (dshEvidence !== undefined) accumulator.sessionId ??= dshEvidence.sessionId;
    const dshText = harness === "dsh" ? stripProxyDiagnostic(plainOutput(outcome.rawLines)) : "";
    if (dshMapper !== undefined && dshEvidence !== undefined) {
      for (const event of dshEvidence.events) {
        if (event.type !== "session") dshMapper.process(event);
      }
    }
    const nativeDshEvents = dshMapper?.finish(dshText) ?? false;
    if (harness === "dsh" && dshText !== "" && !nativeDshEvents) emitMessageEnd({ role: "assistant", content: dshText }, accumulator, emit);
    if (outcome.stderr.trim() !== "") emit({ type: "unknown", sourceType: "stderr", data: { stream: "stderr", text: outcome.stderr.trim() } });
    // A resumed dsh actor must come back to its own conversation, and the
    // transcript is where that commitment becomes visible. With no session to
    // read, the only content this turn has is the child's raw stdout — which the
    // evidence analyzer rejects as malformed records, so the run would report
    // that symptom instead of the cause. Name the defect instead: this turn has
    // no transcript of its own, so none is written.
    //
    // Only a request that named a conversation is held to this. An attempt that
    // was never asked to continue may legitimately map nothing (an interrupted
    // attempt, a foreign CLI build) — that is why the raw join exists at all.
    // An interrupt and a spawn that never happened keep their own error and
    // their own retry: neither left a conversation to miss.
    if (harness === "dsh" && dshResumeId !== undefined && dshEvidence === undefined
      && !outcome.aborted && outcome.spawnError === undefined) {
      const child = childFailed ? `: ${subprocessError(harness, outcome, sourcePath).message}` : "";
      const error = new AgentError({
        kind: "transcript-missing",
        message: `the resumed dsh session ${dshResumeId} could not be read back under `
          + `${dshHome}/sessions, so this turn has no transcript of its own${child}`,
      });
      // The actor keeps its identity, so a stage that retries returns to the
      // same conversation and fails the same way rather than silently starting
      // over with none of its memory.
      return yield* failAttempt(error, {
        harness,
        sessionId: provisionalId,
        nativeSessionId: dshResumeId,
        transcriptPath,
      });
    }
    // The transcript is the harness's audit trail in the canonical message
    // dialect (see canonical-transcript.ts) — the record the analyzers and any
    // later reader work from. claude resumes by native session id and dsh from
    // its own stored session, so neither reads this file back.
    //
    // pi/pi-cli are the exception twice over: they resume through `--session`,
    // which points at pi's own session file, and pi writes that file itself. An
    // earlier version pointed `--session` at Piano's transcript and then appended
    // the converted stdout to it, which put two authors on one file: pi's own
    // entries plus Piano's copy of them, a second header, and a new root — and
    // the next resume rebuilt its context from the wrong leaf and lost history.
    // So the two files are now separate: pi keeps its session, and Piano's audit
    // trail is written beside it.
    const auditPath = piRpc === undefined
      ? transcriptPath
      : `${transcriptPath.replace(/\.jsonl$/, "")}.audit.jsonl`;
    const transcript = canonicalTranscriptText(
      harness,
      outcome.rawLines,
      dshEvidence?.events ?? [],
      retryRequest.prompt,
    );
    // dsh is the one harness whose payload repeats what is already stored: a
    // resumed session replays its whole event list, so its transcript is a
    // snapshot of the conversation rather than this turn's delta. Folding it in
    // keeps the file equal to that conversation, and makes the write idempotent
    // — a retried turn, or a replayed prefix, converges instead of stacking
    // another copy (which is how a ten-turn actor reached 84% repeats).
    // claude appends its per-turn payload; pi/pi-cli are not written here at all
    // beyond their audit file, because their session is pi's to own.
    const transcriptIsSnapshot = harness === "dsh";
    const writeTranscript = (path: string, text: string): Effect.Effect<void, AgentError> =>
      io.writeFile(path, text).pipe(Effect.mapError((cause) => agentError("session-artifact", cause)));
    // io has no append adapter, so an append is the read of the file this
    // attempt continues plus the write of the concatenation. A missing file
    // appends to nothing; any other unreadable file keeps its failure.
    const appendTranscript = (path: string, text: string): Effect.Effect<void, AgentError> =>
      io.appendText(path, text).pipe(
        Effect.mapError((cause) => agentError("session-artifact", cause)),
      );
    yield* Effect.gen(function* () {
      if (retryRequest.continuation === undefined) {
        yield* writeTranscript(auditPath, transcript);
        return;
      }
      if (!transcriptIsSnapshot) {
        yield* appendTranscript(auditPath, transcript);
        return;
      }
      // A transcript that is gone (or never written) folds in as empty, so the
      // attempt still records everything it has.
      const stored = yield* io.readText(auditPath).pipe(
        Effect.catchAll(() => Effect.succeed("")),
      );
      const merged = mergeCanonicalTranscript(stored, transcript);
      if (merged !== stored) {
        yield* writeTranscript(auditPath, merged);
      }
    }).pipe(Effect.tapError((error) => Effect.sync(() => emit({ type: "error", errorType: error.kind, message: error.message }))));
    // The file a retry reopens: for pi/pi-cli that is pi's own session — the
    // one argv named — not the audit trail, which pi never wrote and could not
    // continue from. `piSessionPath` is a fixed point for continuations, so a
    // retry that also fails stashes the same path again.
    const continuationTranscriptPath = harness === "pi" || harness === "pi-cli"
      ? piSessionPath(retryRequest, transcriptPath)
      : transcriptPath;
    if (childFailed) {
      const refusal = piRpc?.promptRefusal;
      const error = refusal !== undefined
        // The refusal reason pi gave is the diagnostic the caller needs — the
        // child's exit code carries no information about it.
        ? refusal
        : subprocessError(harness, outcome, sourcePath);
      // Stash the attempt's session identity so the shared retry boundary
      // reopens this transcript instead of starting a new session. The native
      // handle is what this attempt actually observed — or what it inherited
      // when it died before announcing one — never the fabricated logical id,
      // which no harness can resolve.
      const native = accumulator.sessionId ?? retryRequest.continuation?.nativeSessionId;
      return yield* failAttempt(error, {
        harness,
        sessionId: provisionalId,
        ...(native === undefined ? {} : { nativeSessionId: native }),
        transcriptPath: continuationTranscriptPath,
      });
    }
    // The headless dsh runner always mints a new native id. For a continued
    // Piano actor, preserve the actor's logical child id rather than replacing
    // it with that unrelated epoch id; the native id remains in the evidence.
    const sessionId = harness === "dsh" && retryRequest.continuation !== undefined
      ? retryRequest.continuation.sessionId
      : accumulator.sessionId ?? provisionalId;
    const result: AgentResult = {
      sessionId,
      // What the evidence analyzers read: for pi/pi-cli that is the audit trail
      // Piano wrote, since pi's session file keeps pi's own entry shapes.
      transcriptPath: auditPath,
      text: accumulator.text,
      ...(config.model === undefined ? {} : { model: config.model }),
      ...(thinking === undefined ? {} : { thinkingLevel: thinking }),
      continuation: {
        harness,
        sessionId,
        // The harness's own handle, distinct from Piano's logical id whenever
        // the two diverge (a continued dsh actor keeps its logical id while
        // the headless runner mints a fresh native one per epoch).
        ...(accumulator.sessionId === undefined ? {} : { nativeSessionId: accumulator.sessionId }),
        // The file the *harness* reopens (same rule as the failure path).
        transcriptPath: continuationTranscriptPath,
      } satisfies AgentContinuation,
    };
    emit({ type: "done", exitStatus: 0, sessionId, transcriptPath: auditPath });
    yield* persistAgentEvents(observed, sessionId);
    return { result };
    }),
    (discuss) => discuss === undefined
      ? Effect.void
      : discuss.close().pipe(Effect.catchAll(() => Effect.void)),
  );
}
