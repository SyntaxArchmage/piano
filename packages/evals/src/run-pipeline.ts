/**
 * The live `piano evals` run pipeline: select cases, expand trials, execute
 * them (optionally in parallel), and persist every finished case as it lands
 * so an interrupted run leaves a valid partial report behind.
 *
 * This is the domain orchestration the `piano evals` CLI delegates to; the CLI
 * keeps argument parsing and printing. The roots and the case-execution seam
 * are injectable so the persistence path is testable without a harness.
 */

import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { errorMessage, writeFileAtomic } from "@piano/base";
import { DEFAULT_EVALS_ROOT, loadCases } from "./case-loader.js";
import { DriverError } from "./errors.js";
import { usableBenchmarkValue } from "./evidence.js";
import { readBaseline, recordBaseline } from "./baseline.js";
import { runCase } from "./run-case.js";
import { formatCompactTokens } from "./report.js";
import { buildReport } from "./scorer.js";
import {
  DEFAULT_EVALS_OUTPUT_ROOT,
  defaultRunSetId,
  readPersistedRunSets,
  runSetReportPath,
} from "./runset.js";
import type { CaseResult, EvalCase, EvalReport, EvalRunOptions } from "./types.js";

/** Case-execution seam: the real `runCase` by default. */
export type RunCaseFn = (
  root: string,
  kase: EvalCase,
  opts: EvalRunOptions,
) => Effect.Effect<CaseResult, DriverError, FileSystem.FileSystem>;

export interface RunPipelineOptions {
  /** Only run cases in this group (or matching this grader-tag keyword). */
  readonly group?: string;
  /** Only run this one case. */
  readonly caseId?: string;
  readonly dryRun: boolean;
  readonly trials: number;
  readonly parallel?: number;
  readonly skipExisting: boolean;
  readonly timeoutMs?: number;
  readonly variant?: string;
  readonly recordBaseline: boolean;
  readonly replayBaseline: boolean;
}

export interface RunPipelineDeps {
  /** Case material root (the `--root` flag); defaults to the checked-in
   * `evals/` tree. Read-only. */
  readonly root?: string;
  /** Where output lands: `<runSetId>/report.json`, per-case pinned baselines,
   * and the copied workspaces. Injectable so tests can point it at a fixture
   * directory. Defaults to the user-level evals home. */
  readonly outputRoot?: string;
  /** Case-execution seam (defaults to the real `runCase`); injectable so the
   * per-case persistence path is testable without running a harness. */
  readonly runCase?: RunCaseFn;
  /** Live progress sink: one short line per notable event. The CLI wires this
   * to stderr so stdout stays the pure report. */
  readonly onProgress?: (line: string) => void;
}

/** What the pipeline produced. Empty selections are outcomes, not errors: the
 * caller prints a message and returns. */
export type RunPipelineResult =
  | { readonly kind: "no-cases" }
  | { readonly kind: "no-pending" }
  | { readonly kind: "report"; readonly report: EvalReport };

function expandEvalRunCells(cases: readonly EvalCase[], trials: number): { kase: EvalCase; trial: number }[] {
  return cases.flatMap((kase) =>
    Array.from({ length: trials }, (_, index) => ({ kase, trial: index + 1 })));
}

/** The history layer fails with its own error type; the pipeline speaks one. */
function asDriverError(cause: unknown): DriverError {
  return new DriverError({ message: errorMessage(cause), cause });
}

/** Cases with at least one persisted real result. A `skipped` row does not
 * count: it is a dry run rather than an execution attempt. Malformed reports
 * are already skipped by `readPersistedRunSets`. */
function existingCaseIds(
  outputRoot: string,
): Effect.Effect<ReadonlySet<string>, never, FileSystem.FileSystem> {
  return readPersistedRunSets(outputRoot).pipe(Effect.map((reports) => {
    const existing = new Set<string>();
    for (const report of reports) {
      for (const kase of report.cases) {
        if (kase.status !== "skipped") existing.add(kase.caseId);
      }
    }
    return existing;
  }));
}

