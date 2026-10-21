import { chmod, cp, lstat, mkdir, mkdtemp, open, readFile, readlink, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { TRACE, type Logging, type Source } from "@piano/logging";
import { errorMessage, isMissingPathError, WorkflowError, workflowError } from "./errors.js";
import { pathWithin } from "./path-within.js";
import { isWorkflowIdentifier } from "./workflow.js";
import {
  runtimeInstanceId,
  type WorkflowRuntimeFrame,
} from "./workflow-runtime.js";

const execFileAsync = promisify(execFile);

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
  readonly kind: "map-slot";
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
async function isCaseInsensitiveFileSystem(root: string): Promise<boolean> {
  const resolvedRoot = resolve(root);
  const rootInfo = await lstat(resolvedRoot);
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
    try {
      const candidateInfo = await lstat(candidateSegments.join(sep));
      if (candidateInfo.dev === rootInfo.dev && candidateInfo.ino === rootInfo.ino) return true;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
  }
  return false;
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

async function captureWorkspaceDirectoryIdentity(
  path: string,
  label: string,
): Promise<WorkspaceDirectoryIdentity> {
  const lexical = resolve(path);
  const canonical = await realpath(lexical);
  const info = await lstat(canonical);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw workflowError("schedule", lexical, `${label} must resolve to a real directory`);
  }
  return { lexical, canonical, dev: info.dev, ino: info.ino };
}

/** Identity checks are deliberately separate from the filesystem operations.
 * They close ordinary replacement/substitution paths; same-UID check-then-use
 * races still require descriptor/openat2 or sandbox enforcement (see the
 * explicit limitation at the destructive boundaries below). */
async function assertWorkspaceDirectoryIdentity(
  identity: WorkspaceDirectoryIdentity,
  label: string,
): Promise<void> {
  const actual = await realpath(identity.lexical);
  if (resolve(actual) !== identity.canonical) {
    throw workflowError("schedule", identity.lexical, `${label} realpath changed during workspace operation`);
  }
  const info = await lstat(identity.canonical);
  if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== identity.dev || info.ino !== identity.ino) {
    throw workflowError("schedule", identity.lexical, `${label} identity changed during workspace operation`);
  }
}

/** Validate the final runDir node before resolving it. Parent symlinks remain
 * supported, but the run root itself must always be a real directory. */
async function canonicalRunRoot(runDir: string, create: boolean): Promise<CanonicalRunRoot> {
  const lexical = resolve(runDir);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(lexical);
  } catch (error) {
    if (!isMissingPathError(error) || !create) throw error;
    await mkdir(lexical, { recursive: true });
    info = await lstat(lexical);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw workflowError(
      "schedule",
      lexical,
      "run directory must be a real directory; refusing a symlink or non-directory final node",
    );
  }
  const canonical = await realpath(lexical);
  const canonicalInfo = await lstat(canonical);
  if (canonicalInfo.isSymbolicLink() || !canonicalInfo.isDirectory()) {
    throw workflowError("schedule", lexical, "run directory resolved to a symlink or non-directory");
  }
  return { lexical, canonical, dev: canonicalInfo.dev, ino: canonicalInfo.ino };
}

/** Recheck the same run-root identity immediately before metadata or slot
 * mutation. This catches deletion/recreation and parent substitution while
 * retaining compatibility with a symlink in a runDir parent component. */
async function assertCanonicalRunRoot(root: CanonicalRunRoot): Promise<void> {
  const lexicalInfo = await lstat(root.lexical);
  if (lexicalInfo.isSymbolicLink() || !lexicalInfo.isDirectory()) {
    throw workflowError("schedule", root.lexical, "run directory was replaced by a symlink or non-directory");
  }
  const actual = await realpath(root.lexical);
  if (resolve(actual) !== root.canonical) {
    throw workflowError("schedule", root.lexical, "run directory realpath changed during workspace operation");
  }
  const canonicalInfo = await lstat(root.canonical);
  if (canonicalInfo.isSymbolicLink() || !canonicalInfo.isDirectory() ||
    canonicalInfo.dev !== root.dev || canonicalInfo.ino !== root.ino) {
    throw workflowError("schedule", root.lexical, "run directory identity changed during workspace operation");
  }
}

/** Check the existing portion of a run-owned path without resolving through a
 * missing tail. This lets first allocation create absent metadata directories
 * while rejecting a substituted ancestor before any mkdir/read/write. */
async function assertSafeWorkspacePathAncestors(root: string, candidate: string): Promise<void> {
  const canonicalRoot = resolve(root);
  const lexicalCandidate = resolve(candidate);
  if (!pathWithin(canonicalRoot, lexicalCandidate)) {
    throw workflowError("schedule", candidate, "workspace path escapes its canonical root");
  }
  let current = canonicalRoot;
  const segments = workspacePathSegments(relative(canonicalRoot, lexicalCandidate)).filter((segment) => segment !== "");
  for (const segment of segments) {
    current = join(current, segment);
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(current);
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw workflowError("schedule", current, "workspace path has a symlink or non-directory ancestor");
    }
    if (resolve(await realpath(current)) !== resolve(current)) {
      throw workflowError("schedule", current, "workspace path ancestor realpath changed");
    }
  }
}

function pathFromRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function workspacePath(runDir: string, key: string): string {
  return join(runDir, "workspaces", `worktree-${encodeURIComponent(key)}`);
}

function workspaceRecordPath(runDir: string, key: string): string {
  return join(runDir, "workspace-records", encodeURIComponent(key), "record.json");
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
): WorkflowWorkspaceRecord {
  if (!pathFromRecord(value)) {
    throw workflowError("schedule", recordPath, "workspace record must be an object");
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
    throw workflowError("schedule", recordPath, "workspace record has an unsupported or inconsistent format");
  }
  if (expected.sourceCwd !== undefined && resolve(value.sourceCwd) !== resolve(expected.sourceCwd)) {
    throw workflowError("schedule", recordPath, "workspace record belongs to a different source workspace");
  }
  if (parseLaneBranch(value.laneBranch)?.mnemonic !== value.mnemonic) {
    throw workflowError("schedule", recordPath, "workspace record has an unsupported or inconsistent lane identity");
  }
  if (value.sourceBranch !== undefined && typeof value.sourceBranch !== "string") {
    throw workflowError("schedule", recordPath, "workspace record sourceBranch must be a string");
  }
  return {
    version: 3,
    key: value.key,
    kind: "map-slot",
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
}

async function writeWorkspaceRecord(
  recordPath: string,
  record: WorkflowWorkspaceRecord,
  runRoot: CanonicalRunRoot,
): Promise<void> {
  const recordDir = dirname(recordPath);
  const assertRecordPathSafe = async (): Promise<void> => {
    await assertCanonicalRunRoot(runRoot);
    await assertSafeWorkspacePathAncestors(runRoot.canonical, recordDir);
  };
  await assertRecordPathSafe();
  const temporary = `${recordPath}.${randomUUID()}.tmp`;
  await mkdir(recordDir, { recursive: true });
  let operationFailure: unknown;
  try {
    await assertRecordPathSafe();
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await assertRecordPathSafe();
    await rename(temporary, recordPath);
    return;
  } catch (error) {
    operationFailure = error;
  }
  // Only a failed write/rename can leave the temporary behind. If the run root
  // was substituted, do not follow it merely to remove the residue.
  try {
    await assertRecordPathSafe();
    await rm(temporary, { force: true });
  } catch (error) {
    throw new AggregateError(
      [operationFailure, workflowError("schedule", temporary, `workspace record temporary cleanup failed: ${errorMessage(error)}`)],
      "workspace record write and cleanup both failed",
    );
  }
  throw operationFailure;
}

/** Delete one slot's record directory crash-atomically: rename it out of the
 * records tree first, so a crash leaves an ignorable trash entry instead of a
 * half-deleted record that every later read would reject. */
async function removeWorkspaceRecord(recordPath: string, runRoot: CanonicalRunRoot): Promise<void> {
  const recordDir = dirname(recordPath);
  const recordsRoot = dirname(recordDir);
  await assertCanonicalRunRoot(runRoot);
  await assertSafeWorkspacePathAncestors(runRoot.canonical, recordsRoot);
  const trash = join(recordsRoot, ".removing");
  await mkdir(trash, { recursive: true });
  const moved = join(trash, `${basename(recordDir)}.${randomUUID()}`);
  await rename(recordDir, moved);
  await rm(moved, { recursive: true, force: true });
}

async function readWorkspaceRecord(
  recordPath: string,
  expected: { readonly key: string; readonly cwd: string; readonly sourceCwd?: string },
): Promise<WorkflowWorkspaceRecord | undefined> {
  let recordInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    recordInfo = await lstat(recordPath);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
  if (recordInfo.isSymbolicLink() || !recordInfo.isFile()) {
    throw workflowError("schedule", recordPath, "workspace record must be a regular file");
  }
  let raw: string;
  try {
    raw = await readFile(recordPath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw workflowError("schedule", recordPath, `workspace record is not valid JSON: ${errorMessage(error)}`);
  }
  return parseWorkspaceRecord(value, expected, recordPath);
}


/** The map lane's workspace key. The job ordinal is part of the slot's
 * identity, not decoration: every job re-enters the same loop frames from
 * iteration zero, so a key without it collides with a previous job's
 * preserved slot record — or silently rebinds a leftover directory — the
 * moment a second prompt or a continue re-allocates the same slot. */
function mapSlotKey(jobOrdinal: number, frames: readonly WorkflowRuntimeFrame[]): string {
  if (!frames.some((frame) => frame.kind === "map")) {
    throw new WorkflowError({
      phase: "schedule",
      path: "workspace",
      message: "map workspace allocation requires an active map slot",
    });
  }
  const instanceId = runtimeInstanceId(frames);
  if (instanceId === undefined) {
    throw new WorkflowError({
      phase: "schedule",
      path: "workspace",
      message: "map workspace allocation has no runtime instance id",
    });
  }
  return `job-${jobOrdinal}/${instanceId}`;
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
async function inspectGitSource(source: string, run: string): Promise<GitSourceFacts | undefined> {
  let repository: GitRepositoryIdentity;
  try {
    repository = await gitRepositoryIdentity(source);
  } catch {
    return undefined;
  }
  const root = repository.worktreeRoot;
  // A workspace rooted below the repository root would make the worktree
  // include files outside the caller's declared workspace, and a run
  // embedded in the workspace is run management rather than application
  // content. Both shapes take the store-worktree strategy instead.
  if (root !== source || pathWithin(source, run)) return undefined;
  const [headResult, branchResult, statusResult] = await Promise.all([
    execFileAsync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], { encoding: "utf8" })
      .then((result) => result.stdout.trim())
      .catch(() => ""),
    execFileAsync("git", ["-C", root, "symbolic-ref", "--quiet", "--short", "HEAD"], { encoding: "utf8" })
      .then((result) => result.stdout.trim())
      .catch(() => ""),
    execFileAsync("git", ["-C", root, "status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" }),
  ]);
  const head = headResult;
  if (head === "") {
    throw workflowError("schedule", source, "workspace source repository has no commits to fork a lane from");
  }
  const branch = branchResult;
  if (branch === "") {
    throw workflowError("schedule", source, "workspace source HEAD is detached; check out a branch before running lanes");
  }
  const caseInsensitive = await isCaseInsensitiveFileSystem(root);
  const dirty = statusResult.stdout
    .split(/\r?\n/u)
    .map((line) => line.slice(3).trim())
    .some((path) => path !== "" && !isProtectedWorkspaceName(path, caseInsensitive));
  return { root, commonRoot: repository.commonRoot, dirty, head, branch };
}

interface GitRepositoryIdentity {
  readonly worktreeRoot: string;
  readonly commonRoot: string;
}

/** The repository's common git directory: the admin parent for every linked
 * worktree. `rev-parse --git-common-dir` names it for a working tree and for a
 * bare store alike. */
async function gitCommonDir(cwd: string): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
  const path = result.stdout.trim();
  return realpath(isAbsolute(path) ? path : resolve(cwd, path));
}

