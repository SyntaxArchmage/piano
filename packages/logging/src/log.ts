import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname } from "node:path";
import { errorMessage, LogWriteError } from "./errors.js";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const severityNumber: Record<LogLevel, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

export interface LogFields {
  module?: string;
  file?: string;
  function?: string;
  stage?: string;
  agent?: string;
  level?: LogLevel;
  namespace?: string;
  instance?: string;
  attempt?: number;
  spanId?: string;
  message?: string;
  outcome?: string;
  data?: Record<string, unknown>;
}

export interface ILogWriter {
  readonly runId: string;
  readonly path: string;
  readonly traceId: string;
  append(event: string, fields?: LogFields): Effect.Effect<void, LogWriteError, FileSystem.FileSystem>;
}

export class LogWriter implements ILogWriter {
  constructor(
    readonly runId: string,
    readonly path: string,
    readonly traceId: string,
  ) {}

  append(
    event: string,
    fields: LogFields = {},
  ): Effect.Effect<void, LogWriteError, FileSystem.FileSystem> {
    const { runId, path, traceId } = this;
    return Effect.gen(function* () {
      const entry = yield* Effect.try({
        try: () => ({
          timestamp: new Date().toISOString(),
          run_id: runId,
          trace_id: traceId,
          ...(fields.spanId === undefined ? {} : { span_id: fields.spanId }),
          ...(fields.module === undefined ? {} : { module: fields.module }),
          ...(fields.file === undefined ? {} : { file: fields.file }),
          ...(fields.function === undefined ? {} : { function: fields.function }),
          ...(fields.stage === undefined ? {} : { stage: fields.stage }),
          ...(fields.agent === undefined ? {} : { agent: fields.agent }),
          event,
          severity: fields.level ?? "info",
          severity_number: severityNumber[fields.level ?? "info"],
          ...(fields.namespace === undefined ? {} : { namespace: fields.namespace }),
          message: fields.message ?? humanMessage(event),
          ...(fields.instance === undefined ? {} : { instance: fields.instance }),
          ...(fields.attempt === undefined ? {} : { attempt: fields.attempt }),
          ...(fields.outcome === undefined ? {} : { outcome: fields.outcome }),
          ...(fields.data === undefined ? {} : { attributes: fields.data }),
        }),
        catch: (cause) => new LogWriteError({
          operation: "serialize",
          path,
          message: errorMessage(cause),
        }),
      });
      const line = yield* Effect.try({
        try: () => `${JSON.stringify(entry)}\n`,
        catch: (cause) => new LogWriteError({
          operation: "serialize",
          path,
          message: errorMessage(cause),
        }),
      });
      const fileSystem = yield* FileSystem.FileSystem;
      yield* fileSystem.makeDirectory(dirname(path), { recursive: true }).pipe(
        Effect.mapError((cause) => new LogWriteError({
          operation: "mkdir",
          path,
          message: errorMessage(cause),
        })),
      );
      yield* fileSystem.writeFileString(path, line, { flag: "a" }).pipe(
        Effect.mapError((cause) => new LogWriteError({
          operation: "append",
          path,
          message: errorMessage(cause),
        })),
      );
    });
  }
}

/** Buffers log entries in memory until {@link commit} is called with the real
 * path.  After commit the writer delegates every call to a {@link LogWriter}. */
export class AsyncLogWriter implements ILogWriter {
  private pending: Array<{ event: string; fields: LogFields }> | null = [];
  private committed: LogWriter | null = null;
  readonly path: string = "";

  constructor(
    readonly runId: string,
    readonly traceId: string,
  ) {}

  commit(path: string): Effect.Effect<void, LogWriteError, FileSystem.FileSystem> {
    const writer = new LogWriter(this.runId, path, this.traceId);
    const queue = this.pending ?? [];
    this.pending = null;
    this.committed = writer;
    return Effect.forEach(queue, ({ event, fields }) => writer.append(event, fields), { discard: true });
  }

  append(event: string, fields: LogFields = {}): Effect.Effect<void, LogWriteError, FileSystem.FileSystem> {
    if (this.committed !== null) return this.committed.append(event, fields);
    this.pending!.push({ event, fields });
    return Effect.void;
  }
}

function humanMessage(event: string): string {
  return event
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
