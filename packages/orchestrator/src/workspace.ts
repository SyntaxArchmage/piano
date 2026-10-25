import type { FileSystem } from "@effect/platform";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Deferred, Effect } from "effect";
import { isRecord, TRACE, type Logging, type Source } from "@piano/logging";
import {
  io,
  workspaceRecordPath,
  workspaceRecordRoot,
  workspaceRoot as workspaceRootPath,
  workspaceStorePath,
  workspaceWorktreePath as workspacePath,
} from "@piano/base";
import { errorMessage, WorkflowError, workflowError } from "./errors.js";
import { pathWithin } from "./path-within.js";
import { isWorkflowIdentifier } from "./workflow.js";
import {
  runtimeInstanceId,
  type WorkflowRuntimeFrame,
} from "./workflow-runtime.js";

/** The module-internal failure channel: typed workflow errors plus the
 * `io.IoError` leaves whose cause callers classify before the public boundary
 * collapses the channel to `WorkflowError`. */
type WorkspaceFailure = WorkflowError | io.IoError;

/** The `fs.Stats` shape `io.lstat`/`io.stat` returns. */
type WorkspaceStat = Effect.Effect.Success<ReturnType<typeof io.lstat>>;

/** Run a synchronous helper that may throw a workflow error (path
 * validation) as a typed Effect failure instead of a defect. */
function guard<A>(operation: () => A): Effect.Effect<A, WorkspaceFailure> {
  return Effect.try({
    try: operation,
    catch: (cause) => cause instanceof WorkflowError ? cause : io.ioError("guard", undefined, cause),
  });
}

function rawCause(failure: WorkspaceFailure): unknown {
  return failure instanceof io.IoError ? failure.cause ?? failure : failure;
}

/** Collapse the internal channel to the module's typed error at a public
 * boundary, exactly as the previous promise boundary did. */
function failureAt(path: string, failure: WorkspaceFailure): WorkflowError {
  return failure instanceof WorkflowError
    ? failure
    : workflowError("schedule", path, failure.message);
}

const isMissingLeaf = (failure: WorkspaceFailure): boolean =>
  failure instanceof io.IoError && io.isMissingPathError(failure.cause);

const isGoneLeaf = (failure: WorkspaceFailure): boolean =>
  failure instanceof io.IoError && io.isMissingPathError(failure.cause);

export type WorkflowWorkspaceStrategy = "git-worktree" | "store-worktree";
export type WorkflowWorkspacePhase = "allocated" | "applying" | "cleaning" | "preserved";

/** A workspace is independent from an actor/session: one map-slot workspace
 * is shared by all of that slot's stages, while actor continuation remains
 * scoped to the logical stage. */
export interface WorkflowWorkspaceBinding {
  readonly key: string;
  readonly cwd: string;
  readonly kind: "shared" | "map-slot";
  readonly sourceCwd?: string;
  readonly recordPath?: string;
  readonly strategy?: WorkflowWorkspaceStrategy;
  /** The commit the lane forked from (map slots only). */
  readonly baseCommit?: string;
}

export interface WorkflowWorkspaceRecord {
  readonly version: 3;
  readonly key: string;
  readonly cwd: string;
  readonly sourceCwd: string;
  readonly strategy: WorkflowWorkspaceStrategy;
  readonly phase: WorkflowWorkspacePhase;
  /** Task namespace (`<task-slug>-<runId>`) shared by every lane of one run. */
  readonly mnemonic: string;
  /** The branch this lane checks out: `tuna/<mnemonic>/lane-<n>`. */
  readonly laneBranch: string;
  /** The commit the lane forked from: source HEAD, a seed commit of unsaved
   * content, a nested lane checkpoint, or the store's frozen baseline. */
  readonly baseCommit: string;
  /** The branch checked out in `sourceCwd` when the lane forked. A carry only
   * fast-forwards when it is still the same branch. */
  readonly sourceBranch?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The repository the lane's worktree belongs to: the source's own git root
   * (`git-worktree`) or the run's baseline store (`store-worktree`). */
  readonly gitRoot: string;
}

const WORKSPACE_SOURCE: Source = {
  module: "orchestrator",
  file: "workspace.ts",
  function: "allocateMapWorkspace",
};

const workspacePathSeparator = sep === "\\" ? /[\\/]/u : /\//u;
const protectedWorkspaceNames = new Set([".git", ".piano-run.lock"]);

function workspacePathSegments(path: string): string[] {
  return path.split(workspacePathSeparator);
}

function isProtectedWorkspaceName(name: string, caseInsensitive: boolean): boolean {
  const comparable = caseInsensitive ? name.toLowerCase() : name;
  return protectedWorkspaceNames.has(comparable);
}

function isProtectedWorkspacePath(root: string, candidate: string, caseInsensitive: boolean): boolean {
  const candidatePath = resolve(candidate);
  const rootPath = resolve(root);
  if (!pathWithin(rootPath, candidatePath) || rootPath === candidatePath) return false;
  return workspacePathSegments(relative(rootPath, candidatePath))
    .some((segment) => isProtectedWorkspaceName(segment, caseInsensitive));
}

/** Determine the identity semantics of the filesystem containing `root`.
 * Linux must keep `.GIT` as an ordinary application name, while a real
 * case-insensitive filesystem must protect every spelling of `.git` and
 * `.piano-run.lock`. This is read-only: it compares a case-variant path to the
 * root's own device/inode, so content inspection does not require write access
 * or leave a probe residue. */
function isCaseInsensitiveFileSystem(root: string): Effect.Effect<boolean, WorkspaceFailure> {
  return Effect.gen(function* () {
    const resolvedRoot = resolve(root);
    const rootInfo = yield* io.lstat(resolvedRoot);
    const segments = workspacePathSegments(resolvedRoot);
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      if (segment === undefined) continue;
      const letter = segment.search(/[A-Za-z]/u);
      if (letter < 0) continue;
      const original = segment[letter];
      if (original === undefined) continue;
      const alternate = original === original.toLowerCase()
        ? original.toUpperCase()
        : original.toLowerCase();
      const candidateSegments = [...segments];
      candidateSegments[index] = `${segment.slice(0, letter)}${alternate}${segment.slice(letter + 1)}`;
      const candidateInfo = yield* io.lstat(candidateSegments.join(sep)).pipe(
        Effect.catchIf(isMissingLeaf, () => Effect.succeed(undefined)),
      );
      if (candidateInfo !== undefined && candidateInfo.dev === rootInfo.dev && candidateInfo.ino === rootInfo.ino) {
        return true;
      }
    }
    return false;
  });
}

interface CanonicalRunRoot {
  readonly lexical: string;
  readonly canonical: string;
  readonly dev: number;
  readonly ino: number;
}

interface WorkspaceDirectoryIdentity {
  readonly lexical: string;
  readonly canonical: string;
  readonly dev: number;
  readonly ino: number;
}

function captureWorkspaceDirectoryIdentity(
  path: string,
  label: string,
): Effect.Effect<WorkspaceDirectoryIdentity, WorkspaceFailure> {
  return Effect.gen(function* () {
    const lexical = resolve(path);
    const canonical = yield* io.realpath(lexical);
    const info = yield* io.lstat(canonical);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      return yield* Effect.fail(workflowError("schedule", lexical, `${label} must resolve to a real directory`));
    }
    return { lexical, canonical, dev: info.dev, ino: info.ino };
  });
}

/** Identity checks are deliberately separate from the filesystem operations.
 * They close ordinary replacement/substitution paths; same-UID check-then-use
 * races still require descriptor/openat2 or sandbox enforcement (see the
 * explicit limitation at the destructive boundaries below). */
function assertWorkspaceDirectoryIdentity(
  identity: WorkspaceDirectoryIdentity,
  label: string,
): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    const actual = yield* io.realpath(identity.lexical);
    if (resolve(actual) !== identity.canonical) {
      return yield* Effect.fail(workflowError("schedule", identity.lexical, `${label} realpath changed during workspace operation`));
    }
    const info = yield* io.lstat(identity.canonical);
    if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== identity.dev || info.ino !== identity.ino) {
      return yield* Effect.fail(workflowError("schedule", identity.lexical, `${label} identity changed during workspace operation`));
    }
  });
}

/** Validate the final runDir node before resolving it. Parent symlinks remain
 * supported, but the run root itself must always be a real directory. */
function canonicalRunRoot(runDir: string, create: boolean): Effect.Effect<CanonicalRunRoot, WorkspaceFailure> {
  return Effect.gen(function* () {
    const lexical = resolve(runDir);
    const info = yield* io.lstat(lexical).pipe(
      Effect.catchIf(isMissingLeaf, (failure) => {
        if (!create) return Effect.fail(failure);
        return Effect.gen(function* () {
          yield* io.mkdir(lexical, { recursive: true });
          return yield* io.lstat(lexical);
        });
      }),
    );
    if (info.isSymbolicLink() || !info.isDirectory()) {
      return yield* Effect.fail(workflowError(
        "schedule",
        lexical,
        "run directory must be a real directory; refusing a symlink or non-directory final node",
      ));
    }
    const canonical = yield* io.realpath(lexical);
    const canonicalInfo = yield* io.lstat(canonical);
    if (canonicalInfo.isSymbolicLink() || !canonicalInfo.isDirectory()) {
      return yield* Effect.fail(workflowError("schedule", lexical, "run directory resolved to a symlink or non-directory"));
    }
    return { lexical, canonical, dev: canonicalInfo.dev, ino: canonicalInfo.ino };
  });
}

/** Recheck the same run-root identity immediately before metadata or slot
 * mutation. This catches deletion/recreation and parent substitution while
 * retaining compatibility with a symlink in a runDir parent component. */
function assertCanonicalRunRoot(root: CanonicalRunRoot): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    const lexicalInfo = yield* io.lstat(root.lexical);
    if (lexicalInfo.isSymbolicLink() || !lexicalInfo.isDirectory()) {
      return yield* Effect.fail(workflowError("schedule", root.lexical, "run directory was replaced by a symlink or non-directory"));
    }
    const actual = yield* io.realpath(root.lexical);
    if (resolve(actual) !== root.canonical) {
      return yield* Effect.fail(workflowError("schedule", root.lexical, "run directory realpath changed during workspace operation"));
    }
    const canonicalInfo = yield* io.lstat(root.canonical);
    if (canonicalInfo.isSymbolicLink() || !canonicalInfo.isDirectory() ||
      canonicalInfo.dev !== root.dev || canonicalInfo.ino !== root.ino) {
      return yield* Effect.fail(workflowError("schedule", root.lexical, "run directory identity changed during workspace operation"));
    }
  });
}

/** Check the existing portion of a run-owned path without resolving through a
 * missing tail. This lets first allocation create absent metadata directories
 * while rejecting a substituted ancestor before any mkdir/read/write. */
function assertSafeWorkspacePathAncestors(root: string, candidate: string): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    const canonicalRoot = resolve(root);
    const lexicalCandidate = resolve(candidate);
    if (!pathWithin(canonicalRoot, lexicalCandidate)) {
      return yield* Effect.fail(workflowError("schedule", candidate, "workspace path escapes its canonical root"));
    }
    let current = canonicalRoot;
    const segments = workspacePathSegments(relative(canonicalRoot, lexicalCandidate)).filter((segment) => segment !== "");
    for (const segment of segments) {
      current = join(current, segment);
      const info = yield* io.lstat(current).pipe(
        Effect.catchIf(isMissingLeaf, () => Effect.succeed(undefined)),
      );
      if (info === undefined) return;
      if (info.isSymbolicLink() || !info.isDirectory()) {
        return yield* Effect.fail(workflowError("schedule", current, "workspace path has a symlink or non-directory ancestor"));
      }
      const actual = yield* io.realpath(current);
      if (resolve(actual) !== resolve(current)) {
        return yield* Effect.fail(workflowError("schedule", current, "workspace path ancestor realpath changed"));
      }
    }
  });
}

/** The run's lane namespace: `<task-slug>-<runId>`. The run id carries the
 * datetime and entropy, so two tasks that pick the same word never collide. */
export function mnemonicNamespace(slug: string, runId: string): string {
  return `${slug}-${runId}`;
}

/** The branch a lane checks out: `tuna/<mnemonic>/lane-<n>`. The mnemonic is
 * the run's task namespace (`<task-slug>-<runId>`), so branches of different
 * tasks and runs never collide. */
function laneBranchName(mnemonic: string, laneNumber: number): string {
  return `tuna/${mnemonic}/lane-${laneNumber}`;
}

const LANE_BRANCH_PATTERN = /^tuna\/([^/]+)\/lane-(\d+)$/u;

/** Inverse of `laneBranchName`; also validates the mnemonic for callers that
 * parse a branch name out of evidence. */
