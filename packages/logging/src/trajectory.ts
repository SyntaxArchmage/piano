import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname } from "node:path";
import { errorMessage, TrajectoryWriteError } from "./errors.js";

/** One accepted prompt in a run, recorded so `resume` can replay the piano
 * conversation turn by turn instead of as one flat event stream. */
export interface TrajectoryTurn {
  readonly prompt: string;
  readonly status: "completed" | "failed" | "cancelled";
  /** Cumulative `events` length after this turn, measured on the merged and
   * compacted array, so replay slices `[turns[i-1].eventCount, turns[i].eventCount)`.
   * Per-turn deltas would not be stable: `compactTrajectoryEvents` dedups `usage`
   * by `workflow.invocationId`, which carries no executionId, so a later turn can
   * collapse an event an earlier turn had already contributed. */
  readonly eventCount: number;
}

export interface TrajectoryDocument {
  readonly version: 1;
  readonly runId: string;
  readonly updatedAt: string;
  readonly status: "completed" | "failed" | "cancelled";
  readonly promptLength: number;
  readonly events: readonly unknown[];
  readonly sessionId?: string;
  readonly transcriptPath?: string;
  readonly error?: unknown;
  /** Human-assigned run name (set via the TUI `/rename` command). */
  readonly name?: string;
  /** Workflow this run executed, so `resume` reloads the same one. */
  readonly workflowPath?: string;
  /** TUI workspace at the time of the last turn, which may differ from the
   * session cwd after `/workspace`. */
  readonly workspaceCwd?: string;
  readonly turns?: readonly TrajectoryTurn[];
}

/** Write input for one turn. `turns` is writer-owned because `eventCount` can
 * only be measured after this turn's events are merged and compacted. */
export type TrajectoryWriteInput =
  & Omit<TrajectoryDocument, "version" | "runId" | "updatedAt" | "turns">
  & {
    /** Prompt text for this turn. Omit to update the document without
     * appending a turn entry. */
    readonly prompt?: string;
  };

/** One line of the append-only trajectory stream: what one write recorded,
 * plus the identity and the moment it recorded it.
 *
 * Turns and the cumulative event ledger are folded from these rather than
 * stored. A turn's extent is where its prompt is, and its `eventCount` is what
 * the fold had counted by then; storing them would mean every write had to read
 * the whole run back first, which is what re-serializing the growing document
 * cost. Fields a write does not speak about are absent, and the fold takes the
 * newest one that does. */
export interface TrajectoryStreamRecord {
  readonly version: 1;
  readonly runId: string;
  readonly timestamp: string;
  /** Prompt text, when this write closed a turn. */
  readonly prompt?: string;
  readonly status?: "completed" | "failed" | "cancelled";
  readonly promptLength?: number;
  readonly events: readonly unknown[];
  readonly sessionId?: string;
  readonly transcriptPath?: string;
  readonly error?: unknown;
  readonly name?: string;
  readonly workflowPath?: string;
  readonly workspaceCwd?: string;
}

/** The stream beside a trajectory document path. */
export function trajectoryStreamPath(documentPath: string): string {
  return `${documentPath}l`;
}

/** Append one record to the trajectory stream beside a document path.
 *
 * The stream's single writer seam: both writes go through it, so the file has
 * one place that knows its line format. */
function appendTrajectoryRecord(
  fileSystem: FileSystem.FileSystem,
  documentPath: string,
  record: TrajectoryStreamRecord,
): Effect.Effect<void, TrajectoryWriteError, never> {
  const path = trajectoryStreamPath(documentPath);
  return Effect.gen(function* () {
    const line = yield* Effect.try({
      try: () => `${stringifyTrajectory(record)}\n`,
      catch: (cause) => new TrajectoryWriteError({ operation: "serialize", path, message: errorMessage(cause) }),
    });
    yield* fileSystem.makeDirectory(dirname(path), { recursive: true }).pipe(
      Effect.mapError((cause) => new TrajectoryWriteError({ operation: "mkdir", path, message: errorMessage(cause) })),
    );
    yield* fileSystem.writeFileString(path, line, { flag: "a" }).pipe(
      Effect.mapError((cause) => new TrajectoryWriteError({ operation: "write", path, message: errorMessage(cause) })),
    );
  });
}

