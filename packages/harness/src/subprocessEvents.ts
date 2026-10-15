import {
  asAgentMessage,
  asAgentMessageEvent,
  messageText,
  type AgentEvent,
  type AgentMessage,
  type AgentUsage,
} from "./events.js";
import type { HarnessName } from "./harness-config.js";
import { normalizePortableEvent } from "./portableEvents.js";
import {
  asRecord,
  nonEmptyString,
  numberValue,
  type JsonRecord,
} from "./json-narrowing.js";

/**
 * One harness-event vocabulary for every subprocess adapter.
 *
 * Claude's stream-json frames, pi's RPC records and Codex's dotted lifecycle
 * events are three dialects of the same conversation, and nothing above this
 * module may tell which one produced an event: the chat renderer, the
 * trajectory writer and the eval evidence all read the same `AgentEvent`. The
 * translation lives here, together with the two rules every dialect shares —
 * the gateway banner that heads a streamed message, and the accumulator that
 * turns a stream of deltas into the turn's final text.
 *
 * `normalizeSubprocessLine` is the entry point; the dialects below it are
 * private to this module.
 */

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

function assistantMessage(value: unknown): AgentMessage {
  const message = asAgentMessage(value);
  return message.role === undefined ? { ...message, role: "assistant" } : message;
}

export function stripProxyDiagnostic(text: string): string {
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

export function sanitizeAssistantMessage(message: AgentMessage): AgentMessage {
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

export function extractUsage(value: unknown): AgentUsage | undefined {
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
    ...(numberValue(input) === undefined ? {} : { input: numberValue(input) }),
    ...(numberValue(output) === undefined ? {} : { output: numberValue(output) }),
    ...(numberValue(cacheRead) === undefined ? {} : { cacheRead: numberValue(cacheRead) }),
    ...(numberValue(cacheWrite) === undefined ? {} : { cacheWrite: numberValue(cacheWrite) }),
    ...(numberValue(usage.cacheWrite1h ?? usage.cache_creation_input_tokens_1h) === undefined ? {} : { cacheWrite1h: numberValue(usage.cacheWrite1h ?? usage.cache_creation_input_tokens_1h) }),
    ...(numberValue(usage.reasoning ?? usage.reasoning_tokens ?? usage.reasoning_output_tokens) === undefined ? {} : { reasoning: numberValue(usage.reasoning ?? usage.reasoning_tokens ?? usage.reasoning_output_tokens) }),
    ...(numberValue(usage.totalTokens ?? usage.total_tokens) === undefined ? {} : { totalTokens: numberValue(usage.totalTokens ?? usage.total_tokens) }),
    ...(numberValue(usage.contextTokens ?? usage.context_tokens) === undefined ? {} : { contextTokens: numberValue(usage.contextTokens ?? usage.context_tokens) }),
    ...(numberValue(usage.turns) === undefined ? {} : { turns: numberValue(usage.turns) }),
    ...(usage.cost === undefined ? {} : { cost: usage.cost }),
  };
  return Object.keys(result).length === 0 ? undefined : result;
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
export function emitStreamedText(
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

export function emitMessageEnd(
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
  const toolCallId = nonEmptyString(tool?.toolCallId ?? tool?.tool_use_id ?? tool?.id) ?? "unknown";
  const toolName = nonEmptyString(tool?.toolName ?? tool?.name) ?? "unknown";
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
  const toolCallId = nonEmptyString(value.toolCallId ?? value.tool_use_id ?? value.id) ?? "unknown";
  const toolName = nonEmptyString(value.toolName ?? value.name)
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
  const type = nonEmptyString(value.type);
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
        message: nonEmptyString(failure?.message ?? value.message) ?? "Codex turn failed",
      });
      accumulator.turnEnded = true;
      return true;
    }
    case "item.started":
    case "item.updated":
    case "item.completed": {
      const item = asRecord(value.item);
      if (item === undefined) return true;
      const itemType = nonEmptyString(item.type);
      if (itemType === "agent_message") {
        if (type === "item.updated") {
          const delta = nonEmptyString(item.delta ?? item.text_delta);
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
      const toolCallId = nonEmptyString(item.id) ?? `codex-${itemType}`;
      const toolName = itemType === "command_execution"
        ? "bash"
        : nonEmptyString(item.name ?? item.tool_name) ?? "unknown";
      const args = itemType === "command_execution"
        ? { command: item.command ?? "" }
        : item.arguments ?? item.input ?? {};
      if (type === "item.started" || accumulator.toolNames?.has(toolCallId) !== true) {
        emitToolUse({ id: toolCallId, name: toolName, input: args }, emit, accumulator);
      }
      if (type === "item.completed") {
        const exitCode = numberValue(item.exit_code ?? item.exitCode);
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
        message: nonEmptyString(value.message) ?? "Codex request failed",
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
  const type = nonEmptyString(value.type);
  if (harness === "codex" && normalizeCodexRecord(value, emit, accumulator)) return;
  // A dozen events are facts about the conversation that every dialect names
  // identically; portableEvents.ts normalizes those for all of them.
  const portable = normalizePortableEvent(value);
  if (portable !== undefined) {
    emit(portable);
    return;
  }
  switch (type) {
    // Claude's `--include-partial-messages` wraps every raw Anthropic stream
    // frame in a `stream_event` envelope. Unwrapping it here is what puts
    // Claude on the `message_update` / `text_delta` contract Pi already emits,
    // so the TUI's one live-stream renderer drives both harnesses. Without it
    // the CLI reports only completed `assistant` blocks and the chat area
    // stays parked at the head of the transcript until the reply is over.
    case "stream_event": {
      const event = asRecord(value.event);
      const inner = nonEmptyString(event?.type);
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
        const contentIndex = numberValue(value.index);
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
        const contentIndex = numberValue(value.index);
        if (contentIndex !== undefined) {
          accumulator.toolCallsByContentIndex ??= new Map();
          accumulator.toolCallsByContentIndex.set(contentIndex, {
            toolCallId: nonEmptyString(block.id ?? block.toolCallId) ?? "unknown",
            toolName: nonEmptyString(block.name ?? block.toolName) ?? "unknown",
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
      const contentIndex = numberValue(value.index);
      if (contentIndex !== undefined) accumulator.toolCallsByContentIndex?.delete(contentIndex);
      return;
    }
    case "tool_execution_start":
    case "tool_use":
    case "tool_call":
      emitToolUse(value, emit, accumulator);
      return;
    case "tool_execution_update": {
      const toolCallId = nonEmptyString(value.toolCallId ?? value.tool_use_id ?? value.id) ?? "unknown";
      const toolName = nonEmptyString(value.toolName ?? value.name)
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
      const error = asRecord(value.delta)?.stop_reason === "error" ? nonEmptyString(asRecord(value.delta)?.error) : undefined;
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
      const rawText = nonEmptyString(value.result ?? value.text ?? value.output);
      const text = rawText === undefined ? undefined : stripProxyDiagnostic(rawText);
      if (text !== undefined && accumulator.lastMessageEndText !== text) {
        emitMessageEnd(sanitizeAssistantMessage({ role: "assistant", content: text }), accumulator, emit);
      }
      const usage = extractUsage(value);
      if (usage !== undefined) emit({ type: "usage", usage });
      accumulator.turnEnded = true;
      return;
    }
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