async function gitRepositoryIdentity(cwd: string): Promise<GitRepositoryIdentity> {
  // One spawn: rev-parse prints each requested value on its own line, in order.
  const result = await execFileAsync("git", [
    "-C", cwd,
    "rev-parse", "--show-toplevel", "--git-common-dir",
  ], { encoding: "utf8" });
  const [rootLine, commonLine] = result.stdout.split(/\r?\n/u);
  const commonPath = (commonLine ?? "").trim();
  return {
    worktreeRoot: await realpath((rootLine ?? "").trim()),
    commonRoot: await realpath(isAbsolute(commonPath) ? commonPath : resolve(cwd, commonPath)),
  };
}

/** Linked-worktree admin entries live under the owning repository's
 * `worktrees/` folder. */
async function gitWorktreeAdminParent(owner: string): Promise<string> {
  return join(await gitCommonDir(owner), "worktrees");
}

async function assertGitRootBound(sourceCwd: string, gitRoot: string): Promise<void> {
  const expected = await gitRepositoryIdentity(sourceCwd);
  const actual = await gitRepositoryIdentity(gitRoot);
  if (actual.worktreeRoot !== expected.worktreeRoot || actual.commonRoot !== expected.commonRoot) {
    throw workflowError(
      "schedule",
      gitRoot,
      `git workspace repository does not match source Git common root ${expected.commonRoot}`,
    );
  }
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
  /** Store path only: the ref holding the fork commit, used as the winner
   * delta base. */
  readonly baselineRef?: string;
}

/** Write the workspace content as one commit into the source repository,
 * without touching its index or any ref. The commit is reachable only through
 * the lane branches that fork from it. */
async function commitWorkspaceContent(
  source: string,
  options: { readonly runDir: string; readonly parent?: string; readonly message: string },
): Promise<string> {
  const scratch = join(options.runDir, "git");
  await mkdir(scratch, { recursive: true });
  const tree = await writeContentTree({
    contentDir: source,
    excludeUnder: [options.runDir],
    scratchDir: scratch,
    gitArgs: ["-C", source],
    env: process.env,
  });
  return (await execFileAsync("git", [
    "-C", source,
    ...PIANO_GIT_IDENTITY_ARGS,
    "commit-tree", tree,
    ...(options.parent === undefined ? [] : ["-p", options.parent]),
    "-m", options.message,
  ], { encoding: "utf8" })).stdout.trim();
}

/** Stage and commit a worktree's edits, one place for the piano identity and
 * the change check. Returns the tip and whether anything was committed. */
