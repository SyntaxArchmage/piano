import {
  asAgentMessage,
  type AgentEvent,
  type AgentMessage,
  type AgentUsage,
} from "./events.js";
import { asRecord, jsonValue, nonEmptyString, numberValue, type JsonRecord } from "./json-narrowing.js";
import {
  emitMessageEnd,
  emitStreamedText,
  extractUsage,
  sanitizeAssistantMessage,
  stripProxyDiagnostic,
  type SubprocessAccumulator,
} from "./subprocessEvents.js";

/**
 * Turning dsh's durable session records into events.
 *
 * dsh persists a session as a JSONL log, so its adapter can read the real
 * conversation instead of inferring one from stdout — but the log arrives in
 * shapes no one else speaks: three kinds of packed delta rows, steps nested
 * inside turns, tool calls and results announced separately from the messages
 * that carry them. Everything here translates those into the same `AgentEvent`
 * stream the other adapters emit, and the dedup key is what keeps a resumed
 * session's replayed prefix from appearing twice.
 */

interface DshAssistantRecord {
  readonly turn: number;
  readonly message: AgentMessage;
  readonly usage?: AgentUsage;
}

export interface DshEventMapper {
  process(event: JsonRecord): void;
  finish(finalText: string): boolean;
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
  const turn = numberValue(data.turn);
  if (turn === undefined) return undefined;
  const usage = dshUsage(data);
  return { turn, message: sanitizeAssistantMessage(message), ...(usage === undefined ? {} : { usage }) };
}

export function createDshEventMapper(
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
    const turn = numberValue(data.turn);
    const step = numberValue(data.step);
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
        emitTurnStart(numberValue(data.turn));
        break;
      case "step/start":
        // dsh's current session format emits step boundaries for each model
        // call and may omit the outer turn/end when headless shutdown races
        // persistence. A step can still recover a missing turn start, while
        // the finalizer below closes the open outer turn exactly once.
        emitTurnStart(numberValue(data.turn));
        break;
      case "assistant/message": {
        const assistant = dshAssistantRecord(data);
        if (assistant === undefined) break;
        emitAssistant(assistant, data);
        break;
      }
      case "assistant/chunk": {
        const chunk = asRecord(data.chunk);
        const turn = numberValue(data.turn);
        const step = numberValue(data.step);
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
            contentIndex: numberValue(chunk.index),
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
        const callId = nonEmptyString(data.callId) ?? "unknown";
        const toolName = nonEmptyString(data.name) ?? "unknown";
        toolNames.set(callId, toolName);
        emit({ type: "tool_execution_start", toolCallId: callId, toolName, args: jsonValue(data.arguments) });
        break;
      }
      case "tool/result": {
        const message = asAgentMessage(data.message);
        const resultBlock = Array.isArray(message.content)
          ? message.content.map(asRecord).find((part) => part?.type === "tool-result")
          : undefined;
        const callId = nonEmptyString(data.callId)
          ?? nonEmptyString(resultBlock?.toolCallId)
          ?? nonEmptyString(asRecord(message.source)?.callId)
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
        const turn = numberValue(data.turn);
        if (turn !== undefined) {
          const results = turnToolResults.get(turn) ?? [];
          results.push(message);
          turnToolResults.set(turn, results);
        }
        toolNames.delete(callId);
        break;
      }
      case "turn/end": {
        emitTurnEnd(numberValue(data.turn));
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

export function dshRecordKey(record: JsonRecord): string {
  const seq = numberValue(record.seq);
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
