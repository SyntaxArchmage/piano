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
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AgentError, agentError } from "./errors.js";
import { PI_CUSTOM_TOOL_NAMES } from "./tool-names.js";
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
  eventMetadata,
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
import type { SteeringChannel } from "./steering.js";

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
  /** Supervisor discussion callback exposed by the Piano `discuss` tool. */
  readonly discuss?: (question: string) => Promise<string>;
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

interface PiModelRuntime {
  getModel(provider: string, model: string): unknown;
  /** Resolve a model id from Pi's own provider/model registry. */
  getModels?(): readonly unknown[];
  setRuntimeApiKey(provider: string, apiKey: string): Promise<void>;
}

interface PiResourceLoader {
  reload(): Promise<void>;
  getAgentsFiles?(): {
    agentsFiles: readonly { readonly path: string; readonly content: string }[];
  };
  getSkills?(): {
    skills: readonly { readonly name: string; readonly filePath?: string }[];
  };
  getSystemPrompt?(): string | undefined;
  getSystemPromptSource?(): { readonly path: string } | undefined;
}

interface PiSession {
  readonly sessionId: string;
  readonly sessionFile?: string;
  /** Pi clamps the requested level to the selected model's capabilities. */
  readonly thinkingLevel?: string;
  subscribe(listener: (event: unknown) => void): () => void;
  prompt(text: string): Promise<void>;
  /** Genuine mid-turn delivery: injects a user message that the agent loop
   * ingests before its next LLM call. Optional because it is probed, not
   * assumed — older/fake SDKs omit it. */
  steer?(text: string): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
}

export interface PiModule {
  readonly ModelRuntime: {
    create(options: Record<string, unknown>): Promise<PiModelRuntime>;
  };
  readonly SessionManager: {
    create(cwd: string, sessionDir?: string): unknown;
    open?(path: string, sessionDir?: string, cwdOverride?: string): unknown;
  };
  readonly SettingsManager: {
    inMemory(settings: Record<string, unknown>): unknown;
  };
  readonly DefaultResourceLoader: new (options: Record<string, unknown>) => PiResourceLoader;
  readonly createAgentSession: (options: Record<string, unknown>) => Promise<{ session: PiSession }>;
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

export interface PiHarnessOptions extends AgentHarnessOptions {
  /** Keep provider/model/auth discovery inside Pi when false. */
  readonly usePianoConfig?: boolean;
  readonly sdk?: PiModule;
  readonly sdkLoader?: () => Promise<PiModule>;
}

export type AgentRunner = (
  request: AgentRequest,
  options?: AgentHarnessOptions,
) => Effect.Effect<AgentResult, AgentError, Logging | FileSystem.FileSystem>;

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


const MIN_PI_VERSION = "0.84.0";
const MAX_SDK_LOAD_RETRIES = 2;
/** In-session API request retries owned by the Pi SDK itself. Hardcoded
 * reliability floor (issue #45): a stage must survive provider-side storms
 * without surfacing a terminal AgentError. */
const SDK_API_MAX_RETRIES = 10;
const TRANSIENT_SDK_ERROR_CODES = new Set([
  "EAGAIN", "EBUSY", "EINTR", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "EPIPE",
]);
let sdkRootCache: string | undefined;
export const defaultPiConfigPath = defaultAgentConfigPath;
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

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((value) => Number.parseInt(value, 10) || 0);
  const b = right.split(".").map((value) => Number.parseInt(value, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0) ? 1 : -1;
  }
  return 0;
}