async function commitWorktreeChanges(
  cwd: string,
  message: string,
): Promise<{ readonly commit: string; readonly changed: boolean }> {
  const status = await execFileAsync("git", ["-C", cwd, "status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" });
  const changed = status.stdout.trim() !== "";
  if (changed) {
    await execFileAsync("git", ["-C", cwd, "add", "-A", "--", "."], { encoding: "utf8" });
    await execFileAsync("git", [
      "-C", cwd,
      ...PIANO_GIT_IDENTITY_ARGS,
      "commit", "-q", "-m", message,
    ], { encoding: "utf8" });
  }
  const commit = (await execFileAsync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" })).stdout.trim();
  return { commit, changed };
}

/** Resolve what this region's lanes fork from, once per entry. */
export async function prepareMapLaneFork(
  sourceCwd: string,
  options: {
    readonly runDir: string;
    readonly runId: string;
    readonly jobOrdinal: number;
    readonly frames: readonly WorkflowRuntimeFrame[];
    readonly parent?: WorkflowWorkspaceBinding;
  },
): Promise<MapLaneFork> {
  const run = (await canonicalRunRoot(options.runDir, true)).canonical;
  const source = await realpath(resolve(sourceCwd));
  const facts = await inspectGitSource(source, run);
  if (facts === undefined) {
    const baseline = await freezeWorkspaceBaseline(source, {
      runDir: run,
      refName: workspaceRefName(
        options.runId,
        `baselines/job-${options.jobOrdinal}/${encodeURIComponent(`${runtimeInstanceId(options.frames) ?? "root"}/fork`)}`,
      ),
      excludeUnder: [run],
    });
    const storeDir = await workspaceBaselineStore(run);
    return {
      strategy: "store-worktree",
      gitRoot: storeDir,
      commonRoot: storeDir,
      commit: baseline.commit,
      baselineRef: baseline.refName,
    };
  }
  if (options.parent?.kind === "map-slot" && facts.dirty) {
    // A nested tournament inside a lane: checkpoint the parent lane onto its
    // own branch so children fork from a commit that contains its edits.
    const { commit } = await commitWorktreeChanges(
      source,
      `piano: checkpoint lane ${facts.branch} before nested lanes`,
    );
    return { strategy: "git-worktree", gitRoot: source, commonRoot: facts.commonRoot, commit, sourceBranch: facts.branch };
  }
  if (facts.dirty) {
    const commit = await commitWorkspaceContent(source, {
      runDir: run,
      parent: facts.head,
      message: `piano: seed unsaved workspace content for ${facts.branch}`,
    });
    return { strategy: "git-worktree", gitRoot: source, commonRoot: facts.commonRoot, commit, sourceBranch: facts.branch };
  }
  return { strategy: "git-worktree", gitRoot: source, commonRoot: facts.commonRoot, commit: facts.head, sourceBranch: facts.branch };
}

/** The lane numbers already taken in this namespace, so allocation never
 * reuses one even though every branch survives cleanup. */
async function scanLaneNumbers(gitRoot: string, mnemonic: string): Promise<readonly number[]> {
  const result = await execFileAsync("git", [
    "-C", gitRoot,
    "for-each-ref", "--format=%(refname:short)", `refs/heads/tuna/${mnemonic}/`,
  ], { encoding: "utf8" });
  const numbers: number[] = [];
  for (const line of result.stdout.split(/\r?\n/u)) {
    const parsed = parseLaneBranch(line.trim());
    if (parsed?.mnemonic === mnemonic) numbers.push(parsed.laneNumber);
  }
  return numbers;
}

/** Allocates lane numbers for one execution: every `allocateMapWorkspace`
 * call of that execution must share the instance. Lane branches are never
 * deleted, so the next free number only grows; concurrent cold callers share
 * one scan and take consecutive numbers, and a collision just advances the
 * hint. */
export interface LaneNumberAllocator {
  next(input: { readonly scanRoot: string; readonly commonRoot: string; readonly mnemonic: string }): Promise<number>;
}

export function createLaneNumberAllocator(): LaneNumberAllocator {
  const hints = new Map<string, number>();
  const scans = new Map<string, Promise<number>>();
  const keyOf = (commonRoot: string, mnemonic: string): string => `${commonRoot}\0${mnemonic}`;
  return {
    async next({ scanRoot, commonRoot, mnemonic }) {
      const key = keyOf(commonRoot, mnemonic);
      const hinted = hints.get(key);
      if (hinted !== undefined) {
        hints.set(key, hinted + 1);
        return hinted;
      }
      let scan = scans.get(key);
      if (scan === undefined) {
        scan = scanLaneNumbers(scanRoot, mnemonic).then((taken) => {
          const next = taken.length === 0 ? 0 : Math.max(...taken) + 1;
          hints.set(key, next + 1);
          return next;
        });
        scans.set(key, scan);
        void scan.finally(() => scans.delete(key)).catch(() => undefined);
        return scan;
      }
      // A concurrent cold caller started the scan and reserved its result;
      // take the next hint once it resolves.
      const first = await scan;
      const next = hints.get(key) ?? first + 1;
      hints.set(key, next + 1);
      return next;
    },
  };
}

async function addLaneWorktree(gitRoot: string, branch: string, cwd: string, commit: string): Promise<void> {
  await execFileAsync("git", ["-C", gitRoot, "worktree", "add", "-b", branch, cwd, commit], { encoding: "utf8" });
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
    /** The region's fork, or a thunk resolving it. The walker passes a
     * memoized thunk so a resume whose slots all exist never pays for a seed
     * commit the allocation will not use. */
    readonly fork?: MapLaneFork | (() => Promise<MapLaneFork>);
    /** The execution's lane counter; omitted callers get a fresh allocator
     * (one scan per allocation). */
    readonly laneAllocator?: LaneNumberAllocator;
  },
): Effect.Effect<WorkflowWorkspaceBinding, WorkflowError, FileSystem.FileSystem | Logging> {
  return TRACE(WORKSPACE_SOURCE, Effect.tryPromise({
    try: async () => {
      const sourceIdentity = await captureWorkspaceDirectoryIdentity(sourceCwd, "workspace source");
      const source = sourceIdentity.canonical;
      const runRoot = await canonicalRunRoot(runDir, true);
      const run = runRoot.canonical;
      const workspaceRoot = join(run, "workspaces");
      if (pathWithin(run, source) && !pathWithin(workspaceRoot, source)) {
        throw workflowError(
          "schedule",
          source,
          `cannot allocate a workspace inside Piano run directory "${run}"`,
        );
      }
      const sourceInfo = await stat(source);
      if (!sourceInfo.isDirectory()) {
        throw workflowError("schedule", source, "workspace source must be a directory");
      }
      const key = mapSlotKey(jobOrdinal, frames);
      const cwd = workspacePath(run, key);
      if (!pathWithin(source, run) && pathWithin(source, cwd)) {
        throw workflowError("schedule", cwd, `workspace for map slot "${key}" cannot be nested inside its source`);
      }
      const recordPath = workspaceRecordPath(run, key);
      await assertCanonicalRunRoot(runRoot);
      await assertSafeWorkspacePathAncestors(run, dirname(recordPath));
      let existing = await readWorkspaceRecord(recordPath, { key, cwd, sourceCwd: source });
      // A sweep interrupted between removing the worktree and deleting the
      // record leaves a "cleaning" record whose lane is already gone: finish
      // the sweep instead of reporting a missing slot.
      if (existing?.phase === "cleaning" && !await pathExists(existing.cwd)) {
        await removeWorkspaceRecord(recordPath, runRoot);
        existing = undefined;
      }
      if (existing !== undefined) {
        if (existing.mnemonic !== options.mnemonic) {
          throw workflowError(
            "schedule",
            recordPath,
            `workspace slot "${key}" belongs to lane namespace "${existing.mnemonic}"`,
          );
        }
        try {
          await assertSafeWorkspaceDirectory(workspaceRoot, existing.cwd);
        } catch (error) {
          if (isMissingPathError(error)) {
            throw workflowError("schedule", recordPath, `workspace slot "${key}" is missing at ${existing.cwd}`);
          }
          throw error;
        }
        await assertOwnedWorkspace(workspaceRoot, existing);
        return bindingFromRecord(existing, recordPath);
      }

      await assertCanonicalRunRoot(runRoot);
      await assertSafeWorkspacePathAncestors(run, dirname(cwd));
      await mkdir(dirname(cwd), { recursive: true });
      await assertSafeWorkspacePathAncestors(run, dirname(cwd));
      try {
        await lstat(cwd);
        throw workflowError("schedule", cwd, `workspace for map slot "${key}" already exists`);
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }

      const supplied = options.fork;
      const fork = typeof supplied === "function"
        ? await supplied()
        : supplied ?? await prepareMapLaneFork(source, { runDir: run, runId, jobOrdinal, frames });
      const gitRoot = fork.gitRoot;
      const removeAllocatedWorkspace = async (): Promise<void> => {
        try {
          await assertCanonicalRunRoot(runRoot);
          await rm(cwd, { recursive: true, force: true });
          await execFileAsync("git", ["-C", gitRoot, "worktree", "prune"]).catch(() => undefined);
        } catch (error) {
          // If the run root changed, do not follow the replacement to clean
          // up; report the residue so recovery can inspect the original root.
          throw workflowError("schedule", cwd, `allocated workspace cleanup failed: ${errorMessage(error)}`);
        }
      };
      const laneAllocator = options.laneAllocator ?? createLaneNumberAllocator();
      let laneBranch = "";
      let addFailure: unknown;
      try {
        await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
        await assertCanonicalRunRoot(runRoot);
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const next = await laneAllocator.next({
            scanRoot: gitRoot,
            commonRoot: fork.commonRoot,
            mnemonic: options.mnemonic,
          });
          const branch = laneBranchName(options.mnemonic, next);
          try {
            await addLaneWorktree(gitRoot, branch, cwd, fork.commit);
            laneBranch = branch;
            addFailure = undefined;
            break;
          } catch (error) {
            addFailure = error;
            // A concurrent allocation may have taken the number; the hint is
            // already advanced past it, so just try the next one.
            if (!errorMessage(error).includes("already exists")) break;
          }
        }
        if (addFailure !== undefined) throw addFailure;
      } catch (error) {
        await removeAllocatedWorkspace();
        throw error;
      }
      const now = new Date().toISOString();
      const record: WorkflowWorkspaceRecord = {
        version: 3,
        key,
        kind: "map-slot",
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
      try {
        await writeWorkspaceRecord(recordPath, record, runRoot);
      } catch (error) {
        await removeAllocatedWorkspace();
        throw error;
      }
      return bindingFromRecord(record, recordPath);
    },
    catch: (cause) => cause instanceof WorkflowError
      ? cause
      : workflowError("schedule", sourceCwd, errorMessage(cause)),
  }), {
    runDir,
    runId,
    sourceCwd: resolve(sourceCwd),
    instanceId: runtimeInstanceId(frames),
  }).pipe(Effect.mapError((cause) => cause instanceof WorkflowError
    ? cause
    : workflowError("schedule", sourceCwd, errorMessage(cause))));
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

async function readWorkspaceRecords(
  runRoot: CanonicalRunRoot,
  sourceCwd?: string,
  keys?: readonly string[],
): Promise<readonly { readonly path: string; readonly record: WorkflowWorkspaceRecord }[]> {
  await assertCanonicalRunRoot(runRoot);
  const run = runRoot.canonical;
  const recordsRoot = join(run, "workspace-records");
  try {
    await lstat(recordsRoot);
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
  await assertSafeWorkspaceDirectory(run, recordsRoot);
  let entries;
  try {
    entries = await readdir(recordsRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
  const expectedSource = sourceCwd === undefined ? undefined : await realpath(resolve(sourceCwd));
  const selectedKeys = keys === undefined ? undefined : new Set(keys);
  const records: Array<{ readonly path: string; readonly record: WorkflowWorkspaceRecord }> = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) {
      throw workflowError("schedule", join(recordsRoot, entry.name), "workspace record directory cannot be a symlink");
    }
    // `.removing` is the crash-safe trash a completed sweep leaves behind.
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    let key: string;
    try {
      key = decodeURIComponent(entry.name);
    } catch (error) {
      throw workflowError("schedule", join(recordsRoot, entry.name), `workspace record key is not encoded safely: ${errorMessage(error)}`);
    }
    if (selectedKeys !== undefined && !selectedKeys.has(key)) continue;
    await assertCanonicalRunRoot(runRoot);
    await assertSafeWorkspaceDirectory(run, join(recordsRoot, entry.name));
    const recordPath = join(recordsRoot, entry.name, "record.json");
    const expectedCwd = workspacePath(run, key);
    const record = await readWorkspaceRecord(recordPath, {
      key,
      cwd: expectedCwd,
    });
    if (record === undefined) {
      throw workflowError("schedule", recordPath, "workspace record is missing");
    }
    if (resolve(record.cwd) !== resolve(expectedCwd) || !pathWithin(run, resolve(record.cwd))) {
      throw workflowError("schedule", recordPath, "workspace record points outside its execution directory");
    }
    records.push({ path: recordPath, record });
  }
  if (expectedSource !== undefined) {
    for (const { path, record } of records) {
      const source = resolve(record.sourceCwd);
      if (source !== expectedSource) {
        throw workflowError("schedule", path, "workspace record belongs to a different source workspace");
      }
    }
  }
  return records;
}

/** Commit a lane's remaining edits onto its own branch before the worktree is
 * removed. Every lane keeps its history — the branch is the lane version — so
 * a losing lane's work must not vanish with its working copy. */
async function checkpointLane(record: WorkflowWorkspaceRecord): Promise<void> {
  await commitWorktreeChanges(record.cwd, `piano: lane ${record.laneBranch} final state`);
}

async function removeWorkspaceDirectory(
  record: WorkflowWorkspaceRecord,
  runRoot: CanonicalRunRoot,
  executionRoot: string,
): Promise<void> {
  await assertCanonicalRunRoot(runRoot);
  let kind: "directory" | "file" | "symlink" | "missing";
  try {
    const info = await lstat(record.cwd);
    kind = info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : "file";
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
  const gitRoot = await assertOwnedWorkspace(executionRoot, record);
  if (kind !== "directory") {
    throw workflowError("schedule", record.cwd, `refusing to cleanup non-directory workspace (${kind})`);
  }
  await checkpointLane(record);
  try {
    await assertCanonicalRunRoot(runRoot);
    await execFileAsync("git", ["-C", gitRoot, "worktree", "remove", "--force", record.cwd], { encoding: "utf8" });
  } catch (error) {
    // A failed Git removal leaves the worktree admin entry uncertain. Keep
    // the directory intact so recovery can repair Git and retry cleanup.
    throw workflowError("schedule", record.cwd, `git worktree cleanup failed: ${errorMessage(error)}`);
  }
  if (await pathExists(record.cwd)) {
    throw workflowError("schedule", record.cwd, "git worktree cleanup reported success but the workspace still exists");
  }
}

/** Sweep every slot in one execution: a preserved slot keeps its record and
 * worktree, every other slot loses both. Idempotent, and interrupted sweeps
 * are finished by the next cleanup or allocation. */
export function cleanupMapWorkspaces(
  runDir: string,
  options: WorkflowWorkspaceCleanupOptions = {},
): Effect.Effect<readonly WorkflowWorkspaceRecord[], WorkflowError, FileSystem.FileSystem | Logging> {
  return Effect.tryPromise({
    try: async () => {
      const runRoot = await canonicalRunRoot(runDir, false);
      const all = await readWorkspaceRecords(runRoot, options.sourceCwd, options.keys);
      const prefix = options.keyPrefix;
      // Deepest key first: a nested lane's repository root is its parent lane,
      // so the child worktree must be removed while the parent still exists.
      const records = (prefix === undefined
        ? all
        : all.filter(({ record }) => record.key.startsWith(prefix)))
        .slice()
        .sort((left, right) =>
          right.record.key.split("/").length - left.record.key.split("/").length
          || right.record.key.localeCompare(left.record.key));
      const finalized: WorkflowWorkspaceRecord[] = [];
      for (const { path, record } of records) {
        const now = new Date().toISOString();
        if (options.preserve === true) {
          // A preserved slot is advertised as recoverable. Validate the
          // concrete directory before recording that state; metadata-only
          // preservation must never bless a substituted symlink or node.
          await assertOwnedWorkspace(runRoot.canonical, record);
          const preserved: WorkflowWorkspaceRecord = {
            ...record,
            phase: "preserved",
            updatedAt: now,
          };
          await writeWorkspaceRecord(path, preserved, runRoot);
          finalized.push(preserved);
          continue;
        }
        const cleaning: WorkflowWorkspaceRecord = { ...record, phase: "cleaning", updatedAt: now };
        await writeWorkspaceRecord(path, cleaning, runRoot);
        await removeWorkspaceDirectory(cleaning, runRoot, runRoot.canonical);
        // The lane branch is the durable record now: cleanup leaves no
        // tombstone, so a later sweep finds nothing to re-read.
        await removeWorkspaceRecord(path, runRoot);
      }
      return finalized;
    },
    catch: (cause) => cause instanceof WorkflowError
      ? cause
      : workflowError("schedule", runDir, errorMessage(cause)),
  }).pipe(Effect.mapError((cause) => cause instanceof WorkflowError
    ? cause
    : workflowError("schedule", runDir, errorMessage(cause))));
}

/** Re-emit every validated file link from its original source spelling after
 * the copy: Node's recursive cp can canonicalise relative links. */
async function rewriteWorkspaceSymlinks(
  source: string,
  destination: string,
  skip: (path: string) => boolean,
): Promise<void> {
  const visit = async (sourcePath: string, destinationPath: string): Promise<void> => {
    if (skip(sourcePath)) return;
    const info = await lstat(sourcePath);
    if (info.isSymbolicLink()) {
      const rawTarget = await readlink(sourcePath);
      const resolvedTarget = await realpath(sourcePath);
      if (!pathWithin(source, resolvedTarget) || skip(resolvedTarget) || !(await stat(resolvedTarget)).isFile()) {
        throw workflowError(
          "schedule",
          sourcePath,
          "workspace content symlink target changed to external or directory content",
        );
      }
      const copied = await lstat(destinationPath);
      if (!copied.isSymbolicLink()) {
        throw workflowError("schedule", destinationPath, "workspace content symlink was not preserved by copy");
      }
      const target = isAbsolute(rawTarget)
        ? resolve(destination, relative(source, resolvedTarget))
        : rawTarget;
      await rm(destinationPath, { force: true });
      await symlink(target, destinationPath);
      return;
    }
    if (!info.isDirectory()) return;
    for (const entry of await readdir(sourcePath, { withFileTypes: true })) {
      await visit(join(sourcePath, entry.name), join(destinationPath, entry.name));
    }
  };
  await visit(source, destination);
}

async function applyWorkspaceContents(
  candidate: string,
  runRoot: CanonicalRunRoot,
  sourceIdentity: WorkspaceDirectoryIdentity,
): Promise<void> {
  const source = sourceIdentity.canonical;
  const run = runRoot.canonical;
  const stagingDirectory = await mkdtemp(join(dirname(source), ".piano-apply-"));
  const staged = join(stagingDirectory, "workspace");
  const before = join(stagingDirectory, "before");
  let beforeSnapshotCreated = false;
  let operationFailure: unknown;
  let rollbackFailure: unknown;
  let cleanupFailure: unknown;
  try {
    await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
    const candidateCaseInsensitive = await isCaseInsensitiveFileSystem(candidate);
    const skipCandidateEntry = (entry: string): boolean =>
      isProtectedWorkspacePath(candidate, entry, candidateCaseInsensitive);
    // The content gate is the shared fail-closed walk: external or directory
    // symlinks and special nodes are refused before anything is copied.
    await collectContentPaths(candidate);
    await cp(candidate, staged, {
      recursive: true,
      errorOnExist: true,
      force: false,
      dereference: false,
      filter: (entry) => !skipCandidateEntry(entry),
    });
    // Node's recursive copy can canonicalise relative links on some paths.
    // Re-emit every validated file link from its original candidate spelling
    // before the staged tree is used, so no link can point back at the slot.
    await rewriteWorkspaceSymlinks(candidate, staged, skipCandidateEntry);
    const sourceContainsRunDirectory = pathWithin(source, run);
    const runContainer = dirname(run);
    const sourceContainsRunContainer = sourceContainsRunDirectory && runContainer !== source;
    const sourceCaseInsensitive = await isCaseInsensitiveFileSystem(source);
    const excludedSourceSubtrees = sourceContainsRunDirectory && resolve(run) !== resolve(source) ? [run] : [];
    const protectedEntry = (entry: string): boolean => {
      return isProtectedWorkspacePath(source, entry, sourceCaseInsensitive) ||
        (sourceContainsRunDirectory && (pathWithin(run, resolve(entry)) || (sourceContainsRunContainer && pathWithin(runContainer, resolve(entry)))));
    };
    // Freeze the source before the first destructive operation. If any later
    // copy/rewrite step fails, this snapshot restores the complete application
    // tree while the protected Git/run entries remain untouched.
    await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
    await snapshotWorkspaceLstat(source, before, excludedSourceSubtrees);
    beforeSnapshotCreated = true;
    // These checks intentionally precede each destructive/use boundary. They
    // do not eliminate a same-UID check-then-use race; such callers require a
    // sandbox or descriptor/openat2-based implementation.
    await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
    const sourceEntries = await readdir(source);
    for (const entry of sourceEntries) {
      await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
      await assertCanonicalRunRoot(runRoot);
      if (!protectedEntry(join(source, entry))) await rm(join(source, entry), { recursive: true, force: true });
    }
    const stagedEntries = await readdir(staged);
    for (const entry of stagedEntries) {
      await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
      await assertCanonicalRunRoot(runRoot);
      if (protectedEntry(join(source, entry))) continue;
      await cp(join(staged, entry), join(source, entry), { recursive: true, force: true, dereference: false });
    }
    const skipStagedEntry = (entry: string): boolean => {
      const path = relative(staged, entry);
      return path === "" ? false : protectedEntry(join(source, path));
    };
    await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
    await rewriteWorkspaceSymlinks(staged, source, skipStagedEntry);
    await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
  } catch (error) {
    operationFailure = error;
    if (beforeSnapshotCreated) {
      try {
        await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source before rollback");
        const sourceContainsRunDirectory = pathWithin(source, run);
        const excludedSourceSubtrees = sourceContainsRunDirectory && resolve(run) !== resolve(source) ? [run] : [];
        await restoreWorkspaceLstat(source, before, undefined, excludedSourceSubtrees);
        await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source after rollback");
      } catch (error) {
        rollbackFailure = error;
      }
    }
  }
  try {
    await rm(stagingDirectory, { recursive: true, force: true });
  } catch (error) {
    cleanupFailure = workflowError("schedule", stagingDirectory, `workspace apply cleanup failed: ${errorMessage(error)}`);
  }
  if (operationFailure !== undefined) {
    const failures = [operationFailure];
    if (rollbackFailure !== undefined) failures.push(workflowError("schedule", source, `workspace source rollback failed: ${errorMessage(rollbackFailure)}`));
    if (cleanupFailure !== undefined) failures.push(cleanupFailure);
    if (failures.length > 1) throw new AggregateError(failures, "workspace apply failed and recovery was incomplete");
    throw operationFailure;
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
}

/** Provenance of how a tournament winner was carried into the parent scope.
 * A git-worktree slot is merged: its worktree is committed on the lane branch
 * and git fast-forwards the parent — git is the delta, the record, and the
 * verification. A store-worktree slot (non-Git sources) keeps the frozen-delta
 * route, where the winning slot's own coding-agent worker consolidates and the
 * engine records only what it verified (PRD §10). */
export type WorkflowCarryKind =
  | "git-merged"
  | "worker-consolidated"
  | "admitted-not-carried"
  | "carry-failed";

/** Whether a carry kind means the winner's work reached the parent scope. */
export function carryLanded(kind: WorkflowCarryKind): boolean {
  return kind === "git-merged" || kind === "worker-consolidated";
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

async function assertSafeWorkspaceAncestors(root: string, path: string): Promise<void> {
  const segments = workspacePathSegments(path);
  let current = resolve(root);
  const rootInfo = await lstat(current);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || resolve(await realpath(current)) !== current) {
    throw workflowError("schedule", current, "workspace rollback refuses a symlink or non-directory root");
  }
  const caseInsensitive = await isCaseInsensitiveFileSystem(current);
  if (segments.some((segment) => isProtectedWorkspaceName(segment, caseInsensitive))) {
    throw workflowError("schedule", root, `unsafe workspace rollback path: ${path}`);
  }
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw workflowError("schedule", current, "workspace rollback refuses a symlink or non-directory ancestor");
    }
    if (resolve(await realpath(current)) !== current) {
      throw workflowError("schedule", current, "workspace rollback refuses a symlink ancestor");
    }
  }
}

function safeWorkspaceNodePath(root: string, path: string): string {
  const segments = workspacePathSegments(path);
  if (
    path.trim() === "" ||
    isAbsolute(path) ||
    (sep === "\\" && /^[A-Za-z]:/u.test(path)) ||
    segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment === ".git" || segment === ".piano-run.lock")
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
async function assertSafeWorkspaceDirectory(root: string, candidate: string): Promise<void> {
  const canonicalRoot = await realpath(root);
  const lexicalCandidate = resolve(candidate);
  if (!pathWithin(canonicalRoot, lexicalCandidate)) {
    throw workflowError("schedule", candidate, "workspace path escapes its execution directory");
  }

  const segments = workspacePathSegments(relative(canonicalRoot, lexicalCandidate)).filter((segment) => segment !== "");
  let current = canonicalRoot;
  for (const segment of segments) {
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw workflowError("schedule", current, "workspace slot refuses a symlink ancestor or directory substitution");
    }
    if (!info.isDirectory()) {
      throw workflowError("schedule", current, "workspace slot has a non-directory ancestor");
    }
    const actual = await realpath(current);
    if (resolve(actual) !== resolve(current) || !pathWithin(canonicalRoot, actual)) {
      throw workflowError("schedule", current, "workspace slot realpath escapes its execution directory");
    }
  }
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
async function assertRunOwnedWorkspaceDirectory(
  root: string,
  candidate: string,
  gitRoot: string | undefined,
): Promise<string> {
  await assertSafeWorkspaceDirectory(root, candidate);
  if (gitRoot === undefined) {
    throw workflowError("schedule", candidate, "workspace slot has no owning repository");
  }
  let pointer: string;
  try {
    pointer = await readFile(join(candidate, ".git"), "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      throw workflowError("schedule", candidate, "workspace slot is not a run-owned worktree");
    }
    throw error;
  }
  const adminDir = /^gitdir:\s*(.+)$/mu.exec(pointer)?.[1];
  if (adminDir === undefined) {
    throw workflowError("schedule", candidate, "workspace slot is not a run-owned worktree");
  }
  const admin = resolve(candidate, adminDir);
  const owner = await gitWorktreeAdminParent(gitRoot);
  if (!pathWithin(owner, admin, false)) {
    throw workflowError("schedule", candidate, `workspace slot worktree does not belong to ${gitRoot}`);
  }
  return gitRoot;
}

/** The full lane-ownership rule, once: the directory is a run-owned worktree
 * of `record.gitRoot`, it is checked out on the record's lane branch, that
 * branch still points at the worktree's HEAD, and a source-owned lane's
 * repository is still the source's own. */
async function assertOwnedWorkspace(
  root: string,
  record: WorkflowWorkspaceRecord,
): Promise<string> {
  const gitRoot = await assertRunOwnedWorkspaceDirectory(root, record.cwd, record.gitRoot);
  // One process: the worktree shares the repository's refs, so both the tip
  // and the branch can be resolved from inside the lane.
  const tips = await execFileAsync("git", [
    "-C", record.cwd,
    "rev-parse", "HEAD", `refs/heads/${record.laneBranch}`,
  ], { encoding: "utf8" }).then((result) => result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)).catch(() => []);
  if (tips.length !== 2 || tips[0] !== tips[1]) {
    throw workflowError("schedule", record.cwd, `workspace slot is not checked out on its lane branch ${record.laneBranch}`);
  }
  if (record.strategy === "git-worktree") await assertGitRootBound(record.sourceCwd, gitRoot);
  return gitRoot;
}

async function regularFileHash(root: string, path: string): Promise<string> {
  await assertSafeWorkspaceAncestors(root, path);
  const filePath = safeWorkspaceNodePath(root, path);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);
  const handle = await open(filePath, flags);
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw workflowError("schedule", filePath, "workspace rollback refuses a non-regular file");
    }
    return createHash("sha256").update(await handle.readFile()).digest("hex");
  } finally {
    await handle.close();
  }
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
export async function inventoryWorkspaceLstat(
  root: string,
  excluded: readonly string[] = [],
): Promise<readonly WorkspaceLstatEntry[]> {
  await realpath(root);
  const caseInsensitive = await isCaseInsensitiveFileSystem(root);
  const excludedUnder = excluded.map((entry) => resolve(entry));
  const effectiveExcluded = excludedUnder.filter((entry) => resolve(root) !== entry && !pathWithin(entry, resolve(root)));
  const reachable = (candidate: string): boolean =>
    effectiveExcluded.every((entry) => !pathWithin(entry, resolve(candidate)));
  const protectsExcludedDescendant = (candidate: string): boolean =>
    effectiveExcluded.some((entry) => pathWithin(resolve(candidate), entry));
  const entries: WorkspaceLstatEntry[] = [];
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw workflowError("schedule", root, "workspace rollback refuses a symlink or non-directory root");
  }
  entries.push({ path: WORKSPACE_ROOT_PATH, kind: "directory", mode: rootInfo.mode & 0o7777 });

  const visit = async (directory: string): Promise<void> => {
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw workflowError("schedule", directory, "workspace rollback refuses a symlink or non-directory ancestor");
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (isProtectedWorkspaceName(entry.name, caseInsensitive)) continue;
      const entryPath = join(directory, entry.name);
      if (!reachable(entryPath)) continue;
      const info = await lstat(entryPath);
      const path = relative(root, entryPath);
      const base = { path, mode: info.mode & 0o7777 };
      if (info.isSymbolicLink()) {
        // readlink does not resolve the target. Do not call realpath here.
        entries.push({ ...base, kind: "symlink", symlinkTarget: await readlink(entryPath) });
      } else if (info.isDirectory()) {
        // Do not make an ancestor of an excluded run subtree a rollback root:
        // removing that ancestor would also delete the evidence we promised to
        // preserve. Non-excluded descendants are still inventoried below.
        if (!protectsExcludedDescendant(entryPath)) entries.push({ ...base, kind: "directory" });
        await visit(entryPath);
      } else if (info.isFile()) {
        entries.push({ ...base, kind: "file", contentHash: await regularFileHash(root, path) });
      } else if (info.isFIFO()) {
        // Never read a FIFO: doing so can block or consume another process's
        // stream. The path is still part of the rollback inventory.
        entries.push({ ...base, kind: "fifo" });
      } else {
        entries.push({ ...base, kind: "other" });
      }
    }
  };

  await visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

