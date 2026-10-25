/**
 * `piano evals` command — drives the Piano evals system.
 *
 * Usage:
 *   piano evals [--group <group>] [--case <id>] [--trials <n>] [--parallel=<n>]
 *     [--skip-existing] [--timeout <seconds>] [--variant <name>]
 *     [--record-baseline|--replay-baseline] [--dry-run]
 *   piano evals --report [--group <group> | --case <id>] [--runset <id>] [--delta]
 *
 * Loads all cases under the evals package's `workloads/` dir (optionally a
 * single group or tag keyword with `--group`, or a single case with `--case`).
 * `--group` matches the case's group field or any of its grader tags, so a
 * keyword like `tflops` assembles every case carrying that tag. Runs each
 * (copying its workspace template, executing the launch command), and prints a
 * text eval report.
 *
 * `--report` runs nothing: it re-renders the persisted report of the latest
 * run set (or `--runset <id>`). With `--group`/`--case` it instead assembles a
 * board of every persisted case matching the keyword (group name or grader
 * tag), each taken from its newest run set, rendered as one matrix. `--delta`
 * adds a per-case Δ board next to that matrix: every metric the case's own
 * matrix reports, as a `Δvalue`/`Δ%` cell pair between the case's two latest
 * runs — never across cases, and never against a pair the caller picks. A case
 * recorded once has no reference, so its Δ cells are missing. The delta needs
 * a selection to scope it, so it requires `--group` or `--case` and refuses
 * `--runset`. The default output is
 * the matrix plus the score summary; `--details` adds the per-case process
 * print (status, cost, stage and progress lines).
 *
 * The command is a thin shell: argument parsing and printing live here, the
 * run pipeline and the offline board live in `@piano/evals`.
 */

import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { stderr, stdout } from "node:process";
import { errorMessage } from "@piano/base";
import {
  formatReport,
  reportRunSet,
  runEvalPipeline,
  type RunCaseFn,
  type RunPipelineOptions,
  type RunSetReportOptions,
} from "@piano/evals";
import { CliArgumentError } from "./errors.js";
import { programName } from "./program-name.js";

const usage = `usage: ${programName()} evals [--group <group>] [--case <id>] [--trials <n>] [--parallel=<n>] [--skip-existing] [--timeout <seconds>] [--variant <name>] [--record-baseline|--replay-baseline] [--dry-run] | --report [--group <group> | --case <id>] [--runset <id>] [--delta] [--details]`;

/** The parsed command line is exactly what the package's live pipeline and
 * offline board accept, plus the two CLI-only controls. */
interface EvalsArgs extends RunPipelineOptions, RunSetReportOptions {
  /** Case material root override (`--root`). */
  readonly root?: string;
  readonly report: boolean;
}

export function parseEvalsArgs(args: readonly string[]): Effect.Effect<EvalsArgs, CliArgumentError> {
  let group: string | undefined;
  let caseId: string | undefined;
  let dryRun = false;
  let trials = 1;
  let parallel: number | undefined;
  let skipExisting = false;
  let root: string | undefined;
  let timeoutMs: number | undefined;
  let variant: string | undefined;
  let recordBaseline = false;
  let replayBaseline = false;
  let report = false;
  let details = false;
  let delta = false;
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
    } else if (arg === "--parallel" || arg?.startsWith("--parallel=")) {
      const inline = arg.startsWith("--parallel=");
      const raw = inline ? arg.slice("--parallel=".length) : args[index + 1];
      const value = raw === undefined || raw === "" ? Number.NaN : Number(raw);
      if (!Number.isInteger(value) || value < 1 || value > 64) {
        return Effect.fail(new CliArgumentError({ message: "--parallel must be an integer from 1 to 64" }));
      }
      parallel = value;
      index += inline ? 1 : 2;
    } else if (arg === "--skip-existing") {
      skipExisting = true;
      index += 1;
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
    } else if (arg === "--delta") {
      delta = true;
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
      || parallel !== undefined || skipExisting || timeoutMs !== undefined || variant !== undefined || recordBaseline || replayBaseline) {
      return Effect.fail(new CliArgumentError({ message: `--report analyzes persisted run sets; it cannot be combined with run options\n${usage}` }));
    }
  } else {
    if (details) {
      return Effect.fail(new CliArgumentError({ message: "--details requires --report" }));
    }
    if (delta) {
      return Effect.fail(new CliArgumentError({ message: "--delta requires --report" }));
    }
    if (runSet !== undefined) {
      return Effect.fail(new CliArgumentError({ message: "--runset requires --report" }));
    }
  }
  if (delta) {
    // A Δ board diffs each case against its own previous record, so it needs
    // a selection to say which cases to diff: without one there is nothing to
    // scope the board to, and no defensible "previous" to pick per case.
    if (group === undefined && caseId === undefined) {
      return Effect.fail(new CliArgumentError({ message: `--delta needs a selection; add --group <group> or --case <id>\n${usage}` }));
    }
    if (runSet !== undefined) {
      return Effect.fail(new CliArgumentError({ message: `--delta always diffs each case against its own previous run; it cannot be combined with --runset\n${usage}` }));
    }
  }
  return Effect.succeed({
    ...(group === undefined ? {} : { group }),
    ...(caseId === undefined ? {} : { caseId }),
    dryRun,
    trials,
    ...(parallel === undefined ? {} : { parallel }),
    skipExisting,
    ...(root === undefined ? {} : { root }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(variant === undefined ? {} : { variant }),
    recordBaseline,
    replayBaseline,
    report,
    details,
    delta,
    ...(runSet === undefined ? {} : { runSet }),
  });
}

interface EvalsCommandDeps {
  /** Root holding `<runSetId>/report.json`; injectable so the report path can
   * be pointed at fixtures. Defaults to the user-level evals home. */
  readonly outputRoot?: string;
  /** Case-execution seam (defaults to the real `runCase`); injectable so the
   * per-case persistence path is testable without running a harness. */
  readonly runCase?: RunCaseFn;
}

function toCliError(cause: unknown): CliArgumentError {
  return new CliArgumentError({ message: errorMessage(cause) });
}

/** Run the full evals pipeline and print a text report. */
export function evalsCommand(
  args: readonly string[],
  deps: EvalsCommandDeps = {},
): Effect.Effect<void, CliArgumentError, FileSystem.FileSystem> {
  return parseEvalsArgs(args).pipe(
    Effect.flatMap((opts) => Effect.gen(function* () {
      if (opts.report) {
        const text = yield* reportRunSet(opts, deps.outputRoot).pipe(
          Effect.mapError(toCliError),
        );
        yield* Effect.sync(() => stdout.write(text));
        return;
      }
      const result = yield* runEvalPipeline(opts, {
        ...(opts.root === undefined ? {} : { root: opts.root }),
        ...(deps.outputRoot === undefined ? {} : { outputRoot: deps.outputRoot }),
        ...(deps.runCase === undefined ? {} : { runCase: deps.runCase }),
        // Live progress goes to stderr so stdout stays the pure report.
        onProgress: (line) => stderr.write(`${line}\n`),
      }).pipe(Effect.mapError(toCliError));
      if (result.kind === "no-cases") {
        yield* Effect.sync(() => stdout.write("no evals cases found.\n"));
        return;
      }
      if (result.kind === "no-pending") {
        yield* Effect.sync(() => stdout.write("no evals cases pending; selected cases already have persisted results.\n"));
        return;
      }
      yield* Effect.sync(() => stdout.write(formatReport(result.report) + "\n"));
    })),
  );
}
