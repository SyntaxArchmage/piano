import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { stdin, stdout } from "node:process";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  KeybindingsManager,
  ProcessTerminal,
  SelectList,
  setKeybindings,
  TUI,
  TUI_KEYBINDINGS,
  Text,
} from "@earendil-works/pi-tui";
import type { SelectItem, SelectListTheme } from "@earendil-works/pi-tui";
import {
  defaultRunsRoot,
  formatStaticObservabilityReport,
  inspectStaticObservability,
} from "@piano/logging";
import { foldJobSpans, jobs, parseProgressStreamRecord, rebuildRunStatus, runStatusPath, type JobView } from "@piano/orchestrator";
import { CliArgumentError, LogsStorageError, TuiError, type CliError } from "./errors.js";
import { programName } from "./program-name.js";
import { formatRunId, oneLine } from "./session-resume.js";

const usage = `usage: ${programName()} logs [--trace] [--check <run-id>] [--jobs [<run-id>]] [--job <ordinal>] [--rebuild <run-id> [--force]]`;
const RST = "\x1b[0m";
const COLORS = {
  accent: "\x1b[38;2;192;57;43m",
  blue: "\x1b[38;2;129;162;190m",
  cyan: "\x1b[38;2;86;182;194m",
  dim: "\x1b[38;2;150;150;150m",
  error: "\x1b[38;2;231;76;60m",
  success: "\x1b[38;2;46;204;113m",
  warn: "\x1b[38;2;240;198;116m",
  bold: "\x1b[1m",
} as const;

const paint = (style: string, value: string): string => `${style}${value}${RST}`;

interface LogsOptions {
  runsRoot: string;
  trace: boolean;
  checkRun?: string;
  jobs: boolean;
  jobOrdinal?: number;
  jobsRun?: string;
  rebuildRun?: string;
  force: boolean;
}

export interface LogsDeps {
  runsRoot?: string;
  pickRun?: (
    runsRoot: string,
    trace: boolean,
  ) => Effect.Effect<string | undefined, CliError, FileSystem.FileSystem>;
}

