import type { HarnessName } from "./harness-config.js";

type JsonRecord = Record<string, unknown>;

/**
 * Persist each subprocess transcript in one canonical dialect: NDJSON records
 * of `{"type":"message","message":{"role","content","usage"},"timestamp"}` —
 * the format the pi SDK writes natively and that the evidence analyzers
 * (packages/evals) and downstream readers understand.
 *
 * The mapping is applied to Claude, dsh, and pi/pi-cli native records before
 * they are stored in Piano's actor transcript. Claude resumes by native session
 * id; dsh's shipped headless profile has no resume flag, so the subprocess
 * adapter re-injects this canonical transcript as explicit context on the next
 * epoch. pi and pi-cli resume through their own `--session <path>` flag — and
 * that file is theirs, written and read back by pi's own SessionManager — so
 * their payload is mapped to plain audit records instead, kept apart from the
 * session pi owns. Rebuilding a session file from pi's stdout and appending it
 * to the same path pi writes would leave two authors on one conversation.
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
  userPrompt?: string,
): string {
  const records = harness === "claude"
    ? rawLines.flatMap((line) => claudeMessageRecords(line))
    : harness === "dsh"
      ? dshEvents.flatMap((event) => dshMessageRecords(event))
      : harness === "codex"
        ? codexMessageRecords(rawLines, userPrompt)
        : harness === "pi" || harness === "pi-cli"
          ? piAuditRecords(rawLines)
          : undefined;
  if (records === undefined || records.length === 0) return joinTranscript(rawLines);
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function joinTranscript(rawLines: readonly string[]): string {
  return rawLines.join("\n") + (rawLines.length > 0 ? "\n" : "");
}

/**
 * Fold this attempt's canonical transcript into the one already stored.
 *
 * A harness may hand back only its own turn, or the actor's whole conversation.
 * dsh is the second kind: a resumed session replays its complete event list on
 * every turn, so the payload is a snapshot that already contains everything
 * written before. Appending a snapshot writes the conversation again each turn
 * — measured on a ten-turn dsh actor, 84% of the stored records were re-appends,
 * and a turn's file grew as O(N²) in the number of turns.
 *
 * So the stored transcript is replaced when the produced one already holds every
 * record it has: the produced payload is then the same conversation, stated
 * once. That is what makes the write idempotent — replaying a prefix, or
 * retrying a turn, converges on the same bytes instead of stacking another copy.
 * Multiset equality is deliberately not required, so a transcript that already
 * accumulated repeats is repaired rather than extended.
 *
 * When the produced transcript does *not* hold what is stored — a per-turn
 * payload, or a different session — it is appended, byte for byte, which is what
 * a caller relying on append semantics already expects. Nothing stored is ever
 * dropped.
 */
export function mergeCanonicalTranscript(stored: string, produced: string): string {
  if (produced === "") return stored;
  if (stored === "") return produced;
  const arriving = new Set(produced.split("\n"));
  for (const record of stored.split("\n")) {
    if (record.trim() === "") continue;
    if (!arriving.has(record)) return stored + produced;
  }
  // Every record already stored is in the produced payload, so that payload is
  // this conversation stated once. (A stored transcript of nothing but blank
  // lines reaches here too, and carries nothing to preserve.)
  return produced;
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

/** Codex's JSONL stream contains lifecycle records plus completed `item`
 * payloads. Persist the durable assistant/tool messages in Piano's canonical
 * transcript so strict eval evidence can read a Codex run without knowing the
 * CLI's event dialect. */
function codexMessageRecords(lines: readonly string[], userPrompt: string | undefined): JsonRecord[] {
  const records: JsonRecord[] = userPrompt === undefined || userPrompt === ""
    ? []
    : [messageRecord("user", userPrompt, undefined, undefined)];
  let lastAssistant = -1;
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord(value);
    if (record?.type === "item.completed") {
      const item = asRecord(record.item);
      if (item === undefined) continue;
      const timestamp = stringValue(record.timestamp ?? item.timestamp);
      if (item.type === "agent_message") {
        const message = asRecord(item.message);
        const content = message?.content ?? item.text ?? item.content ?? "";
        const role = stringValue(message?.role) ?? "assistant";
        records.push(messageRecord(role, content, timestamp, undefined));
        if (role === "assistant") lastAssistant = records.length - 1;
        continue;
      }
      if (item.type === "command_execution" || item.type === "function_call" || item.type === "mcp_tool_call") {
        const toolCallId = stringValue(item.id);
        const name = item.type === "command_execution"
          ? "bash"
          : stringValue(item.name ?? item.tool_name) ?? "unknown";
        const input = item.type === "command_execution"
          ? { command: item.command ?? "" }
          : item.arguments ?? item.input ?? {};
        records.push(messageRecord("assistant", [{
          type: "tool_use",
          ...(toolCallId === undefined ? {} : { toolCallId }),
          ...(toolCallId === undefined ? {} : { id: toolCallId }),
          name,
          input,
        }], timestamp, undefined));
        lastAssistant = records.length - 1;
        const output = item.aggregated_output ?? item.output ?? item.result;
        if (output !== undefined) {
          records.push(messageRecord("tool", [{
            type: "tool_result",
            ...(toolCallId === undefined ? {} : { tool_use_id: toolCallId }),
            content: output,
          }], timestamp, undefined));
        }
      }
      continue;
    }
    if (record?.type === "turn.completed" && lastAssistant >= 0) {
      const usage = mapUsage(asRecord(record.usage), {
        input: "input_tokens",
        output: "output_tokens",
        cacheRead: "cached_input_tokens",
        cacheWrite: "cache_write_tokens",
      });
      if (usage !== undefined) {
        const previous = asRecord(records[lastAssistant]!.message);
        if (previous !== undefined) {
          records[lastAssistant] = {
            ...records[lastAssistant],
            message: { ...previous, usage },
          };
        }
      }
    }
  }
  return records;
}

/** Converts pi/pi-cli RPC stdout into Piano's canonical audit records.
 *
 * This is deliberately *not* a pi session file. pi owns its own session — it
 * writes the `--session` path itself and resumes from it — so an audit trail
 * shaped like a session would be a second author on the same conversation, and
 * a client that appended it would corrupt the file pi resumes from. Only the
 * durable messages are kept, as canonical `type:"message"` records: each
 * `message_end` whose role pi persists (user, assistant, toolResult), with the
 * message passed through verbatim. The event stream also carries pi's own
 * session header; it is dropped here because it describes pi's file, not this
 * audit trail. When nothing maps (an interrupted attempt, a foreign CLI build),
 * the raw join is kept so the evidence that exists is not silently lost. */
function piAuditRecords(rawLines: readonly string[]): JsonRecord[] {
  const records: JsonRecord[] = [];
  for (const line of rawLines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const record = asRecord(value);
    if (record === undefined || record.type !== "message_end") continue;
    const message = asRecord(record.message);
    const role = stringValue(message?.role);
    if (message === undefined || role === undefined || !PI_PERSISTED_ROLES.has(role)) continue;
    // pi stamps a numeric message timestamp; the event may carry its own.
    const messageTime = numberValue(message.timestamp);
    const timestamp = stringValue(record.timestamp)
      ?? (messageTime !== undefined ? new Date(messageTime).toISOString() : undefined);
    records.push({
      type: "message",
      ...(timestamp === undefined ? {} : { timestamp }),
      message,
    });
  }
  return records;
}

const PI_PERSISTED_ROLES = new Set(["user", "assistant", "toolResult"]);
