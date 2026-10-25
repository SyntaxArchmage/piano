import { FileSystem } from "@effect/platform";
import { io } from "@piano/base";
import { isUnsafeWorkspaceRelativePath } from "@piano/contract";
import { Effect, Either } from "effect";
import { logger, TRACE, type Logging, type Source } from "@piano/logging";

/** Leaf adapter: one `git` invocation behind one io Effect. Every git effect in
 * this module composes this call, so the external process boundary stays
 * exactly one call wide. A non-zero exit is an `IoError` carrying the child's
 * own stderr, which `gitErrorDetails` reads. */
function runGit(
  cwd: string,
  args: readonly string[],
  options: { readonly maxBuffer?: number } = {},
): Effect.Effect<io.CommandResult, io.IoError> {
  return io.execFile("git", ["-C", cwd, ...args], options.maxBuffer === undefined ? {} : {
    maxBuffer: options.maxBuffer,
  });
}

/** ISSUE-017: orchestrator-owned winner auto-commit. When a workflow opts into
 * `autoCommit`, the loop executor stages and commits each KEEP round's
 * `changed_files` into the caller workspace with a structured winner-commit
 * template (no push). All git work here is strictly additive on explicit
 * paths (`git add -- <file>`), never `git add -A`, so pre-existing user
 * changes and untracked run artifacts are never swept into a winner commit.
 * Commit failures are non-fatal: auto-commit is bookkeeping and must not kill
 * a long tuning run. On failure the staged paths are unstaged again so a
 * failed commit cannot poison later rounds' reverts. */

const WINNER_COMMIT_SOURCE: Source = {
  module: "orchestrator",
  file: "winner-commit.ts",
  function: "commitRoundFiles",
};
const WINNER_COMMIT_LOG = logger(WINNER_COMMIT_SOURCE, { namespace: "workflow" });

/** Porcelain v1 line `XY <path>` — the path begins at column 4. Lines shorter
 * than that carry no path (blank line); `--untracked-files=all` emits each
 * untracked file individually as `?? path`. */
function porcelainPath(line: string): string | undefined {
  return line.length >= 4 ? line.slice(3) : undefined;
}

/** Snapshot the workspace's dirty files (tracked modifications, staged
 * changes, and untracked files) at run start. Auto-commit later subtracts
 * this set from each round's `changed_files` so user / other-task changes are
 * never swept into a winner commit. Never fails:
 * a non-git / unavailable workspace simply yields an empty snapshot and the
 * per-round commit then reports its own warning. */
export function snapshotDirtyFiles(
  cwd: string,
): Effect.Effect<ReadonlySet<string>, never, never> {
  return runGit(cwd, ["status", "--porcelain=v1", "--untracked-files=all"], {
    maxBuffer: 32 * 1024 * 1024,
  }).pipe(
    Effect.map((result) => {
      const dirty = new Set<string>();
      for (const line of result.stdout.split(/\r?\n/u)) {
        const path = porcelainPath(line);
        if (path !== undefined) dirty.add(path);
      }
      return dirty as ReadonlySet<string>;
    }),
    Effect.catchAll(() => Effect.succeed<ReadonlySet<string>>(new Set<string>())),
  );
}

/** Keep only the files auto-commit is allowed to stage: non-empty,
 * workspace-relative, not pre-existing dirty, and deduplicated. */
export function safeChangedFiles(
  files: readonly string[],
  preExistingDirty: ReadonlySet<string>,
): readonly string[] {
  const kept: string[] = [];
  for (const file of files) {
    const trimmed = file.trim();
    if (trimmed === "" || isUnsafeWorkspaceRelativePath(trimmed)) continue;
    if (preExistingDirty.has(trimmed)) continue;
    if (!kept.includes(trimmed)) kept.push(trimmed);
  }
  return kept;
}

/** Extract the open ticket id from a mission prompt, e.g. `TR-21673`. */
const TICKET_PATTERN = /[A-Z]{2,6}-\d+/u;
export function extractTicket(text: string): string | undefined {
  return TICKET_PATTERN.exec(text)?.[0];
}

export interface WinnerCommitMessageInput {
  /** Commit message `[Type]`; perf KEEP rounds default to Feature. */
  readonly type?: string;
  /** Open ticket id; extracted from the mission prompt when available. */
  readonly ticket?: string;
  /** Operator being tuned, e.g. `gemm`. */
  readonly operator: string;
  readonly iteration: number;
  /** Why this change exists (round hypothesis). */
  readonly hypothesis: string;
  /** What changed (implementation diff_summary). */
  readonly solution: string;
  /** Verification evidence line (profile + regression + verify status). */
  readonly test: string;
  /** Commit message Impact area; defaults to `ops`. */
  readonly impactArea?: string;
}