function parseLogsArgs(
  args: readonly string[],
  deps: LogsDeps,
): Effect.Effect<LogsOptions, CliArgumentError> {
  let trace = false;
  let checkRun: string | undefined;
  let jobsFlag = false;
  let jobOrdinal: number | undefined;
  let rebuildRun: string | undefined;
  let force = false;
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--trace") {
      trace = true;
      continue;
    }
    if (arg === "--check") {
      const value = args[index + 1];
      if (value === undefined || value === "" || value.startsWith("-")) {
        return Effect.fail(new CliArgumentError({ message: `--check requires a run id\n${usage}` }));
      }
      if (checkRun !== undefined) {
        return Effect.fail(new CliArgumentError({ message: `--check may be specified only once\n${usage}` }));
      }
      checkRun = value;
      index += 1;
      continue;
    }
    if (arg === "--jobs") {
      if (jobsFlag) {
        return Effect.fail(new CliArgumentError({ message: `--jobs may be specified only once\n${usage}` }));
      }
      jobsFlag = true;
      continue;
    }
    if (arg === "--rebuild") {
      const value = args[index + 1];
      if (value === undefined || value === "" || value.startsWith("-")) {
        return Effect.fail(new CliArgumentError({ message: `--rebuild requires a run id\n${usage}` }));
      }
      if (rebuildRun !== undefined) {
        return Effect.fail(new CliArgumentError({ message: `--rebuild may be specified only once\n${usage}` }));
      }
      rebuildRun = value;
      index += 1;
      continue;
    }
    if (arg === "--force") {
      if (force) {
        return Effect.fail(new CliArgumentError({ message: `--force may be specified only once\n${usage}` }));
      }
      force = true;
      continue;
    }
    if (arg === "--job") {
      const value = args[index + 1];
      if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
        return Effect.fail(new CliArgumentError({ message: `--job requires a positive job ordinal\n${usage}` }));
      }
      if (jobOrdinal !== undefined) {
        return Effect.fail(new CliArgumentError({ message: `--job may be specified only once\n${usage}` }));
      }
      jobOrdinal = Number(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      return Effect.fail(new CliArgumentError({ message: `unknown option: ${arg}\n${usage}` }));
    }
    positionals.push(arg);
  }
  if (trace && checkRun !== undefined) {
    return Effect.fail(new CliArgumentError({ message: `--trace and --check cannot be combined\n${usage}` }));
  }
  if (jobOrdinal !== undefined && !jobsFlag) {
    return Effect.fail(new CliArgumentError({ message: `--job requires --jobs\n${usage}` }));
  }
  if (jobsFlag && trace) {
    return Effect.fail(new CliArgumentError({ message: `--jobs and --trace cannot be combined\n${usage}` }));
  }
  if (jobsFlag && checkRun !== undefined) {
    return Effect.fail(new CliArgumentError({ message: `--jobs and --check cannot be combined\n${usage}` }));
  }
  if (force && rebuildRun === undefined) {
    return Effect.fail(new CliArgumentError({ message: `--force requires --rebuild\n${usage}` }));
  }
  if (rebuildRun !== undefined && (trace || checkRun !== undefined || jobsFlag || jobOrdinal !== undefined)) {
    return Effect.fail(new CliArgumentError({ message: `--rebuild cannot be combined with --trace, --check or --jobs\n${usage}` }));
  }
  if (rebuildRun !== undefined && positionals.length > 0) {
    return Effect.fail(new CliArgumentError({ message: `--rebuild takes its run id, not a positional\n${usage}` }));
  }
  if (!jobsFlag && positionals.length > 0) {
    // Keep the historical surface: plain `piano logs` takes no positional.
    return Effect.fail(new CliArgumentError({ message: `unknown option: ${positionals[0] ?? ""}\n${usage}` }));
  }
  if (positionals.length > 1) {
    return Effect.fail(new CliArgumentError({ message: `--jobs accepts at most one run id\n${usage}` }));
  }
  return Effect.succeed({
    runsRoot: deps.runsRoot ?? defaultRunsRoot(),
    trace,
    jobs: jobsFlag,
    ...(checkRun === undefined ? {} : { checkRun }),
    ...(jobOrdinal === undefined ? {} : { jobOrdinal }),
    ...(positionals[0] === undefined ? {} : { jobsRun: positionals[0] }),
    ...(rebuildRun === undefined ? {} : { rebuildRun }),
    force,
  });
}

function selectTheme(): SelectListTheme {
  const selectPaint = (style: string) => (value: string): string => paint(style, value);
  return {
    selectedPrefix: selectPaint(`${COLORS.bold}${COLORS.accent}`),
    selectedText: selectPaint(COLORS.bold),
    description: selectPaint(COLORS.dim),
    scrollInfo: selectPaint(COLORS.dim),
    noMatch: selectPaint(COLORS.dim),
  };
}

function runIds(runsRoot: string): Effect.Effect<string[], LogsStorageError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = runsRoot;
    const entries = yield* fileSystem.readDirectory(path).pipe(
      Effect.catchAll((cause) => cause._tag === "SystemError" && cause.reason === "NotFound"
        ? Effect.succeed([])
        : Effect.fail(new LogsStorageError({
          operation: "list-runs",
          path,
          message: cause.message,
        }))),
    );
    const directories = yield* Effect.forEach(entries, (entry) =>
      fileSystem.stat(join(path, entry)).pipe(
        Effect.map((info) => info.type === "Directory" ? entry : undefined),
        Effect.catchAll(() => Effect.succeed(undefined)),
      ),
    );
    return directories.filter((entry): entry is string => entry !== undefined).sort().reverse();
  });
}

interface RunRowMetadata {
  readonly workflow?: string;
  readonly status?: string;
  readonly prompt?: string;
}

/** The row the run's state document carries: the workflow it ran, how it
 * ended, and the first prompt it was given. */
