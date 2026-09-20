import type { HarnessName } from "./harness-config.js";

type JsonRecord = Record<string, unknown>;

/**
 * Persist each subprocess transcript in one canonical dialect: NDJSON records
 * of `{"type":"message","message":{"role","content","usage"},"timestamp"}` —
 * the format the pi SDK writes natively and that the evidence analyzers
 * (packages/evals) and downstream readers understand.
 *
 * The mapping is only applied where the transcript file is pure audit:
 * claude resumes by session id and dsh spawns fresh per attempt, so neither
 * CLI ever re-reads these bytes. pi and pi-cli keep a byte-identical copy of
 * their native stdout because pi-cli's `--session <path>` resume consumes
 * exactly this file.
 *
 * Unrecognizable content is dropped rather than passed through: the analyzer
 * treats foreign records as structural issues, and the native audit trail
 * remains in the harness home / log stream. When nothing maps at all (an
 * interrupted attempt, a foreign CLI build), the raw join is written so the
 * file never silently loses the evidence that does exist.
 */
export function canonicalTranscriptText(
  harness: HarnessName,
  rawLines: readonly string[],
  dshEvents: readonly JsonRecord[] = [],
): string {
  const records = harness === "claude"
    ? rawLines.flatMap((line) => claudeMessageRecords(line))
    : harness === "dsh"
      ? dshEvents.flatMap((event) => dshMessageRecords(event))
      : undefined;
  if (records === undefined || records.length === 0) return joinTranscript(rawLines);
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function joinTranscript(rawLines: readonly string[]): string {
  return rawLines.join("\n") + (rawLines.length > 0 ? "\n" : "");
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function messageRecord(
  role: string,
  content: unknown,
  timestamp: string | undefined,
  usage: JsonRecord | undefined,
): JsonRecord {
  const message: JsonRecord = {
    role,
    content: Array.isArray(content) ? content.flatMap((part) => canonicalPart(part) ?? []) : content,
    ...(usage === undefined ? {} : { usage }),
  };
  return { type: "message", ...(timestamp === undefined ? {} : { timestamp }), message };
}

/** Maps one claude/dsh native content block to the canonical vocabulary
 * (`text`, `thinking`, `toolCall`, `tool_result`); undefined drops it. */
function canonicalPart(part: unknown): JsonRecord[] | undefined {
  const block = asRecord(part);
  if (block === undefined) return undefined;
  switch (block.type) {
    case "text":
      return typeof block.text === "string" ? [{ type: "text", text: block.text }] : undefined;
    case "thinking":
      return typeof block.thinking === "string" ? [{ type: "thinking", thinking: block.thinking }] : undefined;
    case "reasoning":
      // dsh carries chain-of-thought in `reasoning` blocks with a `text` field.
      return typeof block.text === "string" ? [{ type: "thinking", thinking: block.text }] : undefined;
    case "tool_use": {
      const toolCallId = stringValue(block.id);
      return [{
        type: "toolCall",
        ...(toolCallId === undefined ? {} : { toolCallId }),
        name: stringValue(block.name) ?? "unknown",
        input: block.input ?? {},
      }];
    }
    case "tool-call": {
      // dsh names calls `tool-call` with a JSON-string `arguments` field.
      const toolCallId = stringValue(block.id);
      return [{
        type: "toolCall",
        ...(toolCallId === undefined ? {} : { toolCallId }),
        name: stringValue(block.name) ?? "unknown",
        input: jsonValue(block.arguments) ?? {},
      }];
    }
    case "tool_result": {
      const toolCallId = stringValue(block.tool_use_id);
      return [{
        type: "tool_result",
        ...(toolCallId === undefined ? {} : { toolCallId }),
        content: block.content ?? "",
      }];
    }
    case "tool-result": {
      const toolCallId = stringValue(block.toolCallId);
      return [{
        type: "tool_result",
        ...(toolCallId === undefined ? {} : { toolCallId }),
        content: block.content ?? "",
      }];
    }
    default:
      return undefined;
  }
}

const CANONICAL_USAGE_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

/** Renames a native usage object onto the canonical `input/output/cacheRead/
 * cacheWrite` keys; undefined when it carries no canonical number. */
function mapUsage(
  usage: JsonRecord | undefined,
  aliases: Record<(typeof CANONICAL_USAGE_KEYS)[number], string>,
): JsonRecord | undefined {
  if (usage === undefined) return undefined;
  const mapped: JsonRecord = {};
  for (const canonical of CANONICAL_USAGE_KEYS) {
    const value = numberValue(usage[aliases[canonical]]);
    if (value !== undefined) mapped[canonical] = value;
  }
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function claudeMessageRecords(line: string): JsonRecord[] {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return [];
  }
  const record = asRecord(value);
  const type = stringValue(record?.type);
  if (record === undefined || (type !== "assistant" && type !== "user")) return [];
  const message = asRecord(record.message);
  const role = stringValue(message?.role) ?? type;
  const timestamp = stringValue(record.timestamp);
  const usage = mapUsage(asRecord(message?.usage), {
    input: "input_tokens",
    output: "output_tokens",
    cacheRead: "cache_read_input_tokens",
    cacheWrite: "cache_creation_input_tokens",
  });
  return [messageRecord(role, message?.content, timestamp, usage)];
}

function dshMessageRecords(event: JsonRecord): JsonRecord[] {
  const type = stringValue(event.type);
  if (type !== "assistant/message" && type !== "user/message" && type !== "tool/result") return [];
  const data = asRecord(event.data);
  if (data === undefined) return [];
  const time = numberValue(event.time);
  const timestamp = time === undefined ? undefined : new Date(time).toISOString();
  if (type === "user/message") {
    return [messageRecord("user", data.content, timestamp, undefined)];
  }
  const message = asRecord(data.message);
  if (type === "tool/result") {
    return [messageRecord("tool", message?.content ?? data.content, timestamp, undefined)];
  }
  const role = stringValue(message?.role) ?? "assistant";
  const usage = mapUsage(asRecord(data.usage), {
    input: "inputTokens",
    output: "outputTokens",
    cacheRead: "cacheReadTokens",
    cacheWrite: "cacheWriteTokens",
  });
  return [messageRecord(role, message?.content, timestamp, usage)];
}