const MAX_TRAJECTORY_STRING = 8_192;
const MAX_TRAJECTORY_ARRAY = 128;
const MAX_TRAJECTORY_OBJECT_KEYS = 128;
const MAX_TRAJECTORY_DEPTH = 8;

/**
 * The Pi SDK emits very large, repeated `message_update` payloads.  A run
 * trajectory is an evaluation/observability index, not a second transcript:
 * keep the event types needed for metrics and a bounded summary while leaving
 * the complete payload in the stage transcript.  This also makes persistence
 * robust to provider-specific values (BigInt, circular objects, throwing
 * getters) carried by `unknown` event fields.
 */
function compactTrajectoryValue(
  value: unknown,
  ancestors: readonly object[] = [],
  depth = 0,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "string") {
    return value.length <= MAX_TRAJECTORY_STRING
      ? value
      : `${value.slice(0, MAX_TRAJECTORY_STRING - 16)}…[truncated]`;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (typeof value !== "object") return String(value);
  if (ancestors.includes(value)) return "[Circular]";
  if (depth >= MAX_TRAJECTORY_DEPTH) return "[Object depth limit]";

  const nextAncestors = [...ancestors, value];
  let arrayValue: readonly unknown[] | undefined;
  try {
    if (Array.isArray(value)) arrayValue = value;
  } catch {
    return "[Array unavailable]";
  }
  if (arrayValue !== undefined) {
    try {
      const items = arrayValue.slice(0, MAX_TRAJECTORY_ARRAY).map((item) =>
        compactTrajectoryValue(item, nextAncestors, depth + 1),
      );
      if (arrayValue.length > MAX_TRAJECTORY_ARRAY) items.push(`[${arrayValue.length - MAX_TRAJECTORY_ARRAY} more items]`);
      return items;
    } catch {
      return "[Array unavailable]";
    }
  }

  const output: Record<string, unknown> = {};
  let keys: string[];
  let keyCount = 0;
  try {
    const allKeys = Object.keys(value);
    keyCount = allKeys.length;
    keys = allKeys.slice(0, MAX_TRAJECTORY_OBJECT_KEYS);
  } catch {
    return "[Object keys unavailable]";
  }
  for (const key of keys) {
    try {
      output[key] = compactTrajectoryValue(
        (value as Record<string, unknown>)[key],
        nextAncestors,
        depth + 1,
      );
    } catch {
      output[key] = "[Value unavailable]";
    }
  }
  if (keyCount > MAX_TRAJECTORY_OBJECT_KEYS) {
    output.__truncatedKeys = `[${keyCount - MAX_TRAJECTORY_OBJECT_KEYS} more keys]`;
  }
  return output;
}

function compactTrajectoryMessage(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return compactTrajectoryValue(value);
  }
  try {
    const message = value as Record<string, unknown>;
    const content = message.content;
    let text: string | undefined;
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) {
      const parts = content.flatMap((part) => {
        if (typeof part !== "object" || part === null) return [];
        const partText = (part as Record<string, unknown>).text;
        return typeof partText === "string" ? [partText] : [];
      });
      if (parts.length > 0) text = parts.join("");
    }
    const summary: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(message)) {
      if (key === "content" || key === "role") continue;
      summary[key] = compactTrajectoryValue(item);
    }
    return {
      ...summary,
      ...(typeof message.role === "string" ? { role: message.role } : {}),
      ...(content === undefined ? {} : { content: compactTrajectoryValue(content) }),
      ...(text === undefined ? {} : { text: compactTrajectoryValue(text) }),
    };
  } catch {
    // A provider may expose an event message with a throwing getter or proxy.
    // Fall back to the generic bounded reader so one malformed field cannot
    // prevent the trajectory document from being persisted.
    return compactTrajectoryValue(value);
  }
}

function compactTrajectoryMessageField(source: Record<string, unknown>): unknown {
  try {
    return compactTrajectoryMessage(source.message);
  } catch {
    return "[Value unavailable]";
  }
}

function compactTrajectoryToolResultsField(source: Record<string, unknown>): readonly unknown[] {
  try {
    const toolResults = source.toolResults;
    return Array.isArray(toolResults)
      ? toolResults.slice(0, MAX_TRAJECTORY_ARRAY).map(compactTrajectoryMessage)
      : [];
  } catch {
    return [];
  }
}

