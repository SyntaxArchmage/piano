import type { AgentContinuation, AgentRequest } from "./agent-contract.js";
import type { ThinkingLevel } from "./events.js";
import type { ResolvedHarnessConfig } from "./harness-config.js";
import {
  DSH_RESUME_SESSION_ENV,
  dshModelPatchPath,
  dshResumeOverlayPath,
  dshWebSearchOffPatchPath,
} from "./harness-home.js";
import { PI_WEB_SEARCH_TOOL_NAME, piWebSearchExtensionPath } from "./pi-web-search.js";
import { CLAUDE_BARE_UNAVAILABLE_TOOLS } from "./tool-names.js";

/**
 * The command line each subprocess harness is started with.
 *
 * Four harnesses, four shapes of invocation, and every difference between them
 * is a fact about that harness: which flag carries the model, whether the task
 * travels as argv or as the first stdin frame, whether a resumed turn names a
 * session of its own. Keeping the builders side by side is what makes those
 * facts readable, and nothing in this module knows how the process is run.
 */

export interface LoadedResources {
  readonly systemPrompt?: string;
  readonly contextFiles: readonly { readonly path: string; readonly content: string }[];
  readonly skills: readonly { readonly path: string; readonly content: string }[];
}

export function piArguments(
  request: AgentRequest,
  config: ResolvedHarnessConfig,
  thinking: ThinkingLevel | undefined,
  resources: LoadedResources,
  transcriptPath: string,
  rpc = true,
): string[] {
  const args = rpc ? ["--mode", "rpc"] : ["--mode", "json", "--print"];
  if (config.provider !== undefined) args.push("--provider", config.provider);
  if (config.model !== undefined) args.push("--model", config.model);
  if (config.apiKey !== undefined) args.push("--api-key", config.apiKey);
  if (thinking !== undefined) args.push("--thinking", thinking);
  if (request.sessionDir !== undefined) args.push("--session-dir", request.sessionDir);
  // The resume file is pi's own: it writes the entries and reads them back, so
  // pointing it at a path Piano also writes would leave two authors on one file
  // — duplicated messages, a second header, and a branch pi resumes from the
  // wrong leaf. `piSessionPath` is therefore Piano-named but pi-owned, and Piano's
  // canonical evidence transcript is written separately. It is always passed:
  // pi's own choice of file is not something Piano could hand back next turn.
  if (rpc) args.push("--session", piSessionPath(request, transcriptPath));
  for (const path of request.skillPaths ?? []) args.push("--skill", path);
  // The pi CLI accepts `--append-system-prompt <text>` (repeatable). Inline
  // the loaded resources so agents.md and the harness appendix reach the
  // subprocess; previously these were dropped entirely.
  const appendix = [
    resources.systemPrompt,
    ...resources.contextFiles.map((file) => `# ${file.path}\n${file.content}`),
  ].filter((value): value is string => value !== undefined && value !== "").join("\n\n");
  if (appendix !== "") args.push("--append-system-prompt", appendix);
  if (request.tools !== undefined && request.tools.length > 0) {
    if (request.tools.includes(PI_WEB_SEARCH_TOOL_NAME)) args.push("--extension", piWebSearchExtensionPath);
    args.push("--tools", request.tools.join(","));
  }
  if (!rpc) args.push(request.prompt);
  // RPC mode takes no positional task: it must arrive as the first stdin
  // frame (`{"type":"prompt",...}`) so the steer channel can bind to the same
  // live process.
  return args;
}

/** Codex's exec mode has no stage-level tool allowlist: its sandbox is the
 * execution boundary. The workflow tool names are validated by the catalog,
 * while the task and loaded resources travel as the prompt. */
export function codexArguments(
  request: AgentRequest,
  config: ResolvedHarnessConfig,
  thinking: ThinkingLevel | undefined,
  resources: LoadedResources,
  additionalWritableDirs: readonly string[],
): string[] {
  const resumeId = codexResumeId(request.continuation);
  const args = resumeId === undefined
    ? ["exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check"]
    : ["exec", "resume", resumeId, "--json", "--skip-git-repo-check"];
  if (config.model !== undefined) args.push("--model", config.model);
  // `exec resume` does not expose `--add-dir`; the initial thread's sandbox
  // policy and additional writable roots are persisted by Codex and reused by
  // the native resume command. Passing the flag here would make every resumed
  // turn fail argument parsing on current Codex CLI releases.
  if (resumeId === undefined) {
    for (const directory of additionalWritableDirs) args.push("--add-dir", directory);
  }
  if (thinking !== undefined) {
    // Codex has no `off` effort; minimal is the closest explicit equivalent.
    const effort = thinking === "off" ? "minimal" : thinking;
    args.push("--config", `model_reasoning_effort=${JSON.stringify(effort)}`);
  }
  if (resumeId === undefined && config.profile !== undefined) args.push("--profile", config.profile);
  const appendix = resourceAppendix(resources, true);
  args.push(appendix === "" ? request.prompt : `${appendix}\n\n## Task\n${request.prompt}`);
  return args;
}

