// Offline access to persisted eval run sets.
//
// Every full `piano evals` run writes `<root>/<runSetId>/report.json` (the same
// EvalReport the run prints). This module persists and reads those back, mints
// run-set ids, and assembles the offline `--report` board, all without running
// anything.

import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { homedir } from "node:os";
import { join } from "node:path";
import { matchesSelectionKeyword } from "./case-loader.js";
import { formatDeltaTables, formatReport, type DeltaRecord } from "./report.js";
import { buildReport } from "./scorer.js";
import type { CaseResult, EvalReport } from "./types.js";

/** The canonical run-set id shape this module's `defaultRunSetId()` produces:
 * `eval-` + UTC-ish local timestamp. Filtering by shape keeps hand-made
 * workspace dirs (and legacy `eval-single-*` scratch dirs) out of the list. */
const RUN_SET_ID_RE = /^eval-\d{8}T\d{6}\.\d{3}$/;

/** Where `piano evals` writes its output: one run set per report, one pinned
 * baseline per case, and each case's copied workspace. Distinct from
 * `DEFAULT_EVALS_ROOT`, the checked-in case material this output comes from. */
export const DEFAULT_EVALS_OUTPUT_ROOT = join(homedir(), ".piano", "evals");

/** Where one run set's report is persisted. Single spelling for every reader
 * and writer of `report.json`. */
export function runSetReportPath(root: string, runSetId: string): string {
  return join(root, runSetId, "report.json");
}

/** Mint a new run-set id: `eval-` plus a sortable local timestamp. The single
 * source for both id creation and shape matching. */
export function defaultRunSetId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const millis = String(now.getMilliseconds()).padStart(3, "0");
  return `eval-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.${millis}`;
}

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
      fileSystem.exists(runSetReportPath(root, id)).pipe(
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
  const path = runSetReportPath(root, runSetId);
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

/** Every readable persisted report, newest first. A run set whose report is
 * absent or malformed is skipped: "one unreadable run" is not a reason to
 * refuse the board the others can render. */
export function readPersistedRunSets(
  root: string,
): Effect.Effect<readonly EvalReport[], never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const ids = yield* listRunSetIds(root);
    const reports = yield* Effect.forEach(ids, (id) =>
      readRunSetReport(root, id).pipe(Effect.catchAll(() => Effect.succeed(undefined))));
    return reports.filter((report): report is EvalReport => report !== undefined);
  });
}

export interface RunSetReportOptions {
  readonly group?: string;
  readonly caseId?: string;
  readonly runSet?: string;
  readonly details: boolean;
  readonly delta: boolean;
}

/**
 * `--report` assembly: the text of a persisted run set's board, without
 * running anything. With no selection it renders the stored report verbatim;
 * with `--group`/`--case` it gathers every persisted case matching the
 * keyword — a group family name (`tuning` covers `tuning-cuda` too) or a
 * grader tag — taking each case's newest occurrence as the row, so
 * `--group tflops` shows all tagged cases even when they live in different
 * groups and were run in different sessions. Each case keeps its own group: a
 * keyword selects cases, it does not re-label them, and a case's group is what
 * decides how that case is displayed. A selection whose keyword is a family
 * name therefore renders each group in that family with its own family's
 * columns. `delta` appends the Δ board next to that matrix: every metric the
 * case's own matrix reports, as a `Δvalue`/`Δ%` cell pair between the case's
 * two latest runs. Cases never compare against each other.
 */
export function reportRunSet(
  opts: RunSetReportOptions,
  outputRoot = DEFAULT_EVALS_OUTPUT_ROOT,
): Effect.Effect<string, Error, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const selection = [
      opts.group === undefined ? undefined : `--group ${opts.group}`,
      opts.caseId === undefined ? undefined : `--case ${opts.caseId}`,
    ].filter((part): part is string => part !== undefined).join(" ");
    if (selection === "") {
      // No selection: render the newest (or explicit) stored report verbatim.
      // `delta` cannot reach here — it requires a selection.
      const currentId = opts.runSet ?? (yield* listRunSetIds(outputRoot))[0];
      if (currentId === undefined) {
        return yield* Effect.fail(new Error(`no persisted eval reports under ${outputRoot}`));
      }
      const current = yield* readRunSetReport(outputRoot, currentId);
      return formatReport(current, { details: opts.details }) + "\n";
    }
    // Selection: assemble a board of every persisted case matching the
    // keyword, each row taken from its newest occurrence (or pinned to
    // `--runset`). `skipped` stub rows are dry-run leftovers and never count.
    const matches = (kase: CaseResult) => kase.status !== "skipped"
      && (opts.group === undefined || matchesSelectionKeyword(kase.group, kase.tags, opts.group))
      && (opts.caseId === undefined || kase.caseId === opts.caseId);
    type Occurrence = { readonly id: string; readonly at: string; readonly kase: CaseResult };
    const reports = yield* readPersistedRunSets(outputRoot);
    const occurrences = new Map<string, Occurrence[]>();
    for (const report of reports) {
      for (const kase of report.cases) {
        if (!matches(kase)) continue;
        const key = `${kase.caseId}#${kase.trial}`;
        const list = occurrences.get(key);
        const occurrence = { id: report.runSetId, at: report.createdAt, kase };
        if (list === undefined) occurrences.set(key, [occurrence]);
        else list.push(occurrence);
      }
    }
    // Each case compares against itself and nothing else: its newest record
    // and the one before it (occurrences are newest first). Δ always diffs the
    // two latest runs — the caller refuses to pin a run set alongside it — and
    // a case with a single record has no reference, so every Δ cell reads as
    // missing.
    const chosen = [...occurrences.values()].flatMap((list) => {
      const index = opts.runSet === undefined
        ? 0
        : list.findIndex((occurrence) => occurrence.id === opts.runSet);
      if (index < 0) return [];
      return [{ current: list[index]!, prior: list[index + 1] }];
    });
    if (chosen.length === 0) {
      return yield* Effect.fail(new Error(opts.runSet !== undefined
        ? `run set "${opts.runSet}" contains no case for ${selection}`
        : `no persisted run set contains ${selection}`));
    }
    const currentEntries = chosen.map((row) => row.current);
    const used = [...new Set(currentEntries.map((o) => o.id))].sort();
    const currentReport = buildReport(
      used.length === 1 ? used[0]! : `gathered ${used[0]}..${used[used.length - 1]}`,
      currentEntries.reduce((newest, o) => (o.at > newest ? o.at : newest), ""),
      currentEntries.map((o) => o.kase),
    );
    const text = formatReport(currentReport, { minMatrixCases: 1, details: opts.details }) + "\n";
    if (!opts.delta) return text;
    // Each row diffs against its own preceding run — the case's second-latest
    // record — so a case run twice in different sessions still compares
    // against itself. The records keep their own group, so the Δ board is
    // grouped and columned exactly like the matrix printed above it.
    const records: DeltaRecord[] = chosen.map((row) => ({
      current: row.current.kase,
      currentRunSet: row.current.id,
      ...(row.prior === undefined
        ? {}
        : { previous: row.prior.kase, previousRunSet: row.prior.id }),
    }));
    return text + formatDeltaTables(records) + "\n";
  });
}