function sdkRoot(): string {
  if (sdkRootCache === undefined) {
    sdkRootCache = join(execSync("npm root -g", { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
  }
  return sdkRootCache;
}

type SdkLoader = () => Promise<PiModule>;
const defaultSdkLoader: SdkLoader = () => import(join(sdkRoot(), "dist/index.js")) as Promise<PiModule>;
const sdkModuleCache = new WeakMap<SdkLoader, Promise<PiModule>>();

function sdkAvailable(): boolean {
  const root = sdkRoot();
  const packagePath = join(root, "package.json");
  if (!existsSync(join(root, "dist/index.js")) || !existsSync(packagePath)) return false;
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return typeof packageJson.version === "string" && compareVersions(packageJson.version, MIN_PI_VERSION) >= 0;
}

/** Check the installed SDK boundary without importing or starting a session. */
export function piAvailable(): boolean {
  try {
    return sdkAvailable();
  } catch {
    return false;
  }
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

function transientSdkLoad(error: AgentError): boolean {
  const cause = error.cause;
  let code: unknown;
  try {
    code = typeof cause === "object" && cause !== null && "code" in cause
      ? (cause as { code?: unknown }).code
      : undefined;
  } catch {
    code = undefined;
  }
  return (typeof code === "string" && TRANSIENT_SDK_ERROR_CODES.has(code)) || /temporar|timeout|timed out|try again/i.test(error.message);
}

function loadCachedSdk(loader: SdkLoader): Promise<PiModule> {
  const cached = sdkModuleCache.get(loader);
  if (cached !== undefined) return cached;
  const pending = Promise.resolve().then(loader);
  const tracked = pending.catch((cause) => {
    if (sdkModuleCache.get(loader) === tracked) sdkModuleCache.delete(loader);
    throw cause;
  });
  sdkModuleCache.set(loader, tracked);
  return tracked;
}

/** Load the SDK module without creating a session. This is the real discovery
 * boundary used by doctor before it reports the Pi SDK as ready. */
export async function piLoadable(): Promise<boolean> {
  if (!piAvailable()) return false;
  try {
    await loadCachedSdk(defaultSdkLoader);
    return true;
  } catch {
    return false;
  }
}

function loadSdk(options: PiHarnessOptions): Effect.Effect<PiModule, AgentError> {
  return Effect.suspend(() => {
    if (options.sdk !== undefined) return Effect.succeed(options.sdk);
    const available = options.sdkLoader === undefined
      ? Effect.try({
        try: sdkAvailable,
        catch: (cause) => new AgentError({
          kind: "sdk-discovery",
          message: `unable to inspect the pi SDK installation: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        }),
      })
      : Effect.succeed(true);
    return available.pipe(
      Effect.flatMap((isAvailable) => {
        if (!isAvailable) {
          return Effect.fail(new AgentError({
            kind: "sdk-unavailable",
            message: "pi SDK is not installed or is below the supported version",
          }));
        }
        const loader = options.sdkLoader ?? defaultSdkLoader;
        let attempt = 0;
        const loadAttempt = Effect.suspend(() => {
          attempt += 1;
          return Effect.tryPromise({
            try: () => loadCachedSdk(loader),
            catch: (cause) => new AgentError({
              kind: "sdk-load",
              message: `pi SDK module load failed on attempt ${attempt}: ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            }),
          });
        });
        return Effect.retry(loadAttempt, {
          times: MAX_SDK_LOAD_RETRIES,
          while: transientSdkLoad,
        });
      }),
    );
  });
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

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isAssistantMessage(message: AgentMessage): boolean {
  return message.role === undefined || message.role === "assistant";
}

function extractUsage(value: unknown): AgentUsage | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const usage = value as Record<string, unknown>;
  const number = (item: unknown): number | undefined =>
    typeof item === "number" && Number.isFinite(item) ? item : undefined;
  const result: AgentUsage = {
    ...(number(usage.input) === undefined ? {} : { input: number(usage.input) }),
    ...(number(usage.output) === undefined ? {} : { output: number(usage.output) }),
    ...(number(usage.cacheRead) === undefined ? {} : { cacheRead: number(usage.cacheRead) }),
    ...(number(usage.cacheWrite) === undefined ? {} : { cacheWrite: number(usage.cacheWrite) }),
    ...(number(usage.cacheWrite1h) === undefined ? {} : { cacheWrite1h: number(usage.cacheWrite1h) }),
    ...(number(usage.reasoning) === undefined ? {} : { reasoning: number(usage.reasoning) }),
    ...(number(usage.totalTokens) === undefined ? {} : { totalTokens: number(usage.totalTokens) }),
    ...(number(usage.contextTokens) === undefined ? {} : { contextTokens: number(usage.contextTokens) }),
    ...(number(usage.turns) === undefined ? {} : { turns: number(usage.turns) }),
    ...(usage.cost === undefined ? {} : { cost: usage.cost }),
  };
  return Object.keys(result).length === 0 ? undefined : result;
}

