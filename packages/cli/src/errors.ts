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

export class ConfigFileError extends Data.TaggedError("ConfigFileError")<{
  readonly operation: "read" | "write" | "edit";
  readonly path: string;
  readonly message: string;
}> {}

export class SetupFileError extends Data.TaggedError("SetupFileError")<{
  readonly operation: "read" | "write";
  readonly path: string;
  readonly message: string;
}> {}

export type CliError = CliArgumentError | LogsStorageError | TuiError | ConfigFileError | SetupFileError;
