import { FileSystem } from "@effect/platform";
import { io } from "@piano/base";
import { isUnsafeWorkspaceRelativePath } from "@piano/contract";
import { Effect, Either } from "effect";
import { logger, TRACE, type Logging, type Source } from "@piano/logging";
import { workflowError, type WorkflowError } from "./errors.js";

/** Leaf adapter: one `git` invocation behind one io Effect. Every git effect in
 * this module composes this call, so the external process boundary stays
 * exactly one call wide. A non-zero exit is an `IoError` carrying the child's
 * own stderr, which `gitErrorDetails` reads.
 *
 * Every call carries `GIT_LITERAL_PATHSPECS=1`: workspace filenames are data,
 * not patterns, so a name containing `*`, `?`, `[`, or `:` magic reaches git
 * as the exact file the status scan reported. */
function runGit(
  cwd: string,
  args: readonly string[],
  options: { readonly maxBuffer?: number } = {},
): Effect.Effect<io.CommandResult, io.IoError> {
  return io.execFile("git", ["-C", cwd, ...args], {
    env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
    ...(options.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
  });
}

/** Orchestrator-owned loop commit. A loop is the only workflow construct that
 * commits: after each iteration's accepted results (and a tournament's winner
 * carry) the walker commits the iteration's workspace changes, so every round
 * is a recoverable point whether the round decided KEEP, DISCARD, or anything
 * else. All git work is path-limited to the paths `git status` reports, never
 * a repository-wide sweep, and never pushes. Files that were already dirty
 * when the execution started are never swept in. A commit that still fails
 * after `COMMIT_MAX_ATTEMPTS` fails the run — it is the run's durable record,
 * not best-effort bookkeeping. */

const LOOP_COMMIT_SOURCE: Source = {
  module: "orchestrator",
  file: "loop-commit.ts",
  function: "commitFiles",
};
const LOOP_COMMIT_LOG = logger(LOOP_COMMIT_SOURCE, { namespace: "workflow" });

/** Total `git commit` attempts before a failure fails the run (one initial
 * attempt plus two retries). */
export const COMMIT_MAX_ATTEMPTS = 3;

/** One entry of `git status --porcelain=v1 -z`. `status` is the two-letter XY
 * code. A rename or copy carries the source path that follows the destination
 * as the next NUL-separated token. Paths are repository-root relative and are
 * kept byte-for-byte — git has already unquoted them for `-z`, so trimming
 * would corrupt legitimate leading/trailing spaces. */
export interface WorkspaceChange {
  readonly status: string;
  readonly path: string;
  readonly sourcePath?: string;
}

function isRenameOrCopy(status: string): boolean {
  return status[0] === "R" || status[0] === "C" || status[1] === "R" || status[1] === "C";
}

/** Parse `git status --porcelain=v1 -z` output. Each entry is `XY <path>`;
 * rename and copy entries are followed by their source path. Besides the
 * index-side `R`/`C` statuses git reports for staged renames, a worktree-side
 * `R`/`C` (second status column) is parsed the same way. */
export function parsePorcelainStatus(stdout: string): readonly WorkspaceChange[] {
  const changes: WorkspaceChange[] = [];
  const tokens = stdout.split("\0");
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token.length < 4) continue;
    const status = token.slice(0, 2);
    const path = token.slice(3);
    if (path === "") continue;
    if (isRenameOrCopy(status)) {
      const sourcePath = tokens[index + 1];
      index += 1;
      if (sourcePath !== undefined && sourcePath !== "") {
        changes.push({ status, path, sourcePath });
        continue;
      }
    }
    changes.push({ status, path });
  }
  return changes;
}

/** The workspace's repository root, or `undefined` when `cwd` is not inside a
 * git worktree. A store lane or a plain directory has no commit target; the
 * caller logs that instead of faking a commit. Never fails: the answer is
 * state, not an error. */
export function gitWorkspaceRoot(
  cwd: string,
): Effect.Effect<string | undefined, never, never> {
  return runGit(cwd, ["rev-parse", "--show-toplevel"]).pipe(
    Effect.map((result) => {
      const root = result.stdout.trim();
      return root === "" ? undefined : root;
    }),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );
}

/** The workspace's changed paths (tracked modifications, staged changes, and
 * untracked files, including files an agent wrote as memory/notes) at one
 * moment, spelled repository-root relative. The pathspec `.` keeps the answer
 * inside the workspace when `cwd` is a subdirectory of its repository. */
export function workspaceChanges(
  cwd: string,
): Effect.Effect<readonly WorkspaceChange[], io.IoError> {
  return runGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."], {
    maxBuffer: 32 * 1024 * 1024,
  }).pipe(Effect.map((result) => parsePorcelainStatus(result.stdout)));
}

/** Snapshot the workspace's dirty paths at execution start, including both
 * ends of a rename. Loop commits subtract this set so user / other-task
 * changes present before the run are never swept in.
 *
 * A non-git workspace has no commit target and snapshots as empty. A git
 * workspace whose status cannot be read is a real failure, not an empty
 * snapshot: treating it as empty would let the first iteration's commit sweep
 * in exactly the pre-existing changes this snapshot exists to exclude. */