/** Diff two tolerant lstat inventories. Unsupported nodes are reported as
 * ordinary changed paths; no target is resolved and no special node is read. */
export async function diffWorkspaceLstat(
  baselineRoot: string,
  candidateRoot: string,
  excluded: readonly string[] = [],
): Promise<readonly WorkspaceContentChange[]> {
  const [baseline, candidate] = await Promise.all([
    inventoryWorkspaceLstat(baselineRoot, excluded),
    inventoryWorkspaceLstat(candidateRoot, excluded),
  ]);
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
}

async function removeWorkspaceLstatNode(root: string, path: string): Promise<void> {
  safeWorkspaceNodePath(root, path);
  await assertSafeWorkspaceAncestors(root, path);
  await rm(safeWorkspaceNodePath(root, path), { recursive: true, force: true });
}

async function copyWorkspaceLstatNode(
  sourceRoot: string,
  targetRoot: string,
  path: string,
): Promise<void> {
  const source = safeWorkspaceNodePath(sourceRoot, path);
  const target = safeWorkspaceNodePath(targetRoot, path);
  await assertSafeWorkspaceAncestors(sourceRoot, path);
  await assertSafeWorkspaceAncestors(targetRoot, path);
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    await symlink(await readlink(source), target);
    return;
  }
  if (info.isFile()) {
    await cp(source, target, { dereference: false });
    await chmod(target, info.mode & 0o7777);
    return;
  }
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      await copyWorkspaceLstatNode(sourceRoot, targetRoot, join(path, entry.name));
    }
    await chmod(target, info.mode & 0o7777);
    return;
  }
  throw workflowError("schedule", source, "workspace rollback cannot recreate a special baseline node");
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
export async function restoreWorkspaceLstat(
  targetRoot: string,
  baselineRoot: string,
  changes?: readonly WorkspaceContentChange[],
  excluded: readonly string[] = [],
): Promise<void> {
  const effectiveChanges = changes ?? await diffWorkspaceLstat(baselineRoot, targetRoot, excluded);
  await assertSafeWorkspaceAncestors(targetRoot, "root");
  await assertSafeWorkspaceAncestors(baselineRoot, "root");
  const baselineRootInfo = await lstat(baselineRoot);
  if (!baselineRootInfo.isDirectory() || baselineRootInfo.isSymbolicLink()) {
    throw workflowError("schedule", baselineRoot, "workspace rollback baseline root is not a real directory");
  }
  for (const change of effectiveChanges) {
    if (change.path !== WORKSPACE_ROOT_PATH) safeWorkspaceNodePath(targetRoot, change.path);
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
    if (change.path !== WORKSPACE_ROOT_PATH) await removeWorkspaceLstatNode(targetRoot, change.path);
  }

  // Restoring a changed directory restores its complete baseline subtree.
  for (const change of roots) {
    if (change.path !== WORKSPACE_ROOT_PATH && change.kind !== "added") {
      await copyWorkspaceLstatNode(baselineRoot, targetRoot, change.path);
    }
  }
  await chmod(targetRoot, baselineRootInfo.mode & 0o7777);
  const remaining = await diffWorkspaceLstat(baselineRoot, targetRoot, excluded);
  if (remaining.length > 0) {
    throw workflowError("schedule", targetRoot, `workspace rollback verification failed: ${remaining.map((change) => change.path).join(", ")}`);
  }
}

