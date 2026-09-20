/**
 * `piano evals` command — drives the Piano evals system.
 *
 * Usage:
 *   piano evals [--group <group>] [--case <id>] [--trials <n>] [--timeout <seconds>]
 *     [--variant <name>] [--record-baseline|--replay-baseline] [--dry-run]
 *   piano evals --report [--group <group> | --case <id>] [--runset <id>] [--compare]
 *
 * Loads all cases under the evals package's `workloads/` dir (optionally a
 * single group or tag keyword with `--group`, or a single case with `--case`).
 * `--group` matches the case's group field or any of its grader tags, so a
 * keyword like `tflops` assembles every case carrying that tag. Runs each
 * (copying its workspace template, executing the launch command), and prints a
 * text eval report.
 *
 * `--report` runs nothing: it re-renders the persisted report of the latest
 * run set (or `--runset <id>`), and with `--compare` appends a per-case
 * dimension-by-dimension delta table against the previous run set for
 * regression spotting. With `--group`/`--case` it instead assembles a board
 * of every persisted case matching the keyword (group name or grader tag),
 * each taken from its newest run set, rendered as one matrix; `--compare`
 * then pairs every case against its own previous stored occurrence. The
 * default output is the matrix plus the score summary; `--details` adds the
 * per-case process print (status, cost, stage and progress lines).
 */

import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { stderr, stdout } from "node:process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildReport,
  DEFAULT_EVALS_ROOT,
  DEFAULT_EVAL_HISTORY_ROOT,
  DEFAULT_WORKSPACE_ROOT,
  appendEvalHistory,
  formatReport,
  formatRunSetComparison,
  listRunSetIds,
  readBaseline,
  readRunSetReport,
  recordBaseline,
  runHistoryEntry,
  loadCases,
  runCase,
  type CaseResult,
} from "@piano/evals";
import { CliArgumentError } from "./errors.js";

const usage = "usage: piano evals [--group <group>] [--case <id>] [--trials <n>] [--timeout <seconds>] [--variant <name>] [--record-baseline|--replay-baseline] [--dry-run] | --report [--group <group> | --case <id>] [--runset <id>] [--compare] [--details]";

interface EvalsArgs {
  readonly group?: string;
  readonly caseId?: string;
  readonly dryRun: boolean;
  readonly trials: number;
  readonly root?: string;
  readonly timeoutMs?: number;
  readonly variant?: string;
  readonly recordBaseline: boolean;
  readonly replayBaseline: boolean;
  readonly report: boolean;
  readonly details: boolean;
  readonly compare: boolean;
  readonly runSet?: string;
}

