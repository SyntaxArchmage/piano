import { FileSystem } from "@effect/platform";
import { Effect, FiberRef } from "effect";
import { dirname } from "node:path";
import { errorMessage, failureDetails, TraceWriteError, type FailureDetails } from "./errors.js";

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentId: string | null;
  depth: number;
  fn: string;
  module?: string;
  file?: string;
  startedAt: number;
}

type TraceRecord = {
  timestamp: string;
  run_id: string;
  trace_id: string;
  seq: number;
  depth: number;
  span_id: string;
  parent_id: string | null;
  event: "enter" | "exit" | "error";
  status?: "ok" | "error";
  fn: string;
  module?: string;
  file?: string;
  args?: unknown;
  ok?: boolean;
  duration_ms?: number;
  result?: unknown;
  error?: FailureDetails;
};

export interface ITraceWriter {
  readonly runId: string;
  readonly traceId: string;
  currentSpan(): Effect.Effect<TraceSpan | undefined>;
  enter(fn: string, args?: unknown, source?: { module: string; file: string }): Effect.Effect<TraceSpan, TraceWriteError, FileSystem.FileSystem>;
  exit(span: TraceSpan, result?: unknown): Effect.Effect<void, TraceWriteError, FileSystem.FileSystem>;
  error(span: TraceSpan, cause: unknown): Effect.Effect<void, TraceWriteError, FileSystem.FileSystem>;
}

export class TraceWriter implements ITraceWriter {
  private counter = 0;
  private seq = 0;
  private readonly stack = FiberRef.unsafeMake<readonly TraceSpan[]>([]);

  constructor(
    readonly runId: string,
    protected path: string,
    readonly traceId: string = runId,
  ) {}

  currentSpan(): Effect.Effect<TraceSpan | undefined> {
    return FiberRef.get(this.stack).pipe(Effect.map((stack) => stack[stack.length - 1]));
  }

  enter(
    fn: string,
    args?: unknown,
    source?: { module: string; file: string },
  ): Effect.Effect<TraceSpan, TraceWriteError, FileSystem.FileSystem> {
    const { runId, traceId } = this;
    const stack = this.stack;
    const append = (record: TraceRecord) => this.append(record);
    const nextSpanId = () => `sp-${++this.counter}`;
    const nextSequence = () => ++this.seq;
    return Effect.gen(function* () {
      const currentStack = yield* FiberRef.get(stack);
      const span = yield* Effect.sync(() => ({
        traceId,
        spanId: nextSpanId(),
        parentId: currentStack[currentStack.length - 1]?.spanId ?? null,
        depth: currentStack.length,
        fn,
        ...(source === undefined ? {} : { module: source.module, file: source.file }),
        startedAt: performance.now(),
      }));
      yield* append({
        timestamp: new Date().toISOString(),
        run_id: runId,
        trace_id: traceId,
        seq: nextSequence(),
        depth: span.depth,
        span_id: span.spanId,
        parent_id: span.parentId,
        event: "enter",
        fn,
        ...(source === undefined ? {} : { module: source.module, file: source.file }),
        ...(args === undefined ? {} : { args: summarizeTraceValue(args) }),
      });
      yield* FiberRef.set(stack, [...currentStack, span]);
      return span;
    });
  }

  exit(
    span: TraceSpan,
    result?: unknown,
  ): Effect.Effect<void, TraceWriteError, FileSystem.FileSystem> {
    return this.finish(span, {
      event: "exit",
      status: "ok",
      ok: true,
      ...(result === undefined ? {} : { result: summarizeTraceValue(result) }),
    });
  }

  error(
    span: TraceSpan,
    cause: unknown,
  ): Effect.Effect<void, TraceWriteError, FileSystem.FileSystem> {
    return this.finish(span, {
      event: "error",
      status: "error",
      ok: false,
      error: failureDetails(cause),
    });
  }

