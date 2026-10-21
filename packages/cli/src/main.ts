import { NodeFileSystem, NodeRuntime } from "@effect/platform-node";
import { Cause, Effect } from "effect";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { stderr } from "node:process";
import {
  createStagingSession,
  type LoggingError,
} from "@piano/logging";
import type { HarnessHomeError } from "@piano/harness";
import type { WorkflowExecutionError } from "@piano/orchestrator";
import { logsCommand } from "./logs.js";
import { evalsCommand } from "./evals.js";
import { resumeCommand } from "./resume.js";
import { clearAllCommand } from "./clear.js";
import { doctorCommand } from "./doctor.js";
import { ensureSystemCaTrust } from "./ca-certs.js";
import { CliArgumentError, type CliError } from "./errors.js";
import { programName } from "./program-name.js";
import { runSession } from "./session-run.js";

export type MainError = CliError | LoggingError | WorkflowExecutionError | HarnessHomeError;

interface MainOptions {
  readonly workflowPath?: string;
  readonly prompt?: string;
  readonly json?: boolean;
  /** Task namespace for lane branches; skips the preflight summary. */
  readonly mnemonic?: string;
}

function parseMainArgs(args: readonly string[]): Effect.Effect<MainOptions, CliArgumentError> {
  const usage = `usage: ${programName()} [--workflow <path>] [--mnemonic <name>] [-p] [--prompt <text>] [--json] [<prompt>]`;
  let workflowPath: string | undefined;
  let mnemonic: string | undefined;
  let prompt: string | undefined;
  let json = false;
  let headless = false;
  const positional: string[] = [];
  let positionalOnly = false;
  /** The value of a `--flag <value>` pair, or undefined when it is missing or
   * looks like the next flag. */
  const takeValue = (index: number): string | undefined => {
    const value = args[index + 1];
    return value === undefined || value === "" || value.startsWith("-") ? undefined : value;
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) return Effect.fail(new CliArgumentError({ message: usage }));
    if (!positionalOnly && arg === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && arg === "--workflow") {
      const value = takeValue(index);
      if (value === undefined) return Effect.fail(new CliArgumentError({ message: usage }));
      workflowPath = value;
      index += 1;
      continue;
    }
    if (!positionalOnly && arg === "--mnemonic") {
      const value = takeValue(index);
      if (value === undefined) return Effect.fail(new CliArgumentError({ message: usage }));
      mnemonic = value;
      index += 1;
      continue;
    }
    if (!positionalOnly && arg === "-p") {
      if (headless) return Effect.fail(new CliArgumentError({ message: usage }));
      headless = true;
      continue;
    }
    if (!positionalOnly && arg === "--prompt") {
      const value = takeValue(index);
      if (value === undefined) return Effect.fail(new CliArgumentError({ message: usage }));
      prompt = value;
      index += 1;
      continue;
    }
    if (!positionalOnly && arg === "--json") {
      json = true;
      continue;
    }
    if (!positionalOnly && arg.startsWith("-")) return Effect.fail(new CliArgumentError({ message: usage }));
    positional.push(arg);
  }
  if (positional.length > 1 || (positional.length === 1 && prompt !== undefined)) {
    return Effect.fail(new CliArgumentError({ message: usage }));
  }
  if (positional.length === 1 && !headless) {
    return Effect.fail(new CliArgumentError({ message: usage }));
  }
  if (prompt === undefined) prompt = positional[0];
  if (headless && prompt === undefined) {
    return Effect.fail(new CliArgumentError({ message: usage }));
  }
  if ((workflowPath === undefined && prompt === undefined && args.length !== 0)) {
    return Effect.fail(new CliArgumentError({ message: usage }));
  }
  if (json && prompt === undefined) {
    return Effect.fail(new CliArgumentError({ message: `${usage}\n--json requires -p/--prompt` }));
  }
  return Effect.succeed({
    ...(workflowPath === undefined ? {} : { workflowPath }),
    ...(mnemonic === undefined ? {} : { mnemonic }),
    ...(prompt === undefined ? {} : { prompt }),
    ...(json ? { json: true } : {}),
  });
}

/** Start the CLI as a typed Effect program. */
export function main(
  args: readonly string[] = process.argv.slice(2),
): Effect.Effect<void, MainError, import("@effect/platform").FileSystem.FileSystem> {
  if (args[0] === "logs") return logsCommand(args.slice(1));
  if (args[0] === "evals") return evalsCommand(args.slice(1));
  if (args[0] === "resume") return resumeCommand(args.slice(1));
  if (args[0] === "clear-all") return clearAllCommand(args.slice(1));
  if (args[0] === "doctor") return doctorCommand(args.slice(1));
  return parseMainArgs(args).pipe(Effect.flatMap((options) => Effect.gen(function* () {
    // A staging session writes nothing until the first prompt is submitted, so
    // opening Piano and leaving again — including via `/resume`, which hands the
    // TUI over to an existing run — never strands an empty run directory in
    // the picker. Headless prompts always commit, as they always did.
    const session = createStagingSession({ cwd: process.cwd() });
    return yield* runSession(session, options);
  })));
}

export function runCli(args: readonly string[] = process.argv.slice(2)): void {
  ensureSystemCaTrust();
  NodeRuntime.runMain(
    main(args).pipe(
      Effect.provide(NodeFileSystem.layer),
      Effect.tapErrorCause((cause) =>
        Effect.sync(() => stderr.write(`${Cause.pretty(cause)}\n`)),
      ),
    ),
    { disableErrorReporting: true },
  );
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runCli();
}
