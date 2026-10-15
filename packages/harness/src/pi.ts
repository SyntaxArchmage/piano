import { Cause, Effect, Exit, Option } from "effect";
import { FileSystem } from "@effect/platform";
import {
  failureDetails,
  isCancellation,
  logger,
  TRACE,
  type Logging,
  type ObservabilityError,
  type Source,
} from "@piano/logging";
import { homedir } from "node:os";
import { join } from "node:path";
import { AgentError, agentError } from "./errors.js";
import type { AgentRequest, AgentResult } from "./agent-contract.js";
import { buildCustomTools } from "./pi-tools.js";
import {
  loadSdk,
  type PiHarnessOptions,
  type PiModelRuntime,
  type PiSession,
} from "./pi-sdk.js";
export const defaultPiConfigPath = defaultAgentConfigPath;
import { eventMetadata } from "./event-metadata.js";
import { asRecord, stringOr } from "./json-narrowing.js";
import { accumulateStreamedText, normalizePortableEvent, usageFromFields } from "./portable-events.js";
import { agentConfigPath, defaultAgentConfigPath, resolveHarnessConfig, type ResolvedHarnessConfig } from "./harness-config.js";
import { PI_WEB_SEARCH_TOOL_NAME, webSearchExtensionFactory } from "./pi-web-search.js";
import {
  AGENT_RETRY_DELAYS_MS,
  withAgentRetries,
  withFailedContinuation,
  type AgentRetryAttempt,
  type AgentRetryOutcome,
} from "./retry.js";
import {
  asAgentMessageEvent,
  asAgentMessage,
  shouldPersistAgentEvent,
  messageText,
  THINKING_LEVELS,
  type AgentEvent,
  type AgentMessage,
  type AgentResourceInfo,
  type AgentResourceKind,
  type AgentUsage,
  type ThinkingLevel,
} from "./events.js";

interface PiSessionEvent {
  readonly type?: unknown;
  readonly message?: unknown;
  readonly usage?: unknown;
  readonly messages?: unknown;
  readonly willRetry?: unknown;
  readonly assistantMessageEvent?: unknown;
  readonly steering?: unknown;
  readonly followUp?: unknown;
  readonly reason?: unknown;
  readonly entry?: unknown;
  readonly name?: unknown;
  readonly level?: unknown;
  readonly result?: unknown;
  readonly aborted?: unknown;
  readonly success?: unknown;
  readonly finalError?: unknown;
  readonly attempt?: unknown;
  readonly maxAttempts?: unknown;
  readonly delayMs?: unknown;
  readonly errorMessage?: unknown;
  readonly source?: unknown;
  readonly id?: unknown;
  readonly delta?: unknown;
  readonly toolName?: unknown;
  readonly toolCallId?: unknown;
  readonly args?: unknown;
  readonly partialResult?: unknown;
  readonly isError?: unknown;
}


/** In-session API request retries owned by the Pi SDK itself. Hardcoded
 * reliability floor (issue #45): a stage must survive provider-side storms
 * without surfacing a terminal AgentError. */
const SDK_API_MAX_RETRIES = 10;
const AGENT_SOURCE: Source = { module: "harness", file: "pi.ts", function: "executeAgent" };
const LOAD_SOURCE: Source = { module: "harness", file: "pi.ts", function: "loadSdk" };
const RUNTIME_SOURCE: Source = { module: "harness", file: "pi.ts", function: "createModelRuntime" };
const MODEL_SOURCE: Source = { module: "harness", file: "pi.ts", function: "resolveModel" };
const RESOURCE_SOURCE: Source = { module: "harness", file: "pi.ts", function: "createResourceLoader" };
const RELOAD_SOURCE: Source = { module: "harness", file: "pi.ts", function: "reloadResourceLoader" };
const CONTEXT_FILE_SOURCE: Source = { module: "harness", file: "pi.ts", function: "loadContextFile" };
const SKILL_SOURCE: Source = { module: "harness", file: "pi.ts", function: "loadSkill" };
const RESOURCE_LOAD_SOURCE: Source = { module: "harness", file: "pi.ts", function: "loadAgentResources" };
const SESSION_SOURCE: Source = { module: "harness", file: "pi.ts", function: "createAgentSession" };
const SUBSCRIBE_SOURCE: Source = { module: "harness", file: "pi.ts", function: "subscribeSessionEvents" };
const PROMPT_SOURCE: Source = { module: "harness", file: "pi.ts", function: "sendPrompt" };
const AGENT_LOG = logger(AGENT_SOURCE, { namespace: "harness" });
const TURN_LOG = logger(PROMPT_SOURCE, { namespace: "harness" });
const RESOURCE_LOG = logger(RESOURCE_LOAD_SOURCE, { namespace: "harness" });

interface TextResource {
  readonly path: string;
  readonly content: string;
}

function resourceError(kind: AgentResourceKind, path: string, cause: unknown): AgentError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new AgentError({
    kind: "resource-unavailable",
    message: `${kind} resource could not be loaded from ${path}: ${detail}`,
    cause,
  });
}

