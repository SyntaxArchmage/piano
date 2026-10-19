/**
 * `piano logs [<run-id>]` — locate a run, then get out of the way.
 *
 * The command's whole job is to answer "where is that run on disk": it picks
 * a run when no id is given and prints the run directory's absolute path on
 * stdout. Reading the evidence is the operator's job — an editor, `jq`, `less`
 * or any other tool they already use.
 */

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { stdin, stdout } from "node:process";
import { existsSync, readFileSync } from "node:fs";
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
import { defaultRunsRoot } from "@piano/logging";
import { parseRunStatus, runStatusPath } from "@piano/orchestrator";
import { CliArgumentError, interactiveTerminalRequired, LogsStorageError, TuiError, type CliError } from "./errors.js";
import { programName } from "./program-name.js";
import { listRunIds } from "./runs.js";
import { formatRunId, oneLine, summarizeRun } from "./session-resume.js";
import { RST } from "./theme.js";

const usage = `usage: ${programName()} logs [<run-id>]`;
const COLORS = {
  accent: "\x1b[38;2;192;57;43m",
  blue: "\x1b[38;2;129;162;190m",
  dim: "\x1b[38;2;150;150;150m",
  bold: "\x1b[1m",
} as const;

const paint = (style: string, value: string): string => `${style}${value}${RST}`;

interface LogsOptions {
  runsRoot: string;
  run?: string;
}

export interface LogsDeps {
  runsRoot?: string;
  pickRun?: (runsRoot: string) => Effect.Effect<string | undefined, CliError, FileSystem.FileSystem>;
}

function parseLogsArgs(
  args: readonly string[],
  deps: LogsDeps,
): Effect.Effect<LogsOptions, CliArgumentError> {
  const positionals: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("-")) {
      return Effect.fail(new CliArgumentError({ message: `unknown option: ${arg}\n${usage}` }));
    }
    positionals.push(arg);
  }
  if (positionals.length > 1) {
    return Effect.fail(new CliArgumentError({ message: `logs accepts at most one run id\n${usage}` }));
  }
  return Effect.succeed({
    runsRoot: deps.runsRoot ?? defaultRunsRoot(),
    ...(positionals[0] === undefined ? {} : { run: positionals[0] }),
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

/** Resolve a run id to its existing directory, refusing any path that would
 * escape the runs root. */
function resolveRunDir(
  runsRoot: string,
  run: string,
): Effect.Effect<string, LogsStorageError> {
  const resolvedRunsRoot = resolve(runsRoot);
  const runDir = resolve(resolvedRunsRoot, run);
  if (dirname(runDir) !== resolvedRunsRoot) {
    return Effect.fail(new LogsStorageError({
      operation: "logs",
      path: runDir,
      message: "run id must name a direct child of the runs root",
    }));
  }
  if (!existsSync(runDir)) {
    return Effect.fail(new LogsStorageError({
      operation: "logs",
      path: runDir,
      message: `no run directory ${runDir}`,
    }));
  }
  return Effect.succeed(runDir);
}

interface RunRowMetadata {
  readonly workflow?: string;
  readonly status?: string;
  readonly prompt?: string;
}

/** The row the run's state document carries: the workflow it ran, how it
 * ended, and the first prompt it was given. The interpretation is the resume
 * picker's `summarizeRun`, so both pickers read one document one way. */
function readStatusRow(runDir: string): RunRowMetadata | undefined {
  let raw: string;
  try {
    raw = readFileSync(runStatusPath(runDir), "utf8");
  } catch {
    return undefined;
  }
  const status = parseRunStatus(raw);
  if (status === undefined) return undefined;
  const { workflow, status: runState, prompt } = summarizeRun(basename(runDir), status);
  return {
    ...(workflow === undefined ? {} : { workflow }),
    ...(runState === undefined ? {} : { status: runState }),
    ...(prompt === undefined ? {} : { prompt }),
  };
}

/** Exported for testing; the picker calls it once per listed run. */
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
): Effect.Effect<string | undefined, TuiError | LogsStorageError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const runs = yield* listRunIds(runsRoot);
    if (runs.length === 0) {
      yield* Effect.fail(new LogsStorageError({
        operation: "list-runs",
        path: runsRoot,
        message: `no runs found under ${runsRoot}`,
      }));
    }
    if (!stdin.isTTY || !stdout.isTTY) {
      yield* Effect.fail(interactiveTerminalRequired());
    }
    const items = runs.map((id) => ({
      value: id,
      label: runPickerLabel(id, readRunRowMetadata(join(runsRoot, id))),
    }));
    const selected = yield* Effect.try({
      try: () => {
        setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
        const tui = new TUI(new ProcessTerminal());
        const list = new SelectList(items, 10, selectTheme());
        tui.addChild(new Text(paint(`${COLORS.bold}${COLORS.blue}`, "Select a run:"), 0, 0));
        tui.addChild(new Text(paint(COLORS.dim, `${items.length} runs · ↑/↓ move · Enter select · Esc cancel`), 0, 0));
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

export function logsCommand(
  args: readonly string[] = process.argv.slice(2),
  deps: LogsDeps = {},
): Effect.Effect<void, CliError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const options = yield* parseLogsArgs(args, deps);
    const run = options.run ?? (yield* (deps.pickRun ?? pickRun)(options.runsRoot));
    if (run === undefined) return;
    const runDir = yield* resolveRunDir(options.runsRoot, run);
    yield* Effect.sync(() => console.log(runDir));
  });
}
