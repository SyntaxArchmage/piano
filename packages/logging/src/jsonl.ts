import type { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { dirname } from "node:path";

/** A parsed JSON object, never an array and never `null` — the predicate form
 * callers use when control flow depends on the shape. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse JSON text into an object, or `undefined` when it is not JSON or not
 * an object (arrays and `null` included). A torn write reads as absent rather
 * than as a failure — the same tolerance every reader of untrusted evidence
 * needs. */
export function parseJsonRecord(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

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
  const record = parseJsonRecord(line);
  if (record === undefined) return undefined;
  if (typeof record.runId !== "string" || typeof record.timestamp !== "string") return undefined;
  return record as T;
}

/** Parse a whole JSONL stream into the records this build accepts, dropping
 * blank and unreadable lines. The one whole-stream read every run-stream
 * reader shares. */
export function parseRunStreamLines<T>(raw: string | undefined): readonly T[] {
  const records: T[] = [];
  for (const line of (raw ?? "").split("\n")) {
    const record = parseRunStreamLine<T>(line);
    if (record !== undefined) records.push(record);
  }
  return records;
}