function compactTrajectoryValueField(source: Record<string, unknown>, key: string): unknown {
  try {
    return compactTrajectoryValue(source[key]);
  } catch {
    return "[Value unavailable]";
  }
}

function compactTrajectoryBooleanField(source: Record<string, unknown>, key: string): boolean {
  try {
    return source[key] === true;
  } catch {
    return false;
  }
}

function compactTrajectoryStringField(source: Record<string, unknown>, key: string): string {
  try {
    const value = source[key];
    return typeof value === "string" ? value : "unknown";
  } catch {
    return "unknown";
  }
}

function compactTrajectoryExtras(
  source: Record<string, unknown>,
  excluded: readonly string[],
): Record<string, unknown> {
  try {
    const excludedSet = new Set(excluded);
    return Object.fromEntries(
      Object.keys(source)
        .filter((key) => !excludedSet.has(key))
        .map((key) => {
          try {
            return [key, compactTrajectoryValue(source[key])] as const;
          } catch {
            return [key, "[Value unavailable]"] as const;
          }
        }),
    );
  } catch {
    return {};
  }
}

function compactTrajectoryEvent(event: unknown): unknown | undefined {
  if (typeof event !== "object" || event === null) {
    return compactTrajectoryValue(event);
  }
  let eventIsArray = false;
  try {
    eventIsArray = Array.isArray(event);
  } catch {
    return compactTrajectoryValue(event);
  }
  if (eventIsArray) return compactTrajectoryValue(event);
  const source = event as Record<string, unknown>;
  let type: string | undefined;
  try {
    type = typeof source.type === "string" ? source.type : undefined;
  } catch {
    return compactTrajectoryValue(event);
  }
  if (type === undefined) return compactTrajectoryValue(event);
  // Token-level updates are intentionally omitted. They are high-volume,
  // repeated snapshots; the corresponding full stream remains in transcript.
  if (
    type === "message_update" ||
    type === "message_start" ||
    type === "tool_execution_update" ||
    type === "bash_execution_update"
  ) return undefined;

  let workflow: unknown;
  try {
    workflow = typeof source.workflow === "object" && source.workflow !== null
      ? compactTrajectoryValue(source.workflow)
      : undefined;
  } catch {
    workflow = undefined;
  }
  const envelope = (payload: Record<string, unknown> = {}): Record<string, unknown> => ({
    type,
    ...(workflow === undefined ? {} : { workflow }),
    ...payload,
  });
  switch (type) {
    case "message_end":
      return envelope({
        ...compactTrajectoryExtras(source, ["type", "workflow", "message"]),
        message: compactTrajectoryMessageField(source),
      });
    case "turn_end":
      return envelope({
        ...compactTrajectoryExtras(source, ["type", "workflow", "message", "toolResults"]),
        message: compactTrajectoryMessageField(source),
        toolResults: compactTrajectoryToolResultsField(source),
      });
    case "tool_execution_start":
      return envelope({
        toolCallId: compactTrajectoryStringField(source, "toolCallId"),
        toolName: compactTrajectoryStringField(source, "toolName"),
        args: compactTrajectoryValueField(source, "args"),
      });
    case "tool_execution_end":
      return envelope({
        toolCallId: compactTrajectoryStringField(source, "toolCallId"),
        toolName: compactTrajectoryStringField(source, "toolName"),
        result: compactTrajectoryValueField(source, "result"),
        isError: compactTrajectoryBooleanField(source, "isError"),
      });
    case "usage": {
      let usage: Record<string, unknown> = {};
      try {
        const value = source.usage;
        usage = typeof value === "object" && value !== null
          ? value as Record<string, unknown>
          : {};
      } catch {
        usage = {};
      }
      return envelope({ usage: compactTrajectoryValue(usage) });
    }
    case "agent_end": {
      let messages: readonly unknown[] = [];
      try {
        const value = source.messages;
        messages = Array.isArray(value) ? value : [];
      } catch {
        messages = [];
      }
      let willRetry = false;
      try {
        willRetry = source.willRetry === true;
      } catch {
        willRetry = false;
      }
      let compactMessages: readonly unknown[] = [];
      try {
        compactMessages = messages.slice(0, MAX_TRAJECTORY_ARRAY).map(compactTrajectoryMessage);
      } catch {
        compactMessages = [];
      }
      return envelope({
        messages: compactMessages,
        willRetry,
      });
    }
    case "context": {
      let context: Record<string, unknown> = {};
      try {
        const value = source.context;
        context = typeof value === "object" && value !== null
          ? value as Record<string, unknown>
          : {};
      } catch {
        context = {};
      }
      let systemPromptPath: string | undefined;
      try {
        const value = context.systemPromptPath;
        systemPromptPath = typeof value === "string" ? value : undefined;
      } catch {
        systemPromptPath = undefined;
      }
      let userMessage: string | undefined;
      try {
        const value = context.userMessage;
        userMessage = typeof value === "string" ? value : undefined;
      } catch {
        userMessage = undefined;
      }
      let contextFilePaths: readonly unknown[] | undefined;
      try {
        const value = context.contextFilePaths;
        contextFilePaths = Array.isArray(value) ? value : undefined;
      } catch {
        contextFilePaths = undefined;
      }
      let skills: readonly unknown[] | undefined;
      try {
        const value = context.skills;
        skills = Array.isArray(value) ? value : undefined;
      } catch {
        skills = undefined;
      }
      return envelope({
        context: {
          ...(contextFilePaths === undefined ? {} : { contextFilePaths: compactTrajectoryValue(contextFilePaths) }),
          ...(skills === undefined ? {} : { skills: compactTrajectoryValue(skills) }),
          ...(systemPromptPath === undefined ? {} : { systemPromptPath }),
          ...(userMessage === undefined ? {} : { userMessage: compactTrajectoryValue(userMessage) }),
        },
      });
    }
    case "resource":
    case "spawn":
    case "done":
    case "error":
    case "agent_start":
    case "agent_settled":
    case "turn_start":
    case "queue_update":
    case "compaction_start":
    case "compaction_end":
    case "auto_retry_start":
    case "auto_retry_end":
    case "summarization_retry_scheduled":
    case "summarization_retry_attempt_start":
    case "summarization_retry_finished":
    case "session_info_changed":
    case "thinking_level_changed":
      return envelope(compactTrajectoryExtras(source, ["type", "workflow"]));
    default:
      return envelope(compactTrajectoryExtras(source, ["type", "workflow"]));
  }
}