/** Codex emits UUID-shaped thread ids. Do not hand Piano's provisional logical
 * id (`codex-<uuid>`) to `exec resume`: Codex would reject it and lose the
 * retry. A native id is preferred, while the UUID fallback keeps continuations
 * written by an older adapter readable. */
const CODEX_THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function codexResumeId(continuation: AgentContinuation | undefined): string | undefined {
  if (continuation === undefined || continuation.harness !== "codex") return undefined;
  if (continuation.nativeSessionId !== undefined && continuation.nativeSessionId !== "") {
    return continuation.nativeSessionId;
  }
  return CODEX_THREAD_ID.test(continuation.sessionId) ? continuation.sessionId : undefined;
}

function resourceAppendix(resources: LoadedResources, includeSkills: boolean): string {
  return [
    resources.systemPrompt,
    ...resources.contextFiles.map((file) => `# ${file.path}\n${file.content}`),
    ...(includeSkills ? resources.skills.map((file) => `# ${file.path}\n${file.content}`) : []),
  ].filter((value): value is string => value !== undefined && value !== "").join("\n\n");
}

/** Claude's `--resume` takes one of its own session ids (or a session
 * title). Piano's logical actor id is neither, and the CLI aborts the whole
 * run on it — `--resume requires a valid session ID` — which is how one
 * cancelled turn used to kill every later prompt of a coding session. A
 * continuation that never observed a native handle therefore starts a fresh
 * session rather than being handed an id Claude cannot resolve. */
const NATIVE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function claudeResumeId(continuation: AgentContinuation | undefined): string | undefined {
  if (continuation === undefined || continuation.harness !== "claude") return undefined;
  const native = continuation.nativeSessionId;
  return native !== undefined && NATIVE_SESSION_ID.test(native) ? native : undefined;
}

/** The Claude CLI `--effort` label for one portable thinking level.
 *
 * Claude Code's own top label is `xhigh`; `max` is accepted as its alias, which
 * is why the two collapse to one label by default. The mimo models are the
 * exception: on 2026-10-12 the architect-shaped probe at `--effort max` was
 * still producing no streamed output after 4-9 minutes, while the same probe at
 * `--effort xhigh` finished 3/3 in 103-183s and the full coding-team eval then
 * completed end-to-end in 23 minutes (architect ~13 of them). The top level is
 * therefore canonicalized per model instead of assuming one label suits every
 * backend. */
function claudeEffortLabel(thinking: ThinkingLevel, model: string | undefined): string {
  if (thinking !== "xhigh" && thinking !== "max") return thinking;
  return model !== undefined && model.startsWith("mimo") ? "xhigh" : "max";
}

export function claudeArguments(
  request: AgentRequest,
  config: ResolvedHarnessConfig,
  thinking: ThinkingLevel | undefined,
  resources: LoadedResources,
): string[] {
  // `--include-partial-messages` is what makes the output a stream at all.
  // Without it the CLI buffers each block and reports only the completed
  // `assistant` record, so the chat area shows nothing until the turn is
  // over; with it the CLI also emits `stream_event` deltas, which normalize
  // into the same `message_update` / `text_delta` contract Pi drives the live
  // renderer with. `--input-format stream-json` is its input-side twin: it
  // keeps the child alive reading NDJSON user frames on stdin — the
  // transport for genuine mid-turn steering (a frame written while tool
  // calls run reaches the model within the same turn at the next tool
  // boundary; one written at a text stop is taken next turn) and for winding
  // the session down after the turn's `result` frame. The task therefore
  // travels as the first stdin frame (see `userFrame`), not as a positional
  // argument.
  const args = ["--print", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--input-format", "stream-json"];
  if (request.tools?.some((tool) => CLAUDE_BARE_UNAVAILABLE_TOOLS.includes(tool)) !== true) args.unshift("--bare");
  if (config.model !== undefined) args.push("--model", config.model);
  if (thinking !== undefined) args.push("--effort", claudeEffortLabel(thinking, config.model));
  const resumeId = claudeResumeId(request.continuation);
  if (resumeId !== undefined) args.push("--resume", resumeId);
  const appendix = resourceAppendix(resources, true);
  if (appendix !== "") args.push("--append-system-prompt", appendix);
  // Stage tool names are exact Claude Code ids, validated at workflow parse
  // time against CLAUDE_TOOL_NAMES; the CLI itself ignores unknown names, so
  // no renaming happens here — the list is transported verbatim.
  const tools = request.tools;
  if (tools !== undefined && tools.length > 0) {
    // Piano invokes Claude non-interactively. A tool task must not wait for a
    // permission prompt that has no terminal reader; the workspace boundary is
    // still the caller's cwd and the selected allowed-tools list.
    args.push("--permission-mode", "bypassPermissions", "--add-dir", request.cwd, "--allowed-tools", ...tools);
  }
  return args;
}

/** One NDJSON stdin frame for claude's streaming input. `role: "user"` is
 * mandatory in the v2.1 frame schema; `parent_tool_use_id: null` marks a
 * plain turn message. */
export function userFrame(text: string): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  });
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
export function piSessionPath(request: AgentRequest, transcriptPath: string): string {
  const continuation = request.continuation;
  if (continuation !== undefined) return continuation.transcriptPath;
  return `${transcriptPath.replace(/\.jsonl$/, "")}.pi-session.jsonl`;
}

