/**
 * Where a coding agent keeps its user-level configuration, and whether that
 * place is usable. The three install commands resolve the same homes, so the
 * env-var-or-default rule and the "is it a directory" check live here once.
 */
import { io } from "@piano/base";
import { Effect } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";

export type AgentName = "claude" | "codex" | "dsh";

/** The env var that overrides the home, and the default under `$HOME`. */
const HOMES: Record<AgentName, { readonly env: string; readonly directory: string }> = {
  claude: { env: "CLAUDE_CONFIG_DIR", directory: ".claude" },
  codex: { env: "CODEX_HOME", directory: ".codex" },
  dsh: { env: "DSH_HOME", directory: ".dsh" },
};

export function agentHome(name: AgentName): string {
  const { env, directory } = HOMES[name];
  const value = process.env[env]?.trim();
  return value === undefined || value === "" ? join(homedir(), directory) : value;
}

/** Why a home cannot be written to, or undefined when it can. A home that is a
 * file or a symlink is not a directory the installers may add skills under. */
export function unusableHome(home: string): Effect.Effect<"missing" | "not-directory" | undefined> {
  return io.stat(home).pipe(
    Effect.map((stats) => (stats.isDirectory() ? undefined : "not-directory")),
    Effect.catchAll(() => Effect.succeed<"missing">("missing")),
  );
}