/** The slot a `usage` event belongs to, or `undefined` when it is not one.
 * Pi reports these repeatedly while streaming a turn, so one key owns one slot
 * in the ledger however many times it arrives. */
function usageSlotKey(compact: unknown): string | undefined {
  if (typeof compact !== "object" || compact === null || Array.isArray(compact)) return undefined;
  const value = compact as Record<string, unknown>;
  if (value.type !== "usage") return undefined;
  const workflow = value.workflow;
  const invocation = typeof workflow === "object" && workflow !== null && !Array.isArray(workflow)
    ? (workflow as Record<string, unknown>).invocationId
    : undefined;
  return typeof invocation === "string" ? invocation : "run";
}

function compactTrajectoryEvents(events: readonly unknown[]): readonly unknown[] {
  const compacted: unknown[] = [];
  const usageSlots = new Map<string, number>();
  for (const event of events) {
    const compact = compactTrajectoryEvent(event);
    if (compact === undefined) continue;
    const key = usageSlotKey(compact);
    if (key === undefined) {
      compacted.push(compact);
      continue;
    }
    const prior = usageSlots.get(key);
    if (prior === undefined) {
      usageSlots.set(key, compacted.length);
      compacted.push(compact);
    } else {
      // Keep the latest snapshot for each stage/actor; metrics use the
      // maximum, and transcripts retain every raw update for forensic
      // inspection. The slot keeps its first position, so the ledger's order
      // is the order events first appeared.
      compacted[prior] = compact;
    }
  }
  return compacted;
}

/** Parse a run's trajectory from whichever of its two on-disk forms is there.
 *
 * The stream wins: every write lands in it first, and the document is folded
 * from it. The document is read for runs written before the stream existed, and
 * when the stream holds nothing usable — a torn or empty file describes no run.
 *
 * Takes raw file contents rather than paths because its callers read files
 * through different layers, some through Effects and some synchronously. The
 * choice between the two forms lives here and nowhere else. */