function resourceEvent(
  request: AgentRequest,
  resource: AgentResourceInfo,
): void {
  request.onEvent?.({ type: "resource", resource });
}

function logAgentEvent(
  event: AgentEvent,
  sessionId: string,
): Effect.Effect<void, never, Logging | FileSystem.FileSystem> {
  return AGENT_LOG.with({ instance: sessionId }).debug("agent.event.received", {
    data: { sessionId, ...eventMetadata(event) },
  }).pipe(Effect.catchAll(() => Effect.void));
}

function requireSessionArtifact(
  session: PiSession,
): Effect.Effect<{ readonly sessionId: string; readonly transcriptPath: string }, AgentError> {
  if (typeof session.sessionId !== "string" || session.sessionId.trim() === "") {
    return Effect.fail(new AgentError({
      kind: "session-artifact",
      message: "Pi SDK returned an empty session id",
    }));
  }
  if (typeof session.sessionFile !== "string" || session.sessionFile.trim() === "") {
    return Effect.fail(new AgentError({
      kind: "session-artifact",
      message: `Pi SDK session ${session.sessionId} has no persistent transcript file`,
    }));
  }
  return Effect.succeed({ sessionId: session.sessionId, transcriptPath: session.sessionFile });
}

function loadTextResources(
  request: AgentRequest,
  kind: "context-file" | "skill",
  paths: readonly string[],
): Effect.Effect<readonly TextResource[], AgentError, FileSystem.FileSystem | Logging> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const source = kind === "skill" ? SKILL_SOURCE : CONTEXT_FILE_SOURCE;
    return yield* Effect.forEach(paths, (path) => TRACE(
      source,
      fileSystem.readFileString(path).pipe(
        Effect.map((content) => ({ path, content })),
        Effect.mapError((cause) => resourceError(kind, path, cause)),
        Effect.tapError((error) => Effect.sync(() => resourceEvent(request, {
          kind,
          status: "failed",
          source: "workflow",
          path,
          error: error.message,
        }))),
      ),
      { path },
    ));
  }).pipe(Effect.mapError((cause) => cause instanceof AgentError ? cause : agentError("unknown", cause)));
}

/** Read a skill's content. A skill path may be either a directory (Agent Skills
 * spec: `skills/<name>/SKILL.md`) or a flat markdown file. The returned `path`
 * stays the directory/file path handed to the SDK (`additionalSkillPaths`), so
 * the downstream `getSkills()` verification matches; `content` is read from the
 * `SKILL.md` inside a directory. */
function loadSkillResources(
  request: AgentRequest,
  skillPaths: readonly string[],
): Effect.Effect<readonly TextResource[], AgentError, FileSystem.FileSystem | Logging> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* Effect.forEach(skillPaths, (skillPath) => TRACE(
      SKILL_SOURCE,
      fileSystem.stat(skillPath).pipe(
        Effect.flatMap((stats) => {
          const filePath = stats.type === "Directory" ? join(skillPath, "SKILL.md") : skillPath;
          return fileSystem.readFileString(filePath).pipe(
            Effect.map((content) => ({ path: skillPath, content })),
          );
        }),
        Effect.mapError((cause) => resourceError("skill", skillPath, cause)),
        Effect.tapError((error) => Effect.sync(() => resourceEvent(request, {
          kind: "skill",
          status: "failed",
          source: "workflow",
          path: skillPath,
          error: error.message,
        }))),
      ),
      { path: skillPath },
    ));
  }).pipe(Effect.mapError((cause) => cause instanceof AgentError ? cause : agentError("unknown", cause)));
}

function providerForModel(runtime: PiModelRuntime, modelId: string): string | undefined {
  const providers = new Set(
    (runtime.getModels?.() ?? []).flatMap((model) => {
      if (typeof model !== "object" || model === null) return [];
      const value = model as { readonly id?: unknown; readonly provider?: unknown };
      return value.id === modelId && typeof value.provider === "string" && value.provider.trim() !== ""
        ? [value.provider]
        : [];
    }),
  );
  return providers.size === 1 ? [...providers][0] : undefined;
}


function configuredThinkingLevel(value: unknown): ThinkingLevel | undefined {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value)
    ? value as ThinkingLevel
    : undefined;
}

interface TurnAccumulator {
  text: string;
  error?: AgentError;
  /** Stop reason of the most recent assistant message. Used to detect a turn
   * that settled with a truncated (output-token-limit) final message. */
  lastStopReason?: string;
}

/** Stop reasons that mean the assistant turn was truncated by the model's
 * output limit instead of finishing naturally. */
function isTruncatedStopReason(stopReason: unknown): boolean {
  return stopReason === "length" || stopReason === "max_tokens";
}

