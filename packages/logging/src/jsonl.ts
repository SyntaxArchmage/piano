import type { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname } from "node:path";

/** Append one already-serialized line to a JSONL stream: ensure the parent
 * directory exists, then append. This is the single writer mechanism every run
 * stream shares — log, trace, trajectory and the progress ledger all land their
 * bytes through it, so "how a line reaches the file" has one definition.
 *
 * Callers own everything the mechanism does not: the line's format (they
 * serialize before calling) and the error type (they supply `mapError`, which
 * names the failing step). Taking `fileSystem` as a parameter keeps each
 * caller's existing requirement type — some already hold it, some yield it. */
export function appendJsonlLine<E>(
  fileSystem: FileSystem.FileSystem,
  path: string,
  line: string,
  mapError: (step: "mkdir" | "append", cause: unknown) => E,
): Effect.Effect<void, E, never> {
  return Effect.gen(function* () {
    yield* fileSystem.makeDirectory(dirname(path), { recursive: true }).pipe(
      Effect.mapError((cause) => mapError("mkdir", cause)),
    );
    yield* fileSystem.writeFileString(path, line, { flag: "a" }).pipe(
      Effect.mapError((cause) => mapError("append", cause)),
    );
  });
}