function bindEvents(
  request: AgentRequest,
  accumulator: TurnAccumulator,
  attribution?: string,
): (event: unknown) => void {
  return (raw) => {
    const event = typeof raw === "object" && raw !== null
      ? raw as PiSessionEvent
      : { type: undefined };
    const type = typeof event.type === "string" ? event.type : undefined;
    const emit = (value: AgentEvent): void => request.onEvent?.(value);
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
        if (isAssistantMessage(message)) {
          if (assistantMessageEvent.type === "text_delta" && typeof assistantMessageEvent.delta === "string") {
            accumulator.text += assistantMessageEvent.delta;
          } else if (assistantMessageEvent.type === "text_end" && typeof assistantMessageEvent.content === "string") {
            accumulator.text = assistantMessageEvent.content;
          } else {
            const text = messageText(message);
            if (text !== undefined) accumulator.text = text;
          }
        }
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
          toolCallId: stringValue(event.toolCallId, "unknown"),
          toolName: stringValue(event.toolName, "unknown"),
          args: event.args,
        });
        return;
      case "tool_execution_update":
        emit({
          type: "tool_execution_update",
          toolCallId: stringValue(event.toolCallId, "unknown"),
          toolName: stringValue(event.toolName, "unknown"),
          args: event.args,
          partialResult: event.partialResult,
        });
        return;
      case "tool_execution_end":
        emit({
          type: "tool_execution_end",
          toolCallId: stringValue(event.toolCallId, "unknown"),
          toolName: stringValue(event.toolName, "unknown"),
          result: event.result,
          isError: event.isError === true,
        });
        return;
      case "queue_update":
        emit({ type: "queue_update", steering: stringList(event.steering), followUp: stringList(event.followUp) });
        return;
      case "compaction_start":
        emit({ type: "compaction_start", reason: stringValue(event.reason, "unknown") });
        return;
      case "entry_appended":
        emit({ type: "entry_appended", entry: event.entry });
        return;
      case "session_info_changed":
        emit({ type: "session_info_changed", name: typeof event.name === "string" ? event.name : undefined });
        return;
      case "thinking_level_changed":
        emit({ type: "thinking_level_changed", level: stringValue(event.level, "unknown") });
        return;
      case "compaction_end":
        emit({
          type: "compaction_end",
          reason: stringValue(event.reason, "unknown"),
          result: event.result,
          aborted: event.aborted === true,
          willRetry: event.willRetry === true,
          ...(typeof event.errorMessage === "string" ? { errorMessage: event.errorMessage } : {}),
        });
        return;
      case "auto_retry_start":
        emit({
          type: "auto_retry_start",
          attempt: numberValue(event.attempt),
          maxAttempts: numberValue(event.maxAttempts),
          delayMs: numberValue(event.delayMs),
          errorMessage: stringValue(event.errorMessage, "retry requested"),
        });
        return;
      case "auto_retry_end":
        emit({
          type: "auto_retry_end",
          success: event.success === true,
          attempt: numberValue(event.attempt),
          ...(typeof event.finalError === "string" ? { finalError: event.finalError } : {}),
        });
        return;
      case "summarization_retry_scheduled":
        emit({
          type: "summarization_retry_scheduled",
          attempt: numberValue(event.attempt),
          maxAttempts: numberValue(event.maxAttempts),
          delayMs: numberValue(event.delayMs),
          errorMessage: stringValue(event.errorMessage, "retry requested"),
        });
        return;
      case "summarization_retry_attempt_start":
        emit({
          type: "summarization_retry_attempt_start",
          source: stringValue(event.source, "unknown"),
          ...(typeof event.reason === "string" ? { reason: event.reason } : {}),
        });
        return;
      case "summarization_retry_finished":
        emit({ type: "summarization_retry_finished" });
        return;
      case "bash_execution_update":
        emit({ type: "bash_execution_update", id: typeof event.id === "string" ? event.id : undefined, delta: typeof event.delta === "string" ? event.delta : "" });
        return;
      default:
        emit({ type: "unknown", sourceType: type ?? "unknown", data: raw });
    }
  };
}

