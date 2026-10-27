/**
 * `piano install-plugin` — install Piano's Claude Code mod into the user's
 * existing Claude home.
 *
 * The mod registers a native `piano_run` tool and streams progress into the
 * main transcript. It needs the mod API introduced in Claude Code 2.1.311, so
 * a build below that floor is skipped and the MCP server remains the fallback.
 * With `--native`, the tool is enabled through the plugin's own userConfig;
 * without it the plugin loads inert and only the MCP server serves Piano.
 */
import { io } from "@piano/base";
import { Effect } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliArgumentError, SkillInstallError } from "./errors.js";
import { programName } from "./program-name.js";

const MIN_CLAUDE_VERSION = [2, 1, 311] as const;
const PLUGIN_DIR = fileURLToPath(new URL("../assets/piano-plugin", import.meta.url));

const usage = `usage: ${programName()} install-plugin [--native] [--dry-run]`;

function parseArgs(args: readonly string[]): Effect.Effect<
  { readonly native: boolean; readonly dryRun: boolean },
  CliArgumentError
> {
  let native = false;
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--native") native = true;
    else if (arg === "--dry-run") dryRun = true;
    else return Effect.fail(new CliArgumentError({ message: `unknown option: ${arg}\n${usage}` }));
  }
  return Effect.succeed({ native, dryRun });
}

function report(line: string): Effect.Effect<void> {
  return Effect.sync(() => console.log(line));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const failed = (cause: unknown): SkillInstallError => new SkillInstallError({
  operation: "install-plugin",
  path: join(PLUGIN_DIR, ".claude-plugin", "plugin.json"),
  message: cause instanceof Error ? cause.message : String(cause),
});

function claudeHome(): string {
  const value = process.env.CLAUDE_CONFIG_DIR?.trim();
  return value === undefined || value === "" ? join(homedir(), ".claude") : value;
}

/** The running Claude Code's version as three integers, or undefined when the
 * CLI is missing or prints something unparsable. */
function claudeVersion(): Effect.Effect<readonly number[] | undefined> {
  return io.execFileResult("claude", ["--version"], { timeoutMs: 15_000 }).pipe(
    Effect.map((result) => {
      const match = /(\d+)\.(\d+)\.(\d+)/.exec(result.stdout);
      return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
    }),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );
}

function belowFloor(version: readonly number[]): boolean {
  for (let index = 0; index < MIN_CLAUDE_VERSION.length; index++) {
    const floor = MIN_CLAUDE_VERSION[index] ?? 0;
    const value = version[index] ?? 0;
    if (value !== floor) return value < floor;
  }
  return false;
}

export function installPluginCommand(args: readonly string[]): Effect.Effect<void, CliArgumentError | SkillInstallError> {
  return Effect.gen(function* () {
    const options = yield* parseArgs(args);
    const home = claudeHome();
    if (!(yield* io.exists(home))) {
      yield* report(`[WARN] claude: skipped (home not found: ${home})`);
      return;
    }

    const version = yield* claudeVersion();
    if (version === undefined) {
      yield* report("[WARN] claude: skipped (claude CLI not found)");
      return;
    }
    if (belowFloor(version)) {
      yield* report(
        `[WARN] claude: skipped (Claude Code ${version.join(".")} is below the mod API floor ${MIN_CLAUDE_VERSION.join(".")}); use 'piano install-mcp'`,
      );
      return;
    }

    const installed = yield* io.execFileResult("claude", ["plugin", "list", "--json"], { timeoutMs: 30_000 }).pipe(
      Effect.map((result) => {
        try {
          const plugins: unknown = JSON.parse(result.stdout);
          return Array.isArray(plugins) && plugins.some((plugin) =>
            isRecord(plugin) && plugin["id"] === "piano@piano-local");
        } catch {
          return false;
        }
      }),
      Effect.catchAll(() => Effect.succeed(false)),
    )
    if (installed) {
      yield* report("[PASS] claude: piano plugin already installed");
    } else {
      const install = ["plugin", "install", "piano", "--marketplace", PLUGIN_DIR, "--scope", "user", "--json"];
      if (options.dryRun) {
        yield* report(`[INFO] claude: would run claude ${install.join(" ")}`);
        if (options.native) yield* report("[INFO] claude: would set PIANO_CLAUDE_NATIVE=1");
        return;
      }
      const added = yield* io.execFile("claude", install, { timeoutMs: 120_000 }).pipe(
        Effect.mapError(failed),
      );
      if (added.code !== 0) {
        return yield* Effect.fail(failed(new Error(added.stderr.trim() || "claude plugin install failed")));
      }
      yield* report("[PASS] claude: installed the piano plugin");
    }
    if (options.native) yield* configureNative();
    else yield* report("[INFO] claude: plugin is inert; run with --native to register piano_run");
  });
}

/** Turn on the plugin's native tool. `--native` is the user's explicit opt-in,
 * so the plugin's own userConfig now carries it; the host reads that config at
 * plugin load, before the session starts. */
function configureNative(): Effect.Effect<void, SkillInstallError> {
  const values = JSON.stringify({ PIANO_CLAUDE_NATIVE: "1" });
  // The host only reads config values from stdin, and the shell pipeline is the
  // one path io offers for that.
  const command = `printf '%s' '${values.replace(/'/g, "'\\''")}' | claude plugin configure piano@piano-local --values-stdin`;
  return io.runShell(command, process.cwd(), 30_000).pipe(
    Effect.mapError((cause) => failed(cause)),
    Effect.flatMap((result) => result.code === 0
      ? report("[PASS] claude: enabled the native piano_run tool; restart Claude Code")
      : Effect.fail(failed(new Error(result.stderr.trim() || "claude plugin configure failed")))),
  );
}