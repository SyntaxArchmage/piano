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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentHome, unusableHome } from "./agent-home.js";
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

/** The running Claude Code's version as three integers, or why it could not be
 * read: the CLI is missing, it hung, or its output is not a version. */
type ClaudeVersion =
  | { readonly kind: "version"; readonly value: readonly number[] }
  | { readonly kind: "missing" | "hung" | "unreadable" };

function claudeVersion(): Effect.Effect<ClaudeVersion> {
  return io.execFileResult("claude", ["--version"], { timeoutMs: 15_000 }).pipe(
    Effect.map((result): ClaudeVersion => {
      if (result.code === io.NOT_STARTED) return { kind: "missing" };
      if (result.code === io.TIMED_OUT) return { kind: "hung" };
      const match = /(\d+)\.(\d+)\.(\d+)/.exec(result.stdout);
      return match === null
        ? { kind: "unreadable" }
        : { kind: "version", value: [Number(match[1]), Number(match[2]), Number(match[3])] };
    }),
    Effect.catchAll(() => Effect.succeed<ClaudeVersion>({ kind: "missing" })),
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
    const home = agentHome("claude");
    const unusable = yield* unusableHome(home);
    if (unusable !== undefined) {
      yield* report(`[WARN] claude: skipped (${unusable === "missing" ? "home not found" : "home is not a directory"}: ${home})`);
      return;
    }

    const version = yield* claudeVersion();
    if (version.kind !== "version") {
      if (version.kind === "hung") {
        return yield* Effect.fail(failed(new Error("claude --version did not answer within 15s")));
      }
      if (version.kind === "unreadable") {
        return yield* Effect.fail(failed(new Error("claude --version did not print a version")));
      }
      yield* report("[WARN] claude: skipped (claude CLI not found)");
      return;
    }
    if (belowFloor(version.value)) {
      yield* report(
        `[WARN] claude: skipped (Claude Code ${version.value.join(".")} is below the mod API floor ${MIN_CLAUDE_VERSION.join(".")}); use 'piano install-mcp'`,
      );
      return;
    }

    const listing = yield* io.execFileResult("claude", ["plugin", "list", "--json"], {
      timeoutMs: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    }).pipe(
      Effect.map((result) => {
        try {
          const plugins: unknown = JSON.parse(result.stdout);
          if (!Array.isArray(plugins)) return { read: false, installed: false };
          const entry = plugins.find((plugin) => isRecord(plugin) && plugin["id"] === "piano@piano-local");
          return { read: true, installed: entry !== undefined };
        } catch {
          return { read: false, installed: false };
        }
      }),
      Effect.catchAll(() => Effect.succeed({ read: false, installed: false })),
    )
    if (!listing.read) {
      // An unreadable listing is not "not installed": that would reinstall over
      // a plugin whose config a person may have changed.
      return yield* Effect.fail(failed(new Error("claude plugin list did not return a machine-readable list")));
    }
    const installed = listing.installed;
    if (installed) yield* report("[PASS] claude: piano plugin already installed");
    if (installed && !options.native) {
      // The plugin may already carry the setting from an earlier run; this
      // command was simply not asked to change it.
      yield* report("[INFO] claude: --native not requested; the plugin's current config is unchanged. Run with --native to register piano_run.");
      return;
    }
    // `--config` applies the userConfig in the same call, and re-running it on
    // an installed plugin is how the setting is turned on later. Both paths are
    // the same command, so dry-run has one gate instead of one per branch.
    const install = [
      "plugin", "install", "piano", "--marketplace", PLUGIN_DIR, "--scope", "user", "--json",
      ...(options.native ? ["--config", "PIANO_CLAUDE_NATIVE=1"] : []),
    ];
    if (options.dryRun) {
      yield* report(`[INFO] claude: would run claude ${install.join(" ")}`);
      return;
    }
    const added = yield* io.execFile("claude", install, { timeoutMs: 120_000 }).pipe(
      Effect.mapError(failed),
    );
    if (added.code !== 0) {
      return yield* Effect.fail(failed(new Error(added.stderr.trim() || "claude plugin install failed")));
    }
    if (!installed) yield* report("[PASS] claude: installed the piano plugin");
    if (options.native) yield* report("[PASS] claude: enabled the native piano_run tool; restart Claude Code");
  });
}