export function snapshotDirtyFiles(
  cwd: string,
): Effect.Effect<ReadonlySet<string>, WorkflowError> {
  return Effect.gen(function* () {
    const root = yield* gitWorkspaceRoot(cwd);
    if (root === undefined) return new Set<string>();
    const changes = yield* workspaceChanges(cwd).pipe(
      Effect.mapError((cause) => workflowError(
        "schedule",
        cwd,
        `cannot read workspace git status: ${gitErrorDetails(cause)}`,
      )),
    );
    const paths = new Set<string>();
    for (const change of changes) {
      paths.add(change.path);
      if (change.sourcePath !== undefined) paths.add(change.sourcePath);
    }
    return paths as ReadonlySet<string>;
  });
}

/** The exact git work one loop commit performs, derived from the iteration's
 * porcelain entries. Untracked paths and the destination of a worktree-side
 * rename/copy are not known to git yet, so a path-limited commit cannot name
 * them until they are added. Tracked worktree changes are staged path-limited
 * with `git add -A`. An index-side rename/copy is already staged and its
 * source is gone from the worktree, so re-adding that source would fail the
 * whole commit; instead both ends go into the commit pathspec so
 * `git commit --only` records the rename. */
export interface LoopCommitPlan {
  /** Untracked and worktree-rename destinations to stage with `git add --`. */
  readonly add: readonly string[];
  /** Tracked worktree modifications and deletions to stage with `git add -A --`. */
  readonly update: readonly string[];
  /** The `git commit --only` pathspec: every changed path plus rename sources. */
  readonly paths: readonly string[];
  /** Destination paths of the changes this commit covers. */
  readonly changed: readonly string[];
}

/** Keep the changes a loop commit may stage: safe workspace-relative paths,
 * neither end of the change pre-existing dirty, deduplicated. A rename whose
 * source was already dirty is excluded as a whole — committing its
 * destination without the source would invent a change the run did not make. */
export function planLoopCommit(
  changes: readonly WorkspaceChange[],
  preExistingDirty: ReadonlySet<string>,
): LoopCommitPlan {
  const add = new Set<string>();
  const update = new Set<string>();
  const paths = new Set<string>();
  const changed = new Set<string>();
  for (const change of changes) {
    const { status, path, sourcePath } = change;
    if (isUnsafeWorkspaceRelativePath(path)) continue;
    if (sourcePath !== undefined && isUnsafeWorkspaceRelativePath(sourcePath)) continue;
    if (preExistingDirty.has(path) || (sourcePath !== undefined && preExistingDirty.has(sourcePath))) continue;
    changed.add(path);
    paths.add(path);
    if (sourcePath !== undefined) paths.add(sourcePath);
    if (status === "??") {
      add.add(path);
    } else if (isRenameOrCopy(status)) {
      // A worktree-side rename/copy reports the destination as not yet known
      // to git; an index-side one is already staged.
      if (status[1] === "R" || status[1] === "C") add.add(path);
    } else if (status[1] !== " ") {
      // Worktree modification, deletion, or type change. An index-only change
      // (`D `, `A `, `M `, `R `) needs no staging, and `git add -A` on an
      // index-deleted path fails because the path matches nothing.
      update.add(path);
    }
  }
  return { add: [...add], update: [...update], paths: [...paths], changed: [...changed] };
}

/** Extract the open ticket id from a mission prompt, e.g. `TR-21673`. */
const TICKET_PATTERN = /[A-Z]{2,6}-\d+/u;
export function extractTicket(text: string): string | undefined {
  return TICKET_PATTERN.exec(text)?.[0];
}

export interface CommitMessageInput {
  /** Commit message `[Type]`; loop rounds default to Feature. */
  readonly type?: string;
  /** Open ticket id; extracted from the mission prompt when available. */
  readonly ticket?: string;
  /** Loop / region name the commit belongs to (the subject's `<operator>`). */
  readonly operator: string;
  readonly iteration: number;
  /** Why this change exists; loop commits pass neutral loop wording. */
  readonly hypothesis: string;
  /** What changed; loop commits pass neutral loop wording. */
  readonly solution: string;
  /** Verification evidence line, or `not reported` when there is none. */
  readonly test: string;
  /** Commit message Impact area; defaults to `ops`. */
  readonly impactArea?: string;
}

export interface CommitMessage {
  readonly subject: string;
  readonly body: string;
}

export interface CommitResult {
  /** The commit's full hash, as `git rev-parse HEAD` reports it. */
  readonly commit: string;
  readonly subject: string;
}

/** Loop-commit template: subject `[Type](ticket): <operator> R<iteration>`
 * plus Root Cause / Solution / Test / Impact area / Fix status body.
 * All-English, subject line ≤50 chars so a review push would accept it. The
 * iteration suffix is never truncated: it is the one part of the subject that
 * maps the commit back to the loop. Pure — unit-testable without a git repo. */