export interface WinnerCommitMessage {
  readonly subject: string;
  readonly body: string;
}

/** Winner-commit template: subject `[Type](ticket): <subject≤50>` plus
 * Root Cause / Solution / Test / Impact area / Fix status body. All-English,
 * subject line ≤50 chars so a review push would accept it. Pure —
 * unit-testable without a git repo. */
export function buildCommitMessage(input: WinnerCommitMessageInput): WinnerCommitMessage {
  const type = input.type ?? "Feature";
  const ticket = input.ticket ?? "no-ticket";
  const prefix = `[${type}](${ticket}): `;
  const head = `${input.operator} R${input.iteration}`;
  // Gerrit rejects subject lines over 50 chars; trim the operator descriptor
  // (never the fixed prefix) to fit.
  const subject = prefix.length + head.length <= 50
    ? `${prefix}${head}`
    : `${prefix}${head.slice(0, 50 - prefix.length)}`;
  const body = [
    "Root Cause:",
    `    ${input.hypothesis.replace(/\r?\n/gu, " ")}`,
    "Solution:",
    `    ${input.solution.replace(/\r?\n/gu, " ")}`,
    "Test:",
    `    ${input.test.replace(/\r?\n/gu, " ")}`,
    "Impact area:",
    `    ${input.impactArea ?? "ops"}`,
    "Fix status:",
    "    done",
  ].join("\n");
  return { subject, body };
}

/** Unwrap a failed git call down to the useful text. `io.execFile` reports an
 * `IoError` carrying the child's stderr directly; older/wrapped rejections
 * keep the real payload on `.cause`/`.error`. Without this walk, a hook
 * rejection logs only a generic message and the run leaves no way to tell WHY
 * the commit failed (L4-2round evidence, run 20260902T085250). */
function gitErrorDetails(error: unknown): string {
  let node: unknown = error;
  let fallback: string | undefined;
  for (let depth = 0; depth < 6 && typeof node === "object" && node !== null; depth += 1) {
    const candidate = node as { stderr?: string; message?: string; cause?: unknown; error?: unknown };
    if (candidate.stderr !== undefined && candidate.stderr.trim() !== "") return candidate.stderr.trim();
    if (fallback === undefined && candidate.message !== undefined) fallback = candidate.message;
    node = candidate.cause ?? candidate.error;
  }
  return fallback ?? String(error);
}

/** Stage `files` (explicit paths only) and commit them into `cwd`'s git repo
 * with the winner-commit message, then verify with `git log -1 --name-only`.
 * Never fails: every git error becomes a warning log
 * so an auto-commit hiccup cannot take down the tuning run. */
export function commitRoundFiles(
  cwd: string,
  files: readonly string[],
  message: WinnerCommitMessage,
): Effect.Effect<void, never, Logging | FileSystem.FileSystem> {
  return TRACE(WINNER_COMMIT_SOURCE, Effect.gen(function* () {
    if (files.length === 0) {
      yield* WINNER_COMMIT_LOG.warn("auto.commit.skipped", {
        data: { reason: "no winner changed_files to stage", cwd },
      });
      return;
    }
    const outcome = yield* Effect.either(Effect.gen(function* () {
      yield* runGit(cwd, ["add", "--", ...files]);
      yield* runGit(cwd, ["commit", "-m", message.subject, "-m", message.body]);
      return yield* runGit(cwd, ["log", "-1", "--name-only", "--format=%s"]);
    }));
    if (Either.isLeft(outcome)) {
      yield* WINNER_COMMIT_LOG.warn("auto.commit.failed", {
        data: { cwd, subject: message.subject, error: gitErrorDetails(outcome.left) },
      });
      // A failed `git commit` leaves the earlier `git add` staged — and a later
      // tuning round that reverts its candidate with `git checkout -- <file>`
      // would restore the STAGED (candidate) content instead of HEAD, silently
      // corrupting revert semantics. Best-effort unstage the exact paths we
      // added (worktree content is preserved); never fail on this either.
      yield* runGit(cwd, ["reset", "--quiet", "--", ...files]).pipe(
        Effect.catchAll(() => Effect.void),
      );
      return;
    }
    yield* WINNER_COMMIT_LOG.info("auto.commit.committed", {
      data: { cwd, subject: message.subject, log: outcome.right.stdout },
    });
  }));
}
