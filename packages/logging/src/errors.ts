import { Data } from "effect";

/** The cause-reading helpers are the repo's, not this package's: they are
 * re-exported here so every existing `@piano/logging` import keeps working. */
export { errorMessage, failureDetails, isCancellation, type FailureDetails } from "@piano/base";

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