/** Max bytes of response body returned to the model; avoids flooding context. */
const WEB_FETCH_MAX_BYTES = 200_000;

/** Build the customTools array for tools in request.tools that are piano-owned
 * (not built into the Pi SDK). Returns undefined when no custom tools are
 * needed so the caller can skip the option entirely. */
function buildCustomTools(
  requestTools: readonly string[] | undefined,
  discuss: ((question: string) => Promise<string>) | undefined,
): object[] | undefined {
  const active = PI_CUSTOM_TOOL_NAMES.filter(
    (name) => requestTools === undefined || requestTools.includes(name),
  );
  if (active.length === 0 && discuss === undefined) return undefined;
  const tools: object[] = [];

  if (discuss !== undefined) {
    tools.push({
      name: "discuss",
      label: "Discuss with supervisor",
      description: "Ask the supervisor one focused question. The answer is guidance, not approval; continue the task after receiving it.",
      parameters: {
        type: "object",
        required: ["question"],
        properties: {
          question: { type: "string", description: "One focused question for the supervisor." },
        },
      },
      async execute(
        _toolCallId: string,
        params: { question: string },
      ): Promise<{ type: "tool-result"; content: string }> {
        return { type: "tool-result", content: await discuss(params.question) };
      },
    });
  }

  if (active.includes("web_fetch")) {
    tools.push({
      name: "web_fetch",
      label: "Web Fetch",
      description: "Fetch a URL and return its text content. Use for reading documentation, APIs, or web pages.",
      parameters: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", description: "The URL to fetch." },
          timeout_ms: { type: "number", description: "Request timeout in milliseconds. Default: 15000." },
        },
      },
      async execute(
        _toolCallId: string,
        params: { url: string; timeout_ms?: number },
        signal: AbortSignal | undefined,
      ): Promise<{ type: "tool-result"; content: string }> {
        const timeoutMs = typeof params.timeout_ms === "number" && params.timeout_ms > 0
          ? params.timeout_ms
          : 15_000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const linked = (): void => controller.abort();
        signal?.addEventListener("abort", linked, { once: true });
        try {
          const response = await fetch(params.url, { signal: controller.signal });
          const contentType = response.headers.get("content-type") ?? "";
          const isText = /text|json|xml|javascript|yaml|markdown/i.test(contentType);
          if (!isText) {
            return { type: "tool-result", content: `HTTP ${response.status} — content-type: ${contentType} (binary or non-text; not returned)` };
          }
          const reader = response.body?.getReader();
          if (reader === undefined) {
            return { type: "tool-result", content: `HTTP ${response.status} — empty body` };
          }
          const chunks: Uint8Array[] = [];
          let total = 0;
          let truncated = false;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (total + value.byteLength > WEB_FETCH_MAX_BYTES) {
              chunks.push(value.slice(0, WEB_FETCH_MAX_BYTES - total));
              truncated = true;
              break;
            }
            chunks.push(value);
            total += value.byteLength;
          }
          reader.cancel().catch(() => undefined);
          const text = new TextDecoder().decode(
            chunks.reduce((a, b) => {
              const merged = new Uint8Array(a.byteLength + b.byteLength);
              merged.set(a);
              merged.set(b, a.byteLength);
              return merged;
            }, new Uint8Array(0)),
          );
          const header = `HTTP ${response.status} ${response.statusText} — ${params.url}\n\n`;
          const footer = truncated ? `\n\n[truncated at ${WEB_FETCH_MAX_BYTES} bytes]` : "";
          return { type: "tool-result", content: header + text + footer };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { type: "tool-result", content: `Error fetching ${params.url}: ${msg}` };
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", linked);
        }
      },
    });
  }
  return tools;
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
