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
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
import { readRunStatus } from "@piano/orchestrator";
import { CliArgumentError, interactiveTerminalRequired, LogsStorageError, TuiError, type CliError } from "./errors.js";
import { programName } from "./program-name.js";
import { listRunIds } from "./runs.js";
import { formatRunId, oneLine, summarizeRun, type RunSummary } from "./session-resume.js";
import { darkTheme, RST } from "./theme.js";

const usage = `usage: ${programName()} logs [<run-id>]`;
const COLORS = {
  accent: darkTheme.accent,
  blue: darkTheme.mdLink,
  dim: darkTheme.dim,
  bold: darkTheme.bold,
} as const;

const paint = (style: string, value: string): string => `${style}${value}${RST}`;

interface LogsDeps {
  runsRoot?: string;
  pickRun?: (runsRoot: string) => Effect.Effect<string | undefined, CliError, FileSystem.FileSystem>;
}

function parseLogsArgs(
  args: readonly string[],
): Effect.Effect<string | undefined, CliArgumentError> {
  const flag = args.find((arg) => arg.startsWith("-"));
  if (flag !== undefined) {
    return Effect.fail(new CliArgumentError({ message: `unknown option: ${flag}\n${usage}` }));
  }
  if (args.length > 1) {
    return Effect.fail(new CliArgumentError({ message: `logs accepts at most one run id\n${usage}` }));
  }
  return Effect.succeed(args[0]);
}

const SELECT_THEME: SelectListTheme = {
  selectedPrefix: (value) => paint(`${COLORS.bold}${COLORS.accent}`, value),
  selectedText: (value) => paint(COLORS.bold, value),
  description: (value) => paint(COLORS.dim, value),
  scrollInfo: (value) => paint(COLORS.dim, value),
  noMatch: (value) => paint(COLORS.dim, value),
};

/** Resolve a run id to its existing directory, refusing any path that would
 * escape the runs root. */
function resolveRunDir(
  runsRoot: string,
  run: string,
): Effect.Effect<string, LogsStorageError> {
  const resolvedRunsRoot = resolve(runsRoot);
  const runDir = resolve(resolvedRunsRoot, run);
  const fail = (message: string) => Effect.fail(new LogsStorageError({ operation: "logs", path: runDir, message }));
  if (dirname(runDir) !== resolvedRunsRoot) {
    return fail("run id must name a direct child of the runs root");
  }
  if (!existsSync(runDir)) {
    return fail(`no run directory ${runDir}`);
  }
  return Effect.succeed(runDir);
}

/** One picker label: `2026-09-03 01:07 · gpu-cuda-tuning · [failed] · <prompt
 * snippet>`. Fields a run does not carry are omitted, so legacy runs stay id+time. */
export function runPickerLabel(runId: string, row: RunSummary): string {
  return [
    formatRunId(runId),
    row.workflow,
    row.status === undefined || row.status === "completed" ? undefined : `[${row.status}]`,
    row.prompt === undefined ? undefined : oneLine(row.prompt, 60),
  ].filter(Boolean).join(" · ");
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
    const items = yield* Effect.forEach(runs, (id) =>
      readRunStatus(join(runsRoot, id)).pipe(
        Effect.catchAll(() => Effect.succeed(undefined)),
        Effect.map((status) => ({ value: id, label: runPickerLabel(id, summarizeRun(id, status)) })),
      ), { concurrency: 8 });
    const selected = yield* Effect.try({
      try: () => {
        setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS));
        const tui = new TUI(new ProcessTerminal());
        const list = new SelectList(items, 10, SELECT_THEME);
        tui.addChild(new Text(paint(`${COLORS.bold}${COLORS.blue}`, "Select a run:"), 0, 0));
        tui.addChild(new Text(paint(COLORS.dim, `${items.length} runs · ↑/↓ move · Enter select · Esc cancel`), 0, 0));
        tui.addChild(list);
        tui.setFocus(list);
        return { tui, list };
      },
      catch: (cause) => new TuiError({ operation: "create", message: String(cause) }),
    });
    const item = yield* Effect.async<SelectItem | null, TuiError>((resume) => {
      selected.list.onSelect = (item) => resume(Effect.succeed(item));
      selected.list.onCancel = () => resume(Effect.succeed(null));
      selected.tui.start();
    }).pipe(Effect.ensuring(Effect.sync(() => selected.tui.stop())));
    return item?.value;
  });
}

export function logsCommand(
  args: readonly string[] = process.argv.slice(2),
  deps: LogsDeps = {},
): Effect.Effect<void, CliError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const runsRoot = deps.runsRoot ?? defaultRunsRoot();
    const run = (yield* parseLogsArgs(args)) ?? (yield* (deps.pickRun ?? pickRun)(runsRoot));
    if (run === undefined) return;
    const runDir = yield* resolveRunDir(runsRoot, run);
    yield* Effect.sync(() => console.log(runDir));
  });
}
