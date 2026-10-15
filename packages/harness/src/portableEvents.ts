import {
  messageText,
  type AgentEvent,
  type AgentMessage,
  type AgentMessageEvent,
} from "./events.js";
import { nonEmptyString, numberOrZero, stringList, type JsonRecord } from "./json-narrowing.js";

/**
 * The event cases every harness dialect spells the same way.
 *
 * Most of what a session reports is its own business — Claude's content
 * blocks, pi's RPC envelopes, dsh's step records — but a dozen of them are
 * facts about the *conversation* that all three name identically: a queue
 * update, a compaction boundary, an automatic retry, an appended entry, the
 * bash stream. Normalizing those twice is how a new field ends up added to one
 * adapter and not the other, so they are normalized once, here, and each
 * adapter asks this module before falling back to its own dialect.
 *
 * The shape of an unrecognized record is not this module's concern: it answers
 * `undefined` and the caller keeps its own default case.
 */
export function normalizePortableEvent(record: JsonRecord): AgentEvent | undefined {
  switch (nonEmptyString(record.type)) {
    case "queue_update":
      return { type: "queue_update", steering: stringList(record.steering), followUp: stringList(record.followUp) };
    case "compaction_start":
      return { type: "compaction_start", reason: nonEmptyString(record.reason) ?? "unknown" };
    case "entry_appended":
      return { type: "entry_appended", entry: record.entry };
    case "session_info_changed":
      return { type: "session_info_changed", name: typeof record.name === "string" ? record.name : undefined };
    case "thinking_level_changed":
      return { type: "thinking_level_changed", level: nonEmptyString(record.level) ?? "unknown" };
    case "compaction_end":
      return {
        type: "compaction_end",
        reason: nonEmptyString(record.reason) ?? "unknown",
        result: record.result,
        aborted: record.aborted === true,
        willRetry: record.willRetry === true,
        ...(typeof record.errorMessage === "string" ? { errorMessage: record.errorMessage } : {}),
      };
    case "auto_retry_start":
      return {
        type: "auto_retry_start",
        attempt: numberOrZero(record.attempt),
        maxAttempts: numberOrZero(record.maxAttempts),
        delayMs: numberOrZero(record.delayMs),
        errorMessage: nonEmptyString(record.errorMessage) ?? "retry requested",
      };
    case "auto_retry_end":
      return {
        type: "auto_retry_end",
        success: record.success === true,
        attempt: numberOrZero(record.attempt),
        ...(typeof record.finalError === "string" ? { finalError: record.finalError } : {}),
      };
    case "summarization_retry_scheduled":
      return {
        type: "summarization_retry_scheduled",
        attempt: numberOrZero(record.attempt),
        maxAttempts: numberOrZero(record.maxAttempts),
        delayMs: numberOrZero(record.delayMs),
        errorMessage: nonEmptyString(record.errorMessage) ?? "retry requested",
      };
    case "summarization_retry_attempt_start":
      return {
        type: "summarization_retry_attempt_start",
        source: nonEmptyString(record.source) ?? "unknown",
        ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
      };
    case "summarization_retry_finished":
      return { type: "summarization_retry_finished" };
    case "bash_execution_update":
      return {
        type: "bash_execution_update",
        ...(typeof record.id === "string" ? { id: record.id } : {}),
        delta: typeof record.delta === "string" ? record.delta : "",
      };
    default:
      return undefined;
  }
}

/**
 * Fold one streamed update into the turn's text.
 *
 * Every dialect that streams text has the same three sources, and they differ
 * in kind rather than in degree: a delta appends, a `text_end` *replaces* with
 * what the far end says the block finally was, and an update carrying a whole
 * message falls back to that message's own text. This value becomes the
 * attempt's answer — it reaches the actor transcript and the headless JSON
 * stream — so the rule is stated once rather than twice.
 *
 * A message that is not the assistant's changes nothing: a tool result
 * carrying text is not the reply.
 */
export function accumulateStreamedText(
  text: string,
  message: AgentMessage,
  update: AgentMessageEvent,
): string {
  if (message.role !== undefined && message.role !== "assistant") return text;
  if (update.type === "text_delta" && typeof update.delta === "string") return text + update.delta;
  if (update.type === "text_end" && typeof update.content === "string") return update.content;
  return messageText(message) ?? text;
}