  private finish(
    span: TraceSpan,
    result: Pick<TraceRecord, "event" | "status" | "ok" | "result" | "error">,
  ): Effect.Effect<void, TraceWriteError, FileSystem.FileSystem> {
    const { runId, traceId } = this;
    const stack = this.stack;
    const append = (record: TraceRecord) => this.append(record);
    const nextSequence = () => ++this.seq;
    return Effect.gen(function* () {
      yield* append({
        timestamp: new Date().toISOString(),
        run_id: runId,
        trace_id: traceId,
        seq: nextSequence(),
        depth: span.depth,
        span_id: span.spanId,
        parent_id: span.parentId,
        fn: span.fn,
        ...(span.module === undefined ? {} : { module: span.module }),
        ...(span.file === undefined ? {} : { file: span.file }),
        ...result,
        duration_ms: Math.round(performance.now() - span.startedAt),
      }).pipe(Effect.ensuring(
        FiberRef.get(stack).pipe(
          Effect.flatMap((currentStack) => FiberRef.set(
            stack,
            currentStack.filter((current) => current.spanId !== span.spanId),
          )),
        ),
      ));
    });
  }

  private append(record: TraceRecord): Effect.Effect<void, TraceWriteError, FileSystem.FileSystem> {
    return this.writeRecord(record);
  }

  protected writeRecord(record: TraceRecord): Effect.Effect<void, TraceWriteError, FileSystem.FileSystem> {
    const { path } = this;
    return Effect.gen(function* () {
      const line = yield* Effect.try({
        try: () => `${JSON.stringify(record)}\n`,
        catch: (cause) => new TraceWriteError({
          operation: "serialize",
          path,
          message: errorMessage(cause),
        }),
      });
      const fileSystem = yield* FileSystem.FileSystem;
      yield* fileSystem.makeDirectory(dirname(path), { recursive: true }).pipe(
        Effect.mapError((cause) => new TraceWriteError({
          operation: "mkdir",
          path,
          message: errorMessage(cause),
        })),
      );
      yield* fileSystem.writeFileString(path, line, { flag: "a" }).pipe(
        Effect.mapError((cause) => new TraceWriteError({
          operation: "append",
          path,
          message: errorMessage(cause),
        })),
      );
    });
  }
}

function summarizeTraceValue(value: unknown): unknown {
  try {
    if (typeof value === "string") return value.length <= 240 ? value : `${value.slice(0, 237)}...`;
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value !== "object" || value === null) return value;
    if (Array.isArray(value)) return { type: "array", length: value.length };
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 20).map(([key, item]) => [
      key,
      typeof item === "string" && item.length > 240
        ? `${item.slice(0, 237)}...`
        : typeof item === "object" && item !== null
          ? Array.isArray(item) ? { type: "array", length: item.length } : { type: "object" }
          : typeof item === "bigint"
            ? `${item}n`
          : item,
    ]));
  } catch {
    return "[Value unavailable]";
  }
}

type PendingRecord = TraceRecord;

/** Buffers trace records in memory until {@link commit} is called.  The span
 * stack (FiberRef) and counter allocation work normally during staging so
 * callers can hold real TraceSpan values; only the disk write is deferred. */
export class AsyncTraceWriter extends TraceWriter {
  private queue: PendingRecord[] | null = [];

  constructor(
    runId: string,
    traceId: string = runId,
  ) {
    super(runId, "", traceId);
  }

  commit(path: string): Effect.Effect<void, TraceWriteError, FileSystem.FileSystem> {
    const flushed = this.queue ?? [];
    this.queue = null;
    this.path = path;
    return Effect.forEach(flushed, (record) => this.writeRecord(record), { discard: true });
  }

  protected override writeRecord(record: TraceRecord): Effect.Effect<void, TraceWriteError, FileSystem.FileSystem> {
    if (this.queue === null) return super.writeRecord(record);
    this.queue.push(record);
    return Effect.void;
  }
}