function parseLaneBranch(branch: string): { readonly mnemonic: string; readonly laneNumber: number } | undefined {
  const match = LANE_BRANCH_PATTERN.exec(branch);
  if (match === null || !isWorkflowIdentifier(match[1]!)) return undefined;
  return { mnemonic: match[1]!, laneNumber: Number(match[2]) };
}

function bindingFromRecord(record: WorkflowWorkspaceRecord, recordPath: string): WorkflowWorkspaceBinding {
  return {
    key: record.key,
    cwd: record.cwd,
    kind: "map-slot",
    sourceCwd: record.sourceCwd,
    recordPath,
    strategy: record.strategy,
    baseCommit: record.baseCommit,
  };
}

function parseWorkspaceRecord(
  value: unknown,
  expected: { readonly key: string; readonly cwd: string; readonly sourceCwd?: string },
  recordPath: string,
): Effect.Effect<WorkflowWorkspaceRecord, WorkflowError> {
  return Effect.gen(function* () {
    if (!isRecord(value)) {
      return yield* Effect.fail(workflowError("schedule", recordPath, "workspace record must be an object"));
    }
    const strategy = value.strategy === "git-worktree" || value.strategy === "store-worktree"
      ? value.strategy
      : undefined;
    const phase = value.phase === "allocated" || value.phase === "applying" || value.phase === "cleaning" || value.phase === "preserved"
      ? value.phase
      : "allocated";
    if (value.version !== 3 || value.key !== expected.key || value.cwd !== expected.cwd || typeof value.sourceCwd !== "string" ||
      strategy === undefined || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" ||
      typeof value.gitRoot !== "string" || typeof value.mnemonic !== "string" ||
      typeof value.laneBranch !== "string" || typeof value.baseCommit !== "string") {
      return yield* Effect.fail(workflowError("schedule", recordPath, "workspace record has an unsupported or inconsistent format"));
    }
    if (expected.sourceCwd !== undefined && resolve(value.sourceCwd) !== resolve(expected.sourceCwd)) {
      return yield* Effect.fail(workflowError("schedule", recordPath, "workspace record belongs to a different source workspace"));
    }
    if (parseLaneBranch(value.laneBranch)?.mnemonic !== value.mnemonic) {
      return yield* Effect.fail(workflowError("schedule", recordPath, "workspace record has an unsupported or inconsistent lane identity"));
    }
    if (value.sourceBranch !== undefined && typeof value.sourceBranch !== "string") {
      return yield* Effect.fail(workflowError("schedule", recordPath, "workspace record sourceBranch must be a string"));
    }
    return {
      version: 3,
      key: value.key,
      cwd: value.cwd,
      sourceCwd: value.sourceCwd,
      strategy,
      phase,
      mnemonic: value.mnemonic,
      laneBranch: value.laneBranch,
      baseCommit: value.baseCommit,
      ...(typeof value.sourceBranch === "string" ? { sourceBranch: value.sourceBranch } : {}),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      gitRoot: value.gitRoot,
    };
  });
}

function writeWorkspaceRecord(
  recordPath: string,
  record: WorkflowWorkspaceRecord,
  runRoot: CanonicalRunRoot,
): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    const recordDir = dirname(recordPath);
    const assertRecordPathSafe = (): Effect.Effect<void, WorkspaceFailure> =>
      Effect.gen(function* () {
        yield* assertCanonicalRunRoot(runRoot);
        yield* assertSafeWorkspacePathAncestors(runRoot.canonical, recordDir);
      });
    yield* assertRecordPathSafe();
    const temporary = `${recordPath}.${randomUUID()}.tmp`;
    yield* io.mkdir(recordDir, { recursive: true });
    const operation = yield* Effect.gen(function* () {
      yield* assertRecordPathSafe();
      yield* io.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
      yield* assertRecordPathSafe();
      yield* io.rename(temporary, recordPath);
    }).pipe(Effect.either);
    if (operation._tag === "Right") return;
    const operationFailure = operation.left;
    // Only a failed write/rename can leave the temporary behind. If the run
    // root was substituted, do not follow it merely to remove the residue.
    const cleanup = yield* Effect.gen(function* () {
      yield* assertRecordPathSafe();
      yield* io.rm(temporary, { force: true });
    }).pipe(Effect.either);
    if (cleanup._tag === "Left") {
      return yield* Effect.fail(io.ioError("writeWorkspaceRecord", undefined, new AggregateError(
        [
          rawCause(operationFailure),
          workflowError("schedule", temporary, `workspace record temporary cleanup failed: ${errorMessage(rawCause(cleanup.left))}`),
        ],
        "workspace record write and cleanup both failed",
      )));
    }
    return yield* Effect.fail(operationFailure);
  });
}

/** Delete one slot's record directory crash-atomically: rename it out of the
 * records tree first, so a crash leaves an ignorable trash entry instead of a
 * half-deleted record that every later read would reject. */
function removeWorkspaceRecord(recordPath: string, runRoot: CanonicalRunRoot): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    const recordDir = dirname(recordPath);
    const recordsRoot = dirname(recordDir);
    yield* assertCanonicalRunRoot(runRoot);
    yield* assertSafeWorkspacePathAncestors(runRoot.canonical, recordsRoot);
    const trash = join(recordsRoot, ".removing");
    yield* io.mkdir(trash, { recursive: true });
    const moved = join(trash, `${basename(recordDir)}.${randomUUID()}`);
    yield* io.rename(recordDir, moved);
    yield* io.rm(moved, { recursive: true, force: true });
    // Best-effort: a concurrent sweep may still own the trash directory, and an
    // earlier record in this sweep may already have removed it.
    yield* io.rmdir(trash).pipe(Effect.catchAll(() => Effect.void));
  });
}

function readWorkspaceRecord(
  recordPath: string,
  expected: { readonly key: string; readonly cwd: string; readonly sourceCwd?: string },
): Effect.Effect<WorkflowWorkspaceRecord | undefined, WorkspaceFailure> {
  return Effect.gen(function* () {
    const recordInfo = yield* io.lstat(recordPath).pipe(
      Effect.catchIf(isMissingLeaf, () => Effect.succeed(undefined)),
    );
    if (recordInfo === undefined) return undefined;
    if (recordInfo.isSymbolicLink() || !recordInfo.isFile()) {
      return yield* Effect.fail(workflowError("schedule", recordPath, "workspace record must be a regular file"));
    }
    const raw = yield* io.readText(recordPath).pipe(
      Effect.catchIf(isMissingLeaf, () => Effect.succeed(undefined)),
    );
    if (raw === undefined) return undefined;
    const value = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (error) => workflowError("schedule", recordPath, `workspace record is not valid JSON: ${errorMessage(error)}`),
    });
    return yield* parseWorkspaceRecord(value, expected, recordPath);
  });
}


/** The map lane's workspace key. The job ordinal is part of the slot's
 * identity, not decoration: every job re-enters the same loop frames from
 * iteration zero, so a key without it collides with a previous job's
 * preserved slot record — or silently rebinds a leftover directory — the
 * moment a second prompt or a continue re-allocates the same slot. */
function mapSlotKey(jobOrdinal: number, frames: readonly WorkflowRuntimeFrame[]): Effect.Effect<string, WorkflowError> {
  return Effect.gen(function* () {
    if (!frames.some((frame) => frame.kind === "map")) {
      return yield* Effect.fail(new WorkflowError({
        phase: "schedule",
        path: "workspace",
        message: "map workspace allocation requires an active map slot",
      }));
    }
    const instanceId = runtimeInstanceId(frames);
    if (instanceId === undefined) {
      return yield* Effect.fail(new WorkflowError({
        phase: "schedule",
        path: "workspace",
        message: "map workspace allocation has no runtime instance id",
      }));
    }
    return `job-${jobOrdinal}/${instanceId}`;
  });
}

interface GitSourceFacts {
  readonly root: string;
  readonly commonRoot: string;
  readonly dirty: boolean;
  readonly head: string;
  readonly branch: string;
}

/** What a lane can fork from in this source. `undefined` means the source is
 * not a Git workspace at all (or is a subdirectory/embeds the run), which
 * sends lanes to the run's own store. A Git workspace with no commits or a
 * detached HEAD is refused: there is no branch to name or fast-forward. */
function inspectGitSource(source: string, run: string): Effect.Effect<GitSourceFacts | undefined, WorkspaceFailure> {
  return Effect.gen(function* () {
    const repository = yield* gitRepositoryIdentity(source).pipe(
      Effect.catchAll(() => Effect.succeed(undefined)),
    );
    if (repository === undefined) return undefined;
    const root = repository.worktreeRoot;
    // A workspace rooted below the repository root would make the worktree
    // include files outside the caller's declared workspace, and a run
    // embedded in the workspace is run management rather than application
    // content. Both shapes take the store-worktree strategy instead.
    if (root !== source || pathWithin(source, run)) return undefined;
    const [head, branch, status] = yield* Effect.all([
      io.execFile("git", ["-C", root, "rev-parse", "--verify", "HEAD"])
        .pipe(Effect.map((result) => result.stdout.trim()), Effect.catchAll(() => Effect.succeed(""))),
      io.execFile("git", ["-C", root, "symbolic-ref", "--quiet", "--short", "HEAD"])
        .pipe(Effect.map((result) => result.stdout.trim()), Effect.catchAll(() => Effect.succeed(""))),
      io.execFile("git", ["-C", root, "status", "--porcelain=v1", "--untracked-files=all"]),
    ], { concurrency: "unbounded" });
    if (head === "") {
      return yield* Effect.fail(workflowError("schedule", source, "workspace source repository has no commits to fork a lane from"));
    }
    if (branch === "") {
      return yield* Effect.fail(workflowError("schedule", source, "workspace source HEAD is detached; check out a branch before running lanes"));
    }
    const caseInsensitive = yield* isCaseInsensitiveFileSystem(root);
    const dirty = status.stdout
      .split(/\r?\n/u)
      .map((line) => line.slice(3).trim())
      .some((path) => path !== "" && !isProtectedWorkspaceName(path, caseInsensitive));
    return { root, commonRoot: repository.commonRoot, dirty, head, branch };
  });
}

interface GitRepositoryIdentity {
  readonly worktreeRoot: string;
  readonly commonRoot: string;
}

/** The repository's common git directory: the admin parent for every linked
 * worktree. `rev-parse --git-common-dir` names it for a working tree and for a
 * bare store alike. */
function resolveGitCommonDir(cwd: string, path: string): Effect.Effect<string, WorkspaceFailure> {
  return io.realpath(isAbsolute(path) ? path : resolve(cwd, path));
}

function gitCommonDir(cwd: string): Effect.Effect<string, WorkspaceFailure> {
  return Effect.gen(function* () {
    const result = yield* io.execFile("git", ["-C", cwd, "rev-parse", "--git-common-dir"]);
    return yield* resolveGitCommonDir(cwd, result.stdout.trim());
  });
}

function gitRepositoryIdentity(cwd: string): Effect.Effect<GitRepositoryIdentity, WorkspaceFailure> {
  return Effect.gen(function* () {
    // One spawn: rev-parse prints each requested value on its own line, in order.
    const result = yield* io.execFile("git", [
      "-C", cwd,
      "rev-parse", "--show-toplevel", "--git-common-dir",
    ]);
    const [rootLine, commonLine] = result.stdout.split(/\r?\n/u);
    const commonPath = (commonLine ?? "").trim();
    const worktreeRoot = yield* io.realpath((rootLine ?? "").trim());
    const commonRoot = yield* resolveGitCommonDir(cwd, commonPath);
    return { worktreeRoot, commonRoot };
  });
}

/** Linked-worktree admin entries live under the owning repository's
 * `worktrees/` folder. */
function gitWorktreeAdminParent(owner: string): Effect.Effect<string, WorkspaceFailure> {
  return gitCommonDir(owner).pipe(Effect.map((common) => join(common, "worktrees")));
}

function assertGitRootBound(sourceCwd: string, gitRoot: string): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    const expected = yield* gitRepositoryIdentity(sourceCwd);
    const actual = yield* gitRepositoryIdentity(gitRoot);
    if (actual.worktreeRoot !== expected.worktreeRoot || actual.commonRoot !== expected.commonRoot) {
      return yield* Effect.fail(workflowError(
        "schedule",
        gitRoot,
        `git workspace repository does not match source Git common root ${expected.commonRoot}`,
      ));
    }
  });
}

/** Root/loop scopes intentionally use the caller workspace. The runtime
 * serializes ready siblings in such a shared binding because the DSL has no
 * declaration that a stage is read-only or owns a separate workspace. */
export function sharedWorkspaceBinding(cwd: string): WorkflowWorkspaceBinding {
  return { key: "shared-root", cwd: resolve(cwd), kind: "shared" };
}

