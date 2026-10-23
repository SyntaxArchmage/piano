import { Data } from "effect";

/** The evals package's failure channel: config loading, workspace preparation,
 * launch, evidence collection, and persistence all name their failures here. */
export class DriverError extends Data.TaggedError("DriverError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