export function parseEvalsArgs(args: readonly string[]): Effect.Effect<EvalsArgs, CliArgumentError> {
  let group: string | undefined;
  let caseId: string | undefined;
  let dryRun = false;
  let trials = 1;
  let root: string | undefined;
  let timeoutMs: number | undefined;
  let variant: string | undefined;
  let recordBaseline = false;
  let replayBaseline = false;
  let report = false;
  let details = false;
  let compare = false;
  let runSet: string | undefined;
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === "--group") {
      const value = args[index + 1];
      if (value === undefined || value === "") {
        return Effect.fail(new CliArgumentError({ message: "--group requires a value" }));
      }
      group = value;
      index += 2;
    } else if (arg === "--case") {
      const value = args[index + 1];
      if (value === undefined || value === "") {
        return Effect.fail(new CliArgumentError({ message: "--case requires a value" }));
      }
      caseId = value;
      index += 2;
    } else if (arg === "--dry-run") {
      dryRun = true;
      index += 1;
    } else if (arg === "--trials") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 10) {
        return Effect.fail(new CliArgumentError({ message: "--trials must be an integer from 1 to 10" }));
      }
      trials = value;
      index += 2;
    } else if (arg === "--root") {
      const value = args[index + 1];
      if (value === undefined || value === "") {
        return Effect.fail(new CliArgumentError({ message: "--root requires a value" }));
      }
      root = value;
      index += 2;
    } else if (arg === "--timeout") {
      const raw = args[index + 1];
      const seconds = raw === undefined || raw === "" ? Number.NaN : Number(raw);
      if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isSafeInteger(seconds * 1000)) {
        return Effect.fail(new CliArgumentError({ message: "--timeout must be a positive number of seconds" }));
      }
      timeoutMs = seconds * 1000;
      index += 2;
    } else if (arg === "--variant") {
      const value = args[index + 1];
      if (value === undefined || value.trim() === "") {
        return Effect.fail(new CliArgumentError({ message: "--variant requires a value" }));
      }
      variant = value.trim();
      index += 2;
    } else if (arg === "--record-baseline") {
      recordBaseline = true;
      index += 1;
    } else if (arg === "--replay-baseline") {
      replayBaseline = true;
      index += 1;
    } else if (arg === "--report") {
      report = true;
      index += 1;
    } else if (arg === "--details") {
      details = true;
      index += 1;
    } else if (arg === "--compare") {
      compare = true;
      index += 1;
    } else if (arg === "--runset") {
      const value = args[index + 1];
      if (value === undefined || value === "" || value.startsWith("-")) {
        return Effect.fail(new CliArgumentError({ message: `--runset requires a value\n${usage}` }));
      }
      if (runSet !== undefined) {
        return Effect.fail(new CliArgumentError({ message: `--runset may be specified only once\n${usage}` }));
      }
      runSet = value;
      index += 2;
    } else {
      return Effect.fail(new CliArgumentError({ message: `unknown argument "${arg}". ${usage}` }));
    }
  }
  if (recordBaseline && replayBaseline) {
    return Effect.fail(new CliArgumentError({ message: "--record-baseline and --replay-baseline are mutually exclusive" }));
  }
  if (report) {
    // --group/--case scope the offline analysis to a selection within
    // persisted run sets; the remaining flags only make sense for a live run.
    if (dryRun || trials !== 1 || root !== undefined
      || timeoutMs !== undefined || variant !== undefined || recordBaseline || replayBaseline) {
      return Effect.fail(new CliArgumentError({ message: `--report analyzes persisted run sets; it cannot be combined with run options\n${usage}` }));
    }
  } else {
    if (details) {
      return Effect.fail(new CliArgumentError({ message: "--details requires --report" }));
    }
    if (compare) {
      return Effect.fail(new CliArgumentError({ message: "--compare requires --report" }));
    }
    if (runSet !== undefined) {
      return Effect.fail(new CliArgumentError({ message: "--runset requires --report" }));
    }
  }
  return Effect.succeed({
    ...(group === undefined ? {} : { group }),
    ...(caseId === undefined ? {} : { caseId }),
    dryRun,
    trials,
    ...(root === undefined ? {} : { root }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(variant === undefined ? {} : { variant }),
    recordBaseline,
    replayBaseline,
    report,
    details,
    compare,
    ...(runSet === undefined ? {} : { runSet }),
  });
}

interface EvalsCommandDeps {
  /** Root holding `<runSetId>/report.json`; injectable so the report path can
   * be pointed at fixtures. Defaults to the user-level evals root. */
  readonly historyRoot?: string;
  /** Case-execution seam (defaults to the real driver's `runCase`); injectable
   * so the per-case persistence path is testable without running a harness. */
  readonly runCase?: (
    root: string,
    kase: Parameters<typeof runCase>[1],
    opts: Parameters<typeof runCase>[2],
  ) => Effect.Effect<CaseResult, unknown, FileSystem.FileSystem>;
}

