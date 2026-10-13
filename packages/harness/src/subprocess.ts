import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import type { Logging } from "@piano/logging";
import { AgentError, agentError } from "./errors.js";
import { canonicalTranscriptText, mergeCanonicalTranscript } from "./canonical-transcript.js";
import { dshModelPatchPath, dshResumeOverlayPath, DSH_RESUME_SESSION_ENV, dshWebSearchOffPatchPath } from "./harness-home.js";
import {
  agentConfigPath,
  resolveHarnessConfig,
  type HarnessName,
  type ResolvedHarnessConfig,
} from "./harness-config.js";
import {
  asAgentMessageEvent,
  asAgentMessage,
  messageText,
  type AgentEvent,
  type AgentMessage,
  type AgentResourceKind,
  type AgentUsage,
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
} from "./pi.js";
import { PI_WEB_SEARCH_TOOL_NAME, piWebSearchExtensionPath } from "./pi-web-search.js";
import { CLAUDE_BARE_UNAVAILABLE_TOOLS } from "./tool-names.js";

interface JsonRecord {
  readonly [key: string]: unknown;
}

export interface SubprocessAccumulator {
  text: string;
  sessionId?: string;
  /** The terminal result frame may repeat a preceding assistant message. */
  lastMessageEndText?: string;
  /** Head-hold state for the gateway banner in Claude's streamed text:
   * `undefined`/`""` = at the head of a message (undecided prefixes are held
   * back), `null` = past the head (deltas pass through), string = held text. */
  proxyPending?: string | null;
  /** Claude reports tool results as user content blocks; retain names from
   * the corresponding start frame so the normalized end event can close the
   * right chat/trajectory entry. */
  toolNames?: Map<string, string>;
  toolCallsByContentIndex?: Map<number, { readonly toolCallId: string; readonly toolName: string }>;
  /** Set by the terminal `result` frame. With streaming input (claude) the
   * CLI keeps waiting on stdin after it, so this flag is what tells the
   * attempt the turn is over and the child may be wound down. */
  turnEnded?: boolean;
  /** Set when the child refused the attempt's own task frame (pi RPC's
   * `success:false` response to the initial `prompt`). The child can still exit
   * 0 — pi's stdin loop outlives a declined prompt — so this flag is what makes
   * the acknowledged refusal fail the attempt.
   *
   * Deliberately not set by a refused `steer`: that refusal belongs to the
   * steering call that asked for it (which rejects, and the caller keeps its
   * queue semantics), not to the turn. Folding both into one flag is what made
   * an accepted conversation die over a mid-turn injection. */
  promptRejected?: boolean;
}

interface LoadedResources {
  readonly systemPrompt?: string;
  readonly contextFiles: readonly { readonly path: string; readonly content: string }[];
  readonly skills: readonly { readonly path: string; readonly content: string }[];
}

interface ChildOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly rawLines: readonly string[];
  readonly spawnError?: Error;
  readonly aborted: boolean;
  /** The child closed after our own post-`result` wind-down (stdin end, then
   * a bounded SIGTERM). An exit signal from that shutdown is a clean
   * completion, not a harness failure. */
  readonly gracefulShutdown?: boolean;
}

interface DshSessionEvidence {
  readonly path: string;
  readonly sessionId: string;
  readonly text: string;
  readonly events: readonly JsonRecord[];
}

interface DshAssistantRecord {
  readonly turn: number;
  readonly message: AgentMessage;
  readonly usage?: AgentUsage;
}

interface DshEventMapper {
  process(event: JsonRecord): void;
  finish(finalText: string): boolean;
}

interface DshSessionTailer {
  finish(): Promise<DshSessionEvidence | undefined>;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function assistantMessage(value: unknown): AgentMessage {
  const message = asAgentMessage(value);
  return message.role === undefined ? { ...message, role: "assistant" } : message;
}

function stripProxyDiagnostic(text: string): string {
  return text.replace(/^(?:\[save-token:[^\]]*\]\s*)+/i, "");
}

/** `--include-partial-messages` can split the gateway's `[save-token: ...]`
 * banner across text_delta frames. Hold a streamed head until it is proven
 * genuine text or a complete banner has been stripped, so the banner never
 * reaches the live chat block. Returns the text safe to emit now plus the
 * remainder that still looks like an unclosed banner. */
function flushProxyBanner(pending: string): { readonly flush: string; readonly hold: string } {
  const intro = "[save-token:";
  const lower = pending.toLowerCase();
  if (intro.startsWith(lower)) return { flush: "", hold: pending }; // not decidable yet
  if (!lower.startsWith(intro)) return { flush: pending, hold: "" }; // genuine text
  const stripped = stripProxyDiagnostic(pending);
  if (stripped === pending) return { flush: "", hold: pending }; // banner not closed yet
  return stripped === "" ? { flush: "", hold: "" } : flushProxyBanner(stripped);
}

function sanitizeAssistantMessage(message: AgentMessage): AgentMessage {
  if (message.role !== undefined && message.role !== "assistant") return message;
  if (typeof message.content === "string") {
    return { ...message, content: stripProxyDiagnostic(message.content) };
  }
  if (!Array.isArray(message.content)) return message;
  return {
    ...message,
    content: message.content.map((part) => {
      if (typeof part !== "object" || part === null || typeof (part as { text?: unknown }).text !== "string") return part;
      return { ...part, text: stripProxyDiagnostic((part as { text: string }).text) };
    }),
  };
}

function extractUsage(value: unknown): AgentUsage | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const nested = record.usage ?? record.message;
  const usage = asRecord(nested) ?? asRecord(record.delta?.valueOf());
  if (usage === undefined) return undefined;
  const input = usage.input ?? usage.input_tokens ?? usage.inputTokens;
  const output = usage.output ?? usage.output_tokens ?? usage.outputTokens;
  const cacheRead = usage.cacheRead
    ?? usage.cache_read_input_tokens
    ?? usage.cached_input_tokens
    ?? usage.cacheReadTokens;
  const cacheWrite = usage.cacheWrite ?? usage.cache_creation_input_tokens ?? usage.cacheWriteTokens;
  const result: AgentUsage = {
    ...(number(input) === undefined ? {} : { input: number(input) }),
    ...(number(output) === undefined ? {} : { output: number(output) }),
    ...(number(cacheRead) === undefined ? {} : { cacheRead: number(cacheRead) }),
    ...(number(cacheWrite) === undefined ? {} : { cacheWrite: number(cacheWrite) }),
    ...(number(usage.cacheWrite1h ?? usage.cache_creation_input_tokens_1h) === undefined ? {} : { cacheWrite1h: number(usage.cacheWrite1h ?? usage.cache_creation_input_tokens_1h) }),
    ...(number(usage.reasoning ?? usage.reasoning_tokens ?? usage.reasoning_output_tokens) === undefined ? {} : { reasoning: number(usage.reasoning ?? usage.reasoning_tokens ?? usage.reasoning_output_tokens) }),
    ...(number(usage.totalTokens ?? usage.total_tokens) === undefined ? {} : { totalTokens: number(usage.totalTokens ?? usage.total_tokens) }),
    ...(number(usage.contextTokens ?? usage.context_tokens) === undefined ? {} : { contextTokens: number(usage.contextTokens ?? usage.context_tokens) }),
    ...(number(usage.turns) === undefined ? {} : { turns: number(usage.turns) }),
    ...(usage.cost === undefined ? {} : { cost: usage.cost }),
  };
  return Object.keys(result).length === 0 ? undefined : result;
}

const ZSTD_MAGIC = 0xFD2FB528;

interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/** Locate complete zstd frames in dsh's concatenated-frame JSONL artifact. The
 * official persistence backend writes one header frame followed by one frame
 * per event batch; zstdDecompressSync alone would silently decode only the
 * first header frame. */
function dshZstdFrames(buffer: Buffer): readonly ByteRange[] {
  const frames: ByteRange[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 5 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return frames;
    offset += 4;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) return frames;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryBytes = [0, 1, 2, 4][descriptor & 0x03] ?? 0;
    const contentSizeBytes = contentSizeFlag === 0
      ? singleSegment ? 1 : 0
      : 1 << contentSizeFlag;
    const frameHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < frameHeaderBytes) return frames;
    offset += frameHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return frames;
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const blockType = (blockHeader >>> 1) & 0x03;
      if (blockType === 3) return frames;
      const blockSize = blockHeader >>> 3;
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return frames;
      offset += payloadBytes;
      if ((blockHeader & 0x01) !== 0) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames;
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

/** The directory dsh derives from a cwd to hold that project's sessions. Exported
 * because placing a session where this code looks is the only way to test the
 * lookups, and a test that re-implements the shape can silently drift from it. */
