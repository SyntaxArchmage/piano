import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { stdin, stdout } from "node:process";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
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
  trajectoryStreamPath,
} from "@piano/logging";
import { CliArgumentError, LogsStorageError, TuiError, type CliError } from "./errors.js";
import { programName } from "./program-name.js";
import { formatRunId, oneLine } from "./session-resume.js";

const usage = `usage: ${programName()} logs [--trace] [--check <run-id>]`;
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
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
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
    return Effect.fail(new CliArgumentError({ message: `unknown option: ${arg}\n${usage}` }));
  }
  if (trace && checkRun !== undefined) {
    return Effect.fail(new CliArgumentError({ message: `--trace and --check cannot be combined\n${usage}` }));
  }
  return Effect.succeed({
    runsRoot: deps.runsRoot ?? defaultRunsRoot(),
    trace,
    ...(checkRun === undefined ? {} : { checkRun }),
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

/** A run's `trajectory.json` can hold hundreds of megabytes of events, so the
 * picker reads only a bounded tail window: the document's trailing block sits
 * after the huge `events` array and carries `workflowPath`, `status`, and the
 * compact `turns` entries (`{prompt, status, eventCount}`). Missing pieces
 * degrade to an id+time row, never a failure. Runs whose handoff prompts push
 * that trailing block past the small window pay one bigger read (`prompts` of
 * tens of kilobytes per turn are common in tuning workflows). */
const TAIL_WINDOW_BYTES = 64 * 1024;
const TAIL_WINDOW_CAP_BYTES = 1024 * 1024;

interface RunRowMetadata {
  readonly workflow?: string;
  readonly status?: string;
  readonly prompt?: string;
}

function readJsonStringLiteral(match: RegExpExecArray): string | undefined {
  try {
    const value: unknown = JSON.parse(`"${match[1]}"`);
    return typeof value === "string" ? value : undefined;
  } catch {
    // The window cut the literal mid-escape; treat the field as missing.
    return undefined;
  }
}

/** Last `bytes` of the file decoded as utf8, or undefined when unreadable. */
function readTail(trajectoryFile: string, bytes: number): string | undefined {
  return readWindow(trajectoryFile, bytes, "tail");
}

/** First `bytes` of the file decoded as utf8, or undefined when unreadable. */
function readHead(trajectoryFile: string, bytes: number): string | undefined {
  return readWindow(trajectoryFile, bytes, "head");
}

function readWindow(trajectoryFile: string, bytes: number, end: "head" | "tail"): string | undefined {
  try {
    const fd = openSync(trajectoryFile, "r");
    try {
      const size = fstatSync(fd).size;
      const length = Math.min(size, bytes);
      const buffer = Buffer.allocUnsafe(length);
      readSync(fd, buffer, 0, length, end === "tail" ? size - length : 0);
      return buffer.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    // No trajectory (legacy run) or unreadable — an id-only row is correct.
    return undefined;
  }
}

function parseRunTail(tail: string): RunRowMetadata {
  const row: { workflow?: string; status?: string; prompt?: string } = {};
  const workflow = /"workflowPath":"((?:[^"\\]|\\.)*)"/.exec(tail);
  if (workflow !== null) {
    const value = readJsonStringLiteral(workflow);
    if (value !== undefined) row.workflow = basename(value).replace(/\.ya?ml$/i, "");
    // The document-level status is the first one after workflowPath; the
    // per-turn statuses come later inside `turns`.
    const status = /"status":"(completed|failed|cancelled)"/.exec(tail.slice(workflow.index));
    if (status !== null) row.status = status[1];
  }
  const turns = tail.lastIndexOf('"turns":[');
  if (turns !== -1) {
    const prompt = /"prompt":"((?:[^"\\]|\\.)*)"/.exec(tail.slice(turns));
    if (prompt !== null) {
      const value = readJsonStringLiteral(prompt);
      if (value !== undefined) row.prompt = value;
    }
  }
  return row;
}

/** Row fields read from a stream's two ends, for a run whose document is gone.
 *
 * Trajectory records are append-only, so the earliest record that carried a
 * prompt holds the run's first one and the last holds its newest status and
 * workflow. The events in between are the bulk of the run and none of the row.
 * Windows are generous enough to hold a record; a record larger than one simply
 * yields fewer fields, never a failure. */
const STREAM_WINDOW_BYTES = 16 * 1024;

function parseStreamRecord(line: string | undefined): Record<string, unknown> | undefined {
  if (line === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    // Torn mid-append, or cut by the window: the records before it still count.
    return undefined;
  }
}

/** The records a window holds, newest first. */
function windowRecords(window: string): readonly Record<string, unknown>[] {
  return window.split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseStreamRecord)
    .filter((record): record is Record<string, unknown> => record !== undefined);
}

function readStreamRowMetadata(streamFile: string): RunRowMetadata | undefined {
  const head = readHead(streamFile, STREAM_WINDOW_BYTES);
  if (head === undefined) return undefined;
  const row: { workflow?: string; status?: string; prompt?: string } = {};
  for (const record of windowRecords(head)) {
    if (row.prompt === undefined && typeof record.prompt === "string") row.prompt = record.prompt;
    if (row.prompt !== undefined) break;
  }
  const tail = readTail(streamFile, STREAM_WINDOW_BYTES);
  // The tail's first line is usually a fragment of the window's edge; walking
  // back from the end finds the newest whole record.
  for (const record of [...(tail === undefined ? [] : windowRecords(tail))].reverse()) {
    if (row.status === undefined && typeof record.status === "string") row.status = record.status;
    if (row.workflow === undefined && typeof record.workflowPath === "string") {
      row.workflow = basename(record.workflowPath).replace(/\.ya?ml$/i, "");
    }
    if (row.status !== undefined && row.workflow !== undefined) break;
  }
  return row;
}

/** Exported for testing; the picker calls it once per listed run. */
export function readRunRowMetadata(trajectoryFile: string): RunRowMetadata {
  const tail = readTail(trajectoryFile, TAIL_WINDOW_BYTES);
  if (tail !== undefined) {
    const row = parseRunTail(tail);
    if (row.workflow !== undefined) return row;
    const bigger = readTail(trajectoryFile, TAIL_WINDOW_CAP_BYTES);
    // Shorter means the file already fit the small window; nothing more to find.
    if (bigger !== undefined && bigger.length > tail.length) {
      const wider = parseRunTail(bigger);
      if (wider.workflow !== undefined) return wider;
    }
  }
  // No document: the stream is the run's only copy, and its ends answer the row.
  return readStreamRowMetadata(trajectoryStreamPath(trajectoryFile)) ?? {};
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
          const row = readRunRowMetadata(join(runsRoot, id, "trajectory.json"));
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

export function logsCommand(
  args: readonly string[] = process.argv.slice(2),
  deps: LogsDeps = {},
): Effect.Effect<void, CliError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const options = yield* parseLogsArgs(args, deps);
    if (options.checkRun !== undefined) {
      yield* printStaticObservability(options.runsRoot, options.checkRun);
      return;
    }
    const picker = deps.pickRun ?? pickRun;
    const run = yield* picker(options.runsRoot, options.trace);
    if (run === undefined) return;
    yield* printLog(options.runsRoot, run, options.trace);
  });
}