export function parseTrajectory(
  raw: { readonly stream?: string; readonly document?: string },
): TrajectoryDocument | undefined {
  const document = parseTrajectoryDocument(raw.document);
  const records: TrajectoryStreamRecord[] = [];
  for (const line of (raw.stream ?? "").split("\n")) {
    const record = parseStreamRecord(line);
    if (record !== undefined) records.push(record);
  }
  // The document seeds the fold: a run written before the stream existed keeps
  // its history there, and the records appended after an upgrade continue it
  // rather than replacing it.
  return records.length > 0 ? foldTrajectoryStream(records, document) : document;
}

function parseTrajectoryDocument(raw: string | undefined): TrajectoryDocument | undefined {
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as TrajectoryDocument : undefined;
  } catch {
    return undefined;
  }
}

/** One stream record, or `undefined` for a blank, torn, or shapeless line.
 *
 * The identity is what tells a record from any other object that happens to be
 * JSON: a file of bare events, say, must not fold into a run. */
function parseStreamRecord(line: string): TrajectoryStreamRecord | undefined {
  if (line.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // Torn mid-append: it describes a write that never finished, and the
    // records before it are still good.
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as { runId?: unknown; timestamp?: unknown };
  if (typeof record.runId !== "string" || typeof record.timestamp !== "string") return undefined;
  return parsed as TrajectoryStreamRecord;
}

/** Rebuild a run's trajectory document from its stream.
 *
 * The counterpart of the writer's read-merge-rewrite, with the merging done
 * once instead of once per write. Events concatenate and compact in order, a
 * turn's extent is where its prompt sits, and each optional field takes its
 * newest definition — which is what the writer did by hand when it carried the
 * previous document's fields forward.
 *
 * `seed` is the run as it was recorded before the stream existed. A run that
 * predates the stream keeps its history there, and the first record appended
 * after an upgrade would otherwise describe a run with only that record in it. */
export function foldTrajectoryStream(
  records: readonly TrajectoryStreamRecord[],
  seed?: TrajectoryDocument,
): TrajectoryDocument | undefined {
  const seedEvents = seed?.events ?? [];
  const seedTurns = seed?.turns ?? [];
  const last = records.at(-1);
  if (last === undefined) return seed;

  // One linear pass: a `usage` key holds one slot from where it first appeared,
  // so the ledger's length at any point is the distinct keys seen so far plus
  // the events that are not usage snapshots. The seed's keys already hold their
  // positions, and its turns carry their own cumulative counts.
  const turns: TrajectoryTurn[] = [...seedTurns];
  const seenUsage = new Set<string>();
  for (const event of seedEvents) {
    const key = usageSlotKey(compactTrajectoryEvent(event));
    if (key !== undefined) seenUsage.add(key);
  }
  let eventCount = seedTurns.at(-1)?.eventCount ?? compactTrajectoryEvents(seedEvents).length;
  for (const record of records) {
    for (const event of record.events) {
      const compact = compactTrajectoryEvent(event);
      if (compact === undefined) continue;
      const key = usageSlotKey(compact);
      if (key !== undefined) {
        if (seenUsage.has(key)) continue;
        seenUsage.add(key);
      }
      eventCount += 1;
    }
    // A turn entry belongs to a record that carried a prompt, so non-turn
    // updates (rename, session id backfill) never inflate the replay index.
    // A record that carries one always carries the status it closed with.
    if (record.prompt !== undefined && record.status !== undefined) {
      turns.push({ prompt: record.prompt, status: record.status, eventCount });
    }
  }

  const newest = <K extends "status" | "promptLength" | "sessionId" | "transcriptPath" | "error" | "name" | "workflowPath" | "workspaceCwd">(
    key: K,
  ): TrajectoryStreamRecord[K] | undefined => {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const value = records[index]?.[key];
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const status = newest("status");
  const promptLength = newest("promptLength");
  // A stream that never said how a run ended does not describe a document.
  if (status === undefined || promptLength === undefined) return undefined;

  return {
    version: 1,
    runId: last.runId,
    updatedAt: last.timestamp,
    status,
    promptLength,
    events: compactTrajectoryEvents([...seedEvents, ...records.flatMap((record) => record.events)]),
    ...(turns.length === 0 ? {} : { turns }),
    ...(newest("sessionId") === undefined ? {} : { sessionId: newest("sessionId") }),
    ...(newest("transcriptPath") === undefined ? {} : { transcriptPath: newest("transcriptPath") }),
    ...(newest("error") === undefined ? {} : { error: newest("error") }),
    ...(newest("name") === undefined ? {} : { name: newest("name") }),
    ...(newest("workflowPath") === undefined ? {} : { workflowPath: newest("workflowPath") }),
    ...(newest("workspaceCwd") === undefined ? {} : { workspaceCwd: newest("workspaceCwd") }),
  };
}

function stringifyTrajectory(value: unknown): string {
  // Values have already been recursively bounded. Keep the final guard so a
  // future event variant produces a typed write error instead of a malformed
  // trajectory document.
  const content = JSON.stringify(value);
  if (content === undefined) throw new TypeError("trajectory could not be serialized");
  return content;
}

/** Persist the compact event ledger shown by the TUI side panel. */
export class TrajectoryWriter {
  constructor(
    readonly runId: string,
    readonly path: string,
  ) {}

  write(
    document: TrajectoryWriteInput,
  ): Effect.Effect<void, TrajectoryWriteError, FileSystem.FileSystem> {
    const { runId, path } = this;
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const now = new Date().toISOString();
      // The record lands before the view that is folded from it: a failure
      // between the two must leave the view stale, not the record missing.
      yield* appendTrajectoryRecord(fileSystem, path, {
        version: 1,
        runId,
        timestamp: now,
        status: document.status,
        promptLength: document.promptLength,
        events: compactTrajectoryEvents(document.events),
        ...(document.prompt === undefined ? {} : { prompt: document.prompt }),
        ...(document.sessionId === undefined ? {} : { sessionId: document.sessionId }),
        ...(document.transcriptPath === undefined ? {} : { transcriptPath: document.transcriptPath }),
        ...(document.error === undefined ? {} : { error: document.error }),
        ...(document.name === undefined ? {} : { name: document.name }),
        ...(document.workflowPath === undefined ? {} : { workflowPath: document.workflowPath }),
        ...(document.workspaceCwd === undefined ? {} : { workspaceCwd: document.workspaceCwd }),
      });
      const previous = yield* fileSystem.readFileString(path).pipe(
        Effect.flatMap((content) => Effect.try({
          try: () => JSON.parse(content) as Partial<TrajectoryDocument>,
          catch: (cause) => new TrajectoryWriteError({
            operation: "read",
            path,
            message: errorMessage(cause),
          }),
        })),
        Effect.catchAll((cause) => cause._tag === "SystemError" && cause.reason === "NotFound"
          ? Effect.succeed(undefined)
          : Effect.fail(cause instanceof TrajectoryWriteError ? cause : new TrajectoryWriteError({
            operation: "read",
            path,
            message: errorMessage(cause),
          }))),
      );
      const { prompt, ...fields } = document;
      const events = compactTrajectoryEvents([
        ...(previous === undefined || !Array.isArray(previous.events) ? [] : previous.events),
        ...document.events,
      ]);
      const priorTurns = previous === undefined || !Array.isArray(previous.turns) ? [] : previous.turns;
      const merged = {
        ...fields,
        events,
        // A turn entry is appended only when the caller supplies the prompt
        // text, so non-turn updates (rename, session id backfill) never inflate
        // the replay index.
        ...(prompt === undefined
          ? (priorTurns.length === 0 ? {} : { turns: priorTurns })
          : { turns: [...priorTurns, { prompt, status: document.status, eventCount: events.length }] }),
        ...(previous === undefined || document.sessionId !== undefined || previous.sessionId === undefined
          ? {}
          : { sessionId: previous.sessionId }),
        ...(previous === undefined || document.transcriptPath !== undefined || previous.transcriptPath === undefined
          ? {}
          : { transcriptPath: previous.transcriptPath }),
        ...(previous === undefined || document.name !== undefined || previous.name === undefined
          ? {}
          : { name: previous.name }),
        ...(previous === undefined || document.workflowPath !== undefined || previous.workflowPath === undefined
          ? {}
          : { workflowPath: previous.workflowPath }),
        ...(previous === undefined || document.workspaceCwd !== undefined || previous.workspaceCwd === undefined
          ? {}
          : { workspaceCwd: previous.workspaceCwd }),
      };
      const content = yield* Effect.try({
        try: () => `${stringifyTrajectory({
          version: 1 as const,
          runId,
          updatedAt: now,
          ...merged,
        })}\n`,
        catch: (cause) => new TrajectoryWriteError({
          operation: "serialize",
          path,
          message: errorMessage(cause),
        }),
      });
      yield* fileSystem.makeDirectory(dirname(path), { recursive: true }).pipe(
        Effect.mapError((cause) => new TrajectoryWriteError({
          operation: "mkdir",
          path,
          message: errorMessage(cause),
        })),
      );
      yield* fileSystem.writeFileString(path, content).pipe(
        Effect.mapError((cause) => new TrajectoryWriteError({
          operation: "write",
          path,
          message: errorMessage(cause),
        })),
      );
    });
  }

  /** Persist a human-assigned run name into the existing trajectory document,
   * preserving every other field (status, events, session id, transcript path).
   * A missing file yields a `read` TrajectoryWriteError rather than a fresh doc,
   * since a run must already exist before it can be named. */
  rename(
    name: string,
  ): Effect.Effect<void, TrajectoryWriteError, FileSystem.FileSystem> {
    const { runId, path } = this;
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const previous = yield* fileSystem.readFileString(path).pipe(
        Effect.flatMap((content) => Effect.try({
          try: () => JSON.parse(content) as Partial<TrajectoryDocument>,
          catch: (cause) => new TrajectoryWriteError({
            operation: "read",
            path,
            message: errorMessage(cause),
          }),
        })),
        Effect.mapError((cause) => cause instanceof TrajectoryWriteError
          ? cause
          : new TrajectoryWriteError({
            operation: "read",
            path,
            message: errorMessage(cause),
          })),
      );
      const merged = { ...previous, name };
      const now = new Date().toISOString();
      // The record says only what this write is about. The fold carries the
      // run's fields forward from the writes that did speak about them, which
      // is what this method does to the document by hand.
      yield* appendTrajectoryRecord(fileSystem, path, {
        version: 1,
        runId,
        timestamp: now,
        events: [],
        name,
      });
      const content = yield* Effect.try({
        try: () => `${JSON.stringify({
          ...merged,
          version: 1 as const,
          runId,
          updatedAt: now,
        }, null, 2)}\n`,
        catch: (cause) => new TrajectoryWriteError({
          operation: "serialize",
          path,
          message: errorMessage(cause),
        }),
      });
      yield* fileSystem.makeDirectory(dirname(path), { recursive: true }).pipe(
        Effect.mapError((cause) => new TrajectoryWriteError({
          operation: "mkdir",
          path,
          message: errorMessage(cause),
        })),
      );
      yield* fileSystem.writeFileString(path, content).pipe(
        Effect.mapError((cause) => new TrajectoryWriteError({
          operation: "write",
          path,
          message: errorMessage(cause),
        })),
      );
    });
  }
}