/** Where one tournament's lanes fork from. `gitRoot` owns the branches: the
 * source repository for Git workspaces, the run's store otherwise. */
export interface MapLaneFork {
  readonly strategy: WorkflowWorkspaceStrategy;
  readonly gitRoot: string;
  /** The repository's common git dir: every sibling and nested lane shares
   * it, so it keys the lane-number allocation. */
  readonly commonRoot: string;
  readonly commit: string;
  readonly sourceBranch?: string;
}

/** Write the workspace content as one commit into the source repository,
 * without touching its index or any ref. The commit is reachable only through
 * the lane branches that fork from it. */
function commitWorkspaceContent(
  source: string,
  options: { readonly runDir: string; readonly parent?: string; readonly message: string },
): Effect.Effect<string, WorkspaceFailure> {
  return Effect.gen(function* () {
    const scratch = join(options.runDir, "git");
    yield* io.mkdir(scratch, { recursive: true });
    const tree = yield* writeContentTree({
      contentDir: source,
      excludeUnder: [options.runDir],
      scratchDir: scratch,
      gitArgs: ["-C", source],
      env: process.env,
    });
    const result = yield* io.execFile("git", [
      "-C", source,
      ...PIANO_GIT_IDENTITY_ARGS,
      "commit-tree", tree,
      ...(options.parent === undefined ? [] : ["-p", options.parent]),
      "-m", options.message,
    ]);
    return result.stdout.trim();
  });
}

/** Stage and commit a worktree's edits when it has any. */
function stageAndCommitWorktree(cwd: string, message: string): Effect.Effect<boolean, WorkspaceFailure> {
  return Effect.gen(function* () {
    const status = yield* io.execFile("git", ["-C", cwd, "status", "--porcelain=v1", "--untracked-files=all"]);
    if (status.stdout.trim() === "") return false;
    yield* io.execFile("git", ["-C", cwd, "add", "-A", "--", "."]);
    yield* io.execFile("git", [
      "-C", cwd,
      ...PIANO_GIT_IDENTITY_ARGS,
      "commit", "-q", "-m", message,
    ]);
    return true;
  });
}

/** Stage and commit a worktree's edits, returning the tip and whether anything
 * was committed. One place for the piano identity and the change check. */
function commitWorktreeChanges(
  cwd: string,
  message: string,
): Effect.Effect<{ readonly commit: string; readonly changed: boolean }, WorkspaceFailure> {
  return Effect.gen(function* () {
    const changed = yield* stageAndCommitWorktree(cwd, message);
    const commit = (yield* io.execFile("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim();
    return { commit, changed };
  });
}

/** Resolve what this region's lanes fork from, once per entry. */
function prepareMapLaneForkInternal(
  sourceCwd: string,
  options: {
    readonly runDir: string;
    readonly runId: string;
    readonly jobOrdinal: number;
    readonly frames: readonly WorkflowRuntimeFrame[];
    readonly parent?: WorkflowWorkspaceBinding;
  },
): Effect.Effect<MapLaneFork, WorkspaceFailure> {
  return Effect.gen(function* () {
    const run = (yield* canonicalRunRoot(options.runDir, true)).canonical;
    const source = yield* io.realpath(resolve(sourceCwd));
    const facts = yield* inspectGitSource(source, run);
    if (facts === undefined) {
      const baseline = yield* freezeWorkspaceBaselineInternal(source, {
        runDir: run,
        refName: workspaceRefName(
          options.runId,
          `baselines/job-${options.jobOrdinal}/${encodeURIComponent(`${runtimeInstanceId(options.frames) ?? "root"}/fork`)}`,
        ),
        excludeUnder: [run],
      });
      const storeDir = yield* workspaceBaselineStore(run);
      return {
        strategy: "store-worktree",
        gitRoot: storeDir,
        commonRoot: storeDir,
        commit: baseline.commit,
      };
    }
    if (options.parent?.kind === "map-slot" && facts.dirty) {
      // A nested tournament inside a lane: checkpoint the parent lane onto its
      // own branch so children fork from a commit that contains its edits.
      const { commit } = yield* commitWorktreeChanges(
        source,
        `piano: checkpoint lane ${facts.branch} before nested lanes`,
      );
      return { strategy: "git-worktree", gitRoot: source, commonRoot: facts.commonRoot, commit, sourceBranch: facts.branch };
    }
    if (facts.dirty) {
      const commit = yield* commitWorkspaceContent(source, {
        runDir: run,
        parent: facts.head,
        message: `piano: seed unsaved workspace content for ${facts.branch}`,
      });
      return { strategy: "git-worktree", gitRoot: source, commonRoot: facts.commonRoot, commit, sourceBranch: facts.branch };
    }
    return { strategy: "git-worktree", gitRoot: source, commonRoot: facts.commonRoot, commit: facts.head, sourceBranch: facts.branch };
  });
}

/** The lane numbers already taken in this namespace, so allocation never
 * reuses one even though every branch survives cleanup. */
function scanLaneNumbers(gitRoot: string, mnemonic: string): Effect.Effect<readonly number[], WorkspaceFailure> {
  return Effect.gen(function* () {
    const result = yield* io.execFile("git", [
      "-C", gitRoot,
      "for-each-ref", "--format=%(refname:short)", `refs/heads/tuna/${mnemonic}/`,
    ]);
    const numbers: number[] = [];
    for (const line of result.stdout.split(/\r?\n/u)) {
      const parsed = parseLaneBranch(line.trim());
      if (parsed?.mnemonic === mnemonic) numbers.push(parsed.laneNumber);
    }
    return numbers;
  });
}

/** Allocates lane numbers for one execution: every `allocateMapWorkspace`
 * call of that execution must share the instance. Lane branches are never
 * deleted, so the next free number only grows; concurrent cold callers share
 * one scan and take consecutive numbers, and a collision just advances the
 * hint. */
export interface LaneNumberAllocator {
  next(input: {
    readonly scanRoot: string;
    readonly commonRoot: string;
    readonly mnemonic: string;
  }): Effect.Effect<number, WorkspaceFailure>;
}

export function createLaneNumberAllocator(): LaneNumberAllocator {
  const hints = new Map<string, number>();
  const scans = new Map<string, Deferred.Deferred<number, WorkspaceFailure>>();
  const keyOf = (commonRoot: string, mnemonic: string): string => `${commonRoot}\0${mnemonic}`;
  return {
    next: (input) => Effect.gen(function* () {
      const key = keyOf(input.commonRoot, input.mnemonic);
      const hinted = hints.get(key);
      if (hinted !== undefined) {
        hints.set(key, hinted + 1);
        return hinted;
      }
      const pending = scans.get(key);
      if (pending !== undefined) {
        // A concurrent cold caller started the scan and reserved its result;
        // take the next hint once it resolves.
        const first = yield* pending;
        const next = hints.get(key) ?? first + 1;
        hints.set(key, next + 1);
        return next;
      }
      const deferred = yield* Deferred.make<number, WorkspaceFailure>();
      scans.set(key, deferred);
      return yield* scanLaneNumbers(input.scanRoot, input.mnemonic).pipe(
        Effect.map((taken) => {
          const next = taken.length === 0 ? 0 : Math.max(...taken) + 1;
          hints.set(key, next + 1);
          return next;
        }),
        Effect.onExit((exit) => Deferred.done(deferred, exit).pipe(
          Effect.ensuring(Effect.sync(() => { scans.delete(key); })),
        )),
      );
    }),
  };
}

function addLaneWorktree(gitRoot: string, branch: string, cwd: string, commit: string): Effect.Effect<void, WorkspaceFailure> {
  return io.execFile("git", ["-C", gitRoot, "worktree", "add", "-b", branch, cwd, commit]).pipe(Effect.asVoid);
}

/** A map slot that still needs a lane: preparation stops right before the
 * fork so the Effect layer resolves it only when this slot is allocated. */
interface PendingMapSlot {
  readonly kind: "pending";
  readonly sourceIdentity: WorkspaceDirectoryIdentity;
  readonly source: string;
  readonly runRoot: CanonicalRunRoot;
  readonly run: string;
  readonly key: string;
  readonly cwd: string;
  readonly recordPath: string;
}

/** Validate and prepare one slot. An existing record returns its binding;
 * anything else returns the context the allocation phase needs. */
function prepareMapSlot(
  runDir: string,
  jobOrdinal: number,
  frames: readonly WorkflowRuntimeFrame[],
  sourceCwd: string,
  mnemonic: string,
): Effect.Effect<WorkflowWorkspaceBinding | PendingMapSlot, WorkspaceFailure> {
  return Effect.gen(function* () {
    const sourceIdentity = yield* captureWorkspaceDirectoryIdentity(sourceCwd, "workspace source");
    const source = sourceIdentity.canonical;
    const runRoot = yield* canonicalRunRoot(runDir, true);
    const run = runRoot.canonical;
    const workspaceRoot = workspaceRootPath(run);
    if (pathWithin(run, source) && !pathWithin(workspaceRoot, source)) {
      return yield* Effect.fail(workflowError(
        "schedule",
        source,
        `cannot allocate a workspace inside Piano run directory "${run}"`,
      ));
    }
    const sourceInfo = yield* io.stat(source);
    if (!sourceInfo.isDirectory()) {
      return yield* Effect.fail(workflowError("schedule", source, "workspace source must be a directory"));
    }
    const key = yield* mapSlotKey(jobOrdinal, frames);
    const cwd = workspacePath(run, key);
    if (!pathWithin(source, run) && pathWithin(source, cwd)) {
      return yield* Effect.fail(workflowError("schedule", cwd, `workspace for map slot "${key}" cannot be nested inside its source`));
    }
    const recordPath = workspaceRecordPath(run, key);
    yield* assertCanonicalRunRoot(runRoot);
    yield* assertSafeWorkspacePathAncestors(run, dirname(recordPath));
    let existing = yield* readWorkspaceRecord(recordPath, { key, cwd, sourceCwd: source });
    // A sweep interrupted between removing the worktree and deleting the
    // record leaves a "cleaning" record whose lane is already gone: finish
    // the sweep instead of reporting a missing slot.
    if (existing?.phase === "cleaning") {
      const present = yield* pathExists(existing.cwd);
      if (!present) {
        yield* removeWorkspaceRecord(recordPath, runRoot);
        existing = undefined;
      }
    }
    if (existing !== undefined) {
      const current = existing;
      if (current.mnemonic !== mnemonic) {
        return yield* Effect.fail(workflowError(
          "schedule",
          recordPath,
          `workspace slot "${key}" belongs to lane namespace "${current.mnemonic}"`,
        ));
      }
      yield* assertOwnedWorkspace(workspaceRoot, current).pipe(
        Effect.catchIf(isMissingLeaf, () => Effect.fail(
          workflowError("schedule", recordPath, `workspace slot "${key}" is missing at ${current.cwd}`),
        )),
      );
      return bindingFromRecord(current, recordPath);
    }

    yield* assertCanonicalRunRoot(runRoot);
    yield* assertSafeWorkspacePathAncestors(run, dirname(cwd));
    yield* io.mkdir(dirname(cwd), { recursive: true });
    yield* assertSafeWorkspacePathAncestors(run, dirname(cwd));
    const occupied = yield* io.lstat(cwd).pipe(
      Effect.catchIf(isMissingLeaf, () => Effect.succeed(undefined)),
    );
    if (occupied !== undefined) {
      return yield* Effect.fail(workflowError("schedule", cwd, `workspace for map slot "${key}" already exists`));
    }

    return { kind: "pending", sourceIdentity, source, runRoot, run, key, cwd, recordPath };
  });
}

/** Create the lane worktree and its record for a prepared slot. */
function allocatePreparedMapSlot(
  pending: PendingMapSlot,
  fork: MapLaneFork,
  options: { readonly mnemonic: string; readonly laneAllocator?: LaneNumberAllocator },
): Effect.Effect<WorkflowWorkspaceBinding, WorkspaceFailure> {
  return Effect.gen(function* () {
    const { sourceIdentity, source, runRoot, key, cwd, recordPath } = pending;
    const gitRoot = fork.gitRoot;
    const removeAllocatedWorkspace = (): Effect.Effect<void, WorkspaceFailure> =>
      Effect.gen(function* () {
        yield* assertCanonicalRunRoot(runRoot);
        yield* io.rm(cwd, { recursive: true, force: true });
        yield* io.execFile("git", ["-C", gitRoot, "worktree", "prune"]).pipe(Effect.catchAll(() => Effect.void));
      }).pipe(
        // If the run root changed, do not follow the replacement to clean
        // up; report the residue so recovery can inspect the original root.
        Effect.catchAll((failure) => Effect.fail(workflowError(
          "schedule",
          cwd,
          `allocated workspace cleanup failed: ${errorMessage(rawCause(failure))}`,
        ))),
      );
    const laneAllocator = options.laneAllocator ?? createLaneNumberAllocator();
    let laneBranch = "";
    const allocation = yield* Effect.gen(function* () {
      yield* assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
      yield* assertCanonicalRunRoot(runRoot);
      let addFailure: WorkspaceFailure | undefined;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const next = yield* laneAllocator.next({
          scanRoot: gitRoot,
          commonRoot: fork.commonRoot,
          mnemonic: options.mnemonic,
        });
        const branch = laneBranchName(options.mnemonic, next);
        const attempted = yield* addLaneWorktree(gitRoot, branch, cwd, fork.commit).pipe(Effect.either);
        if (attempted._tag === "Right") {
          laneBranch = branch;
          addFailure = undefined;
          break;
        }
        addFailure = attempted.left;
        // A concurrent allocation may have taken the number; the hint is
        // already advanced past it, so just try the next one.
        if (!errorMessage(rawCause(attempted.left)).includes("already exists")) break;
      }
      if (addFailure !== undefined) return yield* Effect.fail(addFailure);
    }).pipe(Effect.either);
    if (allocation._tag === "Left") {
      yield* removeAllocatedWorkspace();
      return yield* Effect.fail(allocation.left);
    }
    const now = new Date().toISOString();
    const record: WorkflowWorkspaceRecord = {
      version: 3,
      key,
      cwd,
      sourceCwd: source,
      strategy: fork.strategy,
      phase: "allocated",
      mnemonic: options.mnemonic,
      laneBranch,
      baseCommit: fork.commit,
      ...(fork.sourceBranch === undefined ? {} : { sourceBranch: fork.sourceBranch }),
      createdAt: now,
      updatedAt: now,
      gitRoot,
    };
    const written = yield* writeWorkspaceRecord(recordPath, record, runRoot).pipe(Effect.either);
    if (written._tag === "Left") {
      yield* removeAllocatedWorkspace();
      return yield* Effect.fail(written.left);
    }
    return bindingFromRecord(record, recordPath);
  });
}

/** Allocate one concrete map slot as a lane branch worktree. Git workspaces
 * own the branch in place; any other workspace gets branches in the run's own
 * store. Every lane is `tuna/<mnemonic>/lane-<n>` and survives cleanup. */
export function allocateMapWorkspace(
  runDir: string,
  runId: string,
  jobOrdinal: number,
  frames: readonly WorkflowRuntimeFrame[],
  sourceCwd: string,
  options: {
    readonly mnemonic: string;
    /** The region's fork. The walker passes one cached Effect so a resume
     * whose slots all exist never pays for a seed commit the allocation will
     * not use, and every slot that does need it shares the same fork. */
    readonly fork?: Effect.Effect<MapLaneFork, WorkflowError>;
    /** The execution's lane counter; omitted callers get a fresh allocator
     * (one scan per allocation). */
    readonly laneAllocator?: LaneNumberAllocator;
  },
): Effect.Effect<WorkflowWorkspaceBinding, WorkflowError, FileSystem.FileSystem | Logging> {
  return TRACE(WORKSPACE_SOURCE, Effect.gen(function* () {
    const prepared = yield* prepareMapSlot(runDir, jobOrdinal, frames, sourceCwd, options.mnemonic).pipe(
      Effect.mapError((failure) => failureAt(sourceCwd, failure)),
    );
    if (prepared.kind !== "pending") return prepared;
    const fork = options.fork === undefined
      ? yield* prepareMapLaneFork(prepared.source, {
        runDir: prepared.run,
        runId,
        jobOrdinal,
        frames,
      })
      : yield* options.fork;
    return yield* allocatePreparedMapSlot(prepared, fork, options).pipe(
      Effect.mapError((failure) => failureAt(sourceCwd, failure)),
    );
  }), {
    runDir,
    runId,
    sourceCwd: resolve(sourceCwd),
    instanceId: runtimeInstanceId(frames),
  });
}

export interface WorkflowWorkspaceCleanupOptions {
  /** The source workspace is checked against every record before mutation. */
  readonly sourceCwd?: string;
  /** Limit finalization to these exact run-owned workspace keys. Omitted
   * sweeps every record of the execution. */
  readonly keys?: readonly string[];
  /** Limit finalization to run-owned keys with this prefix (e.g. `job-2/`).
   * The run-end backstop passes the current job's prefix so one job's
   * completion never sweeps a paused job's preserved slots — those exist
   * precisely so a continue can rebind them. */
  readonly keyPrefix?: string;
  /** Preserve slot directories and mark them reusable for recovery. */
  readonly preserve?: boolean;
}

function readWorkspaceRecords(
  runRoot: CanonicalRunRoot,
  sourceCwd?: string,
  keys?: readonly string[],
): Effect.Effect<readonly { readonly path: string; readonly record: WorkflowWorkspaceRecord }[], WorkspaceFailure> {
  return Effect.gen(function* () {
    yield* assertCanonicalRunRoot(runRoot);
    const run = runRoot.canonical;
    const recordsRoot = workspaceRecordRoot(run);
    const recordsRootInfo = yield* io.lstat(recordsRoot).pipe(
      Effect.catchIf(isMissingLeaf, () => Effect.succeed(undefined)),
    );
    if (recordsRootInfo === undefined) return [];
    yield* assertSafeWorkspaceDirectory(run, recordsRoot);
    const entries = yield* io.readdir(recordsRoot).pipe(
      Effect.catchIf(isMissingLeaf, () => Effect.succeed(undefined)),
    );
    if (entries === undefined) return [];
    let expectedSource: string | undefined;
    if (sourceCwd !== undefined) {
      expectedSource = yield* io.realpath(resolve(sourceCwd));
    }
    const selectedKeys = keys === undefined ? undefined : new Set(keys);
    const records: Array<{ readonly path: string; readonly record: WorkflowWorkspaceRecord }> = [];
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) {
        return yield* Effect.fail(workflowError("schedule", join(recordsRoot, entry.name), "workspace record directory cannot be a symlink"));
      }
      // `.removing` is the crash-safe trash an interrupted sweep leaves behind.
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const key = yield* Effect.try({
        try: () => decodeURIComponent(entry.name),
        catch: (error) => workflowError("schedule", join(recordsRoot, entry.name), `workspace record key is not encoded safely: ${errorMessage(error)}`),
      });
      if (selectedKeys !== undefined && !selectedKeys.has(key)) continue;
      yield* assertCanonicalRunRoot(runRoot);
      yield* assertSafeWorkspaceDirectory(run, join(recordsRoot, entry.name));
      const recordPath = join(recordsRoot, entry.name, "record.json");
      const expectedCwd = workspacePath(run, key);
      const record = yield* readWorkspaceRecord(recordPath, {
        key,
        cwd: expectedCwd,
      });
      if (record === undefined) {
        return yield* Effect.fail(workflowError("schedule", recordPath, "workspace record is missing"));
      }
      if (resolve(record.cwd) !== resolve(expectedCwd) || !pathWithin(run, resolve(record.cwd))) {
        return yield* Effect.fail(workflowError("schedule", recordPath, "workspace record points outside its execution directory"));
      }
      records.push({ path: recordPath, record });
    }
    if (expectedSource !== undefined) {
      for (const { path, record } of records) {
        const source = resolve(record.sourceCwd);
        if (source !== expectedSource) {
          return yield* Effect.fail(workflowError("schedule", path, "workspace record belongs to a different source workspace"));
        }
      }
    }
    return records;
  });
}