export function buildCommitMessage(input: CommitMessageInput): CommitMessage {
  const type = input.type ?? "Feature";
  const ticket = input.ticket ?? "no-ticket";
  const prefix = `[${type}](${ticket}): `;
  const suffix = ` R${input.iteration}`;
  const head = `${input.operator}${suffix}`;
  const available = Math.max(0, 50 - prefix.length - suffix.length);
  const subject = prefix.length + head.length <= 50
    ? `${prefix}${head}`
    : `${prefix}${input.operator.slice(0, available)}${suffix}`;
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

/** Identity Piano falls back to when the workspace repository configures
 * none. A commit is the run's durable record; a machine without a global git
 * identity must not turn every loop iteration into a failed run. Matching
 * values are used by the orchestrator's own baseline commits. */
const FALLBACK_COMMIT_IDENTITY = { name: "Piano", email: "piano@localhost" } as const;

/** `-c` arguments that fill in any identity the repository does not set.
 * Configured values win; only a missing name or email is replaced. */
function commitIdentityArgs(root: string): Effect.Effect<readonly string[], never> {
  const read = (key: string): Effect.Effect<string, never> =>
    runGit(root, ["config", "--get", key]).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.catchAll(() => Effect.succeed("")),
    );
  return Effect.gen(function* () {
    const name = yield* read("user.name");
    const email = yield* read("user.email");
    if (name !== "" && email !== "") return [];
    return [
      "-c", `user.name=${name === "" ? FALLBACK_COMMIT_IDENTITY.name : name}`,
      "-c", `user.email=${email === "" ? FALLBACK_COMMIT_IDENTITY.email : email}`,
    ];
  });
}

/** One stage + `git commit --only` + `git rev-parse HEAD` attempt. */
const commitOnce = (
  root: string,
  plan: LoopCommitPlan,
  message: CommitMessage,
  identity: readonly string[],
): Effect.Effect<CommitResult, io.IoError> => Effect.gen(function* () {
  if (plan.add.length > 0) yield* runGit(root, ["add", "--", ...plan.add]);
  if (plan.update.length > 0) yield* runGit(root, ["add", "-A", "--", ...plan.update]);
  yield* runGit(root, [...identity, "commit", "--only", "-m", message.subject, "-m", message.body, "--", ...plan.paths]);
  const head = yield* runGit(root, ["rev-parse", "HEAD"]);
  return { commit: head.stdout.trim(), subject: message.subject };
});

/** Stage and commit exactly the paths `planLoopCommit` selected into `root`'s
 * git repo with the loop-commit message. Retries a bounded number of times,
 * then fails the run with the child's stderr. On a final failure the staged
 * paths are unstaged again so a failed commit cannot poison later rounds'
 * reverts. */
export function commitFiles(
  root: string,
  plan: LoopCommitPlan,
  message: CommitMessage,
): Effect.Effect<CommitResult, WorkflowError, Logging | FileSystem.FileSystem> {
  return TRACE(LOOP_COMMIT_SOURCE, Effect.gen(function* () {
    if (plan.paths.length === 0) {
      // Never let an empty path list reach `git commit`: a pre-existing,
      // already-staged change could be swept into a commit nobody asked for.
      return yield* Effect.fail(workflowError(
        "schedule",
        root,
        "loop auto-commit was called with no files to stage",
      ));
    }
    const identity = yield* commitIdentityArgs(root);
    let detail = "unknown git failure";
    for (let attempt = 1; attempt <= COMMIT_MAX_ATTEMPTS; attempt += 1) {
      const outcome = yield* Effect.either(commitOnce(root, plan, message, identity));
      if (Either.isRight(outcome)) return outcome.right;
      detail = gitErrorDetails(outcome.left);
      if (attempt < COMMIT_MAX_ATTEMPTS) {
        yield* LOOP_COMMIT_LOG.warn("auto.commit.retrying", {
          data: { cwd: root, subject: message.subject, attempt, maxAttempts: COMMIT_MAX_ATTEMPTS, error: detail },
        });
      }
    }
    // A failed `git commit` leaves the earlier staging in the index — and a
    // later tuning round that reverts its candidate with `git checkout -- <file>`
    // would restore the STAGED (candidate) content instead of HEAD, silently
    // corrupting revert semantics. Best-effort unstage the exact paths we
    // touched (worktree content is preserved).
    yield* runGit(root, ["reset", "--quiet", "--", ...plan.paths]).pipe(
      Effect.catchAll(() => Effect.void),
    );
    yield* LOOP_COMMIT_LOG.error("auto.commit.failed", {
      data: { cwd: root, subject: message.subject, attempts: COMMIT_MAX_ATTEMPTS, error: detail },
    });
    return yield* Effect.fail(workflowError(
      "schedule",
      root,
      `loop auto-commit failed after ${COMMIT_MAX_ATTEMPTS} attempts: ${detail}`,
    ));
  }));
}