/** The dsh session a continued actor must reopen, or `undefined` when there is
 * nothing resumable.
 *
 * Shape-checked, because a dsh continuation also carries Piano's own logical id
 * (`dsh-<uuid>`) when an attempt died before dsh reported a session of its own.
 * Handing that to `agents.resume` would name a session that never existed. dsh
 * mints `session-<uuid>`, and anything else is not a handle: the run then starts
 * a fresh conversation, which is the honest outcome when there is no session to
 * return to. */
export function dshResumeSessionId(request: AgentRequest): string | undefined {
  const continuation = request.continuation;
  if (continuation === undefined || continuation.harness !== "dsh") return undefined;
  const candidate = continuation.nativeSessionId ?? continuation.sessionId;
  return DSH_SESSION_ID.test(candidate) ? candidate : undefined;
}

/** The session id `agents.resume` accepts: dsh mints `session-<uuid>`. */
const DSH_SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * dsh's shipped headless runner creates a random session per process, so a
 * continued Piano actor arrives as a stranger. Piano's overlay replaces only that
 * runner with one that resumes the actor's session; this is the id it reopens,
 * passed as an environment reference because dsh's own task config travels
 * through the profile rather than through flags.
 */
export function dshResumeSessionEnv(resumeSessionId: string | undefined): NodeJS.ProcessEnv {
  // childEnv inherits the parent environment. Explicitly clear a stale resume
  // id when this attempt has no continuation; otherwise an unrelated shell
  // variable can make a fresh attempt reopen the wrong dsh session.
  return { [DSH_RESUME_SESSION_ENV]: resumeSessionId };
}

/** The official dsh launcher has its own headless protocol. It deliberately
 * receives no Pi flags: profile selection, the model overlay, and the task are
 * the complete native invocation. Resources are made explicit in the task
 * because dsh's headless entry point has no append-system-prompt flag.
 *
 * The model travels as `--patch`: the headless runner reads the process-wide
 * `agent-default-model`, so there is no model flag to pass. The overlay was
 * generated with the harness home, one file per reachable model, and its
 * provider is the one Piano configured for dsh — a per-request provider has no
 * generated catalog route and stays unsupported here. The resume overlay is
 * always applied (see below); the session id itself travels as an environment
 * reference, so `resumeSessionId` no longer shapes the argv. */
export function dshArguments(
  request: AgentRequest,
  config: ResolvedHarnessConfig,
  resources: LoadedResources,
  dshHome: string,
  continuationContext?: string,
  _resumeSessionId?: string,
): string[] {
  const appendix = resourceAppendix(resources, true);
  const task = continuationContext === undefined
    ? request.prompt
    : `${continuationContext}\n\n## New task\n${request.prompt}`;
  const prompt = appendix === "" ? task : `${appendix}\n\n## Task\n${task}`;
  const ablateWebSearch = request.tools?.includes(PI_WEB_SEARCH_TOOL_NAME) !== true;
  return [
    "--profile", config.profile ?? "headless",
    ...(config.model === undefined ? [] : ["--patch", dshModelPatchPath(dshHome, config.model)]),
    ...(ablateWebSearch ? ["--patch", dshWebSearchOffPatchPath(dshHome)] : []),
    // Every Piano dsh run drives the turn through the resuming runner — it is
    // also the far end of the stdin steering protocol, so it is overlaid even
    // on a first turn with no session to reopen. Overlay paths come after the
    // profile layer, so the row it disables is the one the headless bundle
    // inserted.
    "--patch", dshResumeOverlayPath(dshHome),
    prompt,
  ];
}

/**
 * The dsh session is resumed natively when the actor has one (see
 * {@link dshResumeSessionId}), so the canonical transcript is replayed only as
 * the fallback it was written to be: when there is no session to reopen, dsh
 * would otherwise see none of the conversation. Replaying into a resumed session
 * as well would double the context — the model would read its own history and
 * then a retelling of it — and spend a budget the resume path does not need.
 */