export function dshProjectKey(cwd: string): string {
  let readable = "";
  let separatorRun = false;
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index);
    const character = String.fromCharCode(code);
    if (character === "/" || character === "\\" || character === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (character !== "~" && /^[A-Za-z0-9._-]$/.test(character)) {
      readable += character;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

/** The session artifact for a known native session id, or undefined when this
 * object's storage does not hold it.
 *
 * dsh lays sessions out as
 * `<home>/sessions/<project-key>/<session-id>/session.jsonl[.zstd]`, so the
 * session id names its own directory and locates the file by itself — whatever
 * project created it, and wherever the actor's cwd has moved since.
 *
 * Independence from the cwd is what a continued map lane needs: its cwd embeds
 * the loop iteration and the slot (`.../slots/<iter>/<map>/slot-N`), so the
 * project directory holding the session is never the one the current epoch
 * names. It is also what keeps lanes apart, which is the property the cwd
 * cannot give: one project directory holds *every stage of one slot*, so a
 * lookup by cwd — or by "newest in this directory" — can hand an actor a
 * sibling's conversation. A session id belongs to exactly one actor, so a
 * lookup by id can only ever return that actor's own memory. */
async function sessionArtifactForId(home: string, sessionId: string): Promise<string | undefined> {
  const sessionsRoot = join(home, "sessions");
  let projects: readonly string[];
  try {
    projects = (await readdir(sessionsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
  for (const project of projects) {
    for (const filename of ["session.jsonl.zstd", "session.jsonl"] as const) {
      const path = join(sessionsRoot, project, sessionId, filename);
      try {
        if ((await stat(path)).isFile()) return path;
      } catch {
        // Not under this project key; keep looking.
      }
    }
  }
  return undefined;
}

async function sessionArtifactPaths(home: string, cwd: string): Promise<readonly string[]> {
  const sessionsRoot = join(home, "sessions");
  const expectedProject = join(sessionsRoot, dshProjectKey(cwd));
  const projects: string[] = [];
  try {
    await stat(expectedProject);
    projects.push(expectedProject);
  } catch {
    // The fallback scan below handles older dsh layouts and lossy project-key
    // collisions without assuming a native implementation detail forever.
  }
  if (projects.length === 0) {
    try {
      for (const entry of await readdir(sessionsRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) projects.push(join(sessionsRoot, entry.name));
      }
    } catch {
      return [];
    }
  }
  const paths: string[] = [];
  for (const project of projects) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(project, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      for (const filename of ["session.jsonl.zstd", "session.jsonl"] as const) {
        const path = join(project, entry.name, filename);
        try {
          if ((await stat(path)).isFile()) paths.push(path);
        } catch {
          // A concurrent dsh cleanup can remove an incomplete session.
        }
      }
    }
  }
  return paths;
}

/** Decode just the first session header. The header is its own zstd frame, so
 * discovery never needs to inflate an entire growing transcript. */
function dshSessionHeader(path: string, raw: Buffer): JsonRecord | undefined {
  let headerBytes = raw;
  if (path.endsWith(".zstd")) {
    const first = dshZstdFrames(raw)[0];
    if (first === undefined) return undefined;
    try {
      headerBytes = zstdDecompressSync(raw.subarray(first.start, first.end));
    } catch {
      return undefined;
    }
  }
  const newline = headerBytes.indexOf(0x0a);
  if (newline < 0) return undefined;
  try {
    return asRecord(JSON.parse(headerBytes.subarray(0, newline).toString("utf8")));
  } catch {
    return undefined;
  }
}

/** dsh's JSONL writer packs runs of three or more delta chunks into a storage
 * row. The installed dsh reader expands these rows before exposing
 * `Session.events`; Piano must do the same at the process boundary so a packed
 * row remains a live text stream rather than an opaque unknown event. */
function expandDshStorageRecord(record: JsonRecord): readonly JsonRecord[] {
  if (record.type !== "text-chunks" && record.type !== "reasoning-chunks" && record.type !== "tool-call-chunks") return [record];
  const data = asRecord(record.data);
  if (data === undefined) return [record];
  const payloadKey = record.type === "tool-call-chunks" ? "args" : "texts";
  const payload = data[payloadKey];
  const seq0 = number(record.seq0);
  const time0 = number(record.time0);
  const turn = number(data.turn);
  const step = number(data.step);
  const index = number(data.index);
  const gaps = data.dt;
  if (seq0 === undefined || time0 === undefined || turn === undefined || step === undefined || index === undefined
    || !Array.isArray(payload) || payload.some((part) => typeof part !== "string")
    || !Array.isArray(gaps) || gaps.length !== payload.length - 1
    || gaps.some((gap) => typeof gap !== "number" || !Number.isFinite(gap))) return [record];
  const id = string(data.id);
  if (record.type === "tool-call-chunks" && id === undefined) return [record];
  const events: JsonRecord[] = [];
  let time = time0;
  for (let offset = 0; offset < payload.length; offset += 1) {
    if (offset > 0) time += gaps[offset - 1] as number;
    const part = payload[offset];
    const chunk = record.type === "text-chunks"
      ? { type: "text-delta", index, text: part }
      : record.type === "reasoning-chunks"
        ? { type: "reasoning-delta", index, text: part }
        : {
          type: "tool-call-delta",
          index,
          id,
          ...(typeof data.name === "string" ? { name: data.name } : {}),
          argumentsDelta: part,
        };
    events.push({
      type: "assistant/chunk",
      seq: seq0 + offset,
      time,
      data: { turn, step, chunk },
    });
  }
  return events;
}

async function findDshSessionArtifact(
  home: string,
  cwd: string,
  startedAt: number,
  resumeSessionId?: string,
): Promise<string | undefined> {
  // A continued actor names its session; take that session or nothing. The
  // discovery below answers "which session did this attempt create", and for a
  // continued actor that question has a wrong answer available: a sibling
  // stage of the same slot shares the project directory, and its file is newer
  // than the resumed one.
  if (resumeSessionId !== undefined) return sessionArtifactForId(home, resumeSessionId);
  const candidates = await sessionArtifactPaths(home, cwd);
  const ranked: Array<{ readonly path: string; readonly mtimeMs: number }> = [];
  for (const path of candidates) {
    try {
      const identity = await stat(path);
      if (identity.mtimeMs >= startedAt - 1000) ranked.push({ path, mtimeMs: identity.mtimeMs });
    } catch {
      // A session can be materialized or repaired between directory listing
      // and stat. The next poll will try it again.
    }
  }
  ranked.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of ranked) {
    try {
      const header = dshSessionHeader(candidate.path, await readFile(candidate.path));
      if (header !== undefined && (string(header.cwd) === undefined || header.cwd === cwd)) return candidate.path;
    } catch {
      // The writer may still be publishing the first frame.
    }
  }
  return undefined;
}

function decodeDshSession(path: string, raw: Buffer): DshSessionEvidence | undefined {
  let text: string;
  try {
    if (path.endsWith(".zstd")) {
      const frames = dshZstdFrames(raw);
      if (frames.length === 0) return undefined;
      text = frames.map(({ start, end }) => zstdDecompressSync(raw.subarray(start, end)).toString("utf8")).join("");
    } else {
      text = raw.toString("utf8");
    }
  } catch {
    return undefined;
  }
  const events = text.split("\n").flatMap((line): readonly JsonRecord[] => {
    if (line.trim() === "") return [];
    try {
      const value: unknown = JSON.parse(line);
      const record = asRecord(value);
      return record === undefined ? [] : expandDshStorageRecord(record);
    } catch {
      return [];
    }
  });
  const header = events.find((event) => event.type === "session");
  const sessionId = string(header?.id);
  if (sessionId === undefined) return undefined;
  return { path, sessionId, text, events };
}

async function readDshSessionEvidence(
  home: string,
  cwd: string,
  startedAt: number,
  resumeSessionId?: string,
): Promise<DshSessionEvidence | undefined> {
  // Same rule as findDshSessionArtifact: a named session is read by name, and a
  // miss stays a miss. Widening to discovery would read a sibling actor's
  // conversation into this actor's transcript, and the next epoch would replay
  // it back as if it were its own history.
  if (resumeSessionId !== undefined) {
    const known = await sessionArtifactForId(home, resumeSessionId);
    if (known === undefined) return undefined;
    try {
      return decodeDshSession(known, await readFile(known));
    } catch {
      // A writer may still be publishing the first frame; the caller keeps the
      // records it tailed itself.
      return undefined;
    }
  }
  const candidates = await sessionArtifactPaths(home, cwd);
  const ranked: Array<{ readonly path: string; readonly mtimeMs: number }> = [];
  for (const path of candidates) {
    try {
      const identity = await stat(path);
      if (identity.mtimeMs >= startedAt - 1000) ranked.push({ path, mtimeMs: identity.mtimeMs });
    } catch {
      // The child may have removed an incomplete file between listing and stat.
    }
  }
  ranked.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of ranked) {
    try {
      const evidence = decodeDshSession(candidate.path, await readFile(candidate.path));
      const header = evidence?.events.find((event) => event.type === "session");
      if (evidence !== undefined && (string(header?.cwd) === undefined || header?.cwd === cwd)) return evidence;
    } catch {
      // Native evidence is best effort for a successful child. The stdout
      // result remains usable, while the transcript records what was available.
    }
  }
  return undefined;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function visibleAssistantText(message: AgentMessage): string | undefined {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return undefined;
  const text = message.content.flatMap((part): readonly string[] => {
    const block = asRecord(part);
    if (block === undefined || (block.type !== undefined && block.type !== "text")) return [];
    return typeof block.text === "string" ? [block.text] : [];
  }).join("");
  return text === "" ? undefined : text;
}

function dshUsage(data: JsonRecord): AgentUsage | undefined {
  return extractUsage({ usage: data.usage });
}

function dshAssistantRecord(data: JsonRecord): DshAssistantRecord | undefined {
  const message = asAgentMessage(data.message);
  const turn = number(data.turn);
  if (turn === undefined) return undefined;
  const usage = dshUsage(data);
  return { turn, message: sanitizeAssistantMessage(message), ...(usage === undefined ? {} : { usage }) };
}

function createDshEventMapper(
  accumulator: SubprocessAccumulator,
  emit: (event: AgentEvent) => void,
): DshEventMapper {
  const processedRecords = new Set<string>();
  const emittedUsageSteps = new Set<string>();
  const startedTextSteps = new Set<string>();
  let assistantMessages = 0;
  let lastAssistantText: string | undefined;
  const toolNames = accumulator.toolNames ??= new Map();
  const turnMessages = new Map<number, AgentMessage>();
  const turnToolResults = new Map<number, AgentMessage[]>();
  const openTurns = new Set<number>();
  const completedTurns = new Set<number>();

  const stepKey = (data: JsonRecord): string | undefined => {
    const turn = number(data.turn);
    const step = number(data.step);
    return turn === undefined || step === undefined ? undefined : `${turn}/${step}`;
  };

  const emitAssistant = (assistant: DshAssistantRecord, data: JsonRecord): void => {
    assistantMessages += 1;
    lastAssistantText = visibleAssistantText(assistant.message);
    turnMessages.set(assistant.turn, assistant.message);
    emitMessageEnd(assistant.message, accumulator, emit);
    const usage = assistant.usage;
    const key = stepKey(data);
    if (usage !== undefined && (key === undefined || !emittedUsageSteps.has(key))) {
      if (key !== undefined) emittedUsageSteps.add(key);
      emit({ type: "usage", usage });
    }
  };

  const emitTurnStart = (turn: number | undefined): void => {
    if (turn !== undefined) {
      if (openTurns.has(turn) || completedTurns.has(turn)) return;
      openTurns.add(turn);
    }
    emit({ type: "turn_start" });
  };

  const emitTurnEnd = (turn: number | undefined): void => {
    const message = turn === undefined ? {} : turnMessages.get(turn) ?? { role: "assistant", content: "" };
    emit({
      type: "turn_end",
      message,
      toolResults: turn === undefined ? [] : turnToolResults.get(turn) ?? [],
    });
    if (turn !== undefined) {
      openTurns.delete(turn);
      completedTurns.add(turn);
    }
  };

  const process = (event: JsonRecord): void => {
    const recordKey = dshRecordKey(event);
    if (processedRecords.has(recordKey)) return;
    processedRecords.add(recordKey);
    const data = asRecord(event.data) ?? {};
    switch (event.type) {
      case "turn/start":
        emitTurnStart(number(data.turn));
        break;
      case "step/start":
        // dsh's current session format emits step boundaries for each model
        // call and may omit the outer turn/end when headless shutdown races
        // persistence. A step can still recover a missing turn start, while
        // the finalizer below closes the open outer turn exactly once.
        emitTurnStart(number(data.turn));
        break;
      case "assistant/message": {
        const assistant = dshAssistantRecord(data);
        if (assistant === undefined) break;
        emitAssistant(assistant, data);
        break;
      }
      case "assistant/chunk": {
        const chunk = asRecord(data.chunk);
        const turn = number(data.turn);
        const step = number(data.step);
        const key = stepKey(data);
        if (chunk?.type === "usage") {
          const usage = extractUsage(chunk);
          if (usage !== undefined && (key === undefined || !emittedUsageSteps.has(key))) {
            if (key !== undefined) emittedUsageSteps.add(key);
            emit({ type: "usage", usage });
          }
        } else if (chunk?.type === "text-delta" && typeof chunk.text === "string") {
          if (key !== undefined && !startedTextSteps.has(key)) {
            startedTextSteps.add(key);
            accumulator.text = "";
            // dsh applies the same gateway path as the other subprocess
            // adapters. Holding an undecidable prefix keeps a split diagnostic
            // banner out of the live block while ordinary text passes through.
            accumulator.proxyPending = "";
            emit({ type: "message_start", message: { role: "assistant", content: [] } });
          }
          emitStreamedText(chunk.text, accumulator, emit, {
            turn,
            step,
            contentIndex: number(chunk.index),
          });
        } else if (chunk?.type === "reasoning-delta" && typeof chunk.text === "string") {
          emit({
            type: "message_update",
            message: { role: "assistant", content: accumulator.text },
            assistantMessageEvent: { type: "reasoning_delta", delta: chunk.text, turn, step },
          });
        }
        break;
      }
      case "tool/call": {
        const callId = string(data.callId) ?? "unknown";
        const toolName = string(data.name) ?? "unknown";
        toolNames.set(callId, toolName);
        emit({ type: "tool_execution_start", toolCallId: callId, toolName, args: jsonValue(data.arguments) });
        break;
      }
      case "tool/result": {
        const message = asAgentMessage(data.message);
        const resultBlock = Array.isArray(message.content)
          ? message.content.map(asRecord).find((part) => part?.type === "tool-result")
          : undefined;
        const callId = string(data.callId)
          ?? string(resultBlock?.toolCallId)
          ?? string(asRecord(message.source)?.callId)
          ?? "unknown";
        const toolName = toolNames.get(callId) ?? "unknown";
        const isError = resultBlock?.isError === true || data.error !== undefined;
        emit({
          type: "tool_execution_end",
          toolCallId: callId,
          toolName,
          result: resultBlock?.content ?? message.content ?? data.meta,
          isError,
        });
        const turn = number(data.turn);
        if (turn !== undefined) {
          const results = turnToolResults.get(turn) ?? [];
          results.push(message);
          turnToolResults.set(turn, results);
        }
        toolNames.delete(callId);
        break;
      }
      case "turn/end": {
        emitTurnEnd(number(data.turn));
        break;
      }
      case "step/end":
        // step/end is intentionally not normalized to turn_end: one dsh turn
        // can contain several model/tool steps. The outer turn/end (or the
        // finish-time recovery for a headless session) owns that boundary.
        break;
      default:
        break;
    }
  };

  return {
    process,
    finish(finalText: string): boolean {
      const text = stripProxyDiagnostic(finalText);
      let fallbackEmitted = false;
      if (text !== "") {
        // The native stdout result is the process-level verdict. Keep the
        // accumulator aligned with it, but only create a second visible block
        // when the durable stream did not contain an assistant text message.
        accumulator.text = text;
        if (lastAssistantText === undefined) {
          emitMessageEnd({ role: "assistant", content: text }, accumulator, emit);
          fallbackEmitted = true;
        }
      }
      for (const turn of [...openTurns]) emitTurnEnd(turn);
      return assistantMessages > 0 || fallbackEmitted;
    },
  };
}

function dshRecordKey(record: JsonRecord): string {
  const seq = number(record.seq);
  if (seq !== undefined) return `seq:${seq}`;
  try {
    return `record:${JSON.stringify(record)}`;
  } catch {
    return `record:${Object.keys(record).join(",")}`;
  }
}

/** Consume complete JSONL records from a physical file prefix. Plain JSONL
 * writes and zstd frames can both be observed halfway through a write, so the
 * byte buffer retains the final unterminated record until the next poll. */
class DshSessionTailerImpl implements DshSessionTailer {
  private readonly seen = new Set<string>();
  private readonly records: JsonRecord[] = [];
  private filePath: string | undefined;
  private fileBytes = 0;
  private plainOffset = 0;
  private zstdFrameCount = 0;
  private pending = Buffer.alloc(0);
  private sessionHeader: JsonRecord | undefined;
  private stopped = false;
  private loop: Promise<void> | undefined;
  private finished: Promise<DshSessionEvidence | undefined> | undefined;

  constructor(
    private readonly home: string,
    private readonly cwd: string,
    private readonly startedAt: number,
    private readonly mapper: DshEventMapper,
    private readonly resumeSessionId?: string,
  ) {}

  start(): void {
    if (this.loop !== undefined) return;
    this.loop = this.pollLoop();
  }

  async finish(): Promise<DshSessionEvidence | undefined> {
    if (this.finished !== undefined) return this.finished;
    this.finished = this.finishOnce();
    return this.finished;
  }

  private async finishOnce(): Promise<DshSessionEvidence | undefined> {
    this.stopped = true;
    await this.loop;
    // One final read closes the race where the process exits immediately after
    // the last persistence batch becomes visible to the filesystem.
    await this.poll();
    const complete = await readDshSessionEvidence(this.home, this.cwd, this.startedAt, this.resumeSessionId);
    if (complete !== undefined) {
      for (const event of complete.events) {
        if (event.type !== "session") this.accept(event);
      }
      return complete;
    }
    return this.sessionHeader === undefined || this.filePath === undefined
      ? undefined
      : {
        path: this.filePath,
        sessionId: string(this.sessionHeader.id) ?? "",
        text: "",
        events: [this.sessionHeader, ...this.records],
      };
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      await this.poll();
      if (!this.stopped) await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }

  private async poll(): Promise<void> {
    try {
      if (this.filePath === undefined) this.filePath = await findDshSessionArtifact(this.home, this.cwd, this.startedAt, this.resumeSessionId);
      if (this.filePath === undefined) return;
      const raw = await readFile(this.filePath);
      if (this.filePath.endsWith(".zstd")) this.consumeZstd(raw);
      else this.consumePlain(raw);
    } catch {
      // Session discovery and reads are best effort. The final stdout result
      // remains valid when a native artifact is absent or being repaired.
    }
  }

  private resetPhysicalCursor(): void {
    this.fileBytes = 0;
    this.plainOffset = 0;
    this.zstdFrameCount = 0;
    this.pending = Buffer.alloc(0);
  }

  private consumePlain(raw: Buffer): void {
    if (raw.length < this.fileBytes) this.resetPhysicalCursor();
    this.fileBytes = raw.length;
    if (raw.length <= this.plainOffset) return;
    this.consumeDecoded(raw.subarray(this.plainOffset));
    this.plainOffset = raw.length;
  }

  private consumeZstd(raw: Buffer): void {
    if (raw.length < this.fileBytes) this.resetPhysicalCursor();
    this.fileBytes = raw.length;
    const frames = dshZstdFrames(raw);
    for (let index = this.zstdFrameCount; index < frames.length; index += 1) {
      const frame = frames[index];
      if (frame === undefined) continue;
      try {
        this.consumeDecoded(zstdDecompressSync(raw.subarray(frame.start, frame.end)));
      } catch {
        // A frame can become visible between its append and its final fsync;
        // retry it on the next poll rather than advancing the frame cursor.
        break;
      }
      this.zstdFrameCount = index + 1;
    }
  }

  private consumeDecoded(bytes: Buffer): void {
    this.pending = this.pending.length === 0 ? Buffer.from(bytes) : Buffer.concat([this.pending, bytes]);
    let newline = this.pending.indexOf(0x0a);
    while (newline >= 0) {
      const line = this.pending.subarray(0, newline);
      this.pending = this.pending.subarray(newline + 1);
      this.consumeLine(line);
      newline = this.pending.indexOf(0x0a);
    }
  }

  private consumeLine(line: Buffer): void {
    if (line.toString("utf8").trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line.toString("utf8")) as unknown;
    } catch {
      return;
    }
    const record = asRecord(value);
    if (record === undefined) return;
    if (record.type === "session") {
      this.sessionHeader = record;
      return;
    }
    for (const event of expandDshStorageRecord(record)) this.accept(event);
  }

  private accept(record: JsonRecord): void {
    const key = dshRecordKey(record);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.records.push(record);
    this.mapper.process(record);
  }
}

function createDshSessionTailer(
  home: string,
  cwd: string,
  startedAt: number,
  mapper: DshEventMapper,
  resumeSessionId?: string,
): DshSessionTailerImpl {
  const tailer = new DshSessionTailerImpl(home, cwd, startedAt, mapper, resumeSessionId);
  tailer.start();
  return tailer;
}

function sessionIdFromValue(value: unknown): string | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const direct = record.sessionId ?? record.session_id ?? record.threadId ?? record.thread_id;
  if (typeof direct === "string" && direct !== "") return direct;
  const message = asRecord(record.message);
  const nested = message?.sessionId ?? message?.session_id;
  return typeof nested === "string" && nested !== "" ? nested : undefined;
}

function emitTextDelta(
  text: string,
  accumulator: SubprocessAccumulator,
  emit: (event: AgentEvent) => void,
  metadata: JsonRecord = {},
): void {
  if (text === "") return;
  accumulator.text += text;
  emit({
    type: "message_update",
    message: { role: "assistant", content: accumulator.text },
    assistantMessageEvent: { type: "text_delta", delta: text, ...metadata },
  });
}

/** Gate one streamed text delta through the banner hold. A Claude
 * `message_start` arms the hold; undecided prefixes stay back and the
 * decidable remainder streams instead, so the live block carries exactly the
 * model's text. Past the head (or unarmed, e.g. Pi), deltas pass straight
 * through to `emitTextDelta`. */
function emitStreamedText(
  text: string,
  accumulator: SubprocessAccumulator,
  emit: (event: AgentEvent) => void,
  metadata: JsonRecord,
): void {
  if (typeof accumulator.proxyPending !== "string") {
    emitTextDelta(text, accumulator, emit, metadata);
    return;
  }
  const { flush, hold } = flushProxyBanner(accumulator.proxyPending + text);
  accumulator.proxyPending = hold === "" ? null : hold;
  if (flush !== "") emitTextDelta(flush, accumulator, emit, metadata);
}

function emitMessageEnd(
  message: AgentMessage,
  accumulator: SubprocessAccumulator,
  emit: (event: AgentEvent) => void,
): void {
  accumulator.proxyPending = null; // the completed record is the text verdict
  const text = messageText(message);
  if (message.role === undefined || message.role === "assistant") {
    if (text !== undefined) {
      accumulator.text = text;
      accumulator.lastMessageEndText = text;
    }
  }
  emit({ type: "message_end", message });
  const usage = extractUsage(message);
  if (usage !== undefined) emit({ type: "usage", usage });
}

function emitToolUse(
  value: JsonRecord,
  emit: (event: AgentEvent) => void,
  accumulator?: SubprocessAccumulator,
): void {
  const tool = asRecord(value);
  const toolCallId = string(tool?.toolCallId ?? tool?.tool_use_id ?? tool?.id) ?? "unknown";
  const toolName = string(tool?.toolName ?? tool?.name) ?? "unknown";
  if (accumulator !== undefined) {
    accumulator.toolNames ??= new Map();
    accumulator.toolNames.set(toolCallId, toolName);
  }
  emit({
    type: "tool_execution_start",
    toolCallId,
    toolName,
    args: tool?.args ?? tool?.input ?? tool?.arguments ?? {},
  });
}

function emitToolResult(
  value: JsonRecord,
  emit: (event: AgentEvent) => void,
  accumulator: SubprocessAccumulator,
): void {
  const toolCallId = string(value.toolCallId ?? value.tool_use_id ?? value.id) ?? "unknown";
  const toolName = string(value.toolName ?? value.name)
    ?? accumulator.toolNames?.get(toolCallId)
    ?? "unknown";
  emit({
    type: "tool_execution_end",
    toolCallId,
    toolName,
    result: value.result ?? value.content ?? value.output,
    isError: value.isError === true || value.is_error === true,
  });
  accumulator.toolNames?.delete(toolCallId);
}

/** Normalize Codex CLI's JSONL event dialect. Codex deliberately keeps the
 * event stream separate from the Claude/Pi message protocol: threads and turns
 * are dotted lifecycle records, while assistant/tool payloads live under an
 * `item` object. Keep the translation here so the rest of Piano sees the same
 * chat, trajectory, usage, and continuation events as every other subprocess
 * harness. */
function normalizeCodexRecord(
  value: JsonRecord,
  emit: (event: AgentEvent) => void,
  accumulator: SubprocessAccumulator,
): boolean {
  const type = string(value.type);
  switch (type) {
    case "thread.started":
      accumulator.sessionId ??= sessionIdFromValue(value);
      return true;
    case "turn.started":
      emit({ type: "turn_start" });
      return true;
    case "turn.completed": {
      const usage = extractUsage(value);
      if (usage !== undefined) emit({ type: "usage", usage });
      emit({
        type: "turn_end",
        message: { role: "assistant", content: accumulator.text },
        toolResults: [],
      });
      accumulator.turnEnded = true;
      return true;
    }
    case "turn.failed": {
      const failure = asRecord(value.error);
      emit({
        type: "error",
        errorType: "request-rejected",
        message: string(failure?.message ?? value.message) ?? "Codex turn failed",
      });
      accumulator.turnEnded = true;
      return true;
    }
    case "item.started":
    case "item.updated":
    case "item.completed": {
      const item = asRecord(value.item);
      if (item === undefined) return true;
      const itemType = string(item.type);
      if (itemType === "agent_message") {
        if (type === "item.updated") {
          const delta = string(item.delta ?? item.text_delta);
          if (delta !== undefined) emitStreamedText(delta, accumulator, emit, {});
          return true;
        }
        if (type === "item.completed") {
          const message = asAgentMessage(item.message ?? {
            role: "assistant",
            content: item.text ?? item.content ?? "",
          });
          emitMessageEnd(sanitizeAssistantMessage(assistantMessage(message)), accumulator, emit);
        }
        return true;
      }
      const isTool = itemType === "command_execution"
        || itemType === "mcp_tool_call"
        || itemType === "function_call";
      if (!isTool) return true;
      const toolCallId = string(item.id) ?? `codex-${itemType}`;
      const toolName = itemType === "command_execution"
        ? "bash"
        : string(item.name ?? item.tool_name) ?? "unknown";
      const args = itemType === "command_execution"
        ? { command: item.command ?? "" }
        : item.arguments ?? item.input ?? {};
      if (type === "item.started" || accumulator.toolNames?.has(toolCallId) !== true) {
        emitToolUse({ id: toolCallId, name: toolName, input: args }, emit, accumulator);
      }
      if (type === "item.completed") {
        const exitCode = number(item.exit_code ?? item.exitCode);
        emitToolResult({
          id: toolCallId,
          name: toolName,
          result: item.aggregated_output ?? item.output ?? item.result ?? "",
          isError: item.status === "failed" || (exitCode !== undefined && exitCode !== 0),
        }, emit, accumulator);
      }
      return true;
    }
    case "error":
      emit({
        type: "error",
        errorType: "request-rejected",
        message: string(value.message) ?? "Codex request failed",
      });
      return true;
    default:
      return false;
  }
}

/** Normalize one complete stdout NDJSON frame. It is pure apart from the
 * supplied event sink, which makes chunking/close behavior testable without a
 * child process. Both Pi JSON mode and Claude stream-json shapes are accepted. */
export function normalizeSubprocessLine(
  line: string,
  harness: HarnessName,
  emit: (event: AgentEvent) => void,
  accumulator: SubprocessAccumulator,
): void {
  let value: JsonRecord;
  try {
    const parsed: unknown = JSON.parse(line);
    const record = asRecord(parsed);
    if (record === undefined) {
      emit({ type: "unknown", sourceType: "invalid-record", data: parsed });
      return;
    }
    value = record;
  } catch {
    emit({ type: "unknown", sourceType: "invalid-json", data: line });
    return;
  }

  normalizeSubprocessRecord(value, harness, emit, accumulator);
}

/** Normalize one parsed NDJSON record. Split out from the line reader so a
 * Claude `stream_event` envelope can hand its wrapped Anthropic frame back
 * through the same cases rather than growing a parallel decoder. */
function normalizeSubprocessRecord(
  value: JsonRecord,
  harness: HarnessName,
  emit: (event: AgentEvent) => void,
  accumulator: SubprocessAccumulator,
): void {
  accumulator.sessionId ??= sessionIdFromValue(value);
  const type = string(value.type);
  if (harness === "codex" && normalizeCodexRecord(value, emit, accumulator)) return;
  switch (type) {
    // Claude's `--include-partial-messages` wraps every raw Anthropic stream
    // frame in a `stream_event` envelope. Unwrapping it here is what puts
    // Claude on the `message_update` / `text_delta` contract Pi already emits,
    // so the TUI's one live-stream renderer drives both harnesses. Without it
    // the CLI reports only completed `assistant` blocks and the chat area
    // stays parked at the head of the transcript until the reply is over.
    case "stream_event": {
      const event = asRecord(value.event);
      const inner = string(event?.type);
      // A nested envelope is not a shape the CLI emits; a hostile or buggy
      // frame must not recurse forever.
      if (event !== undefined && inner !== undefined && inner !== "stream_event") {
        normalizeSubprocessRecord(event, harness, emit, accumulator);
      }
      return;
    }
    // Claude's CLI also emits bare `system` lifecycle frames (`init`, `status`,
    // `success`, and the `thinking_tokens` heartbeats that stream alongside
    // text). They carry no chat content, and rendering them as `unknown` would
    // drop raw JSON into the transcript and close the live text block mid-turn.
    // The session id they announce is already captured above the switch.
    case "system":
      return;
    case "agent_start":
      emit({ type: "agent_start" });
      return;
    case "agent_end":
      emit({
        type: "agent_end",
        messages: Array.isArray(value.messages) ? value.messages.map(asAgentMessage) : [],
        willRetry: value.willRetry === true,
      });
      return;
    case "agent_settled":
      emit({ type: "agent_settled" });
      // pi RPC has no `result`/`done` frame: `agent_settled` is its terminal —
      // no automatic retry, compaction retry, or queued continuation remains.
      // Marking the turn ended triggers the stdin wind-down; harmless for the
      // SDK's own `agent_settled` (no bridge, no child stdin to close).
      accumulator.turnEnded = true;
      return;
    case "turn_start":
      emit({ type: "turn_start" });
      return;
    case "turn_end":
      emit({
        type: "turn_end",
        message: asAgentMessage(value.message),
        toolResults: Array.isArray(value.toolResults) ? value.toolResults.map(asAgentMessage) : [],
      });
      return;
    case "message_start": {
      const message = asAgentMessage(value.message ?? value);
      if (harness === "claude") accumulator.proxyPending = ""; // the gateway banner heads the message text
      emit({ type: "message_start", message });
      return;
    }
    case "message_update": {
      const message = asAgentMessage(value.message);
      const update = asAgentMessageEvent(value.assistantMessageEvent);
      if ((message.role === undefined || message.role === "assistant") && update.type === "text_delta" && typeof update.delta === "string") {
        accumulator.text += update.delta;
      } else if ((message.role === undefined || message.role === "assistant") && update.type === "text_end" && typeof update.content === "string") {
        accumulator.text = update.content;
      } else {
        const text = messageText(message);
        if (text !== undefined && (message.role === undefined || message.role === "assistant")) accumulator.text = text;
      }
      emit({ type: "message_update", message, assistantMessageEvent: update });
      return;
    }
    case "message_end":
      emitMessageEnd(sanitizeAssistantMessage(asAgentMessage(value.message ?? value)), accumulator, emit);
      return;
    case "content_block_delta": {
      const delta = asRecord(value.delta);
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        emitStreamedText(delta.text, accumulator, emit, { contentIndex: value.index });
      } else if (delta?.type === "input_json_delta") {
        const contentIndex = number(value.index);
        const tool = contentIndex === undefined ? undefined : accumulator.toolCallsByContentIndex?.get(contentIndex);
        emit({
          type: "tool_execution_update",
          toolCallId: tool?.toolCallId ?? "unknown",
          toolName: tool?.toolName ?? "unknown",
          args: {},
          partialResult: delta.partial_json ?? "",
        });
      } else {
        emit({
          type: "message_update",
          message: { role: "assistant", content: accumulator.text },
          assistantMessageEvent: asAgentMessageEvent(delta ?? value),
        });
      }
      return;
    }
    case "content_block_start": {
      const block = asRecord(value.content_block ?? value.block);
      if (block?.type === "tool_use") {
        emitToolUse(block, emit, accumulator);
        const contentIndex = number(value.index);
        if (contentIndex !== undefined) {
          accumulator.toolCallsByContentIndex ??= new Map();
          accumulator.toolCallsByContentIndex.set(contentIndex, {
            toolCallId: string(block.id ?? block.toolCallId) ?? "unknown",
            toolName: string(block.name ?? block.toolName) ?? "unknown",
          });
        }
      }
      else if (block?.type === "text") {
        // The gateway banner heads the TEXT block, which can open after the
        // thinking message's snapshot already disarmed the hold (observed
        // live: `message_start`, thinking, `assistant`, then `content_block_start`
        // for text — no second `message_start`). Re-arm at every text block.
        if (harness === "claude") accumulator.proxyPending = "";
        emit({ type: "message_start", message: { role: "assistant", content: [] } });
      }
      return;
    }
    case "content_block_stop": {
      const contentIndex = number(value.index);
      if (contentIndex !== undefined) accumulator.toolCallsByContentIndex?.delete(contentIndex);
      return;
    }
    case "tool_execution_start":
    case "tool_use":
    case "tool_call":
      emitToolUse(value, emit, accumulator);
      return;
    case "tool_execution_update": {
      const toolCallId = string(value.toolCallId ?? value.tool_use_id ?? value.id) ?? "unknown";
      const toolName = string(value.toolName ?? value.name)
        ?? accumulator.toolNames?.get(toolCallId)
        ?? "unknown";
      emit({
        type: "tool_execution_update",
        toolCallId,
        toolName,
        args: value.args ?? value.input ?? {},
        partialResult: value.partialResult ?? value.delta ?? value.output,
      });
      return;
    }
    case "tool_execution_end":
    case "tool_result":
      emitToolResult(value, emit, accumulator);
      return;
    case "user": {
      const message = asAgentMessage(value.message ?? value);
      const normalized = message.role === undefined ? { ...message, role: "user" } : message;
      const content = Array.isArray(normalized.content) ? normalized.content : [];
      for (const part of content) {
        const block = asRecord(part);
        if (block?.type === "tool_result") emitToolResult(block, emit, accumulator);
      }
      emit({ type: "message_end", message: normalized });
      return;
    }
    case "assistant": {
      const message = sanitizeAssistantMessage(assistantMessage(value.message ?? value));
      const content = Array.isArray(message.content) ? message.content : [];
      for (const part of content) {
        const block = asRecord(part);
        if (block?.type === "tool_use") emitToolUse(block, emit, accumulator);
      }
      emitMessageEnd(message, accumulator, emit);
      return;
    }
    case "message_delta": {
      const error = asRecord(value.delta)?.stop_reason === "error" ? string(asRecord(value.delta)?.error) : undefined;
      if (error !== undefined) emit({ type: "error", errorType: "request-rejected", message: error });
      const usage = extractUsage(value);
      if (usage !== undefined) emit({ type: "usage", usage });
      return;
    }
    // The Anthropic end-of-message frame. It carries no text: the completed
    // `assistant` record that follows is what emits `message_end`. Treating it
    // as an unmodeled `unknown` would close the live chat block between blocks
    // of the same turn and split the reply across separate Markdown nodes.
    case "message_stop":
      accumulator.proxyPending = null; // past this message's head
      return;
    case "result":
    case "done": {
      const rawText = string(value.result ?? value.text ?? value.output);
      const text = rawText === undefined ? undefined : stripProxyDiagnostic(rawText);
      if (text !== undefined && accumulator.lastMessageEndText !== text) {
        emitMessageEnd(sanitizeAssistantMessage({ role: "assistant", content: text }), accumulator, emit);
      }
      const usage = extractUsage(value);
      if (usage !== undefined) emit({ type: "usage", usage });
      accumulator.turnEnded = true;
      return;
    }
    case "queue_update":
      emit({ type: "queue_update", steering: stringList(value.steering), followUp: stringList(value.followUp) });
      return;
    case "compaction_start":
      emit({ type: "compaction_start", reason: string(value.reason) ?? "unknown" });
      return;
    case "entry_appended":
      emit({ type: "entry_appended", entry: value.entry });
      return;
    case "session_info_changed":
      emit({ type: "session_info_changed", name: typeof value.name === "string" ? value.name : undefined });
      return;
    case "thinking_level_changed":
      emit({ type: "thinking_level_changed", level: string(value.level) ?? "unknown" });
      return;
    case "compaction_end":
      emit({
        type: "compaction_end",
        reason: string(value.reason) ?? "unknown",
        result: value.result,
        aborted: value.aborted === true,
        willRetry: value.willRetry === true,
        ...(typeof value.errorMessage === "string" ? { errorMessage: value.errorMessage } : {}),
      });
      return;
    case "auto_retry_start":
      emit({
        type: "auto_retry_start",
        attempt: number(value.attempt) ?? 0,
        maxAttempts: number(value.maxAttempts) ?? 0,
        delayMs: number(value.delayMs) ?? 0,
        errorMessage: string(value.errorMessage) ?? "retry requested",
      });
      return;
    case "auto_retry_end":
      emit({
        type: "auto_retry_end",
        success: value.success === true,
        attempt: number(value.attempt) ?? 0,
        ...(typeof value.finalError === "string" ? { finalError: value.finalError } : {}),
      });
      return;
    case "summarization_retry_scheduled":
      emit({
        type: "summarization_retry_scheduled",
        attempt: number(value.attempt) ?? 0,
        maxAttempts: number(value.maxAttempts) ?? 0,
        delayMs: number(value.delayMs) ?? 0,
        errorMessage: string(value.errorMessage) ?? "retry requested",
      });
      return;
    case "summarization_retry_attempt_start":
      emit({ type: "summarization_retry_attempt_start", source: string(value.source) ?? "unknown", ...(typeof value.reason === "string" ? { reason: value.reason } : {}) });
      return;
    case "summarization_retry_finished":
      emit({ type: "summarization_retry_finished" });
      return;
    case "bash_execution_update":
      emit({ type: "bash_execution_update", ...(typeof value.id === "string" ? { id: value.id } : {}), delta: typeof value.delta === "string" ? value.delta : "" });
      return;
    case "response":
      // pi RPC's command acknowledgment, and the only place a frame Piano wrote
      // is confirmed. It is delivered to the pi request broker (which matches it
      // to the pending write by id) and otherwise stays out of the transcript:
      // the broker turns a refusal into the rejection of whichever call asked
      // for it, so the attempt never mistakes a successful envelope for a fault
      // of its own.
      return;
    default: {
      const usage = extractUsage(value);
      if (usage !== undefined) emit({ type: "usage", usage });
      emit({ type: "unknown", sourceType: type ?? `${harness}:unknown`, data: value });
    }
  }
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function readResource(path: string): Promise<string> {
  const info = await stat(path);
  return info.isDirectory() ? readFile(join(path, "SKILL.md"), "utf8") : readFile(path, "utf8");
}

async function loadResources(
  request: AgentRequest,
  emit: (event: AgentEvent) => void,
): Promise<LoadedResources> {
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
  try {
    let systemPrompt: string | undefined;
    if (request.systemPromptPath !== undefined) {
      failedKind = "system-prompt";
      failedPath = request.systemPromptPath;
      systemPrompt = await readResource(request.systemPromptPath);
      emit({ type: "resource", resource: { kind: "system-prompt", status: "loaded", source: "workflow", path: request.systemPromptPath, bytes: Buffer.byteLength(systemPrompt, "utf8") } });
    } else {
      emit({ type: "resource", resource: { kind: "system-prompt", status: "loaded", source: "sdk-default" } });
    }
    for (const path of request.contextFilePaths ?? []) {
      failedKind = "context-file";
      failedPath = path;
      const content = await readResource(path);
      contextFiles.push({ path, content });
      emit({ type: "resource", resource: { kind: "context-file", status: "loaded", source: "workflow", path, bytes: Buffer.byteLength(content, "utf8") } });
    }
    for (const path of request.skillPaths ?? []) {
      failedKind = "skill";
      failedPath = path;
      const content = await readResource(path);
      skills.push({ path, content });
      emit({ type: "resource", resource: { kind: "skill", status: "loaded", source: "workflow", path, bytes: Buffer.byteLength(content, "utf8") } });
    }
    return { systemPrompt, contextFiles, skills };
  } catch (cause) {
    emit({ type: "resource", resource: { kind: failedKind, status: "failed", source: "workflow", path: failedPath ?? request.cwd, error: cause instanceof Error ? cause.message : String(cause) } });
    throw agentError("resource-unavailable", cause);
  }
}

function piArguments(
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
function codexArguments(
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

function claudeArguments(
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
function userFrame(text: string): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  });
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
 * resolve a steer: the ack does, and a refusal rejects the caller's promise
 * instead of being reported as delivered. */
class DshSteerAcks {
  private nextId = 0;
  private readonly pending = new Map<string, {
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }>();

  frame(text: string): { readonly json: string; readonly settled: Promise<void> } {
    this.nextId += 1;
    const id = `steer-${this.nextId}`;
    const settled = new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    settled.catch(() => undefined);
    return { json: dshSteerFrame(text, id), settled };
  }

  /** One stderr line, settling the frame it answers if it is an ack. */
  accept(line: string): void {
    const ack = dshSteerAck(line);
    if (ack === undefined) return;
    const pending = this.pending.get(ack.id);
    if (pending === undefined) return;
    this.pending.delete(ack.id);
    if (ack.accepted) {
      pending.resolve();
      return;
    }
    pending.reject(new AgentError({
      kind: "request-rejected",
      message: ack.reason ?? "the dsh turn had already ended, so the steer was dropped",
    }));
  }

  /** The child is gone: nothing can still be acknowledged. */
  abort(reason: string): void {
    const error = new AgentError({ kind: "harness-unavailable", message: reason });
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
  }
}

function dshSteerAck(line: string): { readonly id: string; readonly accepted: boolean; readonly reason?: string } | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith(DSH_STEER_ACK_PREFIX)) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(DSH_STEER_ACK_PREFIX.length));
    const record = asRecord(parsed);
    const id = string(record?.id);
    if (record === undefined || id === undefined || typeof record.accepted !== "boolean") return undefined;
    const reason = string(record.reason);
    return { id, accepted: record.accepted, ...(reason === undefined ? {} : { reason }) };
  } catch {
    return undefined;
  }
}