/** Commit a lane's remaining edits onto its own branch before the worktree is
 * removed. Every lane keeps its history — the branch is the lane version — so
 * a losing lane's work must not vanish with its working copy. */
function checkpointLane(record: WorkflowWorkspaceRecord): Effect.Effect<void, WorkspaceFailure> {
  return stageAndCommitWorktree(record.cwd, `piano: lane ${record.laneBranch} final state`).pipe(Effect.asVoid);
}

function removeWorkspaceDirectory(
  record: WorkflowWorkspaceRecord,
  runRoot: CanonicalRunRoot,
  executionRoot: string,
): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    yield* assertCanonicalRunRoot(runRoot);
    const info = yield* io.lstat(record.cwd).pipe(
      Effect.catchIf(isMissingLeaf, () => Effect.succeed(undefined)),
    );
    if (info === undefined) return;
    const kind: "directory" | "file" | "symlink" = info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : "file";
    const gitRoot = yield* assertOwnedWorkspace(executionRoot, record);
    if (kind !== "directory") {
      return yield* Effect.fail(workflowError("schedule", record.cwd, `refusing to cleanup non-directory workspace (${kind})`));
    }
    yield* checkpointLane(record);
    const removal = yield* Effect.gen(function* () {
      yield* assertCanonicalRunRoot(runRoot);
      yield* io.execFile("git", ["-C", gitRoot, "worktree", "remove", "--force", record.cwd]);
    }).pipe(Effect.either);
    if (removal._tag === "Left") {
      // A failed Git removal leaves the worktree admin entry uncertain. Keep
      // the directory intact so recovery can repair Git and retry cleanup.
      return yield* Effect.fail(workflowError("schedule", record.cwd, `git worktree cleanup failed: ${errorMessage(rawCause(removal.left))}`));
    }
    if (yield* pathExists(record.cwd)) {
      return yield* Effect.fail(workflowError("schedule", record.cwd, "git worktree cleanup reported success but the workspace still exists"));
    }
  });
}

/** Sweep every slot in one execution: a preserved slot keeps its record and
 * worktree, every other slot loses both. Idempotent, and interrupted sweeps
 * are finished by the next cleanup or allocation. */
export function cleanupMapWorkspaces(
  runDir: string,
  options: WorkflowWorkspaceCleanupOptions = {},
): Effect.Effect<readonly WorkflowWorkspaceRecord[], WorkflowError, Logging> {
  return Effect.gen(function* () {
    const runRoot = yield* canonicalRunRoot(runDir, false);
    const all = yield* readWorkspaceRecords(runRoot, options.sourceCwd, options.keys);
    const prefix = options.keyPrefix;
    const selected = prefix === undefined
      ? all
      : all.filter(({ record }) => record.key.startsWith(prefix));
    const depth = new Map(selected.map(({ record }) => [record.key, record.key.split("/").length]));
    // Deepest key first: a nested lane's repository root is its parent lane,
    // so the child worktree must be removed while the parent still exists.
    const records = selected.slice().sort((left, right) =>
      (depth.get(right.record.key) ?? 0) - (depth.get(left.record.key) ?? 0)
      || right.record.key.localeCompare(left.record.key));
    const finalized: WorkflowWorkspaceRecord[] = [];
    for (const { path, record } of records) {
      const now = new Date().toISOString();
      if (options.preserve === true) {
        // A preserved slot is advertised as recoverable. Validate the
        // concrete directory before recording that state; metadata-only
        // preservation must never bless a substituted symlink or node.
        yield* assertOwnedWorkspace(runRoot.canonical, record);
        const preserved: WorkflowWorkspaceRecord = {
          ...record,
          phase: "preserved",
          updatedAt: now,
        };
        yield* writeWorkspaceRecord(path, preserved, runRoot);
        finalized.push(preserved);
        continue;
      }
      const cleaning: WorkflowWorkspaceRecord = { ...record, phase: "cleaning", updatedAt: now };
      yield* writeWorkspaceRecord(path, cleaning, runRoot);
      yield* removeWorkspaceDirectory(cleaning, runRoot, runRoot.canonical);
      // The lane branch is the durable record now: cleanup leaves no
      // tombstone, so a later sweep finds nothing to re-read.
      yield* removeWorkspaceRecord(path, runRoot);
    }
    return finalized;
  }).pipe(Effect.mapError((failure) => failureAt(runDir, failure)));
}

/** Provenance of how a tournament winner was carried into the parent scope.
 * Both routes are deterministic program work: a git-worktree slot is merged
 * (its worktree is committed on the lane branch and git fast-forwards the
 * parent — git is the delta, the record, and the verification), while a
 * store-worktree slot (non-Git sources) has its frozen delta copied into the
 * parent and verified by the engine. No worker turn decides a carry.
 * Persisted Trajectory records may also carry the legacy `worker-consolidated`
 * value written by older runs; the trajectory schema keeps accepting it, but
 * this runtime never produces it. */
export type WorkflowCarryKind =
  | "git-merged"
  | "delta-applied"
  | "admitted-not-carried"
  | "carry-failed";

/** Whether a carry kind means the winner's work reached the parent scope. */
export function carryLanded(kind: WorkflowCarryKind): boolean {
  return kind === "git-merged" || kind === "delta-applied";
}

export interface WorkflowCarrying {
  readonly kind: WorkflowCarryKind;
  /** The winner commit the worker produced when it chose a git route. */
  readonly commit?: string;
  /** Human-readable failure detail when carry-failed / not-carried. */
  readonly reason?: string;
}