async function collectContentPaths(
  root: string,
  excluded: readonly string[] = [],
  directoryModes?: Map<string, number>,
): Promise<readonly string[]> {
  const paths: string[] = [];
  const resolvedRoot = await realpath(root);
  const caseInsensitive = await isCaseInsensitiveFileSystem(resolvedRoot);
  const excludedUnder = excluded.map((entry) => resolve(entry));
  // An exclusion only makes sense as a subtree *of this tree*. The shared
  // source embeds its run-management directory (evidence/workspaces) as one
  // such subtree, and infra names (.git/.piano-run.lock) are always skipped by
  // name below. A winner slot is materialised *under* that same run directory,
  // so its walking root is nested inside an exclusion path: applying that
  // exclusion here would empty the whole winner tree. Only honour an exclusion
  // that is properly contained within the walked root.
  const effectiveExcluded = excludedUnder.filter((entry) => resolve(root) !== entry && !pathWithin(entry, resolve(root)));
  const excludedRoots = [
    join(resolvedRoot, ".git"),
    ...await Promise.all(effectiveExcluded.map(async (entry) => realpath(entry).catch(() => entry))),
  ];
  const reachable = (candidate: string): boolean =>
    effectiveExcluded.every((entry) => !pathWithin(entry, resolve(candidate)));
  const protectsExcludedDescendant = (candidate: string): boolean =>
    effectiveExcluded.some((entry) => pathWithin(resolve(candidate), entry));
  const excludedTarget = (candidate: string): boolean =>
    isProtectedWorkspacePath(resolvedRoot, candidate, caseInsensitive) ||
    excludedRoots.some((entry) => pathWithin(entry, candidate));
  const validateNode = async (entryPath: string, info: Awaited<ReturnType<typeof lstat>>): Promise<void> => {
    if (info.isSymbolicLink()) {
      const target = await realpath(entryPath);
      if (!pathWithin(resolvedRoot, target) || excludedTarget(target)) {
        throw workflowError("schedule", entryPath, `workspace content symlink targets excluded or external content: ${target}`);
      }
      const targetInfo = await stat(target);
      if (!targetInfo.isFile()) {
        throw workflowError("schedule", entryPath, "workspace content does not support directory symlinks or non-file targets");
      }
      return;
    }
    if (!info.isFile() && !info.isDirectory()) {
      throw workflowError("schedule", entryPath, "workspace content contains an unsupported filesystem node");
    }
  };
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (isProtectedWorkspaceName(entry.name, caseInsensitive)) continue;
      if (!reachable(entryPath)) continue;
      const info = await lstat(entryPath);
      await validateNode(entryPath, info);
      if (info.isDirectory()) {
        if (!protectsExcludedDescendant(entryPath)) {
          directoryModes?.set(relative(root, entryPath), info.mode & 0o7777);
        }
        await visit(entryPath);
      } else paths.push(relative(root, entryPath));
    }
  };
  await visit(root);
  return paths.sort();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

