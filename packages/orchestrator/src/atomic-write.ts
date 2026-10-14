import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname } from "node:path";
import type { WorkflowError } from "./errors.js";

/** One step of an atomic write, named so a caller can keep its own error
 * wording per step rather than settling for one message for all three. */
export type AtomicWriteStep = "mkdir" | "write" | "rename";

/** Write `contents` to `path` so a reader sees either the previous file or the
 * new one and never a half-written document: the bytes land in a staging file
 * that is renamed over the target. The staging name is asked for on every run,
 * so re-running one effect value does not reuse it, and the staging file is
 * removed whichever way the write ends, so a failure leaves no residue. */
export function writeFileAtomic(
  path: string,
  contents: string,
  options: {
    readonly temporaryPath: () => string;
    readonly mapError: (cause: unknown, step: AtomicWriteStep) => WorkflowError;
  },
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const staging = options.temporaryPath();
    // A staging name equal to the target would rewrite the file and then let
    // the cleanup delete it, reporting success over lost bytes.
    if (staging === path) {
      return yield* Effect.fail(options.mapError(
        new Error("atomic write staging path must differ from its target"),
        "write",
      ));
    }
    yield* fileSystem.makeDirectory(dirname(path), { recursive: true }).pipe(
      Effect.mapError((cause) => options.mapError(cause, "mkdir")),
    );
    yield* fileSystem.writeFileString(staging, contents).pipe(
      Effect.mapError((cause) => options.mapError(cause, "write")),
      Effect.zipRight(fileSystem.rename(staging, path).pipe(
        Effect.mapError((cause) => options.mapError(cause, "rename")),
      )),
      Effect.ensuring(fileSystem.remove(staging).pipe(Effect.ignore)),
    );
  });
}