/** Two content trees' comparison result. */
interface WorkspaceContentDiff {
  readonly equal: boolean;
  /** Relative paths (sorted) that differ or exist only on one side. */
  readonly differing: readonly string[];
}

export interface WorkspaceContentChange {
  readonly path: string;
  readonly kind: "added" | "modified" | "deleted";
}

export interface WorkspaceChangeSet {
  /** Frozen winner files. Deleted paths are represented only in `changes`. */
  readonly winnerContentDir: string;
  readonly changes: readonly WorkspaceContentChange[];
}

export type WorkspaceLstatNodeKind = "file" | "directory" | "symlink" | "fifo" | "other";
const WORKSPACE_ROOT_PATH = "";

/** A rollback inventory deliberately records unsupported nodes instead of
 * applying the strict application-content gate. Symlinks are leaves: their
 * targets are recorded textually and never traversed. */
export interface WorkspaceLstatEntry {
  readonly path: string;
  readonly kind: WorkspaceLstatNodeKind;
  readonly mode: number;
  readonly symlinkTarget?: string;
  readonly contentHash?: string;
}

function assertSafeWorkspaceAncestors(root: string, path: string): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    const segments = workspacePathSegments(path);
    let current = resolve(root);
    const rootInfo = yield* io.lstat(current);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      return yield* Effect.fail(workflowError("schedule", current, "workspace rollback refuses a symlink or non-directory root"));
    }
    const rootRealpath = yield* io.realpath(current);
    if (resolve(rootRealpath) !== current) {
      return yield* Effect.fail(workflowError("schedule", current, "workspace rollback refuses a symlink or non-directory root"));
    }
    const caseInsensitive = yield* isCaseInsensitiveFileSystem(current);
    if (segments.some((segment) => isProtectedWorkspaceName(segment, caseInsensitive))) {
      return yield* Effect.fail(workflowError("schedule", root, `unsafe workspace rollback path: ${path}`));
    }
    for (const segment of segments.slice(0, -1)) {
      current = join(current, segment);
      const info = yield* io.lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        return yield* Effect.fail(workflowError("schedule", current, "workspace rollback refuses a symlink or non-directory ancestor"));
      }
      const ancestorRealpath = yield* io.realpath(current);
      if (resolve(ancestorRealpath) !== current) {
        return yield* Effect.fail(workflowError("schedule", current, "workspace rollback refuses a symlink ancestor"));
      }
    }
  });
}

function safeWorkspaceNodePath(root: string, path: string): string {
  const segments = workspacePathSegments(path);
  if (
    path.trim() === "" ||
    isAbsolute(path) ||
    (sep === "\\" && /^[A-Za-z]:/u.test(path)) ||
    segments.some((segment) => segment === "" || segment === "." || segment === ".." || protectedWorkspaceNames.has(segment))
  ) {
    throw workflowError("schedule", root, `unsafe workspace rollback path: ${path}`);
  }
  const candidate = resolve(root, ...segments);
  if (!pathWithin(resolve(root), candidate)) {
    throw workflowError("schedule", root, `workspace rollback path escapes its root: ${path}`);
  }
  return candidate;
}

/** Verify a run-owned slot without following a substituted directory. The
 * lexical check protects the record boundary; lstat plus realpath checks
 * protect every ancestor and the final slot against symlink replacement. */
function assertSafeWorkspaceDirectory(root: string, candidate: string): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    const canonicalRoot = yield* io.realpath(root);
    const lexicalCandidate = resolve(candidate);
    if (!pathWithin(canonicalRoot, lexicalCandidate)) {
      return yield* Effect.fail(workflowError("schedule", candidate, "workspace path escapes its execution directory"));
    }

    const segments = workspacePathSegments(relative(canonicalRoot, lexicalCandidate)).filter((segment) => segment !== "");
    let current = canonicalRoot;
    for (const segment of segments) {
      current = join(current, segment);
      const info = yield* io.lstat(current);
      if (info.isSymbolicLink()) {
        return yield* Effect.fail(workflowError("schedule", current, "workspace slot refuses a symlink ancestor or directory substitution"));
      }
      if (!info.isDirectory()) {
        return yield* Effect.fail(workflowError("schedule", current, "workspace slot has a non-directory ancestor"));
      }
      const actual = yield* io.realpath(current);
      if (resolve(actual) !== resolve(current) || !pathWithin(canonicalRoot, actual)) {
        return yield* Effect.fail(workflowError("schedule", current, "workspace slot realpath escapes its execution directory"));
      }
    }
  });
}

/** The record path alone is not ownership: an interrupted cleanup can leave
 * another ordinary directory at the same pathname. A lane is a git worktree,
 * and its `.git` file names the admin directory the owning repository keeps
 * for it. The rule is that this admin entry lives under the owner's own
 * `worktrees/` folder — not a per-slot marker, just membership in the one
 * repository the record names. Returns that owning repository root. This is
 * still a check-then-use guard: a same-UID attacker can race the final
 * filesystem operation; eliminating that residual requires descriptor/openat2
 * sandboxing. */
function assertRunOwnedWorkspaceDirectory(
  root: string,
  candidate: string,
  gitRoot: string | undefined,
): Effect.Effect<string, WorkspaceFailure> {
  return Effect.gen(function* () {
    yield* assertSafeWorkspaceDirectory(root, candidate);
    if (gitRoot === undefined) {
      return yield* Effect.fail(workflowError("schedule", candidate, "workspace slot has no owning repository"));
    }
    const pointer = yield* io.readText(join(candidate, ".git")).pipe(
      Effect.catchIf(isMissingLeaf, () => Effect.fail(
        workflowError("schedule", candidate, "workspace slot is not a run-owned worktree"),
      )),
    );
    const adminDir = /^gitdir:\s*(.+)$/mu.exec(pointer)?.[1];
    if (adminDir === undefined) {
      return yield* Effect.fail(workflowError("schedule", candidate, "workspace slot is not a run-owned worktree"));
    }
    const admin = resolve(candidate, adminDir);
    const owner = yield* gitWorktreeAdminParent(gitRoot);
    if (!pathWithin(owner, admin, false)) {
      return yield* Effect.fail(workflowError("schedule", candidate, `workspace slot worktree does not belong to ${gitRoot}`));
    }
    return gitRoot;
  });
}

/** The full lane-ownership rule, once: the directory is a run-owned worktree
 * of `record.gitRoot`, it is checked out on the record's lane branch, that
 * branch still points at the worktree's HEAD, and a source-owned lane's
 * repository is still the source's own. */
function assertOwnedWorkspace(
  root: string,
  record: WorkflowWorkspaceRecord,
): Effect.Effect<string, WorkspaceFailure> {
  return Effect.gen(function* () {
    const gitRoot = yield* assertRunOwnedWorkspaceDirectory(root, record.cwd, record.gitRoot);
    // One process: the worktree shares the repository's refs, so both the tip
    // and the branch can be resolved from inside the lane.
    const tips = yield* io.execFile("git", [
      "-C", record.cwd,
      "rev-parse", "HEAD", `refs/heads/${record.laneBranch}`,
    ]).pipe(
      Effect.map((result) => result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)),
      Effect.catchAll(() => Effect.succeed([] as string[])),
    );
    if (tips.length !== 2 || tips[0] !== tips[1]) {
      return yield* Effect.fail(workflowError("schedule", record.cwd, `workspace slot is not checked out on its lane branch ${record.laneBranch}`));
    }
    if (record.strategy === "git-worktree") yield* assertGitRootBound(record.sourceCwd, gitRoot);
    return gitRoot;
  });
}

function regularFileHash(root: string, path: string): Effect.Effect<string, WorkspaceFailure> {
  return Effect.gen(function* () {
    yield* assertSafeWorkspaceAncestors(root, path);
    const filePath = yield* guard(() => safeWorkspaceNodePath(root, path));
    // O_NOFOLLOW/O_NONBLOCK open, stat, read, and a close that cannot replace
    // the operation result all live in the adapter.
    const { info, content } = yield* io.readFileNoFollow(filePath);
    if (!info.isFile()) {
      return yield* Effect.fail(workflowError("schedule", filePath, "workspace rollback refuses a non-regular file"));
    }
    return createHash("sha256").update(content).digest("hex");
  });
}

function lstatEntryEqual(left: WorkspaceLstatEntry, right: WorkspaceLstatEntry): boolean {
  return left.kind === right.kind &&
    left.mode === right.mode &&
    left.symlinkTarget === right.symlinkTarget &&
    left.contentHash === right.contentHash;
}

/**
 * Build a tolerant, lstat-only inventory for rollback. This is intentionally
 * separate from `collectContentPaths`: the normal gate must reject external
 * symlinks, directory symlinks, and special nodes, while rollback must be able
 * to name and remove those nodes without reading through them.
 */
function inventoryWorkspaceLstatInternal(
  root: string,
  excluded: readonly string[] = [],
): Effect.Effect<readonly WorkspaceLstatEntry[], WorkspaceFailure> {
  return Effect.gen(function* () {
    yield* io.realpath(root);
    const caseInsensitive = yield* isCaseInsensitiveFileSystem(root);
    const excludedUnder = excluded.map((entry) => resolve(entry));
    const effectiveExcluded = excludedUnder.filter((entry) => resolve(root) !== entry && !pathWithin(entry, resolve(root)));
    const reachable = (candidate: string): boolean =>
      effectiveExcluded.every((entry) => !pathWithin(entry, resolve(candidate)));
    const protectsExcludedDescendant = (candidate: string): boolean =>
      effectiveExcluded.some((entry) => pathWithin(resolve(candidate), entry));
    const entries: WorkspaceLstatEntry[] = [];
    const rootInfo = yield* io.lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      return yield* Effect.fail(workflowError("schedule", root, "workspace rollback refuses a symlink or non-directory root"));
    }
    entries.push({ path: WORKSPACE_ROOT_PATH, kind: "directory", mode: rootInfo.mode & 0o7777 });

    const visit = (directory: string): Effect.Effect<void, WorkspaceFailure> => Effect.gen(function* () {
      const directoryInfo = yield* io.lstat(directory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
        return yield* Effect.fail(workflowError("schedule", directory, "workspace rollback refuses a symlink or non-directory ancestor"));
      }
      const children = yield* io.readdir(directory);
      for (const entry of children) {
        if (isProtectedWorkspaceName(entry.name, caseInsensitive)) continue;
        const entryPath = join(directory, entry.name);
        if (!reachable(entryPath)) continue;
        const info = yield* io.lstat(entryPath);
        const path = relative(root, entryPath);
        const base = { path, mode: info.mode & 0o7777 };
        if (info.isSymbolicLink()) {
          // readlink does not resolve the target. Do not call realpath here.
          entries.push({ ...base, kind: "symlink", symlinkTarget: yield* io.readlink(entryPath) });
        } else if (info.isDirectory()) {
          // Do not make an ancestor of an excluded run subtree a rollback root:
          // removing that ancestor would also delete the evidence we promised to
          // preserve. Non-excluded descendants are still inventoried below.
          if (!protectsExcludedDescendant(entryPath)) entries.push({ ...base, kind: "directory" });
          yield* visit(entryPath);
        } else if (info.isFile()) {
          entries.push({ ...base, kind: "file", contentHash: yield* regularFileHash(root, path) });
        } else if (info.isFIFO()) {
          // Never read a FIFO: doing so can block or consume another process's
          // stream. The path is still part of the rollback inventory.
          entries.push({ ...base, kind: "fifo" });
        } else {
          entries.push({ ...base, kind: "other" });
        }
      }
    });

    yield* visit(root);
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  });
}

/** Diff two tolerant lstat inventories. Unsupported nodes are reported as
 * ordinary changed paths; no target is resolved and no special node is read. */
function diffWorkspaceLstatInternal(
  baselineRoot: string,
  candidateRoot: string,
  excluded: readonly string[] = [],
): Effect.Effect<readonly WorkspaceContentChange[], WorkspaceFailure> {
  return Effect.gen(function* () {
    const [baseline, candidate] = yield* Effect.all([
      inventoryWorkspaceLstatInternal(baselineRoot, excluded),
      inventoryWorkspaceLstatInternal(candidateRoot, excluded),
    ], { concurrency: "unbounded" });
    const baselineByPath = new Map(baseline.map((entry) => [entry.path, entry]));
    const candidateByPath = new Map(candidate.map((entry) => [entry.path, entry]));
    const changes: WorkspaceContentChange[] = [];
    for (const path of [...new Set([...baselineByPath.keys(), ...candidateByPath.keys()])].sort()) {
      const before = baselineByPath.get(path);
      const after = candidateByPath.get(path);
      if (before === undefined) changes.push({ path, kind: "added" });
      else if (after === undefined) changes.push({ path, kind: "deleted" });
      else if (!lstatEntryEqual(before, after)) changes.push({ path, kind: "modified" });
    }
    return changes;
  });
}

