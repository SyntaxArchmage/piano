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

function compactTrajectoryEvents(events: readonly unknown[]): readonly unknown[] {
  const compacted: unknown[] = [];
  const usageSlots = new Map<string, number>();
  for (const event of events) {
    const compact = compactTrajectoryEvent(event);
    if (compact === undefined) continue;
    if (
      typeof compact === "object" &&
      compact !== null &&
      !Array.isArray(compact) &&
      (compact as Record<string, unknown>).type === "usage"
    ) {
      const workflow = (compact as Record<string, unknown>).workflow;
      const invocation = typeof workflow === "object" && workflow !== null && !Array.isArray(workflow)
        ? (workflow as Record<string, unknown>).invocationId
        : undefined;
      const key = typeof invocation === "string" ? invocation : "run";
      const prior = usageSlots.get(key);
      if (prior === undefined) {
        usageSlots.set(key, compacted.length);
        compacted.push(compact);
      } else {
        // Pi reports cumulative usage repeatedly while streaming a turn. Keep
        // the latest snapshot for each stage/actor; metrics use the maximum,
        // and transcripts retain every raw update for forensic inspection.
        compacted[prior] = compact;
      }
      continue;
    }
    compacted.push(compact);
  }
  return compacted;
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
          updatedAt: new Date().toISOString(),
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
      const content = yield* Effect.try({
        // One serializer for every write into this file. The picker reads the
        // tail with a byte-window regex, so a second, prettier spelling here
        // would silently cost the row its workflow, status and prompt.
        try: () => `${stringifyTrajectory({
          ...merged,
          version: 1 as const,
          runId,
          updatedAt: new Date().toISOString(),
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
