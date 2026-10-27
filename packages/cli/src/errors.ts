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

/** A user-level skill or MCP configuration step that could not be completed.
 * Conflicts and missing homes are reported, not failures; this type is for a
 * missing template or an I/O error. */
export class SkillInstallError extends Data.TaggedError("SkillInstallError")<{
  readonly operation: string;
  readonly path: string;
  readonly message: string;
}> {}

/** The refusal every interactive command shares: there is no terminal to draw
 * on, so the command cannot run. */
export function interactiveTerminalRequired(): TuiError {
  return new TuiError({ operation: "terminal", message: "an interactive terminal is required" });
}

export type CliError = CliArgumentError | LogsStorageError | TuiError | SkillInstallError;
