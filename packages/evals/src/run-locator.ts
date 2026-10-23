/**
 * Run-directory association: decide which newly created Piano run directory
 * belongs to a launched case. Evidence-only — a malformed evidence line never
 * establishes ownership, so association fails closed rather than attaching
 * another run's transcript.
 */
import { Effect } from "effect";
import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { logStreamPathCandidates, parseJsonRecord, traceStreamPathCandidates } from "@piano/logging";
import { DriverError } from "./errors.js";

function containsValue(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((item) => containsValue(item, expected));
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some((item) => containsValue(item, expected));
}

function referencesWorkspace(raw: string, workspaceDir: string): boolean {
  for (const line of raw.split("\n")) {
    // A malformed evidence line cannot establish ownership.
    const record = parseJsonRecord(line);
    if (record !== undefined && containsValue(record, workspaceDir)) return true;
  }
  return false;
}

/** The evidence streams that carry a run's workspace reference: the logging
 * seam's current `system-log/` spellings first, then the legacy root files
 * (including the retired progress ledger old runs still carry). */
function runEvidencePaths(runDir: string): readonly string[] {
  return [
    ...logStreamPathCandidates(runDir),
    ...traceStreamPathCandidates(runDir),
    join(runDir, "progress.jsonl"),
  ];
}

interface RunWorkspaceEvidence {
  readonly observed: boolean;
  readonly matches: boolean;
}

/** Shared association probe: does this run directory reference `workspaceDir`
 * in any evidence stream it has emitted so far? `observed` distinguishes "no
 * reference yet" from "emitted evidence that names another workspace". */
function inspectRunWorkspace(runsRoot: string, id: string, workspaceDir: string): RunWorkspaceEvidence {
  let observed = false;
  for (const path of runEvidencePaths(join(runsRoot, id))) {
    try {
      const content = readFileSync(path, "utf8");
      observed = true;
      if (referencesWorkspace(content, workspaceDir)) return { observed, matches: true };
    } catch {
      // A partial run may not have emitted every evidence stream yet.
    }
  }
  return { observed, matches: false };
}

/** Choose which newly created run directory a live-progress poller may bind
 * to. A single candidate passes through — a later completion-time
 * `findNewRunDir` still verifies or fails closed before any evidence is
 * attributed. With concurrent launches, bind only on a unique workspace
 * match; otherwise return undefined so the caller skips the tick rather than
 * showing another run's progress under this case's label. */
export function matchNewRunDir(
  runsRoot: string,
  createdIds: readonly string[],
  workspaceDir: string,
): string | undefined {
  if (createdIds.length === 1) return createdIds[0];
  if (createdIds.length === 0) return undefined;
  const matches = createdIds.filter((id) => inspectRunWorkspace(runsRoot, id, workspaceDir).matches);
  return matches.length === 1 ? matches[0] : undefined;
}

export interface RunDirectoryAssociation {
  readonly path?: string;
  readonly reason?: string;
  readonly candidates: readonly string[];
}

export function findNewRunDir(
  runsRoot: string,
  before: ReadonlySet<string>,
  workspaceDir: string,
  startedAt: number,
): Effect.Effect<RunDirectoryAssociation, DriverError> {
  return Effect.tryPromise({
    try: async () => {
      let after: string[];
      try {
        after = await readdir(runsRoot);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            candidates: [],
            reason: `no Piano run directory was created for workspace ${workspaceDir}`,
          };
        }
        throw cause;
      }
      const created = after
        .filter((id) => !before.has(id))
        .filter((id) => {
          try {
            return statSync(join(runsRoot, id)).mtimeMs >= startedAt - 1_000;
          } catch {
            return false;
          }
        })
        .sort();
      if (created.length === 0) {
        return {
          candidates: [],
          reason: `no new Piano run directory was created for workspace ${workspaceDir}`,
        };
      }

      // Concurrent evals can create several run directories during the same
      // launch window. Associate by the durable workspace path emitted in the
      // run log; when no unique match exists, fail closed rather than attaching
      // another run's transcript to this case.
      const inspected = created.map((id) => ({ id, ...inspectRunWorkspace(runsRoot, id, workspaceDir) }));
      const matches = inspected.filter((candidate) => candidate.matches).map((candidate) => candidate.id);
      if (created.length === 1) {
        const candidate = inspected[0];
        if (candidate?.observed === true && candidate.matches === false) {
          return {
            candidates: created,
            reason: `new Piano run does not reference workspace ${workspaceDir}; candidates: ${created.join(", ")}`,
          };
        }
        return { path: join(runsRoot, created[0]!), candidates: created };
      }
      if (matches.length === 1) {
        return { path: join(runsRoot, matches[0]!), candidates: created };
      }
      return {
        candidates: created,
        reason: matches.length === 0
          ? `could not associate Piano run with workspace ${workspaceDir}; candidates: ${created.join(", ")}`
          : `multiple Piano runs match workspace ${workspaceDir}; candidates: ${matches.join(", ")}`,
      };
    },
    catch: (cause) => new DriverError({ message: `list Piano runs: ${String(cause)}`, cause }),
  });
}