function removeWorkspaceLstatNode(root: string, path: string): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    yield* guard(() => safeWorkspaceNodePath(root, path));
    yield* assertSafeWorkspaceAncestors(root, path);
    const node = yield* guard(() => safeWorkspaceNodePath(root, path));
    yield* io.rm(node, { recursive: true, force: true });
  });
}

function copyWorkspaceLstatNode(
  sourceRoot: string,
  targetRoot: string,
  path: string,
): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    const source = yield* guard(() => safeWorkspaceNodePath(sourceRoot, path));
    const target = yield* guard(() => safeWorkspaceNodePath(targetRoot, path));
    yield* assertSafeWorkspaceAncestors(sourceRoot, path);
    yield* assertSafeWorkspaceAncestors(targetRoot, path);
    const info = yield* io.lstat(source);
    if (info.isSymbolicLink()) {
      const target0 = yield* io.readlink(source);
      yield* io.symlink(target0, target);
      return;
    }
    if (info.isFile()) {
      yield* io.cp(source, target, { dereference: false });
      yield* io.chmod(target, info.mode & 0o7777);
      return;
    }
    if (info.isDirectory()) {
      yield* io.mkdir(target, { recursive: true });
      const children = yield* io.readdir(source);
      for (const entry of children) {
        yield* copyWorkspaceLstatNode(sourceRoot, targetRoot, join(path, entry.name));
      }
      yield* io.chmod(target, info.mode & 0o7777);
      return;
    }
    return yield* Effect.fail(workflowError("schedule", source, "workspace rollback cannot recreate a special baseline node"));
  });
}

function isWorkspacePathAncestor(parent: string, child: string): boolean {
  const parentSegments = workspacePathSegments(parent);
  const childSegments = workspacePathSegments(child);
  return childSegments.length > parentSegments.length &&
    parentSegments.every((segment, index) => childSegments[index] === segment);
}

function workspacePathDepth(path: string): number {
  return workspacePathSegments(path).length;
}

/** Restore a tolerant lstat diff without traversing symlink ancestors. This
 * exists for rollback only; it does not weaken `diffWorkspaceChangeSet()` or the
 * normal strict gate. */
function restoreWorkspaceLstatInternal(
  targetRoot: string,
  baselineRoot: string,
  changes?: readonly WorkspaceContentChange[],
  excluded: readonly string[] = [],
): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    const effectiveChanges = changes ?? (yield* diffWorkspaceLstatInternal(baselineRoot, targetRoot, excluded));
    yield* assertSafeWorkspaceAncestors(targetRoot, "root");
    yield* assertSafeWorkspaceAncestors(baselineRoot, "root");
    const baselineRootInfo = yield* io.lstat(baselineRoot);
    if (!baselineRootInfo.isDirectory() || baselineRootInfo.isSymbolicLink()) {
      return yield* Effect.fail(workflowError("schedule", baselineRoot, "workspace rollback baseline root is not a real directory"));
    }
    for (const change of effectiveChanges) {
      if (change.path !== WORKSPACE_ROOT_PATH) yield* guard(() => safeWorkspaceNodePath(targetRoot, change.path));
    }
    const ordered = [...effectiveChanges].sort((left, right) =>
      workspacePathDepth(left.path) - workspacePathDepth(right.path) || left.path.localeCompare(right.path));
    // Remove only the highest changed path in each subtree. If a baseline
    // directory became a symlink (or FIFO), the diff also contains its former
    // children as deleted; removing those children after the parent would
    // either fail on a missing ancestor or risk traversing the replacement.
    const roots = ordered.filter((change) =>
      !ordered.some((candidate) => candidate.path !== change.path && isWorkspacePathAncestor(candidate.path, change.path)));
    for (const change of roots) {
      if (change.path !== WORKSPACE_ROOT_PATH) yield* removeWorkspaceLstatNode(targetRoot, change.path);
    }

    // Restoring a changed directory restores its complete baseline subtree.
    for (const change of roots) {
      if (change.path !== WORKSPACE_ROOT_PATH && change.kind !== "added") {
        yield* copyWorkspaceLstatNode(baselineRoot, targetRoot, change.path);
      }
    }
    yield* io.chmod(targetRoot, baselineRootInfo.mode & 0o7777);
    const remaining = yield* diffWorkspaceLstatInternal(baselineRoot, targetRoot, excluded);
    if (remaining.length > 0) {
      return yield* Effect.fail(workflowError("schedule", targetRoot, `workspace rollback verification failed: ${remaining.map((change) => change.path).join(", ")}`));
    }
  });
}

function collectContentPaths(
  root: string,
  excluded: readonly string[] = [],
  directoryModes?: Map<string, number>,
): Effect.Effect<readonly string[], WorkspaceFailure> {
  return Effect.gen(function* () {
    const paths: string[] = [];
    const resolvedRoot = yield* io.realpath(root);
    const caseInsensitive = yield* isCaseInsensitiveFileSystem(resolvedRoot);
    const excludedUnder = excluded.map((entry) => resolve(entry));
    // An exclusion only makes sense as a subtree *of this tree*. The shared
    // source embeds its run-management directory (evidence/workspaces) as one
    // such subtree, and infra names (.git/.piano-run.lock) are always skipped by
    // name below. A winner slot is materialised *under* that same run directory,
    // so its walking root is nested inside an exclusion path: applying that
    // exclusion here would empty the whole winner tree. Only honour an exclusion
    // that is properly contained within the walked root.
    const effectiveExcluded = excludedUnder.filter((entry) => resolve(root) !== entry && !pathWithin(entry, resolve(root)));
    const resolvedExclusions = yield* Effect.all(
      effectiveExcluded.map((entry) => io.realpath(entry).pipe(Effect.catchAll(() => Effect.succeed(entry)))),
      { concurrency: "unbounded" },
    );
    const excludedRoots = [
      join(resolvedRoot, ".git"),
      ...resolvedExclusions,
    ];
    const reachable = (candidate: string): boolean =>
      effectiveExcluded.every((entry) => !pathWithin(entry, resolve(candidate)));
    const protectsExcludedDescendant = (candidate: string): boolean =>
      effectiveExcluded.some((entry) => pathWithin(resolve(candidate), entry));
    const excludedTarget = (candidate: string): boolean =>
      isProtectedWorkspacePath(resolvedRoot, candidate, caseInsensitive) ||
      excludedRoots.some((entry) => pathWithin(entry, candidate));
    const validateNode = (
      entryPath: string,
      info: WorkspaceStat,
    ): Effect.Effect<void, WorkspaceFailure> => Effect.gen(function* () {
      if (info.isSymbolicLink()) {
        const target = yield* io.realpath(entryPath);
        if (!pathWithin(resolvedRoot, target) || excludedTarget(target)) {
          return yield* Effect.fail(workflowError("schedule", entryPath, `workspace content symlink targets excluded or external content: ${target}`));
        }
        const targetInfo = yield* io.stat(target);
        if (!targetInfo.isFile()) {
          return yield* Effect.fail(workflowError("schedule", entryPath, "workspace content does not support directory symlinks or non-file targets"));
        }
        return;
      }
      if (!info.isFile() && !info.isDirectory()) {
        return yield* Effect.fail(workflowError("schedule", entryPath, "workspace content contains an unsupported filesystem node"));
      }
    });
    const visit = (directory: string): Effect.Effect<void, WorkspaceFailure> => Effect.gen(function* () {
      const children = yield* io.readdir(directory);
      for (const entry of children) {
        const entryPath = join(directory, entry.name);
        if (isProtectedWorkspaceName(entry.name, caseInsensitive)) continue;
        if (!reachable(entryPath)) continue;
        const info = yield* io.lstat(entryPath);
        yield* validateNode(entryPath, info);
        if (info.isDirectory()) {
          if (!protectsExcludedDescendant(entryPath)) {
            directoryModes?.set(relative(root, entryPath), info.mode & 0o7777);
          }
          yield* visit(entryPath);
        } else paths.push(relative(root, entryPath));
      }
    });
    yield* visit(root);
    return paths.sort();
  });
}

function pathExists(path: string): Effect.Effect<boolean, WorkspaceFailure> {
  return io.lstat(path).pipe(
    Effect.as(true),
    // ENOTDIR means a non-directory ancestor already replaced this subtree
    // (a winner can turn `a/b` into a file at `a`), so no node exists here.
    Effect.catchIf(isGoneLeaf, () => Effect.succeed(false)),
  );
}

/** Exact byte equality, the comparison `Buffer.equals` performed before the
 * read went through the io adapter (which returns Uint8Array). */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameFile(left: string, right: string): Effect.Effect<boolean, WorkspaceFailure> {
  return Effect.gen(function* () {
    const infos = yield* Effect.all([
      io.lstat(left),
      io.lstat(right),
    ], { concurrency: "unbounded" }).pipe(
      Effect.catchIf(isMissingLeaf, () => Effect.succeed([undefined, undefined] as const)),
    );
    const leftInfo = infos[0];
    const rightInfo = infos[1];
    if (leftInfo === undefined || rightInfo === undefined) return false;
    if (leftInfo.isSymbolicLink() || rightInfo.isSymbolicLink()) {
      if (!leftInfo.isSymbolicLink() || !rightInfo.isSymbolicLink()) return false;
      const [leftTarget, rightTarget] = yield* Effect.all([
        io.readlink(left),
        io.readlink(right),
      ], { concurrency: "unbounded" });
      return leftTarget === rightTarget;
    }
    if (!leftInfo.isFile() || !rightInfo.isFile()) return false;
    if ((leftInfo.mode & 0o7777) !== (rightInfo.mode & 0o7777)) return false;
    const [leftBuffer, rightBuffer] = yield* Effect.all([
      io.readFile(left),
      io.readFile(right),
    ], { concurrency: "unbounded" });
    return sameBytes(leftBuffer, rightBuffer);
  });
}

function copyContentNode(source: string, destination: string): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    const info = yield* io.lstat(source);
    if (info.isSymbolicLink()) {
      const target = yield* io.readlink(source);
      if (isAbsolute(target) || /^[A-Za-z]:[\\/]/u.test(target)) {
        return yield* Effect.fail(workflowError("schedule", source, "workspace content snapshot refuses absolute symlink targets"));
      }
      yield* io.symlink(target, destination);
      return;
    }
    if (!info.isFile()) {
      return yield* Effect.fail(workflowError("schedule", source, "workspace content can only copy regular files or file symlinks"));
    }
    yield* io.cp(source, destination, { dereference: false });
    yield* io.chmod(destination, info.mode & 0o7777);
  });
}

/** Freeze a strict, rollback-capable workspace snapshot. The strict content
 * validation remains the source of truth: external/directory symlinks and
 * special nodes are rejected before anything is copied. The extra directory
 * metadata is ignored by the content gate but lets rollback restore empty
 * directories and permission modes exactly. */
function snapshotWorkspaceLstatInternal(
  sourceContentDir: string,
  snapshotDir: string,
  excludeUnder: readonly string[] = [],
): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    const exists = yield* io.stat(snapshotDir).pipe(
      Effect.as(true),
      Effect.catchIf(isMissingLeaf, () => Effect.succeed(false)),
    );
    if (exists) return yield* Effect.fail(workflowError("schedule", snapshotDir, "workspace rollback snapshot already exists"));
    const canonicalSourceRoot = yield* io.realpath(resolve(sourceContentDir));
    const sourceInfo = yield* io.lstat(canonicalSourceRoot);
    if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
      return yield* Effect.fail(workflowError("schedule", sourceContentDir, "workspace rollback snapshot requires a real directory root"));
    }
    const directoryModes = new Map<string, number>();
    const paths = yield* collectContentPaths(canonicalSourceRoot, excludeUnder, directoryModes);
    yield* io.mkdir(snapshotDir, { recursive: true });
    for (const path of [...directoryModes.keys()].sort((left, right) =>
      workspacePathDepth(left) - workspacePathDepth(right) || left.localeCompare(right))) {
      yield* io.mkdir(join(snapshotDir, path), { recursive: true });
    }
    for (const path of paths) {
      const destination = join(snapshotDir, path);
      yield* io.mkdir(dirname(destination), { recursive: true });
      yield* copyContentNode(join(canonicalSourceRoot, path), destination);
    }
    for (const [path, mode] of [...directoryModes.entries()].sort((left, right) =>
      workspacePathDepth(right[0]) - workspacePathDepth(left[0]) || right[0].localeCompare(left[0]))) {
      yield* io.chmod(join(snapshotDir, path), mode);
    }
    yield* io.chmod(snapshotDir, sourceInfo.mode & 0o7777);
  });
}