async function sameFile(left: string, right: string): Promise<boolean> {
  const [leftInfo, rightInfo] = await Promise.all([lstat(left), lstat(right)]).catch((error: unknown) => {
    if (isMissingPathError(error)) return [undefined, undefined] as const;
    throw error;
  });
  if (leftInfo === undefined || rightInfo === undefined) return false;
  if (leftInfo.isSymbolicLink() || rightInfo.isSymbolicLink()) {
    if (!leftInfo.isSymbolicLink() || !rightInfo.isSymbolicLink()) return false;
    const [leftTarget, rightTarget] = await Promise.all([readlink(left), readlink(right)]);
    return leftTarget === rightTarget;
  }
  if (!leftInfo.isFile() || !rightInfo.isFile()) return false;
  if ((leftInfo.mode & 0o7777) !== (rightInfo.mode & 0o7777)) return false;
  const [leftBuffer, rightBuffer] = await Promise.all([readFile(left), readFile(right)]);
  return leftBuffer.equals(rightBuffer);
}

async function copyContentNode(source: string, destination: string): Promise<void> {
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    const target = await readlink(source);
    if (isAbsolute(target) || /^[A-Za-z]:[\\/]/u.test(target)) {
      throw workflowError("schedule", source, "workspace content snapshot refuses absolute symlink targets");
    }
    await symlink(target, destination);
    return;
  }
  if (!info.isFile()) {
    throw workflowError("schedule", source, "workspace content can only copy regular files or file symlinks");
  }
  await cp(source, destination, { dereference: false });
  await chmod(destination, info.mode & 0o7777);
}