function readStatusRow(runDir: string): RunRowMetadata | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(runStatusPath(runDir), "utf8")) as unknown;
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const status = parsed as { workflowPath?: unknown; status?: unknown; turns?: unknown };
  const row: { workflow?: string; status?: string; prompt?: string } = {};
  if (typeof status.workflowPath === "string") {
    row.workflow = basename(status.workflowPath).replace(/\.ya?ml$/i, "");
  }
  if (typeof status.status === "string") row.status = status.status;
  if (Array.isArray(status.turns)) {
    const first = status.turns[0] as { prompt?: unknown } | undefined;
    if (typeof first?.prompt === "string") row.prompt = first.prompt;
  }
  return row;
}

/** Exported for testing; the picker calls it once per listed run.
 *
 * The run's state document is the row. It is one small file, so reading it is
 * the whole cost of listing a run. */
export function readRunRowMetadata(runDir: string): RunRowMetadata {
  return readStatusRow(runDir) ?? {};
}

/** One picker label: `2026-09-03 01:07 · gpu-cuda-tuning · [failed] · <prompt
 * snippet>`. Fields a run does not carry are omitted, so legacy runs stay id+time. */
export function runPickerLabel(runId: string, row: RunRowMetadata): string {
  return [
    formatRunId(runId),
    row.workflow,
    row.status === undefined || row.status === "completed" ? undefined : `[${row.status}]`,
    row.prompt === undefined ? undefined : oneLine(row.prompt, 60),
  ].filter((part): part is string => part !== undefined && part !== "").join(" · ");
}

function pickRun(
  runsRoot: string,
  trace: boolean,
): Effect.Effect<string | undefined, TuiError | LogsStorageError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const runs = yield* runIds(runsRoot);
    if (runs.length === 0) {
      yield* Effect.fail(new LogsStorageError({
        operation: "list-runs",
        path: runsRoot,
        message: `no runs found under ${runsRoot}`,
      }));
    }
    if (!stdin.isTTY || !stdout.isTTY) {
      yield* Effect.fail(new TuiError({ operation: "terminal", message: "an interactive terminal is required" }));
    }
    const filename = trace ? "trace.jsonl" : "log.jsonl";
    const fileSystem = yield* FileSystem.FileSystem;
    const items = yield* Effect.forEach(runs, (id) =>
      fileSystem.exists(join(runsRoot, id, filename)).pipe(
        Effect.map((exists) => {
          if (!exists) return undefined;
          // No `description`: pi-tui's SelectList truncates the label into a
          // ~32-column primary slot whenever a description is set, which would
          // eat exactly the prompt tail this label exists to show. The full
          // payload lives in the label; the raw id still prints in the
          // `Logs: <run-id>` header after selection.
          const row = readRunRowMetadata(join(runsRoot, id));
          return { value: id, label: runPickerLabel(id, row) };
        }),
        Effect.mapError((cause) => new LogsStorageError({
          operation: "inspect-run",
          path: join(runsRoot, id, filename),
          message: cause.message,
        })),
      ),
    ).pipe(Effect.map((entries) => entries.filter((entry) => entry !== undefined)));
    if (items.length === 0) {
      yield* Effect.fail(new LogsStorageError({
        operation: "list-runs",
        path: runsRoot,
        message: `no runs found with a ${filename}`,
      }));
    }
    const selected = yield* Effect.try({
      try: () => {
        setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
        const tui = new TUI(new ProcessTerminal());
        const list = new SelectList(items, 10, selectTheme());
        tui.addChild(new Text(paint(`${COLORS.bold}${COLORS.blue}`, trace ? "Select a run to inspect its trace:" : "Select a run to inspect its logs:"), 0, 0));
        tui.addChild(new Text(paint(COLORS.dim, `${items.length} runs · ↑/↓ move · Enter open · Esc cancel`), 0, 0));
        tui.addChild(list);
        tui.setFocus(list);
        return { tui, list };
      },
      catch: (cause) => new TuiError({ operation: "create", message: String(cause) }),
    });
    return yield* Effect.async<SelectItem | null, TuiError>((resume) => {
      let stopped = false;
      const finish = (result: Effect.Effect<SelectItem | null, TuiError>): void => {
        if (stopped) return;
        stopped = true;
        selected.tui.stop();
        resume(result);
      };
      selected.list.onSelect = (item) => finish(Effect.succeed(item));
      selected.list.onCancel = () => finish(Effect.succeed(null));
      selected.tui.start();
      return Effect.sync(() => selected.tui.stop());
    }).pipe(Effect.map((item) => item?.value));
  });
}

