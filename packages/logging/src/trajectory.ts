import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname, join } from "node:path";
import { errorMessage, TrajectoryWriteError } from "./errors.js";

/** One accepted prompt in a run, recorded so `resume` can replay the piano
 * conversation turn by turn instead of as one flat event stream. */
export interface TrajectoryTurn {
  readonly prompt: string;
  readonly status: "completed" | "failed" | "cancelled";
  /** Cumulative `events` length after this turn, measured on the merged and
   * compacted array, so replay slices `[turns[i-1].eventCount, turns[i].eventCount)`.
   * Per-turn deltas would not be stable: `compactTrajectoryEvents` dedups `usage`
   * by `workflow.invocationId`, which carries no runId, so a later turn can
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
  /** How many stream records this document already includes.
   *
   * A write appends its record and then rewrites the document, so a crash
   * between the two leaves the document short by the record that landed.
   * Counting them is what lets a reader fold exactly the records the document
   * is missing, rather than guessing from timestamps — two writes can share a
   * millisecond, and a guess would drop one of them.
   *
   * Absent on a document written before this field existed, which reads the
   * same as zero: a document that includes no records at all. */
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

/** The run's trajectory stream, beside the state document that describes it. */
export function trajectoryStreamPath(runDir: string): string {
  return join(runDir, "trajectory.jsonl");
}

/** Append one record to the trajectory stream beside a document path.
 *
 * The stream's single writer seam: both writes go through it, so the file has
 * one place that knows its line format. */
function appendTrajectoryRecord(
  fileSystem: FileSystem.FileSystem,
  path: string,
  record: TrajectoryStreamRecord,
): Effect.Effect<void, TrajectoryWriteError, never> {
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
    default:
      // Every remaining known event type (resource, spawn, done, error, the
      // agent/turn/queue/compaction/retry/summarization lifecycle, session
      // info, thinking level) passes through with its extras compacted, the
      // same as anything unknown.
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
  for (const event of events) {
    const compact = compactTrajectoryEvent(event);
    if (compact !== undefined) compacted.push(compact);
  }
  // The usage-slot rule lives in mergeTrajectoryLedgers alone: merging this
  // batch as one ledger applies it exactly as the fold applies it across
  // records — the slot keeps its first position and the latest snapshot.
  return mergeTrajectoryLedgers([compacted]);
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
/** What a run's trajectory says, folded from its append-only stream.
 *
 * Takes raw contents rather than a path because its callers read the file
 * through different layers, some with Effects and some synchronously. */
export function parseTrajectory(stream: string | undefined): TrajectoryDocument | undefined {
  return foldTrajectoryStream(parseStreamRecords(stream));
}

function parseStreamRecords(raw: string | undefined): readonly TrajectoryStreamRecord[] {
  const records: TrajectoryStreamRecord[] = [];
  for (const line of (raw ?? "").split("\n")) {
    const record = parseStreamRecord(line);
    if (record !== undefined) records.push(record);
  }
  return records;
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

/** Rebuild a run's trajectory from its stream.
 *
 * Events concatenate and compact in order, a turn's extent is where its prompt
 * sits, and each optional field takes its newest definition. */
export function foldTrajectoryStream(
  records: readonly TrajectoryStreamRecord[],
): TrajectoryDocument | undefined {
  const last = records.at(-1);
  if (last === undefined) return undefined;

  // One linear pass: a `usage` key holds one slot from where it first appeared,
  // so the ledger's length at any point is the distinct keys seen so far plus
  // the events that are not usage snapshots.
  const turns: TrajectoryTurn[] = [];
  const seenUsage = new Set<string>();
  let eventCount = 0;
  for (const record of records) {
    for (const event of record.events) {
      const key = usageSlotKey(event);
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

  // The newest record that speaks about a field wins; one that says nothing
  // about it leaves the field out.
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
    promptLength,
    events: mergeTrajectoryLedgers(records.map((record) => record.events)),
    ...(turns.length === 0 ? {} : { turns }),
    ...(newest("sessionId") === undefined ? {} : { sessionId: newest("sessionId") }),
    ...(newest("transcriptPath") === undefined ? {} : { transcriptPath: newest("transcriptPath") }),
    ...(newest("error") === undefined ? {} : { error: newest("error") }),
    ...(newest("name") === undefined ? {} : { name: newest("name") }),
    ...(newest("workflowPath") === undefined ? {} : { workflowPath: newest("workflowPath") }),
    ...(newest("workspaceCwd") === undefined ? {} : { workspaceCwd: newest("workspaceCwd") }),
    // Last, and after `workflowPath`, because the log picker reads a bounded
    // tail of this file rather than the whole of it — a run's events are the
    // bulk of the document and they sit between. A document that put the
    // status anywhere else would show a failed run without saying so.
    status,
  };
}

/** Concatenate ledgers that are already compacted, keeping one slot per usage
 * key — the rule the writer applies, without compacting a second time.
 *
 * Compacting twice is not idempotent: a value that could not be read is
 * replaced by a sentinel, and the second pass would find the sentinel where it
 * expects the value and drop the field. Records carry compacted events, so the
 * fold merges them rather than revisiting them. */
function mergeTrajectoryLedgers(ledgers: readonly (readonly unknown[])[]): readonly unknown[] {
  const merged: unknown[] = [];
  const usageSlots = new Map<string, number>();
  for (const ledger of ledgers) {
    for (const event of ledger) {
      const key = usageSlotKey(event);
      if (key === undefined) {
        merged.push(event);
        continue;
      }
      const prior = usageSlots.get(key);
      if (prior === undefined) {
        usageSlots.set(key, merged.length);
        merged.push(event);
      } else {
        // The slot keeps its first position and takes the latest snapshot.
        merged[prior] = event;
      }
    }
  }
  return merged;
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
      // The record lands before the document rewritten from it: a failure
      // between the two must leave the document stale, not the record missing.
      //
      // The rewrite is the whole write's cost — it merges the run so far and
      // serializes it — so this is what still makes a write grow with the run.
      // It is kept because the document is what a reader reads directly; a run
      // without one falls back to folding the stream, which cannot describe a
      // run whose stream began after its document did.
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
    });
  }

  /** Persist a human-assigned run name as one more record.
   *
   * Naming changes a history rather than starting one: a run the stream cannot
   * describe has nothing to name, and is refused before anything is written. */
  rename(
    name: string,
  ): Effect.Effect<void, TrajectoryWriteError, FileSystem.FileSystem> {
    const { runId, path } = this;
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const stream = yield* fileSystem.readFileString(path).pipe(Effect.orElseSucceed(() => undefined));
      if (parseTrajectory(stream) === undefined) {
        return yield* Effect.fail(new TrajectoryWriteError({
          operation: "read",
          path,
          message: "no trajectory recorded for this run",
        }));
      }
      yield* appendTrajectoryRecord(fileSystem, path, {
        version: 1,
        runId,
        timestamp: new Date().toISOString(),
        events: [],
        name,
      });
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