function messageFailure(message: AgentMessage, attribution?: string): AgentError | undefined {
  if (message === undefined || (message.role !== undefined && message.role !== "assistant")) return undefined;
  if (message.stopReason === "aborted") {
    return new AgentError({
      kind: "cancelled",
      message: typeof message.errorMessage === "string" && message.errorMessage !== ""
        ? message.errorMessage
        : "pi request cancelled",
    });
  }
  if (message.stopReason === "error" || typeof message.errorMessage === "string") {
    const text = typeof message.errorMessage === "string" && message.errorMessage !== ""
      ? message.errorMessage
      : "pi assistant message ended with an error";
    // SDK error text is classified on the raw text; bare HTTP status lines
    // (e.g. "502 status code (no body)") get the model and endpoint named so
    // the report attributes to the provider side rather than reading like a
    // Piano failure. Prose errors ("Connection error") are already attributed.
    const status = /\b([45]\d{2}) status code/.exec(text)?.[1];
    const detailed = attribution === undefined || status === undefined
      ? text
      : `${text} [${attribution}]`;
    if (/rate[-_ ]limit|429|too many requests|quota/i.test(text)) {
      return agentError("rate-limit", detailed);
    }
    if (/time[-_ ]?out|timed out|deadline/i.test(text)) {
      return agentError("timeout", detailed);
    }
    if (status !== undefined) {
      const code = Number(status);
      if (code === 401 || code === 403) {
        return agentError("authentication", `${detailed}: the endpoint rejected the credential`);
      }
      if (code === 429) {
        return agentError("rate-limit", detailed);
      }
      if (code === 408 || code >= 500) {
        return agentError("harness-unavailable", `${detailed}: the endpoint is unavailable; Piano will retry`);
      }
    }
    return agentError("request-rejected", detailed);
  }
  return undefined;
}

function isAssistantMessage(message: AgentMessage): boolean {
  return message.role === undefined || message.role === "assistant";
}

function extractUsage(value: unknown): AgentUsage | undefined {
  const usage = asRecord(value);
  return usage === undefined ? undefined : usageFromFields(usage);
}

function bindEvents(
  request: AgentRequest,
  accumulator: TurnAccumulator,
  attribution?: string,
): (event: unknown) => void {
  return (raw) => {
    const record = typeof raw === "object" && raw !== null
      ? raw as Record<string, unknown>
      : undefined;
    const event = (record ?? { type: undefined }) as PiSessionEvent;
    const type = typeof event.type === "string" ? event.type : undefined;
    const emit = (value: AgentEvent): void => request.onEvent?.(value);
    // The dozen events every dialect spells identically are normalized once,
    // for all of them (see portableEvents.ts).
    const portable = record === undefined ? undefined : normalizePortableEvent(record);
    if (portable !== undefined) {
      emit(portable);
      return;
    }
    switch (type) {
      case "agent_start":
        emit({ type: "agent_start" });
        return;
      case "agent_end":
        emit({
          type: "agent_end",
          messages: Array.isArray(event.messages) ? event.messages.map(asAgentMessage) : [],
          willRetry: event.willRetry === true,
        });
        return;
      case "agent_settled":
        emit({ type: "agent_settled" });
        return;
      case "turn_start":
        emit({ type: "turn_start" });
        return;
      case "turn_end": {
        const message = asAgentMessage(event.message);
        const toolResults = Array.isArray((event as { toolResults?: unknown }).toolResults)
          ? ((event as { toolResults: unknown[] }).toolResults).map(asAgentMessage)
          : [];
        emit({ type: "turn_end", message, toolResults });
        return;
      }
      case "message_start":
        if (isAssistantMessage(asAgentMessage(event.message))) accumulator.text = "";
        emit({ type: "message_start", message: asAgentMessage(event.message) });
        return;
      case "message_update": {
        const message = asAgentMessage(event.message);
        const assistantMessageEvent = asAgentMessageEvent(event.assistantMessageEvent);
        accumulator.text = accumulateStreamedText(accumulator.text, message, assistantMessageEvent);
        // Deltas carry only text; `usage` is emitted once at `message_end` from
        // the finalized message's cumulative
        // counters. Emitting it here would flood a zero-valued `usage` row per
        // token delta (ISSUE-010/011/012) and churn the live chat stream.
        emit({ type: "message_update", message, assistantMessageEvent });
        return;
      }
      case "message_end": {
        const message = asAgentMessage(event.message);
        if (isAssistantMessage(message)) {
          const text = messageText(message);
          if (text !== undefined) accumulator.text = text;
          accumulator.lastStopReason = typeof message.stopReason === "string" ? message.stopReason : undefined;
        }
        emit({ type: "message_end", message });
        const usage = extractUsage(event.usage) ?? extractUsage(message.usage);
        if (usage !== undefined) emit({ type: "usage", usage });
        const failure = messageFailure(message, attribution);
        if (failure !== undefined) {
          accumulator.error = failure;
          emit({ type: "error", errorType: failure.kind, message: failure.message });
        }
        return;
      }
      case "tool_execution_start":
        emit({
          type: "tool_execution_start",
          toolCallId: stringOr(event.toolCallId, "unknown"),
          toolName: stringOr(event.toolName, "unknown"),
          args: event.args,
        });
        return;
      case "tool_execution_update":
        emit({
          type: "tool_execution_update",
          toolCallId: stringOr(event.toolCallId, "unknown"),
          toolName: stringOr(event.toolName, "unknown"),
          args: event.args,
          partialResult: event.partialResult,
        });
        return;
      case "tool_execution_end":
        emit({
          type: "tool_execution_end",
          toolCallId: stringOr(event.toolCallId, "unknown"),
          toolName: stringOr(event.toolName, "unknown"),
          result: event.result,
          isError: event.isError === true,
        });
        return;
      default:
        emit({ type: "unknown", sourceType: type ?? "unknown", data: raw });
    }
  };
}