/** Whether a stderr line is a steering ack rather than something the run said.
 * Checked before the line becomes an event: an ack is the answer to one of
 * Piano's own writes, so reporting it as run output would hand the caller an
 * event while its own steer is still in flight. */
function isSteerAckLine(line: string): boolean {
  return line.trim().startsWith(DSH_STEER_ACK_PREFIX);
}

/** The id the initial `prompt` frame carries, so the broker can tell the
 * attempt's own task frame apart from every `steer` it later injects. */
const PI_PROMPT_REQUEST_ID = "piano-prompt";

/**
 * The far end of pi RPC's request/response protocol.
 *
 * Every frame Piano writes carries an `id` and every reply pi sends is a
 * `type:"response"` record carrying that same id back, so a write is only
 * really delivered when its own response arrives — a successful pipe write
 * proves nothing about whether the agent accepted the message. The broker owns
 * that correlation: `request` resolves on the matching `success:true`, rejects
 * with the child's own error text on `success:false`, and rejects everything
 * still pending when the stream ends, so a caller can never await an answer
 * that has already become impossible.
 */
export class PiRpcClient {
  private nextId = 0;
  private readonly pending = new Map<string, {
    readonly command: string;
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }>();

  /** Called when pi refuses the attempt's own prompt. The refusal is answered
   * on the response frame, which the broker claims before it can reach the
   * ordinary event path, so whoever owns the child's stdin has to be told from
   * here — pi keeps its stdin loop alive after declining and only an explicit
   * wind-down ends it. */
  onPromptRefusal: (() => void) | undefined;

