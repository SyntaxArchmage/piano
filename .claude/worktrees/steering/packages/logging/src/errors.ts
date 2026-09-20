import { Data } from "effect";

export class SessionCreateError extends Data.TaggedError("SessionCreateError")<{
  readonly operation: string;
  readonly path: string;
  readonly message: string;
}> {}

export class LogWriteError extends Data.TaggedError("LogWriteError")<{
  readonly operation: string;
  readonly path: string;
  readonly message: string;
}> {}

export class TraceWriteError extends Data.TaggedError("TraceWriteError")<{
  readonly operation: string;
  readonly path: string;
  readonly message: string;
}> {}

export class TrajectoryWriteError extends Data.TaggedError("TrajectoryWriteError")<{
  readonly operation: string;
  readonly path: string;
  readonly message: string;
}> {}

export type LoggingError = SessionCreateError | LogWriteError | TraceWriteError | TrajectoryWriteError;

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface FailureDetails {
  readonly type: string;
  readonly message: string;
  readonly stacktrace?: string;
  readonly kind?: string;
  readonly cause?: FailureDetails;
}

/** Convert Effect causes and native errors into a bounded, structured record. */
export function failureDetails(cause: unknown, depth = 0): FailureDetails {
  try {
    if (depth > 3) return { type: "UnknownError", message: "cause chain truncated" };
    if (isRecord(cause) && (cause._tag === "Fail" || cause._tag === "Die")) {
      const nested = cause.error ?? cause.defect;
      if (nested !== undefined) return failureDetails(nested, depth + 1);
    }
    if (cause instanceof Error) {
      return {
        type: cause.name || cause.constructor.name,
        message: cause.message,
        ...(cause.stack === undefined ? {} : { stacktrace: cause.stack }),
        ...(typeof (cause as Error & { kind?: unknown }).kind === "string" ? { kind: (cause as Error & { kind: string }).kind } : {}),
        ...(cause.cause === undefined ? {} : { cause: failureDetails(cause.cause, depth + 1) }),
      };
    }
    if (isRecord(cause)) {
      const type = typeof cause._tag === "string" ? cause._tag : "ObjectError";
      const message = typeof cause.message === "string" ? cause.message : safeJson(cause, type);
      return {
        type,
        message,
        ...(typeof cause.stack === "string" ? { stacktrace: cause.stack } : {}),
        ...(typeof cause.kind === "string" ? { kind: cause.kind } : {}),
        ...(cause.cause === undefined ? {} : { cause: failureDetails(cause.cause, depth + 1) }),
      };
    }
    return { type: typeof cause, message: String(cause) };
  } catch {
    return { type: "UnknownError", message: "error details unavailable" };
  }
}

/** Identify user cancellation through nested Effect and domain errors. */
export function isCancellation(cause: unknown, depth = 0): boolean {
  try {
    if (depth > 4 || cause === undefined || cause === null) return false;
    if (!isRecord(cause)) return false;
    if (cause._tag === "Interrupt") return true;
    if (cause._tag === "Fail" || cause._tag === "Die") {
      return isCancellation(cause.error ?? cause.defect, depth + 1);
    }
    if (cause.kind === "cancelled") return true;
    return isCancellation(cause.cause, depth + 1)
      || isCancellation(cause.left, depth + 1)
      || isCancellation(cause.right, depth + 1);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeJson(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value) ?? fallback;
  } catch {
    return fallback;
  }
}