function time(value: unknown): string {
  if (typeof value !== "string") return "????-??-?? ??:??:??.??? UTC??:??";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const pad = (part: number): string => String(part).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, "0")}` +
    ` UTC${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

function formatValue(input: unknown): string {
  if (typeof input === "string") return sanitize(input, payloadWidth());
  try {
    const encoded = JSON.stringify(input);
    return sanitize(encoded === undefined ? "undefined" : encoded, payloadWidth());
  } catch {
    return "[unprintable]";
  }
}

function parseJson(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function formatAttributes(record: Record<string, unknown>): string {
  const source = record.attributes ?? record.payload ?? record.data;
  if (!source || typeof source !== "object" || Array.isArray(source)) return "";
  return Object.entries(source as Record<string, unknown>)
    .map(([key, entryValue]) => `${sanitize(key, payloadWidth())}=${key === "error" ? errorText(entryValue) : formatValue(entryValue)}`)
    .join(" ");
}

function errorText(value: unknown): string {
  if (value !== null && typeof value === "object") {
    const error = value as Record<string, unknown>;
    const type = typeof error.type === "string" ? error.type : "error";
    const kind = typeof error.kind === "string" ? `[${error.kind}]` : "";
    const message = typeof error.message === "string" ? error.message : "unknown failure";
    return sanitize(`${type}${kind}: ${message}`, payloadWidth());
  }
  return sanitize(String(value), payloadWidth());
}

function levelColor(level: string): string {
  if (level === "FATAL" || level === "ERROR") return COLORS.error;
  if (level === "WARN") return COLORS.warn;
  if (level === "TRACE" || level === "DEBUG") return COLORS.dim;
  return COLORS.success;
}

const ESCAPE_RE = /[\r\n\t]/g;

/** Terminal width for payload/message fields (fallback 120). */
function payloadWidth(): number {
  return typeof stdout.columns === "number" && stdout.columns > 40 ? stdout.columns : 120;
}

/** Escape control characters and truncate to `width` so a value stays on one line. */
function sanitize(value: string, width: number): string {
  const escaped = value.replace(ESCAPE_RE, (ch) =>
    ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t");
  return escaped.length <= width ? escaped : `${escaped.slice(0, Math.max(0, width - 1))}…`;
}

export function formatLog(line: string): string {
  const parsed = parseJson(line);
  if (parsed === undefined) return line;
  const levelValue = parsed.severity ?? parsed.level;
  const level = typeof levelValue === "string" ? levelValue.toUpperCase() : "INFO";
  const moduleName = typeof parsed.module === "string" ? parsed.module : undefined;
  const fileName = typeof parsed.file === "string" ? parsed.file : undefined;
  const functionName = typeof parsed.function === "string" ? parsed.function : undefined;
  const source = moduleName && fileName
    ? `${moduleName}/${fileName}${functionName ? `::${functionName}` : ""}`
    : functionName ?? fileName ?? moduleName;
  const namespace = typeof parsed.namespace === "string" ? parsed.namespace : typeof parsed.ns === "string" ? parsed.ns : undefined;
  const component = source || namespace || "piano";
  const event = typeof parsed.event === "string" ? parsed.event : typeof parsed.event_name === "string" ? parsed.event_name : "event";
  const message = typeof parsed.message === "string" ? sanitize(parsed.message, payloadWidth()) : undefined;
  const outcome = typeof parsed.outcome === "string" ? parsed.outcome : typeof parsed.status === "string" ? parsed.status : undefined;
  const context = [
    typeof parsed.stage === "string" ? `stage=${parsed.stage}` : undefined,
    typeof parsed.agent === "string" ? `agent=${parsed.agent}` : undefined,
    outcome === undefined ? undefined : `outcome=${outcome}`,
  ].filter((value): value is string => value !== undefined).join(" ");
  const formattedAttributes = formatAttributes(parsed);
  return [
    paint(COLORS.dim, time(parsed.timestamp ?? parsed.ts)),
    paint(levelColor(level), level.padEnd(5)),
    paint(COLORS.cyan, component),
    paint(`${COLORS.bold}${COLORS.blue}`, event),
    message === undefined ? "" : paint(COLORS.dim, `— ${message}`),
    context === "" ? "" : paint(COLORS.dim, `[${context}]`),
    formattedAttributes ? paint(COLORS.dim, formattedAttributes) : "",
  ].filter(Boolean).join(" ");
}

export function formatTrace(line: string): string {
  const parsed = parseJson(line);
  if (parsed === undefined) return line;
  const depth = typeof parsed.depth === "number" && Number.isFinite(parsed.depth)
    ? Math.max(0, Math.floor(parsed.depth))
    : 0;
  const event: readonly [string, string] = parsed.event === "enter"
    ? ["▶", COLORS.blue]
    : parsed.event === "error"
      ? ["✗", COLORS.error]
      : ["✓", COLORS.success];
  const fn = typeof parsed.fn === "string" ? parsed.fn : "operation";
  const source = sanitize(
    typeof parsed.module === "string" && typeof parsed.file === "string"
      ? `${parsed.module}/${parsed.file}::${fn}`
      : fn,
    payloadWidth(),
  );
  const duration = typeof parsed.duration_ms === "number" ? ` (${parsed.duration_ms}ms)` : "";
  const error = parsed.event === "error" && parsed.error !== undefined ? `: ${errorText(parsed.error)}` : "";
  return `${"  ".repeat(depth)}${paint(COLORS.dim, time(parsed.timestamp ?? parsed.ts))} ${paint(event[1], event[0])} ${paint(COLORS.cyan, source)}${paint(COLORS.dim, duration)}${error ? paint(COLORS.error, error) : ""}`;
}

function printLog(
  runsRoot: string,
  run: string,
  trace: boolean,
): Effect.Effect<void, LogsStorageError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const filename = trace ? "trace.jsonl" : "log.jsonl";
    const file = join(runsRoot, run, filename);
    const fileSystem = yield* FileSystem.FileSystem;
    const content = yield* fileSystem.readFileString(file).pipe(
      Effect.mapError((cause) => new LogsStorageError({ operation: "read", path: file, message: cause.message })),
    );
    yield* Effect.sync(() => console.log(paint(`${COLORS.bold}${COLORS.accent}`, `${trace ? "Trace" : "Logs"}: ${run}`)));
    yield* Effect.forEach(content.split("\n").filter(Boolean), (line) =>
      Effect.sync(() => console.log(trace ? formatTrace(line) : formatLog(line))),
    );
  });
}

