import { Data } from "effect";

export class CliArgumentError extends Data.TaggedError("CliArgumentError")<{
  readonly message: string;
}> {}

export class LogsStorageError extends Data.TaggedError("LogsStorageError")<{
  readonly operation: string;
  readonly path: string;
  readonly message: string;
}> {}

export class TuiError extends Data.TaggedError("TuiError")<{
  readonly operation: string;
  readonly message: string;
}> {}

/** The refusal every interactive command shares: there is no terminal to draw
 * on, so the command cannot run. */
export function interactiveTerminalRequired(): TuiError {
  return new TuiError({ operation: "terminal", message: "an interactive terminal is required" });
}

export type CliError = CliArgumentError | LogsStorageError | TuiError;
