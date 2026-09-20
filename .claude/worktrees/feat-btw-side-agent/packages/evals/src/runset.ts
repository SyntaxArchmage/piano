// Offline access to persisted eval run sets.
//
// Every full `piano evals` run writes `<root>/<runSetId>/report.json` (the same
// EvalReport the run prints). This module reads those back so the report can be
// re-rendered or compared between run sets without running anything — the
// analysis phase is one pure renderer (`formatReport`) over a persisted value.

import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { join } from "node:path";
import type { EvalReport } from "./types.js";

/** The shape `defaultRunSetId()` in the CLI produces: `eval-` + UTC-ish local
 * timestamp. Filtering by shape keeps hand-made workspace dirs (and legacy
 * `eval-single-*` scratch dirs) out of the list. */
const RUN_SET_ID_RE = /^eval-\d{8}T\d{6}\.\d{3}$/;

/** Run set ids newest first. Run set ids embed their creation timestamp, so
 * lexicographic order is chronological order. Missing or unreadable roots
 * yield an empty list: "no persisted runs" is not an error worth surfacing. */
export function listRunSetIds(root: string): Effect.Effect<string[], never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const entries = yield* fileSystem.readDirectory(root).pipe(
      Effect.catchAll(() => Effect.succeed<string[]>([])),
    );
    const candidates = entries.filter((entry) => RUN_SET_ID_RE.test(entry));
    const present = yield* Effect.forEach(candidates, (id) =>
      fileSystem.exists(join(root, id, "report.json")).pipe(
        Effect.map((exists) => (exists ? id : undefined)),
        Effect.catchAll(() => Effect.succeed(undefined)),
      ),
    );
    return present.filter((id): id is string => id !== undefined).sort().reverse();
  });
}

/** Read one run set's persisted report. Fails with a plain Error when the
 * report is absent or unparseable — callers turn that into their own error
 * type, mirroring how the history module throws on invalid rows. */
export function readRunSetReport(
  root: string,
  runSetId: string,
): Effect.Effect<EvalReport, Error, FileSystem.FileSystem> {
  const path = join(root, runSetId, "report.json");
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem.readFileString(path).pipe(
      Effect.mapError((cause) => new Error(`no persisted report for run set "${runSetId}": ${cause.message}`)),
    );
    return yield* Effect.try({
      try: () => {
        const value: unknown = JSON.parse(raw);
        if (typeof value !== "object" || value === null || !Array.isArray((value as { cases?: unknown }).cases)) {
          throw new Error(`malformed report.json for run set "${runSetId}"`);
        }
        return value as EvalReport;
      },
      catch: (cause) => new Error(`cannot parse ${path}: ${String(cause)}`),
    });
  });
}
