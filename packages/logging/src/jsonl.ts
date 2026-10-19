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

/** One parsed JSONL line carrying the run-stream identity (`runId` and
 * `timestamp` strings), or `undefined` for a blank, torn, or shapeless line.
 * The single acceptance rule every run-stream reader shares — the trajectory
 * stream and the progress ledger ask exactly this of a line — so no two
 * readers can disagree about what counts as a record. */
export function parseRunStreamLine<T>(line: string): T | undefined {
  if (line.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // Torn mid-append: it describes a write that never finished, and the
    // records before it are still good.
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const record = parsed as { runId?: unknown; timestamp?: unknown };
  if (typeof record.runId !== "string" || typeof record.timestamp !== "string") return undefined;
  return parsed as T;
}