function sendPrompt(
  request: AgentRequest,
  session: PiSession,
  accumulator: TurnAccumulator,
): Effect.Effect<void, AgentError> {
  return Effect.async<void, AgentError>((resume) => {
    let settled = false;
    const abortSession = Effect.tryPromise({
      try: () => session.abort(),
      catch: () => undefined,
    }).pipe(Effect.catchAll(() => Effect.void));
    const removeAbortListener = (): void => {
      request.signal?.removeEventListener("abort", onAbort);
    };
    const complete = (result: Effect.Effect<void, AgentError>): void => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      resume(result);
    };
    const onAbort = (): void => {
      if (settled) return;
      complete(abortSession.pipe(
        Effect.andThen(Effect.fail(new AgentError({ kind: "cancelled", message: "pi request cancelled" }))),
      ));
    };

    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted) {
      onAbort();
    } else {
      try {
        session.prompt(request.prompt).then(
          () => complete(
            accumulator.error !== undefined
              ? Effect.fail(accumulator.error)
              : isTruncatedStopReason(accumulator.lastStopReason)
                ? Effect.fail(agentError("max-tokens", "assistant output was truncated by the model's output token limit"))
                : Effect.succeed(undefined),
          ),
          (cause) => complete(Effect.fail(agentError("request-rejected", cause))),
        );
      } catch (cause) {
        complete(Effect.fail(agentError("request-rejected", cause)));
      }
    }

    return Effect.gen(function* () {
      removeAbortListener();
      if (!settled) yield* abortSession;
    });
  });
}

function failureFromExit(cause: Cause.Cause<AgentError | ObservabilityError>): AgentError {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure) && failure.value instanceof AgentError) return failure.value;
  if (isCancellation(cause)) {
    return new AgentError({ kind: "cancelled", message: "pi request cancelled", cause });
  }
  const details = failureDetails(cause);
  return new AgentError({ kind: "unknown", message: details.message, cause });
}

export function executeAgent(
  request: AgentRequest,
  options: PiHarnessOptions = {},
): Effect.Effect<AgentResult, AgentError, Logging | FileSystem.FileSystem> {
  return TRACE(AGENT_SOURCE, withAgentRetries(
    (attempt) => runPiAttempt(request, options, attempt),
    options.retryDelaysMs ?? AGENT_RETRY_DELAYS_MS,
    request.signal,
    (notice) => request.onEvent?.({ type: "retry", ...notice }),
  )).pipe(
    Effect.map((outcome) => outcome.result),
  );
}

/** One pi adapter attempt inside the shared retry boundary. Per-attempt state
 * (event aggregation, failure reporting, session lifecycle) is created fresh
 * here so a retry observes a clean world while continuing the same session
 * through `attempt.continuation`. */