/** A frozen workspace content baseline: one git commit in the run's own
 * baseline store. The commit shares blobs across lanes and iterations instead
 * of copying the tree once per lane. */
export interface WorkspaceBaseline {
  /** The run whose store holds the commit. */
  readonly runDir: string;
  /** The commit every lane delta and target-before comparison reads. */
  readonly commit: string;
}

/** The identity commits made by piano itself carry. */
const PIANO_GIT_IDENTITY_ARGS = ["-c", "user.name=Piano", "-c", "user.email=piano@localhost"] as const;

/** The run-owned baseline store. Bare, so it never becomes part of a
 * workspace's content and never touches a host repository. */
function workspaceBaselineStore(runDir: string): Effect.Effect<string, WorkspaceFailure> {
  return Effect.gen(function* () {
    const storeDir = workspaceStorePath(runDir);
    if (!(yield* io.exists(join(storeDir, "HEAD")))) {
      yield* io.mkdir(dirname(storeDir), { recursive: true });
      yield* io.execFile("git", ["init", "--bare", "--quiet", storeDir]);
    }
    return storeDir;
  });
}

/** A ref name under refs/piano/<runId>/, spelled so git accepts it. */
export function workspaceRefName(runId: string, suffix: string): string {
  return `refs/piano/${runId}/${suffix.replace(/[^A-Za-z0-9._/-]/g, "_").replace(/\.\./g, "~")}`;
}

function readBaselineCommit(storeDir: string, refName: string): Effect.Effect<string | undefined, WorkspaceFailure> {
  return io.execFile("git", ["--git-dir", storeDir, "rev-parse", "--verify", "--quiet", refName]).pipe(
    Effect.map((result) => result.stdout.trim()),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );
}

/** Index a workspace's content into one git tree, fail-closed: the walk is
 * the same validation and exclusion the directory snapshots used, and the
 * NUL pathspec feeds git exactly the paths it accepted. `gitArgs`/`env` pick
 * the owning repository — the run's store or the source itself. */
function writeContentTree(options: {
  readonly contentDir: string;
  readonly excludeUnder: readonly string[];
  readonly scratchDir: string;
  readonly gitArgs: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}): Effect.Effect<string, WorkspaceFailure> {
  return Effect.gen(function* () {
    const contentDir = yield* io.realpath(resolve(options.contentDir));
    const paths = yield* collectContentPaths(contentDir, options.excludeUnder);
    const pathspecPath = join(options.scratchDir, `piano-pathspec-${randomUUID()}`);
    const indexPath = join(options.scratchDir, `piano-index-${randomUUID()}`);
    const env = { ...options.env, GIT_INDEX_FILE: indexPath };
    return yield* Effect.gen(function* () {
      yield* io.writeFile(pathspecPath, paths.map((path) => `${path}\0`).join(""));
      yield* io.execFile("git", [
        ...options.gitArgs,
        "add", "-f",
        "--pathspec-from-file", pathspecPath,
        "--pathspec-file-nul",
      ], { cwd: contentDir, env });
      const result = yield* io.execFile("git", [...options.gitArgs, "write-tree"], { env });
      return result.stdout.trim();
    }).pipe(Effect.ensuring(Effect.gen(function* () {
      yield* io.rm(pathspecPath, { force: true });
      yield* io.rm(indexPath, { force: true });
    }).pipe(Effect.catchAll(() => Effect.void))));
  });
}

function writeWorkspaceTree(
  storeDir: string,
  sourceContentDir: string,
  excludeUnder: readonly string[],
): Effect.Effect<string, WorkspaceFailure> {
  return Effect.gen(function* () {
    const contentDir = yield* io.realpath(resolve(sourceContentDir));
    return yield* writeContentTree({
      contentDir,
      excludeUnder,
      scratchDir: storeDir,
      gitArgs: [],
      env: { ...process.env, GIT_DIR: storeDir, GIT_WORK_TREE: contentDir },
    });
  });
}

/** Freeze workspace content as one commit, once. The ref is the completion
 * marker: creating it is atomic, so a re-entry under a continue reuses the
 * commit instead of re-freezing, and a freeze interrupted before the ref
 * simply leaves unreachable objects. A `parent` gives the commit its place in
 * the run's lineage — a lane's baseline hangs off the region's parent
 * baseline, which is what a later worktree fork of that lane reads. */
function freezeWorkspaceBaselineInternal(
  sourceContentDir: string,
  options: {
    readonly runDir: string;
    /** The ref that names the commit and doubles as the freeze-once token.
     * Omitted when the caller keeps the commit in memory only. */
    readonly refName?: string;
    readonly excludeUnder?: readonly string[];
  },
): Effect.Effect<WorkspaceBaseline, WorkspaceFailure> {
  return Effect.gen(function* () {
    const storeDir = yield* workspaceBaselineStore(options.runDir);
    const prior = options.refName === undefined ? undefined : yield* readBaselineCommit(storeDir, options.refName);
    if (prior !== undefined) return { runDir: options.runDir, commit: prior };
    const tree = yield* writeWorkspaceTree(storeDir, sourceContentDir, options.excludeUnder ?? []);
    const result = yield* io.execFile("git", [
      "--git-dir", storeDir,
      ...PIANO_GIT_IDENTITY_ARGS,
      "commit-tree", tree,
      "-m", `piano: workspace baseline ${options.refName ?? "in-memory"}`,
    ]);
    const commit = result.stdout.trim();
    if (options.refName !== undefined) {
      yield* io.execFile("git", ["--git-dir", storeDir, "update-ref", options.refName!, commit, ""]);
    }
    return { runDir: options.runDir, commit };
  });
}

/** The concrete file delta from a frozen baseline to live content. Content is
 * compared the way git compares it — bytes plus the executable bit; other
 * permission bits and empty directories are not modeled. */
function workspaceBaselineChangesInternal(
  baseline: WorkspaceBaseline,
  candidateContentDir: string,
  excludeUnder: readonly string[] = [],
): Effect.Effect<readonly WorkspaceContentChange[], WorkspaceFailure> {
  return Effect.gen(function* () {
    const storeDir = yield* workspaceBaselineStore(baseline.runDir);
    const tree = yield* writeWorkspaceTree(storeDir, candidateContentDir, excludeUnder);
    // -z keeps pathnames verbatim (no C-quoting of backslashes and the like),
    // as `status\0path\0` pairs.
    const result = yield* io.execFile("git", [
      "--git-dir", storeDir,
      "diff-tree", "-r", "--name-status", "--no-renames", "-z",
      baseline.commit, tree,
    ]);
    const fields = result.stdout.split("\0");
    const changes: WorkspaceContentChange[] = [];
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const code = fields[index]!;
      const path = fields[index + 1]!;
      if (path === "") continue;
      changes.push({ path, kind: code === "A" ? "added" : code === "D" ? "deleted" : "modified" });
    }
    return changes.sort((left, right) => left.path.localeCompare(right.path));
  });
}

/** Validate a delta path's parent chain and, for installs, create missing
 * directories. Returns false when an ancestor no longer exists and the caller
 * is deleting: the subtree is already gone, so there is nothing to remove.
 * A symlink or non-directory ancestor is refused before any mutation. */
function prepareWorkspaceDeltaPath(
  targetRoot: string,
  path: string,
  create: boolean,
): Effect.Effect<boolean, WorkspaceFailure> {
  return Effect.gen(function* () {
    const segments = workspacePathSegments(path);
    let current = resolve(targetRoot);
    for (const segment of segments.slice(0, -1)) {
      current = join(current, segment);
      const attempted = yield* io.lstat(current).pipe(Effect.either);
      if (attempted._tag === "Left") {
        if (!isMissingLeaf(attempted.left)) return yield* Effect.fail(attempted.left);
        if (!create) return false;
        yield* io.mkdir(current);
        continue;
      }
      const info = attempted.right;
      if (!info.isDirectory() || info.isSymbolicLink()) {
        return yield* Effect.fail(workflowError("schedule", current, "workspace carry refuses a symlink or non-directory ancestor"));
      }
      const actual = yield* io.realpath(current);
      if (resolve(actual) !== current) {
        return yield* Effect.fail(workflowError("schedule", current, "workspace carry refuses a symlink or non-directory ancestor"));
      }
    }
    return true;
  });
}

/** Non-directory entries that differ between the pre-apply snapshot and the
 * target, excluding the delta itself. Directories are ignored on purpose: the
 * delta model is git trees, which never record empty directories or directory
 * modes. */
function undeclaredWorkspaceChanges(
  beforeDir: string,
  targetRoot: string,
  declared: ReadonlySet<string>,
  excluded: readonly string[],
): Effect.Effect<readonly string[], WorkspaceFailure> {
  return Effect.gen(function* () {
    const [before, after] = yield* Effect.all([
      inventoryWorkspaceLstatInternal(beforeDir),
      inventoryWorkspaceLstatInternal(targetRoot, excluded),
    ], { concurrency: "unbounded" });
    const contentEntries = (entries: readonly WorkspaceLstatEntry[]): Map<string, WorkspaceLstatEntry> =>
      new Map(entries.filter((entry) => entry.kind !== "directory").map((entry) => [entry.path, entry]));
    const left = contentEntries(before);
    const right = contentEntries(after);
    const differing: string[] = [];
    for (const path of new Set([...left.keys(), ...right.keys()])) {
      if (declared.has(path)) continue;
      const previous = left.get(path);
      const current = right.get(path);
      if (previous === undefined || current === undefined || !lstatEntryEqual(previous, current)) {
        differing.push(path);
      }
    }
    return differing.sort();
  });
}

/** Apply a winner delta to a live tree, fail-closed.
 *
 * Every path is either removed or overwritten with the exact node from
 * `winnerContentDir`; nothing else in the target is touched. The target is
 * snapshotted before the first mutation, so a failure restores the pre-apply
 * tree and re-verifies it. This is the store-lane counterpart of a git
 * fast-forward: the program applies the delta and the program verifies it. */
function applyWorkspaceChangeSetInternal(
  targetRoot: string,
  changeSet: WorkspaceChangeSet,
  excluded: readonly string[] = [],
): Effect.Effect<void, WorkspaceFailure> {
  return Effect.gen(function* () {
    const target = resolve(targetRoot);
    const staging = yield* io.mkdtemp(join(dirname(target), ".piano-carry-"));
    const before = join(staging, "before");
    let snapshotCreated = false;
    const operation = yield* Effect.gen(function* () {
      yield* snapshotWorkspaceLstatInternal(target, before, excluded);
      snapshotCreated = true;
      // Deletions first: a winner may replace a directory with a file, and the
      // copy would otherwise collide with the old subtree still in place.
      for (const change of changeSet.changes) {
        if (change.kind !== "deleted") continue;
        const node = yield* guard(() => safeWorkspaceNodePath(target, change.path));
        if (!(yield* prepareWorkspaceDeltaPath(target, change.path, false))) continue;
        yield* io.rm(node, { recursive: true, force: true });
      }
      const installed = changeSet.changes
        .filter((change) => change.kind !== "deleted")
        .sort((left, right) =>
          workspacePathDepth(left.path) - workspacePathDepth(right.path) || left.path.localeCompare(right.path));
      for (const change of installed) {
        const destination = yield* guard(() => safeWorkspaceNodePath(target, change.path));
        yield* prepareWorkspaceDeltaPath(target, change.path, true);
        if (yield* pathExists(destination)) yield* io.rm(destination, { recursive: true, force: true });
        yield* copyContentNode(join(changeSet.winnerContentDir, change.path), destination);
      }
      const applied = yield* diffWorkspaceChangeSetInternal(target, changeSet);
      if (!applied.equal) {
        return yield* Effect.fail(workflowError("schedule", target, `winner delta did not land at: ${applied.differing.join(", ")}`));
      }
      const undeclared = yield* undeclaredWorkspaceChanges(
        before,
        target,
        new Set(changeSet.changes.map((change) => change.path)),
        excluded,
      );
      if (undeclared.length > 0) {
        return yield* Effect.fail(workflowError("schedule", target, `winner delta changed undeclared paths: ${undeclared.join(", ")}`));
      }
    }).pipe(Effect.either);
    let rollbackFailure: WorkspaceFailure | undefined;
    // Without a completed snapshot there is nothing to restore, and the target
    // is untouched: the snapshot step is the first filesystem write.
    if (operation._tag === "Left" && snapshotCreated) {
      const rollback = yield* restoreWorkspaceLstatInternal(target, before, undefined, excluded).pipe(Effect.either);
      if (rollback._tag === "Left") rollbackFailure = rollback.left;
    }
    let cleanupFailure: WorkflowError | undefined;
    // A failed rollback keeps the snapshot: it is the only copy of the pre-apply
    // tree, so the error names where it lives instead of deleting it.
    if (rollbackFailure === undefined) {
      const cleanup = yield* io.rm(staging, { recursive: true, force: true }).pipe(Effect.either);
      if (cleanup._tag === "Left") {
        cleanupFailure = workflowError("schedule", staging, `workspace carry cleanup failed: ${errorMessage(rawCause(cleanup.left))}`);
      }
    }
    if (operation._tag === "Left") {
      const failures: unknown[] = [rawCause(operation.left)];
      if (rollbackFailure !== undefined) {
        failures.push(workflowError(
          "schedule",
          target,
          `workspace carry rollback failed (pre-apply snapshot kept at ${before}): ${errorMessage(rawCause(rollbackFailure))}`,
        ));
      }
      if (cleanupFailure !== undefined) failures.push(cleanupFailure);
      if (failures.length > 1) {
        return yield* Effect.fail(io.ioError("applyWorkspaceChangeSet", undefined, new AggregateError(
          failures,
          "workspace carry failed and recovery was incomplete",
        )));
      }
      return yield* Effect.fail(operation.left);
    }
    if (cleanupFailure !== undefined) return yield* Effect.fail(cleanupFailure);
  });
}