  /** Next request id in this client's own sequence. */
  private id(): string {
    this.nextId += 1;
    return `piano-${this.nextId}`;
  }

  /** Record one response frame. Returns true when it belonged to a pending
   * request, false when nothing was waiting for it (a stray or duplicate
   * frame, which the caller then handles as an ordinary event). */
  settle(value: JsonRecord): boolean {
    const id = string(value.id);
    if (id === undefined) return false;
    const pending = this.pending.get(id);
    if (pending === undefined) return false;
    this.pending.delete(id);
    if (value.success === true) {
      pending.resolve();
      return true;
    }
    const reason = string(value.error) ?? "unknown reason";
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
    pending.reject(error);
    return true;
  }

  /** Build a frame whose acknowledgment this client will await. */
  frame(text: string): { readonly id: string; readonly json: string } {
    const id = this.id();
    return { id, json: JSON.stringify({ id, type: "steer", message: text }) };
  }

  /**
   * Write one frame and resolve only once pi has acknowledged it.
   *
   * pi acknowledges a `steer` as soon as the message is queued, not when the
   * model reads it: the protocol has no later signal, so "accepted into the
   * running turn's steering queue" is the strongest delivery this backend can
   * honestly report. A refusal rejects here and stops at this caller instead
   * of failing the whole conversation.
   */
  async request(text: string, write: (json: string) => void): Promise<void> {
    const { id, json } = this.frame(text);
    const settled = new Promise<void>((resolve, reject) => {
      this.pending.set(id, { command: "steer", resolve, reject });
    });
    try {
      write(json);
    } catch (cause) {
      this.pending.delete(id);
      throw cause instanceof Error ? cause : new Error(String(cause));
    }
    return settled;
  }