/** The one line the run prints when a case lands. */
function doneLine(result: CaseResult): string {
  const tokens = result.trace?.tokens.total ?? 0;
  return `  ${result.caseId}#${result.trial} done status=${result.status}`
    + `${result.artifact.value === undefined ? "" : ` final=${result.artifact.value.toFixed(4)}`}`
    + ` tokens=${formatCompactTokens(tokens)} time=${Math.round((result.durationMs ?? 0) / 60_000)}m`;
}

/** Run the full evals pipeline and return the assembled report. */
export function runEvalPipeline(
  options: RunPipelineOptions,
  deps: RunPipelineDeps = {},
): Effect.Effect<RunPipelineResult, DriverError, FileSystem.FileSystem> {
  const root = deps.root ?? DEFAULT_EVALS_ROOT;
  const outputRoot = deps.outputRoot ?? DEFAULT_EVALS_OUTPUT_ROOT;
  const runOne = deps.runCase ?? runCase;
  return Effect.gen(function* () {
    const selectedCases = yield* loadCases(root, { group: options.group, caseId: options.caseId });
    if (selectedCases.length === 0) return { kind: "no-cases" };
    const existing = options.skipExisting ? yield* existingCaseIds(outputRoot) : undefined;
    const cases = existing === undefined
      ? selectedCases
      : selectedCases.filter((kase) => !existing.has(kase.id));
    if (cases.length === 0) return { kind: "no-pending" };

    const runSetId = defaultRunSetId();
    const reportPath = runSetReportPath(outputRoot, runSetId);
    const persistenceSemaphore = Effect.unsafeMakeSemaphore(1);
    // A kill between cases must not lose finished ones: every completed case
    // is persisted into the run set's report.json as it lands, so an
    // interrupted run leaves a valid partial report behind and the offline
    // `--report` board sees its cases.
    const completed: CaseResult[] = [];
    // Dry runs validate configs without producing measurements; persisting
    // them would leave a zero-score report.json that outranks real results in
    // offline analysis (`--report`).
    const persistCase = (result: CaseResult): Effect.Effect<void, DriverError, FileSystem.FileSystem> =>
      Effect.gen(function* () {
        deps.onProgress?.(doneLine(result));
        completed.push(result);
        const report = buildReport(runSetId, new Date().toISOString(), completed);
        // Atomic replace: a kill mid-write cannot leave a truncated
        // report.json that outranks older complete ones.
        yield* writeFileAtomic<DriverError>(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
          mapError: (cause, step) =>
            new DriverError({ message: `cannot persist eval report (${step}): ${errorMessage(cause)}`, cause }),
        });
        if (options.recordBaseline && usableBenchmarkValue(result.baseline) !== undefined) {
          yield* recordBaseline(outputRoot, result, runSetId).pipe(Effect.mapError(asDriverError));
        }
      });

    const results = yield* Effect.forEach(expandEvalRunCells(cases, options.trials), ({ kase, trial }) =>
      Effect.gen(function* () {
        const pinned = options.replayBaseline && !options.dryRun
          ? yield* readBaseline(outputRoot, kase.id).pipe(Effect.mapError(asDriverError))
          : undefined;
        if (options.replayBaseline && !options.dryRun && pinned === undefined) {
          return yield* Effect.fail(new DriverError({ message: `no pinned baseline for case "${kase.id}"` }));
        }
        return yield* runOne(root, kase, {
          dryRun: options.dryRun,
          runSetId,
          trial,
          ...(pinned === undefined ? {} : { baseline: pinned }),
          ...(options.variant === undefined ? {} : { variant: options.variant }),
          workspaceRoot: outputRoot,
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          // Live progress goes to the caller's sink (stderr in the CLI).
          ...(deps.onProgress === undefined ? {} : { onProgress: deps.onProgress }),
        });
      }).pipe(Effect.tap((result) => options.dryRun
        ? Effect.void
        : persistenceSemaphore.withPermits(1)(persistCase(result)))),
      { concurrency: options.parallel ?? 1 },
    );

    return { kind: "report", report: buildReport(runSetId, new Date().toISOString(), results) };
  });
}