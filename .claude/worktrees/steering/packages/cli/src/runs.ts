// Shared run listing for Piano CLI commands (`resume --list`, `clear-all`).
// Lists run directories under the runs root (`~/.piano/runs`).
//
// A run is a directory whose name is the run id (timestamp + random suffix),
// consumed by `createSession` and `defaultRunsRoot`.
//
// Interactive selection lives with its callers: `logs` has its own picker, and
// resume uses the in-TUI `SessionPicker`, which shows run metadata a flat
// SelectList cannot.

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { join } from "node:path";
import { LogsStorageError } from "./errors.js";

/** Enumerate run ids (directory names) under `runsRoot`, newest first. */
export function listRunIds(runsRoot: string): Effect.Effect<string[], LogsStorageError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const entries = yield* fileSystem.readDirectory(runsRoot).pipe(
      Effect.catchAll((cause) => cause._tag === "SystemError" && cause.reason === "NotFound"
        ? Effect.succeed([])
        : Effect.fail(new LogsStorageError({
          operation: "list-runs",
          path: runsRoot,
          message: cause.message,
        }))),
    );
    const directories = yield* Effect.forEach(entries, (entry) =>
      fileSystem.stat(join(runsRoot, entry)).pipe(
        Effect.map((info) => info.type === "Directory" ? entry : undefined),
        Effect.catchAll(() => Effect.succeed(undefined)),
      ),
    );
    return directories.filter((entry): entry is string => entry !== undefined).sort().reverse();
  });
}