/** Freeze a strict, rollback-capable workspace snapshot. The strict content
 * validation remains the source of truth: external/directory symlinks and
 * special nodes are rejected before anything is copied. The extra directory
 * metadata is ignored by the content gate but lets rollback restore empty
 * directories and permission modes exactly. */
async function snapshotWorkspaceLstat(
  sourceContentDir: string,
  snapshotDir: string,
  excludeUnder: readonly string[] = [],
): Promise<void> {
  const exists = await stat(snapshotDir).then(() => true, (error: unknown) => {
    if (isMissingPathError(error)) return false;
    throw error;
  });
  if (exists) throw workflowError("schedule", snapshotDir, "workspace rollback snapshot already exists");
  const canonicalSourceRoot = await realpath(resolve(sourceContentDir));
  const sourceInfo = await lstat(canonicalSourceRoot);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw workflowError("schedule", sourceContentDir, "workspace rollback snapshot requires a real directory root");
  }
  const directoryModes = new Map<string, number>();
  const paths = await collectContentPaths(canonicalSourceRoot, excludeUnder, directoryModes);
  await mkdir(snapshotDir, { recursive: true });
  for (const path of [...directoryModes.keys()].sort((left, right) =>
    workspacePathDepth(left) - workspacePathDepth(right) || left.localeCompare(right))) {
    await mkdir(join(snapshotDir, path), { recursive: true });
  }
  for (const path of paths) {
    const destination = join(snapshotDir, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyContentNode(join(canonicalSourceRoot, path), destination);
  }
  for (const [path, mode] of [...directoryModes.entries()].sort((left, right) =>
    workspacePathDepth(right[0]) - workspacePathDepth(left[0]) || right[0].localeCompare(left[0]))) {
    await chmod(join(snapshotDir, path), mode);
  }
  await chmod(snapshotDir, sourceInfo.mode & 0o7777);
}

/** Freeze application content as a directory tree with the exact rollback
 * metadata `restoreWorkspaceLstat` consumes. Only consolidation evidence and
 * rollback use this: baselines themselves are git commits below. */
export async function snapshotWorkspaceContent(
  sourceContentDir: string,
  snapshotDir: string,
  excludeUnder: readonly string[] = [],
): Promise<void> {
  await snapshotWorkspaceLstat(sourceContentDir, snapshotDir, excludeUnder);
}

/** A frozen workspace content baseline: one git commit in the run's own
 * baseline store, named by its ref. Replaces the raw directory copies a
 * tournament used to freeze (`baseline/`, `slot-baselines/`) — the commit
 * shares blobs with every lane and iteration instead of copying the tree once
 * per lane, and the ref is the resume token that re-entry reuses. */
export interface WorkspaceBaseline {
  /** The run whose store holds the commit. */
  readonly runDir: string;
  /** `refs/piano/<runId>/…` — the durable name, and the completion marker. */
  readonly refName: string;
  readonly commit: string;
}

/** The identity commits made by piano itself carry. */
const PIANO_GIT_IDENTITY_ARGS = ["-c", "user.name=Piano", "-c", "user.email=piano@localhost"] as const;

/** The run-owned baseline store. Bare, so it never becomes part of a
 * workspace's content and never touches a host repository. */
async function workspaceBaselineStore(runDir: string): Promise<string> {
  const storeDir = join(runDir, "git", "workspaces.git");
  if (!existsSync(join(storeDir, "HEAD"))) {
    await mkdir(dirname(storeDir), { recursive: true });
    await execFileAsync("git", ["init", "--bare", "--quiet", storeDir]);
  }
  return storeDir;
}

/** A ref name under refs/piano/<runId>/, spelled so git accepts it. */
export function workspaceRefName(runId: string, suffix: string): string {
  return `refs/piano/${runId}/${suffix.replace(/[^A-Za-z0-9._/-]/g, "_").replace(/\.\./g, "~")}`;
}

async function readBaselineCommit(storeDir: string, refName: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["--git-dir", storeDir, "rev-parse", "--verify", "--quiet", refName], { encoding: "utf8" });
    return result.stdout.trim();
  } catch {
    return undefined;
  }
}

/** Index the workspace's content into one git tree. The content walk is the
 * same fail-closed validation and exclusion the directory snapshots used —
 * external or directory symlinks and special nodes are refused — and
 * `--pathspec-from-file` feeds that exact path set to git, so the tree cannot
 * pick up what the walk would have refused (or drop what it accepted, e.g.
 * ignored files). */
/** Index a workspace's content into one git tree, fail-closed: the walk is
 * the same validation and exclusion the directory snapshots used, and the
 * NUL pathspec feeds git exactly the paths it accepted. `gitArgs`/`env` pick
 * the owning repository — the run's store or the source itself. */
async function writeContentTree(options: {
  readonly contentDir: string;
  readonly excludeUnder: readonly string[];
  readonly scratchDir: string;
  readonly gitArgs: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}): Promise<string> {
  const contentDir = await realpath(resolve(options.contentDir));
  const paths = await collectContentPaths(contentDir, options.excludeUnder);
  const pathspecPath = join(options.scratchDir, `piano-pathspec-${randomUUID()}`);
  const indexPath = join(options.scratchDir, `piano-index-${randomUUID()}`);
  const env = { ...options.env, GIT_INDEX_FILE: indexPath };
  try {
    await writeFile(pathspecPath, paths.map((path) => `${path}\0`).join(""), "utf8");
    await execFileAsync("git", [
      ...options.gitArgs,
      "add", "-f",
      "--pathspec-from-file", pathspecPath,
      "--pathspec-file-nul",
    ], { cwd: contentDir, env });
    const result = await execFileAsync("git", [...options.gitArgs, "write-tree"], { env, encoding: "utf8" });
    return result.stdout.trim();
  } finally {
    await rm(pathspecPath, { force: true });
    await rm(indexPath, { force: true });
  }
}

async function writeWorkspaceTree(
  storeDir: string,
  sourceContentDir: string,
  excludeUnder: readonly string[],
): Promise<string> {
  const contentDir = await realpath(resolve(sourceContentDir));
  return writeContentTree({
    contentDir,
    excludeUnder,
    scratchDir: storeDir,
    gitArgs: [],
    env: { ...process.env, GIT_DIR: storeDir, GIT_WORK_TREE: contentDir },
  });
}

/** Freeze workspace content as one commit, once. The ref is the completion
 * marker: creating it is atomic, so a re-entry under a continue reuses the
 * commit instead of re-freezing, and a freeze interrupted before the ref
 * simply leaves unreachable objects. A `parent` gives the commit its place in
 * the run's lineage — a lane's baseline hangs off the region's parent
 * baseline, which is what a later worktree fork of that lane reads. */
export async function freezeWorkspaceBaseline(
  sourceContentDir: string,
  options: {
    readonly runDir: string;
    readonly refName: string;
    readonly parent?: WorkspaceBaseline;
    readonly excludeUnder?: readonly string[];
  },
): Promise<WorkspaceBaseline> {
  const storeDir = await workspaceBaselineStore(options.runDir);
  const prior = await readBaselineCommit(storeDir, options.refName);
  if (prior !== undefined) return { runDir: options.runDir, refName: options.refName, commit: prior };
  const tree = await writeWorkspaceTree(storeDir, sourceContentDir, options.excludeUnder ?? []);
  const result = await execFileAsync("git", [
    "--git-dir", storeDir,
    ...PIANO_GIT_IDENTITY_ARGS,
    "commit-tree", tree,
    ...(options.parent === undefined ? [] : ["-p", options.parent.commit]),
    "-m", `piano: workspace baseline ${options.refName}`,
  ], { encoding: "utf8" });
  const commit = result.stdout.trim();
  await execFileAsync("git", ["--git-dir", storeDir, "update-ref", options.refName, commit, ""]);
  return { runDir: options.runDir, refName: options.refName, commit };
}