function runPiAttempt(
  request: AgentRequest,
  options: PiHarnessOptions,
  attempt: AgentRetryAttempt,
): Effect.Effect<AgentRetryOutcome, AgentError, Logging | FileSystem.FileSystem> {
  let turnStarted = false;
  let failureEventReported = false;
  const observedEvents: AgentEvent[] = [];
  const retryRequest: AgentRequest = attempt.continuation === undefined
    ? request
    : { ...request, continuation: attempt.continuation };
  const eventRequest: AgentRequest = {
    ...retryRequest,
    onEvent: (event) => {
      if (event.type === "error") failureEventReported = true;
      if (shouldPersistAgentEvent(event)) observedEvents.push(event);
      retryRequest.onEvent?.(event);
    },
  };
  const reportFailure = (error: AgentError): void => {
    if (failureEventReported) return;
    failureEventReported = true;
    eventRequest.onEvent?.({ type: "error", errorType: error.kind, message: error.message });
  };
  // Session identity for this attempt. Known only after the session is
  // created; failures before that point carry no continuation and retry from
  // scratch. Captured in a mutable cell so the terminal mapError below can
  // stash it on the error for the shared retry boundary.
  let attemptArtifact: { readonly sessionId: string; readonly transcriptPath: string } | undefined;
  return Effect.gen(function* () {
    if (retryRequest.signal?.aborted) return yield* Effect.fail(new AgentError({ kind: "cancelled", message: "pi request cancelled" }));
    if (retryRequest.sessionDir !== undefined) {
      const fileSystem = yield* FileSystem.FileSystem;
      yield* fileSystem.makeDirectory(retryRequest.sessionDir, { recursive: true }).pipe(
        Effect.mapError((cause) => agentError("request-rejected", cause)),
      );
    }
    const sdk = yield* TRACE(LOAD_SOURCE, loadSdk(options), {
      injected: options.sdk !== undefined,
    });
    const usePianoConfig = options.usePianoConfig !== false;
    // The same one-resolution path `doctor`, the generated model registry, and
    // the subprocess adapters use. Reading `agent.config.json` a second time
    // here is how the SDK adapter could silently disagree with the registry it
    // was handed, so this path shares the central resolver instead.
    const overrides: ResolvedHarnessConfig = {
      ...(request.provider ?? options.provider) === undefined ? {} : { provider: request.provider ?? options.provider },
      ...(request.model ?? options.model) === undefined ? {} : { model: request.model ?? options.model },
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      ...(request.thinkingLevel ?? options.thinkingLevel) === undefined ? {} : { thinkingLevel: request.thinkingLevel ?? options.thinkingLevel },
    };
    const config: ResolvedHarnessConfig = usePianoConfig ? resolveHarnessConfig("pi", overrides) : overrides;
    const agentDir = options.agentDir ?? join(homedir(), ".pi", "agent");
    const configuredProvider = config.provider;
    const modelId = config.model;
    const requestedThinkingLevel = config.thinkingLevel;
    if (request.thinkingLevel !== undefined && configuredThinkingLevel(request.thinkingLevel) === undefined) {
      return yield* Effect.fail(new AgentError({
        kind: "resource-unavailable",
        message: `unsupported thinking level "${String(request.thinkingLevel)}" (supported: ${THINKING_LEVELS.join(", ")})`,
      }));
    }
    if (modelId === undefined) {
      return yield* Effect.fail(new AgentError({
        kind: "configuration",
        message: usePianoConfig
          ? "model is not configured; set stage.model, PIANO_PI_MODEL, or model in ~/.piano/agent.config.json"
          : "model is not configured; pass a model id for Pi SDK resolution",
      }));
    }
    const runtime = yield* TRACE(RUNTIME_SOURCE, Effect.tryPromise({
      try: () => sdk.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") }),
      catch: (cause) => agentError("authentication", cause),
    }));
    const provider = configuredProvider ?? providerForModel(runtime, modelId);
    if (provider === undefined) {
      return yield* Effect.fail(new AgentError({
        kind: "configuration",
        message: usePianoConfig
          ? "model provider is not configured; set PIANO_PI_PROVIDER or provider in ~/.piano/agent.config.json"
          : `Pi SDK could not resolve a provider for model ${modelId}`,
      }));
    }
    const apiKey = config.apiKey;
    // Endpoint for failure attribution; the resolved config carries the same
    // resolution the model registry was generated from, so the two cannot
    // disagree about where the request went.
    const endpoint = usePianoConfig ? config.baseUrl : undefined;
    if (apiKey !== undefined) {
      yield* TRACE(
        { ...RUNTIME_SOURCE, function: "setRuntimeApiKey" },
        Effect.tryPromise({ try: () => runtime.setRuntimeApiKey(provider, apiKey), catch: (cause) => agentError("authentication", cause) }),
        { provider },
      );
    }
    if (request.tools?.includes(PI_WEB_SEARCH_TOOL_NAME) === true
      && (endpoint === undefined || apiKey === undefined)) {
      return yield* Effect.fail(new AgentError({
        kind: "configuration",
        message: `web_search needs the endpoint and API key from ${agentConfigPath()} `
          + "(the search runs against the same gateway route as chat)",
      }));
    }
    const model = yield* TRACE(MODEL_SOURCE, Effect.gen(function* () {
      const value = yield* Effect.try({
        try: () => runtime.getModel(provider, modelId),
        catch: (cause) => agentError("request-rejected", cause),
      });
      if (value === undefined) return yield* Effect.fail(new AgentError({ kind: "model-not-found", message: `model not found: ${provider}/${modelId}` }));
      return value;
    }), { provider, model: modelId });
    const contextFilePaths = request.contextFilePaths ?? [];
    const skillPaths = request.skillPaths ?? [];
    const systemPromptSource = request.systemPromptPath === undefined ? "sdk-default" : "workflow";
    resourceEvent(eventRequest, {
      kind: "system-prompt",
      status: "requested",
      source: systemPromptSource,
      ...(request.systemPromptPath === undefined ? {} : { path: request.systemPromptPath }),
    });
    yield* RESOURCE_LOG.info("agent.resource.requested", {
      data: {
        kind: "system-prompt",
        source: systemPromptSource,
        ...(request.systemPromptPath === undefined ? {} : { path: request.systemPromptPath }),
      },
    });
    for (const path of contextFilePaths) {
      resourceEvent(eventRequest, { kind: "context-file", status: "requested", source: "workflow", path });
      yield* RESOURCE_LOG.info("agent.resource.requested", {
        data: { kind: "context-file", source: "workflow", path },
      });
    }
    for (const path of skillPaths) {
      resourceEvent(eventRequest, { kind: "skill", status: "requested", source: "workflow", path });
      yield* RESOURCE_LOG.info("agent.resource.requested", {
        data: { kind: "skill", source: "workflow", path },
      });
    }
    const contextFiles = yield* TRACE(
      RESOURCE_LOAD_SOURCE,
      loadTextResources(eventRequest, "context-file", contextFilePaths),
      { contextFilePaths },
    ).pipe(
      Effect.tapError((error) => RESOURCE_LOG.error("agent.resource.failed", {
        outcome: "failure",
        data: { kind: "context-file", paths: contextFilePaths, error: failureDetails(error) },
      })),
    );
    const skillFiles = yield* TRACE(
      RESOURCE_LOAD_SOURCE,
      loadSkillResources(eventRequest, skillPaths),
      { skillPaths },
    ).pipe(
      Effect.tapError((error) => RESOURCE_LOG.error("agent.resource.failed", {
        outcome: "failure",
        data: { kind: "skill", paths: skillPaths, error: failureDetails(error) },
      })),
    );
    const skillInstructions = skillFiles.map(({ path, content }) =>
      `<workflow_skill path="${path}">\n${content}\n</workflow_skill>`,
    );
    const resourceLoader = yield* TRACE(RESOURCE_SOURCE, Effect.try({
      try: () => new sdk.DefaultResourceLoader({
        cwd: request.cwd,
        agentDir,
        settingsManager: sdk.SettingsManager.inMemory({ retry: { enabled: true, maxRetries: SDK_API_MAX_RETRIES } }),
        noExtensions: true,
        ...(request.tools?.includes(PI_WEB_SEARCH_TOOL_NAME) === true
          ? { extensionFactories: [webSearchExtensionFactory({ baseUrl: endpoint, apiKey, model: modelId })] }
          : {}),
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        noContextFiles: true,
        additionalSkillPaths: skillPaths,
        agentsFilesOverride: () => ({ agentsFiles: [...contextFiles] }),
        ...(request.systemPromptPath === undefined ? {} : { systemPrompt: request.systemPromptPath }),
        ...(skillInstructions.length === 0 ? {} : { appendSystemPrompt: skillInstructions }),
      }),
      catch: (cause) => agentError("request-rejected", cause),
    }));
    yield* TRACE(
      RELOAD_SOURCE,
      Effect.tryPromise({ try: () => resourceLoader.reload(), catch: (cause) => agentError("request-rejected", cause) }),
      { systemPromptPath: request.systemPromptPath, contextFilePaths, skillPaths },
    ).pipe(
      Effect.tapError((error) => RESOURCE_LOG.error("agent.resource.failed", {
        outcome: "failure",
        data: {
          kind: "sdk-resource-loader",
          ...(request.systemPromptPath === undefined ? {} : { systemPromptPath: request.systemPromptPath }),
          contextFilePaths,
          skillPaths,
          error: failureDetails(error),
        },
      })),
    );
    const loadedSystemPrompt = resourceLoader.getSystemPrompt?.();
    const loadedSystemPromptPath = resourceLoader.getSystemPromptSource?.()?.path ?? request.systemPromptPath;
    if (request.systemPromptPath !== undefined && resourceLoader.getSystemPrompt !== undefined && loadedSystemPrompt === undefined) {
      const error = resourceError("system-prompt", request.systemPromptPath, "SDK returned no system prompt");
      resourceEvent(eventRequest, {
        kind: "system-prompt",
        status: "failed",
        source: "workflow",
        path: request.systemPromptPath,
        error: error.message,
      });
      yield* RESOURCE_LOG.error("agent.resource.failed", {
        outcome: "failure",
        data: { kind: "system-prompt", path: request.systemPromptPath, error: failureDetails(error) },
      });
      return yield* Effect.fail(error);
    }
    resourceEvent(eventRequest, {
      kind: "system-prompt",
      status: "loaded",
      source: systemPromptSource,
      ...(loadedSystemPromptPath === undefined ? {} : { path: loadedSystemPromptPath }),
      ...(loadedSystemPrompt === undefined ? {} : { bytes: Buffer.byteLength(loadedSystemPrompt, "utf8") }),
    });
    yield* RESOURCE_LOG.info("agent.resource.loaded", {
      data: {
        kind: "system-prompt",
        source: systemPromptSource,
        ...(loadedSystemPromptPath === undefined ? {} : { path: loadedSystemPromptPath }),
        ...(loadedSystemPrompt === undefined ? {} : { bytes: Buffer.byteLength(loadedSystemPrompt, "utf8") }),
      },
    });
    const loadedContextFiles = resourceLoader.getAgentsFiles?.()?.agentsFiles;
    if (loadedContextFiles !== undefined && loadedContextFiles.length !== contextFiles.length) {
      const error = new AgentError({
        kind: "resource-unavailable",
        message: `SDK loaded ${loadedContextFiles.length} context files, expected ${contextFiles.length}`,
      });
      for (const path of contextFilePaths) {
        resourceEvent(eventRequest, {
          kind: "context-file",
          status: "failed",
          source: "workflow",
          path,
          error: error.message,
        });
      }
      yield* RESOURCE_LOG.error("agent.resource.failed", {
        outcome: "failure",
        data: { kind: "context-file", paths: contextFilePaths, error: failureDetails(error) },
      });
      return yield* Effect.fail(error);
    }
    for (const file of loadedContextFiles ?? contextFiles) {
      resourceEvent(eventRequest, {
        kind: "context-file",
        status: "loaded",
        source: "workflow",
        path: file.path,
        bytes: Buffer.byteLength(file.content, "utf8"),
      });
      yield* RESOURCE_LOG.info("agent.resource.loaded", {
        data: {
          kind: "context-file",
          source: "workflow",
          path: file.path,
          bytes: Buffer.byteLength(file.content, "utf8"),
        },
      });
    }
    const loadedSkills = resourceLoader.getSkills?.()?.skills;
    for (const path of skillPaths) {
      const skill = loadedSkills?.find((item) => item.filePath === path || item.filePath?.startsWith(`${path}/`));
      if (loadedSkills !== undefined && skill === undefined) {
        const error = resourceError("skill", path, "SDK did not report the requested skill");
        resourceEvent(eventRequest, {
          kind: "skill",
          status: "failed",
          source: "workflow",
          path,
          error: error.message,
        });
        yield* RESOURCE_LOG.error("agent.resource.failed", {
          outcome: "failure",
          data: { kind: "skill", path, error: failureDetails(error) },
        });
        return yield* Effect.fail(error);
      }
      const loadedPath = skill?.filePath ?? path;
      const skillFile = skillFiles.find((file) => file.path === path);
      const skillBytes = skillFile === undefined ? undefined : Buffer.byteLength(skillFile.content, "utf8");
      resourceEvent(eventRequest, {
        kind: "skill",
        status: "loaded",
        source: "workflow",
        path: loadedPath,
        ...(skill?.name === undefined ? {} : { name: skill.name }),
        ...(skillBytes === undefined ? {} : { bytes: skillBytes }),
      });
      yield* RESOURCE_LOG.info("agent.resource.loaded", {
        data: {
          kind: "skill",
          source: "workflow",
          path: loadedPath,
          ...(skill?.name === undefined ? {} : { name: skill.name }),
          ...(skillBytes === undefined ? {} : { bytes: skillBytes }),
        },
      });
    }
    const sessionManager = yield* Effect.try({
      try: () => {
        if (retryRequest.continuation === undefined) {
          return sdk.SessionManager.create(retryRequest.cwd, retryRequest.sessionDir);
        }
        if (retryRequest.continuation.harness !== "pi") {
          throw withFailedContinuation(new AgentError({
            kind: "request-rejected",
            message: `cannot resume ${retryRequest.continuation.harness} continuation with the pi SDK`,
          }), { ...retryRequest.continuation, unresolvable: true });
        }
        if (sdk.SessionManager.open === undefined) {
          throw withFailedContinuation(new AgentError({
            kind: "request-rejected",
            message: "installed pi SDK does not support reopening a session",
          }), { ...retryRequest.continuation, unresolvable: true });
        }
        return sdk.SessionManager.open(
          retryRequest.continuation.transcriptPath,
          retryRequest.sessionDir,
          retryRequest.cwd,
        );
      },
      catch: (cause) => cause instanceof AgentError ? cause : agentError("request-rejected", cause),
    });
    const customTools = buildCustomTools(request.tools, request.discuss);
    const session = yield* TRACE(SESSION_SOURCE, Effect.tryPromise({
      try: () => sdk.createAgentSession({
        cwd: request.cwd,
        agentDir,
        model,
        modelRuntime: runtime,
        resourceLoader,
        sessionManager,
        // Issue #51: compaction is intentionally not configured here. The SDK
        // defaults it to enabled (`compaction?.enabled ?? true`), and that is
        // what bounds a stage session's context — pre-prompt compaction plus
        // overflow recovery. Disabling it let loop iterations accumulate to the
        // model window ceiling and fail the run with empty replies.
        settingsManager: sdk.SettingsManager.inMemory({ retry: { enabled: true, maxRetries: SDK_API_MAX_RETRIES } }),
        tools: request.tools === undefined ? ["read", "bash", "edit", "write"] : [...request.tools],
        ...(customTools !== undefined ? { customTools } : {}),
        ...(requestedThinkingLevel === undefined ? {} : { thinkingLevel: requestedThinkingLevel }),
      }),
      catch: (cause) => agentError("request-rejected", cause),
    }));
    // Session identity for this attempt. Known only after the session is
    // created; failures before this point carry no continuation and retry
    // from scratch.
    const artifact = yield* requireSessionArtifact(session.session).pipe(
      Effect.tapError(() => Effect.sync(() => session.session.dispose())),
    );
    attemptArtifact = artifact;
    // The session exists from here on, interrupt or not.
    request.onContinuation?.({
      harness: "pi",
      sessionId: artifact.sessionId,
      nativeSessionId: artifact.sessionId,
      transcriptPath: artifact.transcriptPath,
    });
    const effectiveThinkingLevel = configuredThinkingLevel(session.session.thinkingLevel) ?? requestedThinkingLevel;
    const accumulator: TurnAccumulator = { text: "" };
    const unsubscribeRef: { current?: () => void } = {};
    // Steering v1: bind the live session to the channel when the installed
    // SDK exposes `steer`. Capability probe, not a harness-name branch — an
    // SDK without the method leaves the channel unbound and callers receive
    // "no-active-turn" instead of steering.
    const unbindSteering = request.steering?.bind(
      session.session.steer === undefined
        ? undefined
        : { steer: (text) => session.session.steer!(text) },
    );
    const cleanup = Effect.gen(function* () {
      yield* Effect.sync(() => unbindSteering?.());
      yield* Effect.forEach(
        observedEvents.filter(shouldPersistAgentEvent),
        (event) => logAgentEvent(event, artifact.sessionId),
        { discard: true },
      );
      yield* Effect.try({
        try: () => unsubscribeRef.current?.(),
        catch: () => undefined,
      }).pipe(Effect.ignore);
      yield* Effect.try({
        try: () => session.session.dispose(),
        catch: () => undefined,
      }).pipe(Effect.ignore);
    });
    yield* Effect.gen(function* () {
      yield* AGENT_LOG.info("agent.session.artifact.loaded", {
        data: {
          sessionId: artifact.sessionId,
          transcriptPath: artifact.transcriptPath,
        },
      });
      eventRequest.onEvent?.({
        type: "spawn",
        harness: "pi",
        model: modelId,
        ...(effectiveThinkingLevel === undefined ? {} : { thinkingLevel: effectiveThinkingLevel }),
        skills: skillPaths,
      });
      eventRequest.onEvent?.({
        type: "context",
        context: {
          ...(request.systemPromptPath === undefined ? {} : { systemPromptPath: request.systemPromptPath }),
          contextFilePaths,
          skills: skillPaths,
          userMessage: retryRequest.prompt,
        },
      });
      unsubscribeRef.current = yield* TRACE(SUBSCRIBE_SOURCE, Effect.try({
        try: () => session.session.subscribe(bindEvents(eventRequest, accumulator, [
          `${provider}/${modelId}`,
          ...(endpoint === undefined ? [] : [`endpoint ${endpoint}`]),
        ].join(" via "))),
        catch: (cause) => agentError("request-rejected", cause),
      }));
      yield* AGENT_LOG.info("agent.session.started", {
        data: { cwd: request.cwd, sessionId: artifact.sessionId },
      });
      yield* TURN_LOG.info("agent.turn.started", {
        data: { promptLength: request.prompt.length, sessionId: artifact.sessionId },
      });
      turnStarted = true;
      const prompt = TRACE(
        PROMPT_SOURCE,
        sendPrompt(retryRequest, session.session, accumulator),
        { sessionId: artifact.sessionId, promptLength: retryRequest.prompt.length },
      );
      yield* prompt.pipe(
        Effect.tapError((error) => {
          const cancelled = isCancellation(error);
          return (cancelled ? TURN_LOG.info : TURN_LOG.error)(
            cancelled ? "agent.turn.cancelled" : "agent.turn.failed",
            {
              outcome: cancelled ? "cancelled" : "failure",
              data: { error: failureDetails(error) },
            },
          );
        }),
      );
    }).pipe(Effect.ensuring(cleanup));
    yield* TURN_LOG.info("agent.turn.completed", {
      outcome: "success",
      data: {
        sessionId: artifact.sessionId,
        transcriptPath: artifact.transcriptPath,
        textLength: accumulator.text.length,
      },
    });
    const done: AgentEvent = {
      type: "done",
      exitStatus: 0,
      sessionId: artifact.sessionId,
      transcriptPath: artifact.transcriptPath,
    };
    eventRequest.onEvent?.(done);
    yield* logAgentEvent(done, artifact.sessionId);
    const result = {
      sessionId: artifact.sessionId,
      transcriptPath: artifact.transcriptPath,
      text: accumulator.text,
      model: modelId,
      ...(effectiveThinkingLevel === undefined ? {} : { thinkingLevel: effectiveThinkingLevel }),
      continuation: {
        harness: "pi",
        sessionId: artifact.sessionId,
        nativeSessionId: artifact.sessionId,
        transcriptPath: artifact.transcriptPath,
      },
    };
    return { result };
  }).pipe(
    Effect.onExit((exit) => Effect.sync(() => {
      if (Exit.isFailure(exit)) reportFailure(failureFromExit(exit.cause));
    })),
    Effect.tapError((error) => {
      if (turnStarted) return Effect.void;
      const cancelled = isCancellation(error);
      return (cancelled ? AGENT_LOG.info : AGENT_LOG.error)(
        cancelled ? "agent.session.cancelled" : "agent.session.failed",
        {
          outcome: cancelled ? "cancelled" : "failure",
          data: { error: failureDetails(error) },
        },
      );
    }),
    // Stash the attempt's session identity on retryable failures so the
    // shared retry boundary can reopen this session instead of a new one.
    Effect.mapError((cause) => {
      const error = cause instanceof AgentError ? cause : agentError("unknown", cause);
      return attemptArtifact === undefined
        ? error
        : withFailedContinuation(error, {
          harness: "pi",
          sessionId: attemptArtifact.sessionId,
          transcriptPath: attemptArtifact.transcriptPath,
        });
    }),
  );
}