export interface ITrajectoryWriter {
  readonly runId: string;
  readonly path: string;
  write(document: TrajectoryWriteInput): Effect.Effect<void, TrajectoryWriteError, FileSystem.FileSystem>;
  rename(name: string): Effect.Effect<void, TrajectoryWriteError, FileSystem.FileSystem>;
}

/** Buffers trajectory writes in memory until {@link commit} is called with the
 * real path.  After commit, delegates directly to {@link TrajectoryWriter}. */
export class AsyncTrajectoryWriter implements ITrajectoryWriter {
  private queue: TrajectoryWriteInput[] | null = [];
  private committed: TrajectoryWriter | null = null;

  constructor(
    readonly runId: string,
    readonly path: string = "",
  ) {}

  commit(path: string): Effect.Effect<void, TrajectoryWriteError, FileSystem.FileSystem> {
    const writer = new TrajectoryWriter(this.runId, path);
    const pending = this.queue ?? [];
    this.queue = null;
    this.committed = writer;
    return Effect.forEach(pending, (input) => writer.write(input), { discard: true });
  }

  write(document: TrajectoryWriteInput): Effect.Effect<void, TrajectoryWriteError, FileSystem.FileSystem> {
    if (this.committed !== null) return this.committed.write(document);
    this.queue!.push(document);
    return Effect.void;
  }

  rename(name: string): Effect.Effect<void, TrajectoryWriteError, FileSystem.FileSystem> {
    if (this.committed !== null) return this.committed.rename(name);
    // staging: no document yet, record rename as a write input so it's applied on commit
    this.queue!.push({ status: "completed", promptLength: 0, events: [], name });
    return Effect.void;
  }
}