function printStaticObservability(
  runsRoot: string,
  run: string,
): Effect.Effect<void, LogsStorageError, FileSystem.FileSystem> {
  const resolvedRunsRoot = resolve(runsRoot);
  const runDir = resolve(resolvedRunsRoot, run);
  if (dirname(runDir) !== resolvedRunsRoot) {
    return Effect.fail(new LogsStorageError({
      operation: "check",
      path: runDir,
      message: "run id must name a direct child of the runs root",
    }));
  }
  return inspectStaticObservability(runDir).pipe(
    Effect.mapError((cause) => new LogsStorageError({
      operation: "check",
      path: runDir,
      message: cause.message,
    })),
    Effect.flatMap((report) => Effect.sync(() => console.log(formatStaticObservabilityReport(report))).pipe(
      Effect.andThen(report.valid
        ? Effect.void
        : Effect.fail(new LogsStorageError({
          operation: "check",
          path: runDir,
          message: `static observability check found ${report.issues.length} issue(s)`,
        }))),
    )),
  );
}

function jobStateLabel(state: JobView["state"], outcome: JobView["outcome"]): string {
  return outcome === undefined ? state : `${state}(${outcome})`;
}

function jobStateStyle(view: JobView): string {
  if (view.state === "alive") return COLORS.cyan;
  if (view.state === "paused") return COLORS.warn;
  return view.outcome === "failed" ? COLORS.error : COLORS.success;
}

