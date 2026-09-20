import { Context, Effect, Exit } from "effect";
import type { FileSystem } from "@effect/platform";
import { type ILogWriter, type LogFields } from "./log.js";
import { type ITraceWriter } from "./trace.js";
import { failureDetails, isCancellation, type LogWriteError, type TraceWriteError } from "./errors.js";

export type ObservabilityError = LogWriteError | TraceWriteError;

export interface LoggingService {
  readonly log: ILogWriter;
  readonly trace: ITraceWriter;
}

export interface Source {
  readonly module: string;
  readonly file: string;
  readonly function: string;
}

/** The run-scoped logging capability used by LOG and TRACE. */
export class Logging extends Context.Tag("@piano/logging/Logging")<
  Logging,
  LoggingService
>() {}

export type LoggingContext = Pick<LogFields, "stage" | "agent" | "namespace" | "instance" | "attempt">;
export type LoggerFields = Omit<LogFields, "module" | "file" | "function" | "level" | "ns" | "status">;
export interface Logger {
  /** Application control flow is not failed by best-effort observability. */
  readonly trace: (event: string, fields?: LoggerFields) => Effect.Effect<void, never, Logging | FileSystem.FileSystem>;
  readonly debug: (event: string, fields?: LoggerFields) => Effect.Effect<void, never, Logging | FileSystem.FileSystem>;
  readonly info: (event: string, fields?: LoggerFields) => Effect.Effect<void, never, Logging | FileSystem.FileSystem>;
  readonly warn: (event: string, fields?: LoggerFields) => Effect.Effect<void, never, Logging | FileSystem.FileSystem>;
  readonly error: (event: string, fields?: LoggerFields) => Effect.Effect<void, never, Logging | FileSystem.FileSystem>;
  readonly fatal: (event: string, fields?: LoggerFields) => Effect.Effect<void, never, Logging | FileSystem.FileSystem>;
  readonly with: (context: LoggingContext) => Logger;
}

export type LoggingEffect<A, E = never, R = never> = Effect.Effect<
  A,
  E | ObservabilityError,
  R | Logging | FileSystem.FileSystem
>;

/** Record an application event without coupling the caller to a writer. */
export function LOG(
  source: Source,
  event: string,
  fields: LogFields = {},
): LoggingEffect<void> {
  return Effect.gen(function* () {
    const service = yield* Logging;
    const span = yield* service.trace.currentSpan();
    yield* service.log.append(event, {
      ...fields,
      ...(fields.spanId === undefined && span === undefined ? {} : { spanId: fields.spanId ?? span?.spanId }),
      module: source.module,
      file: source.file,
      ...(source.function === undefined ? {} : { function: source.function }),
    });
  });
}

/** Trace one Effect boundary, recording enter, exit, and failure as a span. */
export function TRACE<A, E, R>(
  source: Source,
  effect: Effect.Effect<A, E, R>,
  args?: unknown,
): Effect.Effect<A, E, R | Logging | FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const service = yield* Logging;
    const span = yield* service.trace.enter(source.function, args, source).pipe(
      Effect.catchAll(() => Effect.succeed(undefined)),
    );
    const traceLog = logger(source, { namespace: "trace" });
    yield* traceLog.trace("function.enter", {
      ...(span === undefined ? {} : { spanId: span.spanId }),
      ...(args === undefined ? {} : { data: { args } }),
    });
    return yield* effect.pipe(
      Effect.onExit((exit) => Exit.isSuccess(exit)
        ? Effect.gen(function* () {
          yield* traceLog.debug("function.exit", {
            ...(span === undefined ? {} : { spanId: span.spanId }),
            outcome: "success",
          });
          if (span !== undefined) yield* service.trace.exit(span, exit.value).pipe(Effect.catchAll(() => Effect.void));
        })
        : Effect.gen(function* () {
          const cancelled = isCancellation(exit.cause);
          yield* traceLog[cancelled ? "debug" : "error"]("function.error", {
            ...(span === undefined ? {} : { spanId: span.spanId }),
            outcome: cancelled ? "cancelled" : "failure",
            data: { error: failureDetails(exit.cause) },
          });
          if (span !== undefined) yield* service.trace.error(span, exit.cause).pipe(Effect.catchAll(() => Effect.void));
        })),
    );
  }) as Effect.Effect<A, E, R | Logging | FileSystem.FileSystem>;
}

/** Create a logger with source and stable context bound once at the call site. */
export function logger(
  source: Source,
  context: LoggingContext = {},
): Logger {
  const emit = (level: LogFields["level"], event: string, fields: LoggerFields = {}) =>
    LOG(source, event, { ...context, ...fields, level }).pipe(Effect.catchAll(() => Effect.void));
  return {
    trace: (event, fields) => emit("trace", event, fields),
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    fatal: (event, fields) => emit("fatal", event, fields),
    with: (next) => logger(source, { ...context, ...next }),
  };
}

export function loggingService(
  log: ILogWriter,
  trace: ITraceWriter,
): LoggingService {
  return { log, trace };
}
