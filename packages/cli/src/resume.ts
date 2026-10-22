// `piano resume` — the CLI entry to the same takeover `/resume` performs inside
// the TUI. This file only resolves *which* run to resume; the resume itself is
// one path, owned by `session-run.ts` and driven by the TUI, so both entries
// replay the same chat and continue the same worker sessions.
//
//   piano resume            open the session picker in the TUI
//   piano resume <run-id>   take that run over directly, skipping the picker
//   piano resume --list     print run ids, newest first
//
// No stdout recap: the resumed conversation is replayed into the chat, which is
// where the user reads it.

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { stdout } from "node:process";
import { join } from "node:path";
import { defaultRunsRoot, createSession, createStagingSession } from "@piano/logging";
import { CliArgumentError, LogsStorageError, type CliError } from "./errors.js";
import { listRunIds } from "./runs.js";
import { programName } from "./program-name.js";
import { runSession, type SessionRunError } from "./session-run.js";

const usage = `usage: ${programName()} resume [<run-id>] [--list]`;

interface ResumeOptions {
  runsRoot: string;
  runId?: string;
  list: boolean;
}

interface ResumeDeps {
  runsRoot?: string;
}

function parseResumeArgs(
  args: readonly string[],
  deps: ResumeDeps,
): Effect.Effect<ResumeOptions, CliArgumentError> {
  let runId: string | undefined;
  let list = false;
  for (const arg of args) {
    if (arg === "--list") list = true;
    else if (arg.startsWith("-")) return Effect.fail(new CliArgumentError({ message: `unknown option: ${arg}\n${usage}` }));
    else if (runId === undefined) runId = arg;
    else return Effect.fail(new CliArgumentError({ message: usage }));
  }
  if (runId !== undefined && list) return Effect.fail(new CliArgumentError({ message: usage }));
  return Effect.succeed({ runsRoot: deps.runsRoot ?? defaultRunsRoot(), runId, list });
}

/** Reject an unknown run id before opening a session on it: `createSession`
 * creates the run directory it is given, so a typo would otherwise leave an
 * empty run behind and fail later with a less specific message. */
function requireRun(
  runsRoot: string,
  runId: string,
): Effect.Effect<void, LogsStorageError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = join(runsRoot, runId);
    const exists = yield* fileSystem.exists(path).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return yield* Effect.fail(new LogsStorageError({
        operation: "list-runs",
        path,
        message: `no run "${runId}" under ${runsRoot}`,
      }));
    }
  });
}

/** `piano resume [<run-id>]` — open the TUI on the resume path: directly on a
 * named run, or on the picker when none was named. */
export function resumeCommand(
  args: readonly string[] = process.argv.slice(2),
  deps: ResumeDeps = {},
): Effect.Effect<void, CliError | SessionRunError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const options = yield* parseResumeArgs(args, deps);
    if (options.list) {
      const ids = yield* listRunIds(options.runsRoot);
      for (const id of ids) stdout.write(`${id}\n`);
      return;
    }
    if (options.runId === undefined) {
      // No run named: open a staging session and the picker over it. Cancelling
      // the picker leaves nothing on disk — a run directory (and its id) is
      // allocated only when the first prompt is actually submitted.
      const session = createStagingSession({ cwd: process.cwd(), runsRoot: options.runsRoot });
      return yield* runSession(session, { resumePicker: true });
    }
    yield* requireRun(options.runsRoot, options.runId);
    // Open the session on the target run so the takeover reuses it instead of
    // stranding a second, empty run directory.
    const session = yield* createSession({
      cwd: process.cwd(),
      runsRoot: options.runsRoot,
      id: options.runId,
    });
    yield* runSession(session, { resumeRunId: options.runId });
  });
}