  /** Build the task frame and the promise pi's acknowledgment settles. The id
   * is the shared prompt id so a refusal is attributable to the attempt. */
  prompt(text: string): { readonly json: string; readonly settled: Promise<void> } {
    const settled = new Promise<void>((resolve, reject) => {
      this.pending.set(PI_PROMPT_REQUEST_ID, { command: "prompt", resolve, reject });
    });
    // A rejection the caller never awaits (the attempt may die from an abort or
    // an exit first) must not surface as an unhandled rejection.
    settled.catch(() => undefined);
    return {
      json: JSON.stringify({ id: PI_PROMPT_REQUEST_ID, type: "prompt", message: text }),
      settled,
    };
  }

  /** A refusal of the attempt's task frame, once observed. */
  get promptRefusal(): AgentError | undefined {
    return this.promptRejection;
  }

  private promptRejection: AgentError | undefined;

  /** Settle every pending request as a failure. Called when stdout closes: the
   * child is gone, so no response can still arrive. */
  abort(reason: string): void {
    const error = new AgentError({ kind: "harness-unavailable", message: reason });
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
  }
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
function piSessionPath(request: AgentRequest, transcriptPath: string): string {
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
function dshResumeSessionId(request: AgentRequest): string | undefined {
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
function dshResumeSessionEnv(resumeSessionId: string | undefined): NodeJS.ProcessEnv {
  // childEnv inherits the parent environment. Explicitly clear a stale resume
  // id when this attempt has no continuation; otherwise an unrelated shell
  // variable can make a fresh attempt reopen the wrong dsh session.
  return { [DSH_RESUME_SESSION_ENV]: resumeSessionId };
}

/** The official dsh launcher has its own headless protocol. It deliberately
 * receives no Pi flags: profile selection, the model overlay, and the task are
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
function dshArguments(
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
async function dshContinuationContext(
  request: AgentRequest,
  resumeSessionId: string | undefined,
): Promise<string | undefined> {
  if (resumeSessionId !== undefined) return undefined;
  const continuation = request.continuation;
  if (continuation === undefined || continuation.harness !== "dsh") return undefined;
  try {
    const transcript = (await readFile(continuation.transcriptPath, "utf8")).trim();
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
  } catch {
    // A failed/interrupted first attempt may not have produced an artifact.
    // Starting without synthetic context is preferable to masking the real task.
    return undefined;
  }
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
    const apiKeyEnv = config.apiKeyEnv ?? "PIANO_DSH_API_KEY";
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
interface ChildStdinControl {
  /** Deliver one steering frame. Resolves when the child has acknowledged
   * acceptance where its protocol can say so (pi RPC correlates by request id);
   * rejects when the child refused it, so the caller — not the whole attempt —
   * owns that outcome. */
  writeFrame(text: string): Promise<void>;
  windDown(): void;
}

/** Per-harness stdin wiring. `initialFrame` is the task frame written as the
 * first stdin line at spawn (claude streaming input; pi RPC `prompt`); a
 * harness whose task travels as argv (dsh) leaves it undefined and uses stdin
 * purely for steering frames, shaped by `frame`. */
interface ChildStdinBridge {
  readonly initialFrame?: string;
  /** Builds a steering frame, returning the line to write and — where the
   * protocol has acknowledgments — the promise they settle. */
  readonly frame: (text: string) => { readonly json: string; readonly settled?: Promise<void> };
  /** Given a response record, the pending frame it settles, if any. */
  readonly settle?: (value: JsonRecord) => boolean;
  /** One line of the child's stderr, read as it arrives — the channel a backend
   * whose acknowledgments cannot travel on stdout answers on. */
  readonly onStderr?: (line: string) => void;
  /** Called when the child's stream ends: whatever the protocol still owed an
   * acknowledgment must fail instead of waiting forever. */
  readonly onClose?: (reason: string) => void;
  onControl(control: ChildStdinControl): void;
}

/** Offer one stdout line to the bridge as a possible response frame. Returns
 * true when a pending write claimed it. */
function consumeResponse(line: string, settle: (value: JsonRecord) => boolean): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return false;
  }
  const record = asRecord(parsed);
  return record !== undefined && string(record.type) === "response" && settle(record);
}

