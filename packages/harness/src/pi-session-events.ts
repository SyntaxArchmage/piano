import type { AgentRequest } from "./agent-contract.js";
import { AgentError, agentError } from "./errors.js";
import {
  asAgentMessage,
  asAgentMessageEvent,
  messageText,
  type AgentEvent,
  type AgentMessage,
  type AgentUsage,
} from "./events.js";
import { asRecord, stringOr } from "./json-narrowing.js";
import { accumulateStreamedText, normalizePortableEvent, usageFromFields } from "./portable-events.js";

/**
 * What one pi session event means, and what a turn accumulates.
 *
 * The pi SDK speaks its own session-event dialect; this is the one place that
 * turns it into the harness's `AgentEvent` stream. The portable cases every
 * dialect spells the same way are normalized first (`portable-events`), and the
 * rest are spelled here: agent/turn lifecycle, streamed messages, tool
 * executions. Anything unrecognized still surfaces as an `unknown` event — the
 * stream never drops what the SDK said.
 *
 * Alongside the translation sits the state a turn accumulates while those
 * events arrive: the assistant's text so far, the last stop reason (to detect a
 * turn truncated by the model's output limit), and a typed failure a message
 * settled with. It is read by the prompt side of the adapter once the session's
 * prompt promise settles.
 */

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

export interface TurnAccumulator {
  text: string;
  error?: AgentError;
  /** Stop reason of the most recent assistant message. Used to detect a turn
   * that settled with a truncated (output-token-limit) final message. */
  lastStopReason?: string;
}

/** Stop reasons that mean the assistant turn was truncated by the model's
 * output limit instead of finishing naturally. */
export function isTruncatedStopReason(stopReason: unknown): boolean {
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

export function bindEvents(
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