/** `--jobs [<run-id>]` / `--jobs --job <ordinal> [<run-id>]`: fold the run's
 * progress ledger into its jobs. The ledger is the evidence; the fold is the
 * same one `/continue` consumes, so this prints exactly what a continue would
 * skip. */
/** Fold a run's ledgers back into its state document — the recovery path when
 * the view is missing or torn. Refuses while the latest job is still open
 * unless forced: a live run's own writer owns the view. */
function printRebuild(
  runsRoot: string,
  run: string,
  force: boolean,
): Effect.Effect<void, LogsStorageError, FileSystem.FileSystem> {
  const resolvedRunsRoot = resolve(runsRoot);
  const runDir = resolve(resolvedRunsRoot, run);
  if (dirname(runDir) !== resolvedRunsRoot) {
    return Effect.fail(new LogsStorageError({
      operation: "rebuild",
      path: runDir,
      message: "run id must name a direct child of the runs root",
    }));
  }
  return Effect.gen(function* () {
    const status = yield* rebuildRunStatus(runDir, { force }).pipe(
      Effect.mapError((error) => new LogsStorageError({
        operation: "rebuild",
        path: runDir,
        message: error.message,
      })),
    );
    yield* Effect.sync(() => {
      if (status === undefined) {
        console.log(paint(COLORS.dim, `no ledgers to fold for ${run}`));
        return;
      }
      const latest = status.jobs.at(-1);
      console.log(paint(`${COLORS.bold}${COLORS.accent}`, `Rebuilt ${run}/status.json`));
      console.log([
        paint(COLORS.dim, `jobs=${status.jobs.length}`),
        paint(COLORS.dim, `turns=${status.turns?.length ?? 0}`),
        ...(latest === undefined ? [] : [paint(COLORS.dim, `latest=#${latest.jobOrdinal} ${latest.state}`)]),
      ].join("  "));
    });
  });
}