/** The concrete file delta from a frozen baseline to live content. Content is
 * compared the way git compares it — bytes plus the executable bit; other
 * permission bits and empty directories are not modeled. */
export async function workspaceBaselineChanges(
  baseline: WorkspaceBaseline,
  candidateContentDir: string,
  excludeUnder: readonly string[] = [],
): Promise<readonly WorkspaceContentChange[]> {
  const storeDir = await workspaceBaselineStore(baseline.runDir);
  const tree = await writeWorkspaceTree(storeDir, candidateContentDir, excludeUnder);
  // -z keeps pathnames verbatim (no C-quoting of backslashes and the like),
  // as `status\0path\0` pairs.
  const result = await execFileAsync("git", [
    "--git-dir", storeDir,
    "diff-tree", "-r", "--name-status", "--no-renames", "-z",
    baseline.commit, tree,
  ], { encoding: "utf8" });
  const fields = result.stdout.split("\0");
  const changes: WorkspaceContentChange[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const code = fields[index]!;
    const path = fields[index + 1]!;
    if (path === "") continue;
    changes.push({ path, kind: code === "A" ? "added" : code === "D" ? "deleted" : "modified" });
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

/** Copy just the changed files into a frozen directory — the winner delta
 * evidence and worker input. Deleted paths are represented only in `changes`. */
async function freezeChangedFiles(
  changes: readonly WorkspaceContentChange[],
  winnerContentDir: string,
  frozenWinnerDir: string,
): Promise<WorkspaceChangeSet> {
  await mkdir(frozenWinnerDir, { recursive: true });
  for (const change of changes) {
    if (change.kind === "deleted") continue;
    const destination = join(frozenWinnerDir, change.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyContentNode(join(winnerContentDir, change.path), destination);
  }
  return { winnerContentDir: frozenWinnerDir, changes };
}

/** Freeze only the winner's delta against its baseline. This avoids turning
 * build/profile files that were already present in the parent into a
 * whole-tree equality demand. */
export async function captureWorkspaceBaselineChanges(
  baseline: WorkspaceBaseline,
  winnerContentDir: string,
  frozenWinnerDir: string,
  excludeUnder: readonly string[] = [],
): Promise<WorkspaceChangeSet> {
  const changes = await workspaceBaselineChanges(baseline, winnerContentDir, excludeUnder);
  return freezeChangedFiles(changes, winnerContentDir, frozenWinnerDir);
}

/** Check only the winner delta against a target; unrelated parent files are
 * outside this gate and therefore cannot force destructive whole-tree sync. */
export async function diffWorkspaceChangeSet(
  targetContentDir: string,
  changeSet: WorkspaceChangeSet,
): Promise<WorkspaceContentDiff> {
  await collectContentPaths(targetContentDir);
  const differing: string[] = [];
  for (const change of changeSet.changes) {
    const target = join(targetContentDir, change.path);
    if (change.kind === "deleted") {
      if (await pathExists(target)) differing.push(change.path);
      continue;
    }
    if (!(await sameFile(target, join(changeSet.winnerContentDir, change.path)))) {
      differing.push(change.path);
    }
  }
  return { equal: differing.length === 0, differing };
}

/** Commit the lane's remaining edits onto its branch and fast-forward the
 * source checkout onto it. The lane branch always keeps the commit, so a
 * failed fast-forward loses nothing. `changed` is false when the lane
 * committed no edits (its fork point is the winner). */
async function mergeGitWorktreeWinner(
  record: WorkflowWorkspaceRecord,
  gitRoot: string,
  sourceIdentity: WorkspaceDirectoryIdentity,
): Promise<{ readonly commit: string; readonly changed: boolean; readonly merged: boolean; readonly reason?: string }> {
  const { commit, changed } = await commitWorktreeChanges(
    record.cwd,
    `piano: apply winning tournament slot ${record.key}`,
  );
  // No edits: the fork point is the winner and is already on the source.
  if (!changed) return { commit, changed, merged: true };
  if (record.sourceBranch !== undefined) {
    const current = await execFileAsync("git", ["-C", record.sourceCwd, "symbolic-ref", "--quiet", "--short", "HEAD"], { encoding: "utf8" })
      .then((result) => result.stdout.trim())
      .catch(() => "");
    if (current !== record.sourceBranch) {
      return {
        commit,
        changed,
        merged: false,
        reason: `source branch "${record.sourceBranch}" is no longer checked out (now "${current === "" ? "detached" : current}"); winner kept on ${record.laneBranch}`,
      };
    }
  }
  await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source before Git merge");
  try {
    await execFileAsync("git", ["-C", gitRoot, "merge", "--ff-only", record.laneBranch], { encoding: "utf8" });
    await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source after Git merge");
    return { commit, changed, merged: true };
  } catch (cause) {
    if (cause instanceof WorkflowError) throw cause;
    // The source advanced past the lane's fork point during the run, so a
    // fast-forward is impossible. The lane branch keeps the winner commit for
    // the operator to merge or inspect; cleanup removes only the worktree.
    return { commit, changed, merged: false, reason: errorMessage(cause) };
  }
}

export interface WorkflowWinnerResult {
  readonly key: string;
  readonly method: "git-ff" | "git-no-changes" | "content-copy";
  readonly commit?: string;
  /** A non-fast-forward source left the winner commit un-merged; it stays
   * reachable on the lane branch. */
  readonly skipped?: { readonly reason: string };
}

/** Apply one selected slot directly to the declared source workspace. The
 * winner is never materialized as a second run-owned "winner" directory.
 *
 * A source-owned lane is committed on its own branch and fast-forwarded onto
 * the source checkout (true lineage: the working tree now *is* the winner's
 * committed tree). A store-worktree lane — the fallback for non-Git sources —
 * keeps the validated content-copy so unsaved user edits still land. When the
 * source cannot fast-forward, the lane branch keeps the winner and the result
 * reports `skipped` rather than destroying source state. */
export function applyWinnerWorkspace(
  runDir: string,
  winnerKey: string,
  sourceCwd: string,
): Effect.Effect<WorkflowWinnerResult, WorkflowError, FileSystem.FileSystem | Logging> {
  return Effect.tryPromise({
    try: async () => {
      const runRoot = await canonicalRunRoot(runDir, false);
      const sourceIdentity = await captureWorkspaceDirectoryIdentity(sourceCwd, "workspace source");
      const source = sourceIdentity.canonical;
      const run = runRoot.canonical;
      const recordPath = workspaceRecordPath(run, winnerKey);
      const record = await readWorkspaceRecord(recordPath, {
        key: winnerKey,
        cwd: workspacePath(run, winnerKey),
        sourceCwd: source,
      });
      if (record === undefined) {
        throw workflowError("schedule", run, `winner workspace "${winnerKey}" is not owned by this execution`);
      }
      let gitRoot: string;
      try {
        gitRoot = await assertOwnedWorkspace(run, record);
      } catch (error) {
        if (isMissingPathError(error)) {
          throw workflowError("schedule", recordPath, `winner workspace is missing at ${record.cwd}`);
        }
        throw error;
      }
      const applying: WorkflowWorkspaceRecord = {
        ...record,
        phase: "applying",
        updatedAt: new Date().toISOString(),
      };
      await writeWorkspaceRecord(recordPath, applying, runRoot);
      await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
      await assertCanonicalRunRoot(runRoot);
      if (applying.strategy === "git-worktree") {
        const merged = await mergeGitWorktreeWinner(applying, gitRoot, sourceIdentity);
        const result: WorkflowWinnerResult = {
          key: applying.key,
          method: merged.changed === true ? "git-ff" : "git-no-changes",
          commit: merged.commit,
          ...(merged.merged === false ? { skipped: { reason: merged.reason ?? `source advanced; winner kept on ${applying.laneBranch}` } } : {}),
        };
        return result;
      }
      await applyWorkspaceContents(applying.cwd, runRoot, sourceIdentity);
      return { key: applying.key, method: "content-copy" as const };
    },
    catch: (cause) => cause instanceof WorkflowError
      ? cause
      : workflowError("schedule", sourceCwd, errorMessage(cause)),
  }).pipe(Effect.mapError((cause) => cause instanceof WorkflowError
    ? cause
    : workflowError("schedule", sourceCwd, errorMessage(cause))));
}