/** Run the full evals pipeline and print a text report. */
export function evalsCommand(
  args: readonly string[],
  deps: EvalsCommandDeps = {},
): Effect.Effect<void, CliArgumentError, FileSystem.FileSystem> {
  return parseEvalsArgs(args).pipe(
    Effect.flatMap((opts) => Effect.gen(function* () {
      if (opts.report) {
        yield* reportRunSet(opts, deps.historyRoot ?? DEFAULT_EVAL_HISTORY_ROOT);
        return;
      }
      const root = opts.root ?? DEFAULT_EVALS_ROOT;
      const cases = yield* loadCases(root, { group: opts.group, caseId: opts.caseId }).pipe(
        Effect.mapError((cause) => new CliArgumentError({ message: cause.message })),
      );
      if (cases.length === 0) {
        yield* Effect.sync(() => stdout.write("no evals cases found.\n"));
        return;
      }

      const runSetId = defaultRunSetId();
      const historyRoot = deps.historyRoot ?? DEFAULT_EVAL_HISTORY_ROOT;
      const runOne = deps.runCase ?? runCase;
      const outputDir = join(historyRoot, runSetId);
      // A kill between cases must not lose finished ones: every completed
      // case is persisted (run-set report.json + per-case history) as it
      // lands, so an interrupted run leaves a valid partial report behind
      // and the offline `--report` board sees its cases.
      const completed: CaseResult[] = [];
      const persistRunSet = (): Effect.Effect<void, CliArgumentError> => Effect.tryPromise({
        try: async () => {
          const report = buildReport(runSetId, new Date().toISOString(), [...completed]);
          await mkdir(outputDir, { recursive: true });
          // Rename makes the refresh atomic: a kill mid-write cannot leave a
          // truncated report.json that outranks older complete ones.
          await writeFile(join(outputDir, "report.json.tmp"), `${JSON.stringify(report, null, 2)}\n`);
          await rename(join(outputDir, "report.json.tmp"), join(outputDir, "report.json"));
        },
        catch: (cause) => new CliArgumentError({ message: `cannot persist eval report: ${String(cause)}` }),
      });
      const results = yield* Effect.forEach(cases.flatMap((kase) =>
        Array.from({ length: opts.trials }, (_, index) => ({ kase, trial: index + 1 }))), ({ kase, trial }) =>
        Effect.gen(function* () {
          const pinned = opts.replayBaseline && !opts.dryRun
            ? yield* readBaseline(historyRoot, kase.id).pipe(
              Effect.mapError((cause) => new CliArgumentError({ message: cause.message })),
            )
            : undefined;
          if (opts.replayBaseline && !opts.dryRun && pinned === undefined) {
            return yield* Effect.fail(new CliArgumentError({ message: `no pinned baseline for case "${kase.id}"` }));
          }
          return yield* runOne(root, kase, {
            group: opts.group,
            root,
            dryRun: opts.dryRun,
            runSetId,
            trial,
            ...(pinned === undefined ? {} : { baseline: pinned }),
            ...(opts.variant === undefined ? {} : { variant: opts.variant }),
            workspaceRoot: DEFAULT_WORKSPACE_ROOT,
            ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
            // Live progress goes to stderr so stdout stays the pure report.
            onProgress: (line) => stderr.write(`${line}\n`),
          }).pipe(
            Effect.mapError((cause) => new CliArgumentError({
              message: cause instanceof Error ? cause.message : String(cause),
            })),
          );
        }).pipe(Effect.tap((result) => Effect.gen(function* () {
          if (opts.dryRun) return;
          const tokens = result.trajectory.totalTokens;
          const compact = tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(2)}M` : String(tokens);
          yield* Effect.sync(() => stderr.write(`  ${result.caseId}#${result.trial} done status=${result.status}`
            + `${result.artifact.value === undefined ? "" : ` final=${result.artifact.value.toFixed(4)}`}`
            + ` tokens=${compact} time=${Math.round((result.durationMs ?? 0) / 60_000)}m\n`));
          completed.push(result);
          yield* persistRunSet();
          const history = appendEvalHistory(historyRoot, runHistoryEntry(result, runSetId));
          const persisted = opts.recordBaseline && result.baseline?.source === "baseline" && result.baseline.passed === true && result.baseline.value !== undefined
            ? history.pipe(Effect.andThen(recordBaseline(historyRoot, result, runSetId)))
            : history;
          yield* persisted.pipe(
            Effect.mapError((cause) => new CliArgumentError({ message: cause.message })),
          );
        }))),
      );

      // Dry runs validate configs without producing measurements; persisting
      // them would leave a zero-score report.json that outranks real results
      // in offline analysis (`--report`). Real runs already persisted every
      // case above; this renders the final assembled report.
      const report = buildReport(runSetId, new Date().toISOString(), results);
      yield* Effect.sync(() => stdout.write(formatReport(report) + "\n"));
    })),
  );
}

