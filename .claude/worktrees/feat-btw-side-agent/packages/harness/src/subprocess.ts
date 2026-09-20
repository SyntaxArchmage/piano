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
import { canonicalTranscriptText } from "./canonical-transcript.js";
import { dshModelPatchPath, dshWebSearchOffPatchPath } from "./harness-home.js";
import {
  agentConfigPath,
  resolveHarnessConfig,
  resolveHarnessThinkingLevel,
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
  const cacheRead = usage.cacheRead ?? usage.cache_read_input_tokens ?? usage.cacheReadTokens;
  const cacheWrite = usage.cacheWrite ?? usage.cache_creation_input_tokens ?? usage.cacheWriteTokens;
  const result: AgentUsage = {
    ...(number(input) === undefined ? {} : { input: number(input) }),
    ...(number(output) === undefined ? {} : { output: number(output) }),
    ...(number(cacheRead) === undefined ? {} : { cacheRead: number(cacheRead) }),
    ...(number(cacheWrite) === undefined ? {} : { cacheWrite: number(cacheWrite) }),
    ...(number(usage.cacheWrite1h ?? usage.cache_creation_input_tokens_1h) === undefined ? {} : { cacheWrite1h: number(usage.cacheWrite1h ?? usage.cache_creation_input_tokens_1h) }),
    ...(number(usage.reasoning ?? usage.reasoning_tokens) === undefined ? {} : { reasoning: number(usage.reasoning ?? usage.reasoning_tokens) }),
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

function dshProjectKey(cwd: string): string {
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
): Promise<string | undefined> {
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
): Promise<DshSessionEvidence | undefined> {
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
    const complete = await readDshSessionEvidence(this.home, this.cwd, this.startedAt);
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
      if (this.filePath === undefined) this.filePath = await findDshSessionArtifact(this.home, this.cwd, this.startedAt);
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
): DshSessionTailerImpl {
  const tailer = new DshSessionTailerImpl(home, cwd, startedAt, mapper);
  tailer.start();
  return tailer;
}

function sessionIdFromValue(value: unknown): string | undefined {
  const record = asRecord(value);
  if (record === undefined) return undefined;
  const direct = record.sessionId ?? record.session_id;
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
): string[] {
  const args = ["--mode", "json", "--print"];
  if (config.provider !== undefined) args.push("--provider", config.provider);
  if (config.model !== undefined) args.push("--model", config.model);
  if (config.apiKey !== undefined) args.push("--api-key", config.apiKey);
  if (thinking !== undefined) args.push("--thinking", thinking);
  if (request.sessionDir !== undefined) args.push("--session-dir", request.sessionDir);
  if (request.continuation?.transcriptPath !== undefined) args.push("--session", request.continuation.transcriptPath);
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
  args.push(request.prompt);
  return args;
}

function resourceAppendix(resources: LoadedResources, includeSkills: boolean): string {
  return [
    resources.systemPrompt,
    ...resources.contextFiles.map((file) => `# ${file.path}\n${file.content}`),
    ...(includeSkills ? resources.skills.map((file) => `# ${file.path}\n${file.content}`) : []),
  ].filter((value): value is string => value !== undefined && value !== "").join("\n\n");
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
  if (thinking !== undefined) args.push("--effort", thinking === "xhigh" || thinking === "max" ? "max" : thinking);
  if (request.continuation?.sessionId !== undefined) args.push("--resume", request.continuation.sessionId);
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

/** The official dsh launcher has its own headless protocol. It deliberately
 * receives no Pi flags: profile selection, the model overlay, and the task are
 * the complete native invocation. Resources are made explicit in the task
 * because dsh's headless entry point has no append-system-prompt flag.
 *
 * The model travels as `--patch`: the headless runner reads the process-wide
 * `agent-default-model`, so there is no model flag to pass. The overlay was
 * generated with the harness home, one file per reachable model, and its
 * provider is the one Piano configured for dsh — a per-request provider has no
 * generated catalog route and stays unsupported here. */
function dshArguments(
  request: AgentRequest,
  config: ResolvedHarnessConfig,
  resources: LoadedResources,
  dshHome: string,
): string[] {
  const appendix = resourceAppendix(resources, true);
  const prompt = appendix === "" ? request.prompt : `${appendix}\n\n## Task\n${request.prompt}`;
  const ablateWebSearch = request.tools?.includes(PI_WEB_SEARCH_TOOL_NAME) !== true;
  return [
    "--profile", config.profile ?? "headless",
    ...(config.model === undefined ? [] : ["--patch", dshModelPatchPath(dshHome, config.model)]),
    ...(ablateWebSearch ? ["--patch", dshWebSearchOffPatchPath(dshHome)] : []),
    prompt,
  ];
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
  } else {
    if (config.baseUrl !== undefined) env.PI_BASE_URL = config.baseUrl;
    if (config.apiKey !== undefined) env.PI_API_KEY = secret(config.apiKey);
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

/** Live stdin control for a streaming-input child (claude only). Handed to
 * the attempt the moment the child spawns: `writeFrame` delivers one steering
 * user frame mid-turn, `windDown` ends stdin after the `result` frame and
 * bounds the exit with a SIGTERM grace. */
interface ChildStdinControl {
  writeFrame(text: string): Promise<void>;
  windDown(): void;
}

interface ChildStdinBridge {
  /** The task frame written as the first stdin line at spawn. */
  readonly initialFrame: string;
  onControl(control: ChildStdinControl): void;
}

function runChild(
  binPath: string,
  argv: readonly string[],
  request: AgentRequest,
  emitLine: (line: string) => void,
  env: NodeJS.ProcessEnv,
  stdin?: ChildStdinBridge,
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
      emitLine(trimmed);
    };
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (lineBuffer.trim() !== "") consume(lineBuffer);
      lineBuffer = "";
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
          stream.write(`${userFrame(text)}\n`);
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
      try {
        child.stdin?.write(`${stdin.initialFrame}\n`);
      } catch {
        // A synchronous spawn failure follows on the 'error'/'close' events.
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
    child.stderr?.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4000); });
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
  // `runSubprocessAttempt`); dsh/pi-cli never bind, so the channel answers
  // "no-active-turn" for them and callers keep queue semantics. A dsh
  // implementation (host-mode `Agent.steer` RPC) is deferred work.
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
  const config = resolveHarnessConfig(harness, requestedConfig);
  const thinking = resolveHarnessThinkingLevel(harness, request.thinkingLevel ?? options.thinkingLevel);
  const sourcePath = config.binPath ?? (harness === "claude" ? "claude" : harness === "dsh" ? "dsh" : "pi");
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
    const argv = harness === "claude"
      ? claudeArguments(retryRequest, config, thinking, resources)
      : harness === "dsh"
        ? dshArguments(retryRequest, config, resources, dshHome)
        : piArguments(retryRequest, config, thinking, resources);
    const startedAt = Date.now();
    const dshMapper = harness === "dsh" ? createDshEventMapper(accumulator, emit) : undefined;
    const dshTailer = dshMapper === undefined
      ? undefined
      : createDshSessionTailer(dshHome, retryRequest.cwd, startedAt, dshMapper);
    // Steering for the streaming-input backend: the live child's stdin is the
    // delivery path (a frame written mid-turn reaches the model at the next
    // tool boundary). Claude is the only subprocess harness with the protocol
    // today — dsh/pi-cli get no bridge at all, so the channel stays unbound
    // for them and answers "no-active-turn" (their dedicated implementations
    // attach here when written, without touching this decision point).
    let childControl: ChildStdinControl | undefined;
    let unbindSteering: (() => void) | undefined;
    const stdinBridge: ChildStdinBridge | undefined = harness === "claude"
      ? {
        initialFrame: userFrame(retryRequest.prompt),
        onControl: (control) => {
          childControl = control;
          unbindSteering = request.steering?.bind({ steer: (text) => control.writeFrame(text) });
        },
      }
      : undefined;
    let outcome: ChildOutcome;
    try {
      outcome = yield* Effect.tryPromise({
        try: () => runChild(sourcePath, argv, retryRequest, (line) => {
          normalizeSubprocessLine(line, harness, emit, accumulator);
          // The turn's terminal frame: the CLI now waits on stdin for a next
          // turn that never comes, so end stdin and bound the exit.
          if (accumulator.turnEnded === true) childControl?.windDown();
        }, environment, stdinBridge),
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
        try: () => readDshSessionEvidence(dshHome, retryRequest.cwd, startedAt),
        catch: (cause) => agentError("session-artifact", cause),
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    }
    if (dshEvidence !== undefined) accumulator.sessionId ??= dshEvidence.sessionId;
    const dshText = harness === "dsh" ? stripProxyDiagnostic(plainOutput(outcome.rawLines)) : "";
    if (dshMapper !== undefined && dshEvidence !== undefined) {
      for (const event of dshEvidence.events) {
        if (event.type !== "session") dshMapper.process(event);
      }
    }
    const nativeDshEvents = dshMapper?.finish(dshText) ?? false;
    if (harness === "dsh" && dshText !== "" && !nativeDshEvents) emitMessageEnd({ role: "assistant", content: dshText }, accumulator, emit);
    // The transcript is the harness's audit trail in the canonical message
    // dialect (see canonical-transcript.ts); claude resumes by session id and
    // dsh spawns fresh, so neither re-reads these bytes. pi/pi-cli stay
    // byte-identical because pi-cli's `--session` resume consumes this file.
    const transcript = canonicalTranscriptText(harness, outcome.rawLines, dshEvidence?.events ?? []);
    yield* Effect.tryPromise({
      try: () => retryRequest.continuation === undefined ? writeFile(transcriptPath, transcript, "utf8") : writeFile(transcriptPath, transcript, { encoding: "utf8", flag: "a" }),
      catch: (cause) => agentError("session-artifact", cause),
    }).pipe(Effect.tapError((error) => Effect.sync(() => emit({ type: "error", errorType: error.kind, message: error.message }))));
    if (outcome.stderr.trim() !== "") emit({ type: "unknown", sourceType: "stderr", data: { stream: "stderr", text: outcome.stderr.trim() } });
    // A non-zero exit is a failure — except the SIGTERM our own post-`result`
    // wind-down sends when the CLI lingers after stdin EOF. That closure is
    // the expected end of a streaming-input session.
    if ((outcome.code !== 0 && outcome.gracefulShutdown !== true) || outcome.spawnError !== undefined || outcome.aborted) {
      const error = subprocessError(harness, outcome, sourcePath);
      emit({ type: "error", errorType: error.kind, message: error.message });
      yield* persistAgentEvents(observed, provisionalId);
      // Stash the attempt's session identity so the shared retry boundary
      // reopens this transcript instead of starting a new session.
      return yield* Effect.fail(withFailedContinuation(error, {
        harness,
        sessionId: provisionalId,
        transcriptPath,
      }));
    }
    const sessionId = accumulator.sessionId ?? provisionalId;
    const result: AgentResult = {
      sessionId,
      transcriptPath,
      text: accumulator.text,
      ...(config.model === undefined ? {} : { model: config.model }),
      ...(thinking === undefined ? {} : { thinkingLevel: thinking }),
      continuation: { harness, sessionId, transcriptPath } satisfies AgentContinuation,
    };
    emit({ type: "done", exitStatus: 0, sessionId, transcriptPath });
    yield* persistAgentEvents(observed, sessionId);
    return { result };
  });
}