function runChild(
  binPath: string,
  argv: readonly string[],
  request: AgentRequest,
  emitLine: (line: string) => void,
  env: NodeJS.ProcessEnv,
  stdin?: ChildStdinBridge,
  /** One line of the child's stderr, read as it arrives. The ack channel rides
   * on stderr and a steer waits on it while the turn still runs, so this cannot
   * be deferred to close; it is also the run's only mid-turn signal. */
  onStderrLine?: (line: string) => void,
): Promise<ChildOutcome> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(binPath, [...argv], {
        cwd: request.cwd,
        env,
        stdio: stdin === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
        // A CLI harness may launch its own shell/tool children. Keeping the
        // process group separate lets abort terminate the whole adapter tree.
        detached: process.platform !== "win32",
      });
    } catch (cause) {
      reject(cause);
      return;
    }
    const rawLines: string[] = [];
    let lineBuffer = "";
    let stderr = "";
    let aborted = false;
    let spawnError: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let windDownArmed = false;
    let windDownTimer: NodeJS.Timeout | undefined;
    let settled = false;
    const terminate = (signal: NodeJS.Signals): void => {
      if (process.platform !== "win32" && child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall back to the direct child when a platform/runtime rejects a
          // process-group signal (for example after the group leader exits).
        }
      }
      child.kill(signal);
    };
    const onAbort = (): void => {
      if (settled || aborted) return;
      aborted = true;
      terminate("SIGTERM");
      killTimer = setTimeout(() => terminate("SIGKILL"), 2000);
    };
    const consume = (line: string): void => {
      const trimmed = line.trim();
      if (trimmed === "") return;
      rawLines.push(trimmed);
      // A response frame answers a frame Piano wrote, so the bridge gets first
      // refusal on it: it settles the pending write that asked. Only a frame no
      // request claims continues into the ordinary event path.
      if (stdin?.settle !== undefined && consumeResponse(trimmed, stdin.settle)) return;
      emitLine(trimmed);
    };
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (lineBuffer.trim() !== "") consume(lineBuffer);
      lineBuffer = "";
      // The child is gone, so no response can still arrive: anything still
      // awaiting an acknowledgment must fail rather than hang the attempt.
      stdin?.onClose?.(`${binPath} closed before acknowledging`);
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (windDownTimer !== undefined) clearTimeout(windDownTimer);
      request.signal?.removeEventListener("abort", onAbort);
      resolve({
        code, signal, stderr, rawLines,
        ...(spawnError === undefined ? {} : { spawnError }),
        aborted,
        ...(windDownArmed ? { gracefulShutdown: true } : {}),
      });
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.signal?.aborted) onAbort();
    if (stdin !== undefined) {
      // The CLI exits on stdin EOF itself almost always; the grace timer
      // bounds the case where it does not, so a hung post-`result` process
      // can never keep the worker (and the run's stage) open forever.
      const control: ChildStdinControl = {
        writeFrame: async (text: string): Promise<void> => {
          const stream = child.stdin;
          if (settled || windDownArmed || stream === null || stream.destroyed || stream.writableEnded) {
            throw new Error(`${binPath} stdin is closed; the turn has ended`);
          }
          const { json, settled: acknowledged } = stdin.frame(text);
          // Write first, then await: a protocol with acknowledgments only
          // reports success through a response frame that can arrive before the
          // write call itself has returned.
          const written = stream.write(`${json}\n`);
          if (acknowledged === undefined) return;
          // Backpressure is irrelevant next to the ack, but an error on the
          // stream is not: without this the promise would outlive the child.
          if (written === false) await new Promise<void>((resolve) => stream.once("drain", resolve));
          await acknowledged;
        },
        windDown: (): void => {
          if (settled || windDownArmed) return;
          windDownArmed = true;
          try {
            child.stdin?.end();
          } catch {
            // EPIPE here only means the child is already gone; close settles.
          }
          windDownTimer = setTimeout(() => terminate("SIGTERM"), 2000);
        },
      };
      // A stdin stream error (child gone mid-write) must not surface as an
      // unhandled 'error' event; writeFrame's guards report the closure.
      child.stdin?.on("error", () => undefined);
      stdin.onControl(control);
      if (stdin.initialFrame !== undefined) {
        try {
          child.stdin?.write(`${stdin.initialFrame}\n`);
        } catch {
          // A synchronous spawn failure follows on the 'error'/'close' events.
        }
      }
    }
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      lineBuffer += chunk;
      let newline = lineBuffer.indexOf("\n");
      while (newline >= 0) {
        consume(lineBuffer.slice(0, newline));
        lineBuffer = lineBuffer.slice(newline + 1);
        newline = lineBuffer.indexOf("\n");
      }
    });
    child.stderr?.setEncoding("utf8");
    // stderr is kept whole for the failure message, but the steering ack channel
    // rides on it and has to be read as it arrives: a steer waits on its answer
    // while the turn is still running, long before the child closes and the
    // buffered copy becomes readable. The same live read is what surfaces the
    // runner's own notes (`dsh: ...`) as events while the turn runs, so a caller
    // watching the run can see the turn go live rather than only its obituary.
    let stderrBuffer = "";
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
      stderrBuffer += chunk;
      while (true) {
        const newline = stderrBuffer.indexOf("\n");
        if (newline === -1) break;
        const line = stderrBuffer.slice(0, newline);
        stderrBuffer = stderrBuffer.slice(newline + 1);
        stdin?.onStderr?.(line);
        // An ack is protocol metadata answering a write, not something the run
        // said: emitting it would re-enter the caller's event handler while its
        // own steer is still in flight. It settles the pending write instead,
        // and only the runner's notes become events.
        if (isSteerAckLine(line)) continue;
        onStderrLine?.(line);
      }
    });
    child.on("error", (cause) => { spawnError = cause; });
    child.on("close", finish);
    // A killed harness may have handed its stdout/stderr write ends to a
    // detached grandchild, so `close` would wait on a pipe that never EOFs.
    // Once the direct child is gone, an aborted run has no output worth that
    // wait: destroy the read ends so a wedged pipe can neither strand the
    // outcome promise nor hold Node's event loop open past the user's exit.
    // Un-aborted runs keep draining `close` normally — destroying early would
    // truncate the transcript on a clean exit.
    child.on("exit", () => {
      if (aborted) {
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
    });
  });
}

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
  return Effect.gen(function* () {
    if (request.signal?.aborted) return yield* Effect.fail(new AgentError({ kind: "cancelled", message: `${harness} request cancelled` }));
    const observed: AgentEvent[] = [];
    const emit = (event: AgentEvent): void => {
      observed.push(event);
      request.onEvent?.(event);
    };
    const retryRequest: AgentRequest = attempt.continuation === undefined
      ? request
      : { ...request, continuation: attempt.continuation };
    const resources = yield* Effect.tryPromise({ try: () => loadResources(retryRequest, emit), catch: (cause) => cause instanceof AgentError ? cause : agentError("resource-unavailable", cause) });
    emit({ type: "spawn", harness, ...(config.model === undefined ? {} : { model: config.model }), ...(thinking === undefined ? {} : { thinkingLevel: thinking }), skills: [...(retryRequest.skillPaths ?? [])], ...(retryRequest.continuation?.sessionId === undefined ? {} : { memory: retryRequest.continuation.sessionId }) });
    emit({ type: "context", context: { ...(retryRequest.systemPromptPath === undefined ? {} : { systemPromptPath: retryRequest.systemPromptPath }), contextFilePaths: retryRequest.contextFilePaths ?? [], skills: retryRequest.skillPaths ?? [], userMessage: retryRequest.prompt } });
    const accumulator: SubprocessAccumulator = { text: "" };
    const sessionDirectory = retryRequest.sessionDir ?? join(tmpdir(), "piano-subprocess");
    const provisionalId = retryRequest.continuation?.sessionId ?? `${harness}-${randomUUID()}`;
    const transcriptPath = retryRequest.continuation?.transcriptPath ?? join(sessionDirectory, `${provisionalId}.jsonl`);
    yield* Effect.tryPromise({ try: () => mkdir(dirname(transcriptPath), { recursive: true }), catch: (cause) => agentError("session-artifact", cause) });
    const environment = childEnv(harness, config, options, (retryRequest.tools?.length ?? 0) > 0);
    // Resolved before argv because dsh's model overlay lives inside this home.
    const dshHome = environment.DSH_HOME ?? join(homedir(), ".dsh");
    // Pre-spawn guards keep stale generated homes and incomplete web-search
    // configuration from becoming opaque child failures or memory-only A/B
    // runs.
    const failBeforeSpawn = (error: AgentError) => Effect.gen(function* () {
      emit({ type: "error", errorType: error.kind, message: error.message });
      yield* persistAgentEvents(observed, provisionalId);
      return yield* Effect.fail(error);
    });
    const requireOverlay = (
      path: string,
      kind: "model-not-found" | "session-artifact",
      probeFailed: string,
      missing: string,
    ) => Effect.gen(function* () {
      const exists = yield* Effect.tryPromise({
        try: () => access(path).then(() => true, () => false),
        catch: () => new AgentError({ kind, message: probeFailed }),
      });
      if (exists) return;
      return yield* failBeforeSpawn(new AgentError({ kind, message: missing }));
    });
    if (harness === "dsh" && config.model !== undefined) {
      const patchPath = dshModelPatchPath(dshHome, config.model);
      yield* requireOverlay(
        patchPath,
        "model-not-found",
        `cannot inspect the dsh overlay for model "${config.model}"`,
        `dsh model "${config.model}" has no generated overlay at ${patchPath}; `
          + `add "${config.model}" to the models list in ${agentConfigPath()} so Piano can route it`,
      );
    }
    if (harness === "dsh" && retryRequest.tools?.includes(PI_WEB_SEARCH_TOOL_NAME) !== true) {
      const ablationPath = dshWebSearchOffPatchPath(dshHome);
      yield* requireOverlay(
        ablationPath,
        "session-artifact",
        `cannot inspect the dsh web_search ablation overlay at ${ablationPath}`,
        `dsh web_search ablation overlay is missing at ${ablationPath}; `
          + "re-run the mission bootstrap so Piano regenerates the harness home",
      );
    }
    if ((harness === "pi" || harness === "pi-cli")
      && retryRequest.tools?.includes(PI_WEB_SEARCH_TOOL_NAME) === true
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
    const dshResumeId = harness === "dsh" ? dshResumeSessionId(retryRequest) : undefined;
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
        `cannot inspect the dsh resume overlay at ${resumeOverlay}`,
        `dsh resume overlay is missing at ${resumeOverlay}; `
          + "re-run the mission bootstrap so Piano regenerates the harness home",
      );
    }
    const dshContext = harness === "dsh"
      ? yield* Effect.tryPromise({
        try: () => dshContinuationContext(retryRequest, dshResumeId),
        catch: (cause) => agentError("session-artifact", cause),
      })
      : undefined;
    const argv = harness === "claude"
      ? claudeArguments(retryRequest, config, thinking, resources)
      : harness === "dsh"
        ? dshArguments(retryRequest, config, resources, dshHome, dshContext, dshResumeId)
        : harness === "codex"
          ? codexArguments(retryRequest, config, thinking, resources, options.additionalWritableDirs ?? [])
          : piArguments(retryRequest, config, thinking, resources, transcriptPath, harness === "pi");
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
        onControl: (control) => {
          childControl = control;
          unbindSteering = request.steering?.bind({ steer: (text) => control.writeFrame(text) });
        },
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
              childControl = control;
              // pi declines a prompt and then waits for a command that will
              // never come; the refusal arrives on the returned frame, so the
              // only place that can end the child is here.
              piRpc.onPromptRefusal = () => control.windDown();
              unbindSteering = request.steering?.bind({
                steer: (text) => control.writeFrame(text),
              });
            },
          }
        : {
          frame: (text) => dshAcks.frame(text),
          onStderr: (line) => dshAcks.accept(line),
          onClose: (reason) => dshAcks.abort(reason),
          onControl: (control) => {
            childControl = control;
            unbindSteering = request.steering?.bind({ steer: (text) => control.writeFrame(text) });
          },
        };
    let outcome: ChildOutcome;
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
    try {
      outcome = yield* Effect.tryPromise({
        try: () => runChild(sourcePath, argv, retryRequest, (line) => {
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
        }),
        catch: (cause) => agentError("harness-unavailable", cause),
      }).pipe(Effect.ensuring(Effect.sync(() => unbindSteering?.())));
    } catch (cause) {
      if (dshTailer !== undefined) {
        yield* Effect.tryPromise({ try: () => dshTailer.finish(), catch: () => undefined }).pipe(
          Effect.catchAll(() => Effect.succeed(undefined)),
        );
      }
      const error = cause instanceof AgentError ? cause : agentError("harness-unavailable", cause);
      emit({ type: "error", errorType: error.kind, message: error.message });
      yield* persistAgentEvents(observed, provisionalId);
      return yield* Effect.fail(error);
    }
    const tailedDshEvidence = dshTailer === undefined
      ? undefined
      : yield* Effect.tryPromise({ try: () => dshTailer.finish(), catch: () => undefined }).pipe(
        Effect.catchAll(() => Effect.succeed(undefined)),
      );
    let dshEvidence: DshSessionEvidence | undefined = tailedDshEvidence;
    if (harness === "dsh" && dshEvidence === undefined) {
      // A native session may be absent when a dsh process is interrupted before
      // its checkpoint flush. Preserve the child outcome and stdout/stderr
      // evidence rather than fabricating a session id.
      dshEvidence = yield* Effect.tryPromise({
        try: () => readDshSessionEvidence(dshHome, retryRequest.cwd, startedAt, dshResumeId),
        catch: (cause) => agentError("session-artifact", cause),
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
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
      emit({ type: "error", errorType: error.kind, message: error.message });
      yield* persistAgentEvents(observed, provisionalId);
      // The actor keeps its identity, so a stage that retries returns to the
      // same conversation and fails the same way rather than silently starting
      // over with none of its memory.
      return yield* Effect.fail(withFailedContinuation(error, {
        harness,
        sessionId: provisionalId,
        nativeSessionId: dshResumeId,
        transcriptPath,
      }));
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
    yield* Effect.tryPromise({
      try: async () => {
        if (retryRequest.continuation === undefined) {
          await writeFile(auditPath, transcript, "utf8");
          return;
        }
        if (!transcriptIsSnapshot) {
          await writeFile(auditPath, transcript, { encoding: "utf8", flag: "a" });
          return;
        }
        // A transcript that is gone (or never written) folds in as empty, so the
        // attempt still records everything it has.
        const stored = await readFile(auditPath, "utf8").catch(() => "");
        const merged = mergeCanonicalTranscript(stored, transcript);
        if (merged !== stored) await writeFile(auditPath, merged, "utf8");
      },
      catch: (cause) => agentError("session-artifact", cause),
    }).pipe(Effect.tapError((error) => Effect.sync(() => emit({ type: "error", errorType: error.kind, message: error.message }))));
    if (childFailed) {
      const refusal = piRpc?.promptRefusal;
      const error = refusal !== undefined
        // The refusal reason pi gave is the diagnostic the caller needs — the
        // child's exit code carries no information about it.
        ? refusal
        : subprocessError(harness, outcome, sourcePath);
      emit({ type: "error", errorType: error.kind, message: error.message });
      yield* persistAgentEvents(observed, provisionalId);
      // Stash the attempt's session identity so the shared retry boundary
      // reopens this transcript instead of starting a new session. The native
      // handle is what this attempt actually observed — or what it inherited
      // when it died before announcing one — never the fabricated logical id,
      // which no harness can resolve.
      const native = accumulator.sessionId ?? retryRequest.continuation?.nativeSessionId;
      return yield* Effect.fail(withFailedContinuation(error, {
        harness,
        sessionId: provisionalId,
        ...(native === undefined ? {} : { nativeSessionId: native }),
        // Same rule as the success path: a pi retry reopens the file argv
        // named — pi's own session — not the audit trail, which pi never
        // wrote and could not continue from. `piSessionPath` is a fixed
        // point for continuations, so a retry that also fails stashes the
        // same path again.
        transcriptPath: harness === "pi" || harness === "pi-cli"
          ? piSessionPath(retryRequest, transcriptPath)
          : transcriptPath,
      }));
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
        // The file the *harness* reopens, which for pi/pi-cli is its own
        // session — never the audit trail, whose entries pi did not write.
        // It is the same path argv named, so what pi opens next turn is the
        // file it has been writing all along.
        transcriptPath: harness === "pi" || harness === "pi-cli"
          ? piSessionPath(retryRequest, transcriptPath)
          : transcriptPath,
      } satisfies AgentContinuation,
    };
    emit({ type: "done", exitStatus: 0, sessionId, transcriptPath: auditPath });
    yield* persistAgentEvents(observed, sessionId);
    return { result };
  });
}