/** `--report` path: render a persisted run set without running anything. */
function reportRunSet(
  opts: EvalsArgs,
  historyRoot: string,
): Effect.Effect<void, CliArgumentError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const ids = yield* listRunSetIds(historyRoot);
    const selection = [
      opts.group === undefined ? undefined : `--group ${opts.group}`,
      opts.caseId === undefined ? undefined : `--case ${opts.caseId}`,
    ].filter((part): part is string => part !== undefined).join(" ");
    const read = (id: string) => readRunSetReport(historyRoot, id).pipe(
      Effect.mapError((cause) => new CliArgumentError({ message: cause.message })),
    );
    if (selection === "") {
      // No selection: render the newest (or explicit) stored report verbatim,
      // and with --compare pair it with the previous run set.
      const currentId = opts.runSet ?? ids[0];
      if (currentId === undefined) {
        return yield* Effect.fail(new CliArgumentError({ message: `no persisted eval reports under ${historyRoot}` }));
      }
      const current = yield* read(currentId);
      yield* Effect.sync(() => stdout.write(formatReport(current, { details: opts.details }) + "\n"));
      if (!opts.compare) return;
      // Run set ids embed their creation timestamp, so the newest-first
      // listing is chronological: the predecessor is the first id before it.
      const previousId = ids.find((id) => id < currentId);
      if (previousId === undefined) {
        yield* Effect.sync(() => stdout.write(`no previous run set to compare against (latest is ${currentId})\n`));
        return;
      }
      const previous = yield* read(previousId);
      yield* Effect.sync(() => stdout.write(formatRunSetComparison(current, previous) + "\n"));
      return;
    }
    // Selection: assemble a board of every persisted case matching the
    // keyword (group field or grader tag), taking each case's newest
    // occurrence across run sets — so `--group tflops` shows all tagged
    // cases even when they live in different groups and were run in
    // different sessions. The cases are re-keyed to the selection word so
    // they share one matrix; --compare uses each case's previous stored
    // occurrence as its reference row.
    const matches = (kase: CaseResult) => kase.status !== "skipped"
      && (opts.group === undefined || kase.group === opts.group || kase.tags.includes(opts.group))
      && (opts.caseId === undefined || kase.caseId === opts.caseId);
    const keyword = opts.group ?? opts.caseId ?? "selection";
    type Occurrence = { readonly id: string; readonly at: string; readonly kase: CaseResult };
    const occurrences = new Map<string, Occurrence[]>();
    for (const id of ids) {
      const raw = yield* read(id);
      for (const kase of raw.cases) {
        if (!matches(kase)) continue;
        const key = `${kase.caseId}#${kase.trial}`;
        occurrences.set(key, [...(occurrences.get(key) ?? []), {id, at: raw.createdAt, kase}]);
      }
    }
    const chosen = [...occurrences.entries()]
      .map(([key, list]) => {
        const current = opts.runSet === undefined ? list[0] : list.find((o) => o.id === opts.runSet);
        return current === undefined ? undefined
          : { key, current, prior: list.find((o) => o.id < current.id) };
      })
      .filter((row): row is { key: string; current: Occurrence; prior: Occurrence | undefined } => row !== undefined);
    if (chosen.length === 0) {
      return yield* Effect.fail(new CliArgumentError({
        message: opts.runSet !== undefined
          ? `run set "${opts.runSet}" contains no case for ${selection}`
          : `no persisted run set contains ${selection}`,
      }));
    }
    const label = (entries: readonly Occurrence[]) => {
      const used = [...new Set(entries.map((o) => o.id))].sort();
      return used.length === 1 ? used[0]! : `gathered ${used[0]}..${used[used.length - 1]}`;
    };
    const gathered = (rows: readonly Occurrence[]) => buildReport(
      label(rows),
      rows.reduce((newest, o) => (o.at > newest ? o.at : newest), ""),
      rows.map((o) => ({ ...o.kase, group: keyword })),
    );
    const currentReport = gathered(chosen.map((row) => row.current));
    yield* Effect.sync(() => stdout.write(formatReport(currentReport, { minMatrixCases: 1, details: opts.details }) + "\n"));
    if (!opts.compare) return;
    const priorRows = chosen.map((row) => row.prior).filter((o): o is Occurrence => o !== undefined);
    if (priorRows.length === 0) {
      yield* Effect.sync(() => stdout.write(`no previous occurrence for ${selection} to compare against\n`));
      return;
    }
    yield* Effect.sync(() => stdout.write(formatRunSetComparison(currentReport, gathered(priorRows)) + "\n"));
  });
}

function defaultRunSetId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const millis = String(now.getMilliseconds()).padStart(3, "0");
  return `eval-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.${millis}`;
}
