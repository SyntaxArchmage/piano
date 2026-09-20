// `piano clear-all` — remove run directories older than a time window (recorded
// by the run id's own `yyyyMMddTHHmmss` timestamp prefix, which is stable
// regardless of mtime touches), not the whole `~/.piano` tree. A development
// utility for reaping stale on-disk run state; TTY mode asks for confirmation,
// non-interactive use requires `--force`.

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { stdin, stdout } from "node:process";
import { join } from "node:path";
import { defaultRunsRoot } from "@piano/logging";
import { CliArgumentError, LogsStorageError, TuiError, type CliError } from "./errors.js";
import { listRunIds } from "./runs.js";
import { programName } from "./program-name.js";

const usage = `usage: ${programName()} clear-all [--days <n>] [--hours <n>] [--force]`;

interface ClearOptions {
  runsRoot: string;
  /** Cutoff age in milliseconds before which a run is eligible for removal. */
  cutoffMillis: number;
  force: boolean;
}

export interface ClearDeps {
  runsRoot?: string;
}

function parseClearArgs(
  args: readonly string[],
  deps: ClearDeps,
): Effect.Effect<ClearOptions, CliArgumentError> {
  let days: number | undefined;
  let hours: number | undefined;
  let force = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--days" || arg === "--hours") {
      const raw = args[index + 1];
      const value = raw === undefined ? NaN : Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        return Effect.fail(new CliArgumentError({ message: `expected a non-negative number after ${arg}\n${usage}` }));
      }
      if (arg === "--days") days = value;
      else hours = value;
      index += 1;
      continue;
    }
    return Effect.fail(new CliArgumentError({ message: `unknown option: ${arg}\n${usage}` }));
  }
  if (days !== undefined && hours !== undefined) {
    return Effect.fail(new CliArgumentError({ message: "specify --days or --hours, not both\n" + usage }));
  }
  const hourMillis = 60 * 60 * 1000;
  const cutoffMillis = days !== undefined
    ? days * 24 * hourMillis
    : hours !== undefined
      ? hours * hourMillis
      : 7 * 24 * hourMillis; // default: 7 days
  return Effect.succeed({ runsRoot: deps.runsRoot ?? defaultRunsRoot(), cutoffMillis, force });
}

// Parse the run id's leading timestamp: `yyyyMMddTHHmmss-<random>`. The "-"
// random suffix is intentionally ignored. Session ids use an ISO UTC prefix,
// so parse that prefix as UTC; an unparseable timestamp falls back to Infinity
// so we never accidentally reap a run we cannot age.
const RUN_ID_TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})-/;

function runIdTimestampMillis(runId: string): number {
  const match = RUN_ID_TIME_RE.exec(runId);
  if (match === null) return Number.POSITIVE_INFINITY;
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN, hour = Number.NaN, minute = Number.NaN, second = Number.NaN] = match.slice(1).map((value) => Number(value));
  const timestamp = Date.UTC(
    year, month - 1, day,
    hour, minute, second,
  );
  if (Number.isNaN(timestamp)) return Number.POSITIVE_INFINITY;
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second
    ? timestamp
    : Number.POSITIVE_INFINITY;
}

/** Ask y/N on a raw TTY; resolves true only for an explicit "y". */
function promptConfirmation(message: string): Effect.Effect<boolean, never> {
  if (!stdin.isTTY || !stdout.isTTY) return Effect.succeed(false);
  return Effect.async<boolean, never>((resume) => {
    stdout.write(message);
    stdin.setRawMode(true);
    stdin.resume();
    const cleanup = (): void => {
      stdin.pause();
      try { stdin.setRawMode(false); } catch { /* not a TTY */ }
      stdin.off("data", onData);
    };
    const onData = (chunk: Buffer): void => {
      const char = chunk.toString("utf8");
      if (char === "\r" || char === "\n") {
        cleanup();
        stdout.write("\n");
        resume(Effect.succeed(false));
        return;
      }
      if (char.toLowerCase() === "y") {
        cleanup();
        stdout.write("\n");
        resume(Effect.succeed(true));
      } else if (char.toLowerCase() === "n") {
        cleanup();
        stdout.write("\n");
        resume(Effect.succeed(false));
      }
    };
    stdin.on("data", onData);
    return Effect.sync(cleanup);
  });
}

/** `piano clear-all [--days <n>|--hours <n>] [--force]` — reap runs older than the
 * window. Refuses non-interactive deletion without `--force`. */
export function clearAllCommand(
  args: readonly string[] = process.argv.slice(2),
  deps: ClearDeps = {},
): Effect.Effect<void, CliError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const options = yield* parseClearArgs(args, deps);
    const fileSystem = yield* FileSystem.FileSystem;
    const ids = yield* listRunIds(options.runsRoot);
    const before = Date.now() - options.cutoffMillis;
    const stale = ids.filter((id) => runIdTimestampMillis(id) < before);
    if (stale.length === 0) {
      stdout.write("clear-all: no stale runs to remove\n");
      return;
    }
    if (!options.force) {
      if (!stdin.isTTY || !stdout.isTTY) {
        return yield* Effect.fail(new TuiError({
          operation: "confirm",
          message: "clear-all refuses non-interactive deletion without --force",
        }));
      }
      const confirmed = yield* promptConfirmation(
        `This removes ${stale.length} run(s) older than the cutoff:\n` +
        stale.map((id) => `  - ${id}`).join("\n") +
        "\nThis cannot be undone. Continue? [y/N] ",
      );
      if (!confirmed) {
        stdout.write("clear-all cancelled\n");
        return;
      }
    }
    yield* Effect.forEach(stale, (id) =>
      fileSystem.remove(join(options.runsRoot, id), { recursive: true }).pipe(
        Effect.mapError((cause) => new LogsStorageError({
          operation: "remove",
          path: join(options.runsRoot, id),
          message: String(cause),
        })),
      ),
    );
    stdout.write(`clear-all: removed ${stale.length} run(s)\n`);
  });
}
