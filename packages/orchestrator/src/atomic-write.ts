import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname } from "node:path";

/** One step of an atomic write, named so a caller can keep its own error
 * wording per step rather than settling for one message for all three. */
export type AtomicWriteStep = "mkdir" | "write" | "rename";

/** Write `contents` to `path` so a reader sees either the previous file or the
 * new one and never a half-written document: the bytes land in a staging file
 * that is renamed over the target. The staging file is removed whichever way
 * the write ends, so a failure leaves no residue behind. Callers own the
 * staging name and the error text, because both are part of what they already
 * promise on disk. */
export function writeFileAtomic<E>(
  path: string,
  contents: string,
  options: {
    readonly temporaryPath: string;
    readonly mapError: (cause: unknown, step: AtomicWriteStep) => E;
  },
): Effect.Effect<void, E, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(dirname(path), { recursive: true }).pipe(
      Effect.mapError((cause) => options.mapError(cause, "mkdir")),
    );
    yield* fileSystem.writeFileString(options.temporaryPath, contents).pipe(
      Effect.mapError((cause) => options.mapError(cause, "write")),
      Effect.zipRight(fileSystem.rename(options.temporaryPath, path).pipe(
        Effect.mapError((cause) => options.mapError(cause, "rename")),
      )),
      Effect.ensuring(fileSystem.remove(options.temporaryPath).pipe(Effect.ignore)),
    );
  });
}