/** Check only the winner delta against a target; unrelated parent files are
 * outside this gate and therefore cannot force destructive whole-tree sync.
 *
 * A deleted path may still exist as a directory when the winner replaced a
 * file with a directory at the same path (git reports `D a` plus `A a/child`).
 * That directory is the declaration's new parent, not the deleted node, so it
 * only counts as satisfied when the change set carries additions beneath it. */
function diffWorkspaceChangeSetInternal(
  targetContentDir: string,
  changeSet: WorkspaceChangeSet,
): Effect.Effect<WorkspaceContentDiff, WorkspaceFailure> {
  return Effect.gen(function* () {
    const differing: string[] = [];
    for (const change of changeSet.changes) {
      const target = join(targetContentDir, change.path);
      if (change.kind === "deleted") {
        if (!(yield* pathExists(target))) continue;
        const replacedByDirectory = changeSet.changes.some((other) =>
          other.kind !== "deleted" && isWorkspacePathAncestor(change.path, other.path));
        const isDirectory = yield* io.lstat(target).pipe(
          Effect.map((info) => info.isDirectory()),
          Effect.catchAll(() => Effect.succeed(false)),
        );
        if (!(replacedByDirectory && isDirectory)) differing.push(change.path);
        continue;
      }
      if (!(yield* sameFile(target, join(changeSet.winnerContentDir, change.path)))) {
        differing.push(change.path);
      }
    }
    return { equal: differing.length === 0, differing };
  });
}

/** Commit the lane's remaining edits onto its branch and fast-forward the
 * source checkout onto it. The lane branch always keeps the commit, so a
 * failed fast-forward loses nothing. `changed` is false when the lane
 * committed no edits (its fork point is the winner). */
function mergeGitWorktreeWinner(
  record: WorkflowWorkspaceRecord,
  gitRoot: string,
  sourceIdentity: WorkspaceDirectoryIdentity,
): Effect.Effect<{ readonly commit: string; readonly changed: boolean; readonly merged: boolean; readonly reason?: string }, WorkspaceFailure> {
  return Effect.gen(function* () {
    const { commit, changed } = yield* commitWorktreeChanges(
      record.cwd,
      `piano: apply winning tournament slot ${record.key}`,
    );
    // No edits: the fork point is the winner and is already on the source.
    if (!changed) return { commit, changed, merged: true };
    if (record.sourceBranch !== undefined) {
      const current = yield* io.execFile("git", ["-C", record.sourceCwd, "symbolic-ref", "--quiet", "--short", "HEAD"]).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.catchAll(() => Effect.succeed("")),
      );
      if (current !== record.sourceBranch) {
        return {
          commit,
          changed,
          merged: false,
          reason: `source branch "${record.sourceBranch}" is no longer checked out (now "${current === "" ? "detached" : current}"); winner kept on ${record.laneBranch}`,
        };
      }
    }
    yield* assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source before Git merge");
    const merged = yield* Effect.gen(function* () {
      yield* io.execFile("git", ["-C", gitRoot, "merge", "--ff-only", record.laneBranch]);
      yield* assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source after Git merge");
    }).pipe(Effect.either);
    if (merged._tag === "Right") return { commit, changed, merged: true };
    if (merged.left instanceof WorkflowError) return yield* Effect.fail(merged.left);
    // The source advanced past the lane's fork point during the run, so a
    // fast-forward is impossible. The lane branch keeps the winner commit for
    // the operator to merge or inspect; cleanup removes only the worktree.
    return { commit, changed, merged: false, reason: errorMessage(rawCause(merged.left)) };
  });
}

export interface WorkflowWinnerResult {
  readonly key: string;
  readonly method: "git-ff" | "git-no-changes" | "delta-applied";
  readonly commit?: string;
  /** The winner was not carried: a git source could not fast-forward, or the
   * parent scope changed a path the winner also changed. The winner's content
   * stays in its slot/lane branch. */
  readonly skipped?: { readonly reason: string };
}

/** Apply one selected slot directly to the declared source workspace. The
 * winner is never materialized as a second run-owned "winner" directory.
 *
 * A source-owned lane is committed on its own branch and fast-forwarded onto
 * the source checkout (true lineage: the working tree now *is* the winner's
 * committed tree). A store-worktree lane — the fallback for non-Git sources —
 * has the winner's baseline-relative delta copied into the source and verified;
 * parent files outside that delta are never touched. Both routes are program
 * work: nothing asks a worker to apply the winner. */
export function applyWinnerWorkspace(
  runDir: string,
  winnerKey: string,
  sourceCwd: string,
): Effect.Effect<WorkflowWinnerResult, WorkflowError, Logging> {
  return Effect.gen(function* () {
    const runRoot = yield* canonicalRunRoot(runDir, false);
    const sourceIdentity = yield* captureWorkspaceDirectoryIdentity(sourceCwd, "workspace source");
    const source = sourceIdentity.canonical;
    const run = runRoot.canonical;
    const recordPath = workspaceRecordPath(run, winnerKey);
    const record = yield* readWorkspaceRecord(recordPath, {
      key: winnerKey,
      cwd: workspacePath(run, winnerKey),
      sourceCwd: source,
    });
    if (record === undefined) {
      return yield* Effect.fail(workflowError("schedule", run, `winner workspace "${winnerKey}" is not owned by this execution`));
    }
    const gitRoot = yield* assertOwnedWorkspace(run, record).pipe(
      Effect.catchIf(isMissingLeaf, () => Effect.fail(
        workflowError("schedule", recordPath, `winner workspace is missing at ${record.cwd}`),
      )),
    );
    const applying: WorkflowWorkspaceRecord = {
      ...record,
      phase: "applying",
      updatedAt: new Date().toISOString(),
    };
    yield* writeWorkspaceRecord(recordPath, applying, runRoot);
    yield* assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
    yield* assertCanonicalRunRoot(runRoot);
    if (applying.strategy === "git-worktree") {
      const merged = yield* mergeGitWorktreeWinner(applying, gitRoot, sourceIdentity);
      const result: WorkflowWinnerResult = {
        key: applying.key,
        method: merged.changed === true ? "git-ff" : "git-no-changes",
        commit: merged.commit,
        ...(merged.merged === false ? { skipped: { reason: merged.reason ?? `source advanced; winner kept on ${applying.laneBranch}` } } : {}),
      };
      return result;
    }
    // The lane's fork commit is the parent's drift reference too: every
    // sibling forked from it, so a parent change on any winner path is a
    // genuine conflict and refuses the carry instead of clobbering it.
    const baseline: WorkspaceBaseline = { runDir: run, commit: applying.baseCommit };
    // Both comparisons index the winner into the shared store (each with its
    // own index file), so both siblings must settle before the first failure
    // is reported.
    const [changesOutcome, parentOutcome] = yield* Effect.all([
      workspaceBaselineChangesInternal(baseline, applying.cwd, [run]),
      workspaceBaselineChangesInternal(baseline, source, [run]),
    ], { concurrency: "unbounded", mode: "either" });
    if (changesOutcome._tag === "Left") return yield* Effect.fail(changesOutcome.left);
    if (parentOutcome._tag === "Left") return yield* Effect.fail(parentOutcome.left);
    const changes = changesOutcome.right;
    const parentChanges = parentOutcome.right;
    const winnerPaths = new Set(changes.map((change) => change.path));
    const conflicts = parentChanges.filter((change) => winnerPaths.has(change.path));
    if (conflicts.length > 0) {
      return {
        key: applying.key,
        method: "delta-applied" as const,
        skipped: { reason: `the tournament parent changed after branch allocation at: ${conflicts.map((change) => change.path).join(", ")}` },
      };
    }
    yield* assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source before delta apply");
    if (changes.length > 0) {
      yield* applyWorkspaceChangeSetInternal(source, { winnerContentDir: applying.cwd, changes }, [run]);
    }
    yield* assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source after delta apply");
    return { key: applying.key, method: "delta-applied" as const };
  }).pipe(Effect.mapError((failure) => failureAt(sourceCwd, failure)));
}

export function prepareMapLaneFork(
  sourceCwd: string,
  options: {
    readonly runDir: string;
    readonly runId: string;
    readonly jobOrdinal: number;
    readonly frames: readonly WorkflowRuntimeFrame[];
    readonly parent?: WorkflowWorkspaceBinding;
  },
): Effect.Effect<MapLaneFork, WorkflowError> {
  return prepareMapLaneForkInternal(sourceCwd, options).pipe(
    Effect.mapError((failure) => failureAt(sourceCwd, failure)),
  );
}

export function inventoryWorkspaceLstat(
  root: string,
  excluded: readonly string[] = [],
): Effect.Effect<readonly WorkspaceLstatEntry[], WorkflowError> {
  return inventoryWorkspaceLstatInternal(root, excluded).pipe(
    Effect.mapError((failure) => failureAt(root, failure)),
  );
}

export function diffWorkspaceLstat(
  baselineRoot: string,
  candidateRoot: string,
  excluded: readonly string[] = [],
): Effect.Effect<readonly WorkspaceContentChange[], WorkflowError> {
  return diffWorkspaceLstatInternal(baselineRoot, candidateRoot, excluded).pipe(
    Effect.mapError((failure) => failureAt(baselineRoot, failure)),
  );
}

export function restoreWorkspaceLstat(
  targetRoot: string,
  baselineRoot: string,
  changes?: readonly WorkspaceContentChange[],
  excluded: readonly string[] = [],
): Effect.Effect<void, WorkflowError> {
  return restoreWorkspaceLstatInternal(targetRoot, baselineRoot, changes, excluded).pipe(
    Effect.mapError((failure) => failureAt(targetRoot, failure)),
  );
}

export function snapshotWorkspaceLstat(
  sourceContentDir: string,
  snapshotDir: string,
  excludeUnder: readonly string[] = [],
): Effect.Effect<void, WorkflowError> {
  return snapshotWorkspaceLstatInternal(sourceContentDir, snapshotDir, excludeUnder).pipe(
    Effect.mapError((failure) => failureAt(snapshotDir, failure)),
  );
}

export function freezeWorkspaceBaseline(
  sourceContentDir: string,
  options: {
    readonly runDir: string;
    readonly refName?: string;
    readonly excludeUnder?: readonly string[];
  },
): Effect.Effect<WorkspaceBaseline, WorkflowError> {
  return freezeWorkspaceBaselineInternal(sourceContentDir, options).pipe(
    Effect.mapError((failure) => failureAt(sourceContentDir, failure)),
  );
}

export function workspaceBaselineChanges(
  baseline: WorkspaceBaseline,
  candidateContentDir: string,
  excludeUnder: readonly string[] = [],
): Effect.Effect<readonly WorkspaceContentChange[], WorkflowError> {
  return workspaceBaselineChangesInternal(baseline, candidateContentDir, excludeUnder).pipe(
    Effect.mapError((failure) => failureAt(candidateContentDir, failure)),
  );
}

export function applyWorkspaceChangeSet(
  targetRoot: string,
  changeSet: WorkspaceChangeSet,
  excluded: readonly string[] = [],
): Effect.Effect<void, WorkflowError> {
  return applyWorkspaceChangeSetInternal(targetRoot, changeSet, excluded).pipe(
    Effect.mapError((failure) => failureAt(targetRoot, failure)),
  );
}

export function diffWorkspaceChangeSet(
  targetContentDir: string,
  changeSet: WorkspaceChangeSet,
): Effect.Effect<WorkspaceContentDiff, WorkflowError> {
  return diffWorkspaceChangeSetInternal(targetContentDir, changeSet).pipe(
    Effect.mapError((failure) => failureAt(targetContentDir, failure)),
  );
}