function printJobs(
  runsRoot: string,
  run: string,
  jobOrdinal: number | undefined,
): Effect.Effect<void, LogsStorageError, FileSystem.FileSystem> {
  const resolvedRunsRoot = resolve(runsRoot);
  const runDir = resolve(resolvedRunsRoot, run);
  if (dirname(runDir) !== resolvedRunsRoot) {
    return Effect.fail(new LogsStorageError({
      operation: "jobs",
      path: runDir,
      message: "run id must name a direct child of the runs root",
    }));
  }
  const ledgerPath = join(runDir, "progress.jsonl");
  return Effect.gen(function* () {
    const lines = yield* Effect.try({
      try: () => readFileSync(ledgerPath, "utf8").split("\n"),
      catch: (cause) => new LogsStorageError({ operation: "read", path: ledgerPath, message: String(cause) }),
    });
    const records = lines
      .map((line) => parseProgressStreamRecord(line))
      .filter((record): record is NonNullable<ReturnType<typeof parseProgressStreamRecord>> => record !== undefined);
    if (records.length === 0) {
      if (lines.every((line) => line.trim() === "")) {
        return yield* Effect.fail(new LogsStorageError({
          operation: "jobs",
          path: ledgerPath,
          message: "the run has no progress ledger to fold jobs from",
        }));
      }
      // A ledger with lines this build cannot read is not a missing ledger: it
      // is one written before the record contract, and saying so beats an
      // error that reads like the file is gone.
      if (jobOrdinal === undefined) {
        yield* Effect.sync(() => {
          console.log(paint(`${COLORS.bold}${COLORS.accent}`, `Jobs: ${run}`));
          console.log(paint(COLORS.dim, "no records this build reads — the ledger predates the record contract"));
        });
        return;
      }
      return yield* Effect.fail(new LogsStorageError({
        operation: "jobs",
        path: ledgerPath,
        message: `job #${jobOrdinal} is not in a ledger this build can read`,
      }));
    }
    const views = jobs(foldJobSpans(records));
    if (jobOrdinal === undefined) {
      yield* Effect.sync(() => {
        console.log(paint(`${COLORS.bold}${COLORS.accent}`, `Jobs: ${run}`));
        if (views.length === 0) {
          // Records but no jobs: the ledger predates the job ledger, so its
          // accepted lines carry no execution anchor to group them by. Saying
          // so beats an empty list that reads like a bug.
          console.log(paint(COLORS.dim, "no jobs recorded — this run's ledger predates the job ledger; /restart starts one"));
        }
        for (const view of views) {
          const last = view.spans[view.spans.length - 1];
          const lastAt = last === undefined ? undefined : last.finishedAt ?? last.startedAt;
          console.log([
            paint(COLORS.bold, `#${view.jobOrdinal}`),
            paint(jobStateStyle(view), jobStateLabel(view.state, view.outcome)),
            paint(COLORS.dim, `spans=${view.spans.length}`),
            paint(COLORS.dim, `accepted=${view.accepted.size}`),
            ...(lastAt === undefined ? [] : [paint(COLORS.dim, `last=${lastAt}`)]),
            ...(view.input === undefined ? [] : [oneLine(view.input, 60)]),
          ].join("  "));
        }
      });
      return;
    }
    const view = views.find((candidate) => candidate.jobOrdinal === jobOrdinal);
    if (view === undefined) {
      return yield* Effect.fail(new LogsStorageError({
        operation: "jobs",
        path: ledgerPath,
        message: views.length === 0
          ? `job ${jobOrdinal} not found: the run has no jobs`
          : `job ${jobOrdinal} not found; the run's jobs are ${views.map((candidate) => `#${candidate.jobOrdinal}`).join(", ")}`,
      }));
    }
    yield* Effect.sync(() => {
      console.log([
        paint(`${COLORS.bold}${COLORS.accent}`, `Job #${view.jobOrdinal}`),
        paint(jobStateStyle(view), jobStateLabel(view.state, view.outcome)),
        paint(COLORS.dim, `spans=${view.spans.length}`),
        paint(COLORS.dim, `accepted=${view.accepted.size}`),
      ].join("  "));
      view.spans.forEach((span, index) => {
        const spanStyle = span.status === "running" ? COLORS.cyan : span.status === "failed" ? COLORS.error : COLORS.dim;
        const closed = span.closed === undefined ? "" : paint(COLORS.dim, ` (${span.closed})`);
        console.log(`  ${paint(COLORS.dim, `span ${index + 1}`)}  ${span.startedAt} → ${span.finishedAt ?? "…"}  ${paint(spanStyle, span.status)}${closed}`);
      });
      const accepted = [...view.accepted].sort();
      if (accepted.length > 0) {
        console.log(paint(COLORS.dim, "  accepted:"));
        for (const invocationId of accepted) {
          const attempt = view.attempts.get(invocationId);
          console.log(`    ${invocationId}${attempt === undefined ? "" : paint(COLORS.dim, `  attempt=${attempt}`)}`);
        }
      }
      if (view.input !== undefined) {
        console.log(paint(COLORS.dim, "  input:"));
        console.log(`    ${oneLine(view.input, 120)}`);
      }
    });
  });
}

export function logsCommand(
  args: readonly string[] = process.argv.slice(2),
  deps: LogsDeps = {},
): Effect.Effect<void, CliError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const options = yield* parseLogsArgs(args, deps);
    if (options.rebuildRun !== undefined) {
      yield* printRebuild(options.runsRoot, options.rebuildRun, options.force);
      return;
    }
    if (options.checkRun !== undefined) {
      yield* printStaticObservability(options.runsRoot, options.checkRun);
      return;
    }
    if (options.jobs) {
      const picker = deps.pickRun ?? pickRun;
      const run = options.jobsRun ?? (yield* picker(options.runsRoot, false));
      if (run === undefined) return;
      yield* printJobs(options.runsRoot, run, options.jobOrdinal);
      return;
    }
    const picker = deps.pickRun ?? pickRun;
    const run = yield* picker(options.runsRoot, options.trace);
    if (run === undefined) return;
    yield* printLog(options.runsRoot, run, options.trace);
  });
}
