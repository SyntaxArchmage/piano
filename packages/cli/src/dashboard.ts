/**
 * `piano dashboard` — start (or locate) the read-only run dashboard and print
 * its URL. The same server is what a workflow with `monitor: true` starts in
 * the background; this command is the manual way to start it, to get the URL
 * again, or to stop it.
 */

import { Effect } from "effect";
import { stdout } from "node:process";
import { ensureDashboard, stopDashboard } from "@piano/dashboard";
import { CliArgumentError } from "./errors.js";
import { programName } from "./program-name.js";

const usage = `usage: ${programName()} dashboard [--run <run-id>] [--host <addr>] [--port <n>] [--json] [--stop]`;

interface DashboardOptions {
  readonly runId?: string;
  readonly host?: string;
  readonly port?: number;
  readonly json: boolean;
  readonly stop: boolean;
}

function parseArgs(args: readonly string[]): Effect.Effect<DashboardOptions, CliArgumentError> {
  let runId: string | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let json = false;
  let stop = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--stop") {
      stop = true;
      continue;
    }
    if (arg === "--run" || arg === "--host" || arg === "--port") {
      const value = args[index + 1];
      if (value === undefined || value === "" || value.startsWith("-")) {
        return Effect.fail(new CliArgumentError({ message: usage }));
      }
      if (arg === "--run") runId = value;
      else if (arg === "--host") host = value;
      else {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
          return Effect.fail(new CliArgumentError({ message: `${usage}\n--port must be an integer between 0 and 65535` }));
        }
        port = parsed;
      }
      index += 1;
      continue;
    }
    return Effect.fail(new CliArgumentError({ message: usage }));
  }
  return Effect.succeed({
    ...(runId === undefined ? {} : { runId }),
    ...(host === undefined ? {} : { host }),
    ...(port === undefined ? {} : { port }),
    json,
    stop,
  });
}

export function dashboardCommand(args: readonly string[]): Effect.Effect<void, CliArgumentError> {
  return parseArgs(args).pipe(Effect.flatMap((options) => Effect.gen(function* () {
    if (options.stop) {
      const stopped = stopDashboard();
      stdout.write(stopped ? "Piano dashboard stopped.\n" : "No running Piano dashboard found.\n");
      return;
    }
    const handle = yield* Effect.tryPromise({
      try: () => ensureDashboard({
        ...(options.runId === undefined ? {} : { runId: options.runId }),
        ...(options.host === undefined ? {} : { host: options.host }),
        ...(options.port === undefined ? {} : { port: options.port }),
      }),
      catch: (cause) => new CliArgumentError({
        message: `dashboard could not start: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
    });
    if (handle === undefined) {
      return yield* Effect.fail(new CliArgumentError({
        message: "dashboard could not start (monitoring may be disabled by PIANO_DASHBOARD_DISABLE, or the server script is missing)",
      }));
    }
    if (options.json) {
      stdout.write(`${JSON.stringify(handle)}\n`);
      return;
    }
    stdout.write(`Piano dashboard: ${handle.url}\n`);
    stdout.write(handle.reused ? "(server was already running)\n" : "(server started in the background)\n");
  })));
}
