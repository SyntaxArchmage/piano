import { chmod, cp, lstat, mkdir, mkdtemp, open, readFile, readlink, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { TRACE, type Logging, type Source } from "@piano/logging";
import { errorMessage, WorkflowError, workflowError } from "./errors.js";
import {
  executionDirectory,
  runtimeInstanceId,
  type WorkflowRuntimeFrame,
} from "./workflow-runtime.js";

const execFileAsync = promisify(execFile);

export type WorkflowWorkspaceStrategy = "git-worktree" | "directory-snapshot";
export type WorkflowWorkspaceStatus = "active" | "preserved" | "cleaned";
export type WorkflowWorkspacePhase = "allocated" | "applying" | "cleaning" | "preserved" | "cleaned";

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
}

export interface WorkflowWorkspaceRecord {
  readonly version: 2;
  readonly key: string;
  readonly kind: "map-slot";
  readonly cwd: string;
  readonly sourceCwd: string;
  readonly strategy: WorkflowWorkspaceStrategy;
  readonly status: WorkflowWorkspaceStatus;
  readonly phase: WorkflowWorkspacePhase;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finalizedAt?: string;
  readonly gitRoot?: string;
  /** Durable identity of the allocated slot root. Older records do not have
   * this field and cannot be advertised as preserved safely. */
  readonly slotIdentity?: {
    readonly dev: number;
    readonly ino: number;
    readonly birthtimeMs: number;
    readonly marker?: string;
  };
}

const WORKSPACE_SOURCE: Source = {
  module: "orchestrator",
  file: "workspace.ts",
  function: "allocateMapWorkspace",
};

function inside(parent: string, child: string): boolean {
  const candidate = relative(parent, child);
  return candidate === "" || (!candidate.startsWith("..") && !isAbsolute(candidate) && !candidate.includes("\0"));
}

function missingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "ENOENT";
}

const workspacePathSeparator = sep === "\\" ? /[\\/]/u : /\//u;
const protectedWorkspaceNames = new Set([".git", ".piano-run.lock"]);
const slotIdentityMarkerPrefix = ".piano-slot-identity.";
const slotIdentityMarkerPattern = /^\.piano-slot-identity\.[0-9a-f-]+$/u;

function workspacePathSegments(path: string): string[] {
  return path.split(workspacePathSeparator);
}

function isProtectedWorkspaceName(name: string, caseInsensitive: boolean): boolean {
  const comparable = caseInsensitive ? name.toLowerCase() : name;
  return protectedWorkspaceNames.has(comparable) || comparable.startsWith(slotIdentityMarkerPrefix);
}

function isProtectedWorkspacePath(root: string, candidate: string, caseInsensitive: boolean): boolean {
  const candidatePath = resolve(candidate);
  const rootPath = resolve(root);
  if (!inside(rootPath, candidatePath) || rootPath === candidatePath) return false;
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
      if (!missingPath(error)) throw error;
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
    if (!missingPath(error) || !create) throw error;
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
  if (!inside(canonicalRoot, lexicalCandidate)) {
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
      if (missingPath(error)) return;
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

function workspacePath(
  runDir: string,
  executionId: string,
  key: string,
): string {
  return join(executionDirectory(runDir, executionId), "workspaces", "slots", encodeURIComponent(key));
}

function workspaceRecordPath(
  runDir: string,
  executionId: string,
  key: string,
): string {
  return join(executionDirectory(runDir, executionId), "workspace-records", encodeURIComponent(key), "record.json");
}

function bindingFromRecord(record: WorkflowWorkspaceRecord, recordPath: string): WorkflowWorkspaceBinding {
  return {
    key: record.key,
    cwd: record.cwd,
    kind: "map-slot",
    sourceCwd: record.sourceCwd,
    recordPath,
    strategy: record.strategy,
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
  const strategy = value.strategy === "git-worktree" || value.strategy === "directory-snapshot"
    ? value.strategy
    : undefined;
  const status = value.status === "active" || value.status === "preserved" || value.status === "cleaned"
    ? value.status
    : "active";
  const phase = value.phase === "allocated" || value.phase === "applying" || value.phase === "cleaning" || value.phase === "preserved" || value.phase === "cleaned"
    ? value.phase
    : "allocated";
  if (value.version !== 2 || value.key !== expected.key || value.cwd !== expected.cwd || typeof value.sourceCwd !== "string" ||
    strategy === undefined || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
    throw workflowError("schedule", recordPath, "workspace record has an unsupported or inconsistent format");
  }
  if (expected.sourceCwd !== undefined && resolve(value.sourceCwd) !== resolve(expected.sourceCwd)) {
    throw workflowError("schedule", recordPath, "workspace record belongs to a different source workspace");
  }
  if (value.gitRoot !== undefined && typeof value.gitRoot !== "string") {
    throw workflowError("schedule", recordPath, "workspace record gitRoot must be a string");
  }
  const slotIdentity = pathFromRecord(value.slotIdentity) &&
    typeof value.slotIdentity.dev === "number" && Number.isSafeInteger(value.slotIdentity.dev) &&
    typeof value.slotIdentity.ino === "number" && Number.isSafeInteger(value.slotIdentity.ino) &&
    typeof value.slotIdentity.birthtimeMs === "number" && Number.isFinite(value.slotIdentity.birthtimeMs) &&
    (value.slotIdentity.marker === undefined ||
      (typeof value.slotIdentity.marker === "string" && slotIdentityMarkerPattern.test(value.slotIdentity.marker)))
    ? {
        dev: value.slotIdentity.dev,
        ino: value.slotIdentity.ino,
        birthtimeMs: value.slotIdentity.birthtimeMs,
        ...(typeof value.slotIdentity.marker === "string" ? { marker: value.slotIdentity.marker } : {}),
      }
    : value.slotIdentity === undefined
      ? undefined
      : null;
  if (slotIdentity === null) {
    throw workflowError("schedule", recordPath, "workspace record slotIdentity is malformed");
  }
  return {
    version: 2,
    key: value.key,
    kind: "map-slot",
    cwd: value.cwd,
    sourceCwd: value.sourceCwd,
    strategy,
    status,
    phase,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(typeof value.finalizedAt === "string" ? { finalizedAt: value.finalizedAt } : {}),
    ...(typeof value.gitRoot === "string" ? { gitRoot: value.gitRoot } : {}),
    ...(slotIdentity === undefined ? {} : { slotIdentity }),
  };
}

async function writeWorkspaceRecord(
  recordPath: string,
  record: WorkflowWorkspaceRecord,
  runRoot?: CanonicalRunRoot,
): Promise<void> {
  if (runRoot !== undefined) {
    await assertCanonicalRunRoot(runRoot);
    await assertSafeWorkspacePathAncestors(runRoot.canonical, dirname(recordPath));
  }
  const temporary = `${recordPath}.${randomUUID()}.tmp`;
  await mkdir(dirname(recordPath), { recursive: true });
  let operationFailure: unknown;
  try {
    if (runRoot !== undefined) {
      await assertCanonicalRunRoot(runRoot);
      await assertSafeWorkspacePathAncestors(runRoot.canonical, dirname(recordPath));
    }
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    if (runRoot !== undefined) {
      await assertCanonicalRunRoot(runRoot);
      await assertSafeWorkspacePathAncestors(runRoot.canonical, dirname(recordPath));
    }
    await rename(temporary, recordPath);
  } catch (error) {
    operationFailure = error;
  }
  let cleanupFailure: unknown;
  try {
    if (runRoot === undefined) {
      await rm(temporary, { force: true });
    } else {
      await assertCanonicalRunRoot(runRoot);
      await assertSafeWorkspacePathAncestors(runRoot.canonical, dirname(recordPath));
      await rm(temporary, { force: true });
    }
  } catch (error) {
    // Never follow a substituted run root merely to remove a temp file;
    // surface the residue so recovery can inspect it.
    cleanupFailure = workflowError("schedule", temporary, `workspace record temporary cleanup failed: ${errorMessage(error)}`);
  }
  if (operationFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError([operationFailure, cleanupFailure], "workspace record write and cleanup both failed");
  }
  if (operationFailure !== undefined) {
    throw operationFailure;
  }
  if (cleanupFailure !== undefined) {
    throw cleanupFailure;
  }
}

async function readWorkspaceRecord(
  recordPath: string,
  expected: { readonly key: string; readonly cwd: string; readonly sourceCwd?: string },
): Promise<WorkflowWorkspaceRecord | undefined> {
  let recordInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    recordInfo = await lstat(recordPath);
  } catch (error) {
    if (missingPath(error)) return undefined;
    throw error;
  }
  if (recordInfo.isSymbolicLink() || !recordInfo.isFile()) {
    throw workflowError("schedule", recordPath, "workspace record must be a regular file");
  }
  let raw: string;
  try {
    raw = await readFile(recordPath, "utf8");
  } catch (error) {
    if (missingPath(error)) return undefined;
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

async function validateSnapshotLinks(
  source: string,
  skip: (path: string) => boolean,
): Promise<void> {
  const visit = async (path: string): Promise<void> => {
    if (skip(path)) return;
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = await realpath(path);
      if (!inside(source, target) || skip(target)) {
        throw workflowError("schedule", path, `workspace snapshot symlink targets excluded or external content: ${target}`);
      }
      if (!(await stat(target)).isFile()) {
        throw workflowError("schedule", path, "workspace snapshot does not support directory symlinks or non-file targets");
      }
      return;
    }
    if (info.isFile()) return;
    if (!info.isDirectory()) {
      throw workflowError("schedule", path, "workspace snapshot contains an unsupported filesystem node");
    }
    const entries = (await readdir(path)).sort();
    for (const entry of entries) await visit(join(path, entry));
  };
  await visit(source);
}

async function makeStagingDirectory(source: string): Promise<string> {
  const parent = dirname(source);
  const preferredPrefix = join(parent, ".piano-workspace-");
  try {
    return await mkdtemp(preferredPrefix);
  } catch {
    const fallback = await mkdtemp(join(tmpdir(), "piano-workspace-"));
    if (inside(source, fallback)) {
      await rm(fallback, { recursive: true, force: true });
      throw workflowError(
        "schedule",
        source,
        "cannot create a workspace snapshot staging directory outside the source workspace",
      );
    }
    return fallback;
  }
}

function mapSlotKey(frames: readonly WorkflowRuntimeFrame[]): string {
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
  return instanceId;
}

function mapWorkspacePath(
  runDir: string,
  executionId: string,
  frames: readonly WorkflowRuntimeFrame[],
): string {
  return workspacePath(runDir, executionId, mapSlotKey(frames));
}

function mapWorkspaceRecordPath(
  runDir: string,
  executionId: string,
  frames: readonly WorkflowRuntimeFrame[],
): string {
  return workspaceRecordPath(runDir, executionId, mapSlotKey(frames));
}

async function inspectGitSource(
  source: string,
  run: string,
): Promise<{ readonly root: string; readonly commonRoot: string } | undefined> {
  try {
    const repository = await gitRepositoryIdentity(source);
    const root = repository.worktreeRoot;
    // A workspace rooted below the repository root would make the worktree
    // include files outside the caller's declared workspace. Use a snapshot
    // strategy for that shape instead.
    if (root !== source || inside(source, run)) return undefined;
    const statusResult = await execFileAsync("git", ["-C", root, "status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" });
    const runRelative = relative(root, run);
    const caseInsensitive = await isCaseInsensitiveFileSystem(root);
    const meaningful = statusResult.stdout
      .split(/\r?\n/u)
      .map((line) => line.slice(3).trim())
      .filter((path) => path !== "" && !isProtectedWorkspaceName(path, caseInsensitive) && path !== runRelative && !inside(runRelative, path));
    return meaningful.length === 0 ? { root, commonRoot: repository.commonRoot } : undefined;
  } catch {
    return undefined;
  }
}

interface GitRepositoryIdentity {
  readonly worktreeRoot: string;
  readonly commonRoot: string;
}

async function gitRepositoryIdentity(cwd: string): Promise<GitRepositoryIdentity> {
  const rootResult = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  const worktreeRoot = await realpath(rootResult.stdout.trim());
  const commonResult = await execFileAsync("git", ["-C", cwd, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
  const commonPath = commonResult.stdout.trim();
  const commonRoot = await realpath(isAbsolute(commonPath) ? commonPath : resolve(cwd, commonPath));
  return { worktreeRoot, commonRoot };
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

/** Node's recursive cp preserves a symlink node with dereference:false, but an
 * absolute link may still point at the source tree (and some cp paths
 * canonicalise relative links). Revalidate every allowed file link after the
 * copy and map only absolute source-internal targets into the destination. */
async function rewriteSnapshotSymlinks(
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
      if (!inside(source, resolvedTarget) || skip(resolvedTarget) || !(await stat(resolvedTarget)).isFile()) {
        throw workflowError(
          "schedule",
          sourcePath,
          "workspace snapshot symlink target changed to external or directory content",
        );
      }
      const copied = await lstat(destinationPath);
      if (!copied.isSymbolicLink()) {
        throw workflowError("schedule", destinationPath, "workspace snapshot symlink was not preserved by copy");
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

async function createDirectorySnapshot(
  source: string,
  cwd: string,
  run: string,
): Promise<void> {
  const stagingDirectory = await makeStagingDirectory(source);
  const temporary = join(stagingDirectory, "workspace");
  const sourceContainsRunDirectory = inside(source, run);
  const runContainer = dirname(run);
  const sourceContainsRunContainer = sourceContainsRunDirectory && runContainer !== source;
  const caseInsensitive = await isCaseInsensitiveFileSystem(source);
  const shouldSkip = (entry: string): boolean =>
    (sourceContainsRunDirectory && (inside(run, resolve(entry)) || (sourceContainsRunContainer && inside(runContainer, resolve(entry))))) ||
    isProtectedWorkspacePath(source, entry, caseInsensitive);
  try {
    await validateSnapshotLinks(source, shouldSkip);
    await cp(source, temporary, {
      recursive: true,
      errorOnExist: true,
      force: false,
      dereference: false,
      filter: (entry) => !shouldSkip(entry),
    });
    try {
      await rename(temporary, cwd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await cp(temporary, cwd, { recursive: true, errorOnExist: true, force: false, dereference: false });
      await rm(temporary, { recursive: true, force: true });
    }
    await rewriteSnapshotSymlinks(source, cwd, shouldSkip);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

/** Root/loop scopes intentionally use the caller workspace. The runtime
 * serializes ready siblings in such a shared binding because the DSL has no
 * declaration that a stage is read-only or owns a separate workspace. */
export function sharedWorkspaceBinding(cwd: string): WorkflowWorkspaceBinding {
  return { key: "shared-root", cwd: resolve(cwd), kind: "shared" };
}

/** Allocate one concrete map slot. Clean repositories use a detached Git
 * worktree; dirty/non-Git workspaces use a validated directory snapshot so
 * unsaved source changes remain available to the plugin. */
export function allocateMapWorkspace(
  runDir: string,
  executionId: string,
  frames: readonly WorkflowRuntimeFrame[],
  sourceCwd: string,
): Effect.Effect<WorkflowWorkspaceBinding, WorkflowError, FileSystem.FileSystem | Logging> {
  return TRACE(WORKSPACE_SOURCE, Effect.tryPromise({
    try: async () => {
      const sourceIdentity = await captureWorkspaceDirectoryIdentity(sourceCwd, "workspace source");
      const source = sourceIdentity.canonical;
      const runRoot = await canonicalRunRoot(runDir, true);
      const run = runRoot.canonical;
      const workspaceRoot = join(executionDirectory(run, executionId), "workspaces");
      if (inside(run, source) && !inside(workspaceRoot, source)) {
        throw workflowError(
          "schedule",
          source,
          `cannot snapshot workspace inside Piano run directory "${run}"`,
        );
      }
      const sourceInfo = await stat(source);
      if (!sourceInfo.isDirectory()) {
        throw workflowError("schedule", source, "workspace source must be a directory");
      }
      const key = mapSlotKey(frames);
      const cwd = mapWorkspacePath(run, executionId, frames);
      if (!inside(source, run) && inside(source, cwd)) {
        throw workflowError("schedule", cwd, `workspace for map slot "${key}" cannot be nested inside its source`);
      }
      const recordPath = mapWorkspaceRecordPath(run, executionId, frames);
      await assertCanonicalRunRoot(runRoot);
      await assertSafeWorkspacePathAncestors(run, dirname(recordPath));
      const existing = await readWorkspaceRecord(recordPath, { key, cwd, sourceCwd: source });
      if (existing !== undefined) {
        if (existing.status === "cleaned") {
          throw workflowError("schedule", recordPath, `workspace slot "${key}" was already cleaned`);
        }
        try {
          await assertSafeWorkspaceDirectory(workspaceRoot, existing.cwd);
        } catch (error) {
          if (missingPath(error)) {
            throw workflowError("schedule", recordPath, `workspace slot "${key}" is missing at ${existing.cwd}`);
          }
          throw error;
        }
        if (existing.strategy === "git-worktree") {
          if (existing.gitRoot === undefined) {
            throw workflowError("schedule", recordPath, "git workspace record has no repository root");
          }
          await assertGitRootBound(existing.sourceCwd, existing.gitRoot);
        }
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
        if (!missingPath(error)) throw error;
      }

      const gitSource = await inspectGitSource(source, run);
      let strategy: WorkflowWorkspaceStrategy = "directory-snapshot";
      let gitRoot: string | undefined;
      const removeAllocatedWorkspace = async (): Promise<void> => {
        try {
          await assertCanonicalRunRoot(runRoot);
          await rm(cwd, { recursive: true, force: true });
        } catch (error) {
          // If the run root changed, do not follow the replacement to clean
          // up; report the residue so recovery can inspect the original root.
          throw workflowError("schedule", cwd, `allocated workspace cleanup failed: ${errorMessage(error)}`);
        }
      };
      try {
        if (gitSource !== undefined) {
          try {
            await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
            await assertCanonicalRunRoot(runRoot);
            await execFileAsync("git", ["-C", gitSource.root, "worktree", "add", "--detach", cwd, "HEAD"], { encoding: "utf8" });
            strategy = "git-worktree";
            gitRoot = gitSource.root;
          } catch {
            // A clean repository is the preferred strategy, but a worktree
            // failure must not make a valid non-Git-compatible run unusable.
            await removeAllocatedWorkspace();
            await assertCanonicalRunRoot(runRoot);
            await createDirectorySnapshot(source, cwd, run);
          }
        } else {
          await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
          await assertCanonicalRunRoot(runRoot);
          await createDirectorySnapshot(source, cwd, run);
        }
      } catch (error) {
        await removeAllocatedWorkspace();
        throw error;
      }
      const markerToken = randomUUID();
      const marker = `${slotIdentityMarkerPrefix}${markerToken}`;
      try {
        await writeFile(join(cwd, marker), markerToken, { encoding: "utf8", flag: "wx", mode: 0o600 });
      } catch (error) {
        await removeAllocatedWorkspace();
        throw error;
      }
      const slotInfo = await lstat(cwd);
      const now = new Date().toISOString();
      const record: WorkflowWorkspaceRecord = {
        version: 2,
        key,
        kind: "map-slot",
        cwd,
        sourceCwd: source,
        strategy,
        status: "active",
        phase: "allocated",
        createdAt: now,
        updatedAt: now,
        ...(gitRoot === undefined ? {} : { gitRoot }),
        slotIdentity: { dev: slotInfo.dev, ino: slotInfo.ino, birthtimeMs: slotInfo.birthtimeMs, marker },
      };
      try {
        await writeWorkspaceRecord(recordPath, record, runRoot);
      } catch (error) {
        await removeAllocatedWorkspace();
        throw error;
      }
      return {
        key,
        cwd,
        kind: "map-slot" as const,
        sourceCwd: source,
        recordPath,
        strategy,
      };
    },
    catch: (cause) => cause instanceof WorkflowError
      ? cause
      : workflowError("schedule", sourceCwd, errorMessage(cause)),
  }), {
    runDir,
    executionId,
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
   * retains the legacy execution-wide cleanup behaviour. */
  readonly keys?: readonly string[];
  /** Preserve slot directories and mark them reusable for recovery. */
  readonly preserve?: boolean;
}

async function readWorkspaceRecords(
  runRoot: CanonicalRunRoot,
  executionId: string,
  sourceCwd?: string,
  keys?: readonly string[],
): Promise<readonly { readonly path: string; readonly record: WorkflowWorkspaceRecord }[]> {
  await assertCanonicalRunRoot(runRoot);
  const run = runRoot.canonical;
  const execution = executionDirectory(run, executionId);
  const recordsRoot = join(execution, "workspace-records");
  try {
    await lstat(recordsRoot);
  } catch (error) {
    if (missingPath(error)) return [];
    throw error;
  }
  await assertSafeWorkspaceDirectory(execution, recordsRoot);
  let entries;
  try {
    entries = await readdir(recordsRoot, { withFileTypes: true });
  } catch (error) {
    if (missingPath(error)) return [];
    throw error;
  }
  const expectedSource = sourceCwd === undefined ? undefined : await realpath(resolve(sourceCwd));
  const selectedKeys = keys === undefined ? undefined : new Set(keys);
  const records: Array<{ readonly path: string; readonly record: WorkflowWorkspaceRecord }> = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) {
      throw workflowError("schedule", join(recordsRoot, entry.name), "workspace record directory cannot be a symlink");
    }
    if (!entry.isDirectory()) continue;
    let key: string;
    try {
      key = decodeURIComponent(entry.name);
    } catch (error) {
      throw workflowError("schedule", join(recordsRoot, entry.name), `workspace record key is not encoded safely: ${errorMessage(error)}`);
    }
    if (selectedKeys !== undefined && !selectedKeys.has(key)) continue;
    await assertCanonicalRunRoot(runRoot);
    await assertSafeWorkspaceDirectory(execution, join(recordsRoot, entry.name));
    const recordPath = join(recordsRoot, entry.name, "record.json");
    const expectedCwd = workspacePath(run, executionId, key);
    const record = await readWorkspaceRecord(recordPath, {
      key,
      cwd: expectedCwd,
    });
    if (record === undefined) {
      throw workflowError("schedule", recordPath, "workspace record is missing");
    }
    if (resolve(record.cwd) !== resolve(expectedCwd) || !inside(execution, resolve(record.cwd))) {
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
    if (missingPath(error)) return;
    throw error;
  }
  await assertRunOwnedWorkspaceDirectory(executionRoot, record.cwd, record.slotIdentity);
  if (kind !== "directory") {
    throw workflowError("schedule", record.cwd, `refusing to cleanup non-directory workspace (${kind})`);
  }
  let gitFailure: unknown;
  let gitRemoved = false;
  if (record.strategy === "git-worktree") {
    const gitRoot = record.gitRoot;
    if (gitRoot === undefined) {
      throw workflowError("schedule", record.cwd, "git workspace record has no repository root");
    }
    try {
      await assertGitRootBound(record.sourceCwd, gitRoot);
      await assertCanonicalRunRoot(runRoot);
      await execFileAsync("git", ["-C", gitRoot, "worktree", "remove", "--force", record.cwd], { encoding: "utf8" });
      gitRemoved = true;
    } catch (error) {
      // A failed Git removal leaves the worktree admin entry uncertain. Keep
      // the directory intact so recovery can repair Git and retry cleanup.
      gitFailure = error;
    }
  }
  if (record.strategy !== "git-worktree") {
    await assertCanonicalRunRoot(runRoot);
    await assertRunOwnedWorkspaceDirectory(executionRoot, record.cwd, record.slotIdentity);
    await rm(record.cwd, { recursive: true, force: true });
  }
  if (gitFailure !== undefined) {
    throw workflowError("schedule", record.cwd, `git worktree cleanup failed: ${errorMessage(gitFailure)}`);
  }
  if (gitRemoved && await pathExists(record.cwd)) {
    throw workflowError("schedule", record.cwd, "git worktree cleanup reported success but the workspace still exists");
  }
}

/** Recover the run-owned slot bindings without allocating a second copy. This
 * is intentionally scoped to one execution id, source workspace, and metadata
 * directory so a recovery action cannot sweep another run. */
export function recoverMapWorkspaces(
  runDir: string,
  executionId: string,
  sourceCwd?: string,
): Effect.Effect<readonly WorkflowWorkspaceBinding[], WorkflowError, FileSystem.FileSystem | Logging> {
  return Effect.tryPromise({
    try: async () => {
      const runRoot = await canonicalRunRoot(runDir, false);
      const execution = executionDirectory(runRoot.canonical, executionId);
      const records = await readWorkspaceRecords(runRoot, executionId, sourceCwd);
      const bindings: WorkflowWorkspaceBinding[] = [];
      for (const { path, record } of records) {
        if (record.status === "cleaned") continue;
        if (record.strategy === "git-worktree") {
          if (record.gitRoot === undefined) {
            throw workflowError("schedule", path, "git workspace record has no repository root");
          }
          await assertGitRootBound(record.sourceCwd, record.gitRoot);
        }
        await assertCanonicalRunRoot(runRoot);
        try {
          await assertRunOwnedWorkspaceDirectory(execution, record.cwd, record.slotIdentity);
        } catch (error) {
          if (missingPath(error)) {
            throw workflowError("schedule", path, `recoverable workspace is missing at ${record.cwd}`);
          }
          throw error;
        }
        bindings.push(bindingFromRecord(record, path));
      }
      return bindings;
    },
    catch: (cause) => cause instanceof WorkflowError
      ? cause
      : workflowError("schedule", runDir, errorMessage(cause)),
  }).pipe(Effect.mapError((cause) => cause instanceof WorkflowError
    ? cause
    : workflowError("schedule", runDir, errorMessage(cause))));
}

/** Finalize every slot in one execution. The operation is idempotent and
 * persists a cleaning phase before removal, allowing a later recovery to
 * finish an interrupted cleanup. */
export function cleanupMapWorkspaces(
  runDir: string,
  executionId: string,
  options: WorkflowWorkspaceCleanupOptions = {},
): Effect.Effect<readonly WorkflowWorkspaceRecord[], WorkflowError, FileSystem.FileSystem | Logging> {
  return Effect.tryPromise({
    try: async () => {
      const runRoot = await canonicalRunRoot(runDir, false);
      const records = await readWorkspaceRecords(runRoot, executionId, options.sourceCwd, options.keys);
      const executionRoot = executionDirectory(runRoot.canonical, executionId);
      const finalized: WorkflowWorkspaceRecord[] = [];
      for (const { path, record } of records) {
        if (record.status === "cleaned") {
          finalized.push(record);
          continue;
        }
        const now = new Date().toISOString();
        if (options.preserve === true) {
          // A preserved slot is advertised as recoverable. Validate the
          // concrete directory before recording that state; metadata-only
          // preservation must never bless a substituted symlink or node.
          await assertRunOwnedWorkspaceDirectory(executionRoot, record.cwd, record.slotIdentity);
          if (record.strategy === "git-worktree") {
            if (record.gitRoot === undefined) {
              throw workflowError("schedule", path, "git workspace record has no repository root");
            }
            await assertGitRootBound(record.sourceCwd, record.gitRoot);
          }
          const preserved: WorkflowWorkspaceRecord = {
            ...record,
            status: "preserved",
            phase: "preserved",
            updatedAt: now,
            finalizedAt: now,
          };
          await writeWorkspaceRecord(path, preserved, runRoot);
          finalized.push(preserved);
          continue;
        }
        const cleaning: WorkflowWorkspaceRecord = { ...record, phase: "cleaning", updatedAt: now };
        await writeWorkspaceRecord(path, cleaning, runRoot);
        await removeWorkspaceDirectory(cleaning, runRoot, executionRoot);
        const cleanedAt = new Date().toISOString();
        const cleaned: WorkflowWorkspaceRecord = {
          ...cleaning,
          status: "cleaned",
          phase: "cleaned",
          updatedAt: cleanedAt,
          finalizedAt: cleanedAt,
        };
        await writeWorkspaceRecord(path, cleaned, runRoot);
        finalized.push(cleaned);
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

async function applyWorkspaceContents(
  candidate: string,
  source: string,
  run: string,
  runRoot?: CanonicalRunRoot,
  sourceIdentity?: WorkspaceDirectoryIdentity,
): Promise<void> {
  const stagingDirectory = await mkdtemp(join(dirname(source), ".piano-apply-"));
  const staged = join(stagingDirectory, "workspace");
  const before = join(stagingDirectory, "before");
  let beforeSnapshotCreated = false;
  let operationFailure: unknown;
  let rollbackFailure: unknown;
  let cleanupFailure: unknown;
  try {
    if (sourceIdentity !== undefined) await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
    const candidateCaseInsensitive = await isCaseInsensitiveFileSystem(candidate);
    const skipCandidateEntry = (entry: string): boolean =>
      isProtectedWorkspacePath(candidate, entry, candidateCaseInsensitive);
    await validateSnapshotLinks(candidate, skipCandidateEntry);
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
    await rewriteSnapshotSymlinks(candidate, staged, skipCandidateEntry);
    const sourceContainsRunDirectory = inside(source, run);
    const runContainer = dirname(run);
    const sourceContainsRunContainer = sourceContainsRunDirectory && runContainer !== source;
    const sourceCaseInsensitive = await isCaseInsensitiveFileSystem(source);
    const excludedSourceSubtrees = sourceContainsRunDirectory && resolve(run) !== resolve(source) ? [run] : [];
    const protectedEntry = (entry: string): boolean => {
      return isProtectedWorkspacePath(source, entry, sourceCaseInsensitive) ||
        (sourceContainsRunDirectory && (inside(run, resolve(entry)) || (sourceContainsRunContainer && inside(runContainer, resolve(entry)))));
    };
    // Freeze the source before the first destructive operation. If any later
    // copy/rewrite step fails, this snapshot restores the complete application
    // tree while the protected Git/run entries remain untouched.
    if (sourceIdentity !== undefined) await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
    await snapshotWorkspaceLstat(source, before, excludedSourceSubtrees);
    beforeSnapshotCreated = true;
    // These checks intentionally precede each destructive/use boundary. They
    // do not eliminate a same-UID check-then-use race; such callers require a
    // sandbox or descriptor/openat2-based implementation.
    if (sourceIdentity !== undefined) await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
    const sourceEntries = await readdir(source);
    for (const entry of sourceEntries) {
      if (sourceIdentity !== undefined) await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
      if (runRoot !== undefined) await assertCanonicalRunRoot(runRoot);
      if (!protectedEntry(join(source, entry))) await rm(join(source, entry), { recursive: true, force: true });
    }
    const stagedEntries = await readdir(staged);
    for (const entry of stagedEntries) {
      if (sourceIdentity !== undefined) await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
      if (runRoot !== undefined) await assertCanonicalRunRoot(runRoot);
      if (protectedEntry(join(source, entry))) continue;
      await cp(join(staged, entry), join(source, entry), { recursive: true, force: true, dereference: false });
    }
    const skipStagedEntry = (entry: string): boolean => {
      const path = relative(staged, entry);
      return path === "" ? false : protectedEntry(join(source, path));
    };
    if (sourceIdentity !== undefined) await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
    await rewriteSnapshotSymlinks(staged, source, skipStagedEntry);
    if (sourceIdentity !== undefined) await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
  } catch (error) {
    operationFailure = error;
    if (beforeSnapshotCreated) {
      try {
        if (sourceIdentity !== undefined) await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source before rollback");
        const sourceContainsRunDirectory = inside(source, run);
        const excludedSourceSubtrees = sourceContainsRunDirectory && resolve(run) !== resolve(source) ? [run] : [];
        await restoreWorkspaceLstat(source, before, undefined, excludedSourceSubtrees);
        if (sourceIdentity !== undefined) await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source after rollback");
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

/** Provenance of how a tournament winner was carried into the parent scope
 * (PRD §10). The engine never merges; the winning slot's own coding-agent worker
 * consolidates, and the engine records only what it verified. */
export type WorkflowCarryKind =
  | "worker-consolidated"
  | "admitted-not-carried"
  | "carry-failed";

export interface WorkflowCarrying {
  readonly kind: WorkflowCarryKind;
  /** The winner commit the worker produced when it chose a git route. */
  readonly commit?: string;
  /** Human-readable failure detail when carry-failed / not-carried. */
  readonly reason?: string;
}

/**
 * @deprecated Read-only whole-tree compatibility gate: decide whether two
 * materialised directories hold identical application content. Infra entries
 * that belong to the shared source — `.git`, `.piano-run.lock` and, when it lives
 * under a side, that side's execution run-directory subtree — are excluded from
 * the comparison, mirroring how `applyWorkspaceContents` protects them. The
 * canonical tournament path uses the baseline-relative change-set gate in
 * `consolidation-transaction.ts`. This helper never mutates either tree. */
export interface WorkspaceContentDiff {
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
  if (!inside(resolve(root), candidate)) {
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
  if (!inside(canonicalRoot, lexicalCandidate)) {
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
    if (resolve(actual) !== resolve(current) || !inside(canonicalRoot, actual)) {
      throw workflowError("schedule", current, "workspace slot realpath escapes its execution directory");
    }
  }
}

/** The record path alone is not ownership: an interrupted cleanup can leave
 * another ordinary directory at the same pathname. New records bind the slot
 * root to its allocation inode; legacy records without that durable identity
 * remain readable but cannot cross an ownership boundary. This is still a
 * check-then-use guard: a same-UID attacker can race the final filesystem
 * operation; eliminating that residual requires descriptor/openat2 sandboxing. */
async function assertRunOwnedWorkspaceDirectory(
  root: string,
  candidate: string,
  identity: WorkflowWorkspaceRecord["slotIdentity"],
): Promise<void> {
  await assertSafeWorkspaceDirectory(root, candidate);
  if (identity === undefined) {
    throw workflowError("schedule", candidate, "workspace slot has no durable run-owned identity");
  }
  const info = await lstat(candidate);
  if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== identity.dev || info.ino !== identity.ino ||
    info.birthtimeMs !== identity.birthtimeMs) {
    throw workflowError("schedule", candidate, "workspace slot is not the run-owned allocated directory");
  }
  if (identity.marker === undefined) {
    throw workflowError("schedule", candidate, "workspace slot has no durable identity marker");
  }
  const markerPath = join(candidate, identity.marker);
  let markerInfo: Awaited<ReturnType<typeof lstat>>;
  let markerValue: string;
  try {
    markerInfo = await lstat(markerPath);
    markerValue = await readFile(markerPath, "utf8");
  } catch (error) {
    if (missingPath(error)) {
      throw workflowError("schedule", candidate, "workspace slot identity marker is missing or invalid");
    }
    throw error;
  }
  if (markerInfo.isSymbolicLink() || !markerInfo.isFile() || markerValue !== identity.marker.slice(slotIdentityMarkerPrefix.length)) {
    throw workflowError("schedule", candidate, "workspace slot identity marker is missing or invalid");
  }
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
  const effectiveExcluded = excludedUnder.filter((entry) => resolve(root) !== entry && !inside(entry, resolve(root)));
  const reachable = (candidate: string): boolean =>
    effectiveExcluded.every((entry) => !inside(entry, resolve(candidate)));
  const protectsExcludedDescendant = (candidate: string): boolean =>
    effectiveExcluded.some((entry) => inside(resolve(candidate), entry));
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
 * exists for rollback only; it does not weaken `diffWorkspaceContent()` or the
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
  const effectiveExcluded = excludedUnder.filter((entry) => resolve(root) !== entry && !inside(entry, resolve(root)));
  const excludedRoots = [
    join(resolvedRoot, ".git"),
    ...await Promise.all(effectiveExcluded.map(async (entry) => realpath(entry).catch(() => entry))),
  ];
  const reachable = (candidate: string): boolean =>
    effectiveExcluded.every((entry) => !inside(entry, resolve(candidate)));
  const protectsExcludedDescendant = (candidate: string): boolean =>
    effectiveExcluded.some((entry) => inside(resolve(candidate), entry));
  const excludedTarget = (candidate: string): boolean =>
    isProtectedWorkspacePath(resolvedRoot, candidate, caseInsensitive) ||
    excludedRoots.some((entry) => inside(entry, candidate));
  const validateNode = async (entryPath: string, info: Awaited<ReturnType<typeof lstat>>): Promise<void> => {
    if (info.isSymbolicLink()) {
      const target = await realpath(entryPath);
      if (!inside(resolvedRoot, target) || excludedTarget(target)) {
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

export async function diffWorkspaceContent(
  targetContentDir: string,
  winnerContentDir: string,
  excludeUnder: readonly string[] = [],
): Promise<WorkspaceContentDiff> {
  const targetSet = new Set(await collectContentPaths(targetContentDir, excludeUnder));
  const winnerSet = new Set(await collectContentPaths(winnerContentDir, excludeUnder));
  const all = new Set([...targetSet, ...winnerSet]);
  const differing: string[] = [];
  for (const path of [...all].sort()) {
    const inTarget = targetSet.has(path);
    const inWinner = winnerSet.has(path);
    if (inTarget !== inWinner) {
      differing.push(path);
      continue;
    }
    if (!(await sameFile(join(targetContentDir, path), join(winnerContentDir, path)))) differing.push(path);
  }
  return { equal: differing.length === 0, differing };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (missingPath(error)) return false;
    throw error;
  }
}

async function sameFile(left: string, right: string): Promise<boolean> {
  const [leftInfo, rightInfo] = await Promise.all([lstat(left), lstat(right)]).catch((error: unknown) => {
    if (missingPath(error)) return [undefined, undefined] as const;
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
    if (missingPath(error)) return false;
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

/** Freeze application content for one tournament boundary. This compatibility
 * entry point also carries the exact rollback metadata consumed by
 * `restoreWorkspaceLstat`; strict content comparisons continue to ignore
 * directories and only compare files/file-links. */
export async function snapshotWorkspaceContent(
  sourceContentDir: string,
  snapshotDir: string,
  excludeUnder: readonly string[] = [],
): Promise<void> {
  await snapshotWorkspaceLstat(sourceContentDir, snapshotDir, excludeUnder);
}

/** Compute the concrete file delta from a frozen tournament baseline. */
export async function workspaceContentChanges(
  baselineContentDir: string,
  candidateContentDir: string,
  excludeUnder: readonly string[] = [],
): Promise<readonly WorkspaceContentChange[]> {
  const baseline = new Set(await collectContentPaths(baselineContentDir, excludeUnder));
  const candidate = new Set(await collectContentPaths(candidateContentDir, excludeUnder));
  const paths = [...new Set([...baseline, ...candidate])].sort();
  const changes: WorkspaceContentChange[] = [];
  for (const path of paths) {
    const inBaseline = baseline.has(path);
    const inCandidate = candidate.has(path);
    if (!inBaseline) {
      changes.push({ path, kind: "added" });
    } else if (!inCandidate) {
      changes.push({ path, kind: "deleted" });
    } else if (!(await sameFile(join(baselineContentDir, path), join(candidateContentDir, path)))) {
      changes.push({ path, kind: "modified" });
    }
  }
  return changes;
}

/** Freeze only the winner's delta. This avoids turning build/profile files
 * that were already present in the parent into a whole-tree equality demand. */
export async function captureWorkspaceChangeSet(
  baselineContentDir: string,
  winnerContentDir: string,
  frozenWinnerDir: string,
  excludeUnder: readonly string[] = [],
): Promise<WorkspaceChangeSet> {
  const changes = await workspaceContentChanges(baselineContentDir, winnerContentDir, excludeUnder);
  await mkdir(frozenWinnerDir, { recursive: true });
  for (const change of changes) {
    if (change.kind === "deleted") continue;
    const destination = join(frozenWinnerDir, change.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyContentNode(join(winnerContentDir, change.path), destination);
  }
  return { winnerContentDir: frozenWinnerDir, changes };
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

/** Restore a failed consolidation to its exact pre-turn file state. Only paths
 * observed as changed are touched; unrelated pre-existing edits survive. */
export async function restoreWorkspaceChanges(
  targetContentDir: string,
  beforeContentDir: string,
  changes: readonly WorkspaceContentChange[],
): Promise<void> {
  // Validate every caller-supplied path before mutating either tree. The
  // legacy API accepts a change list directly, so joining an unchecked path
  // here would turn traversal or a symlink ancestor into an escape hatch.
  for (const change of changes) {
    safeWorkspaceNodePath(targetContentDir, change.path);
    await assertSafeWorkspaceAncestors(targetContentDir, change.path).catch((error: unknown) => {
      if (!missingPath(error)) throw error;
    });
    if (change.kind !== "added") {
      safeWorkspaceNodePath(beforeContentDir, change.path);
      await assertSafeWorkspaceAncestors(beforeContentDir, change.path).catch((error: unknown) => {
        if (!missingPath(error)) throw error;
      });
    }
  }
  // Remove the mutated side first, then restore the frozen side. Keeping the
  // phases separate also handles a file changing into a directory (or vice
  // versa) without a child path colliding with a just-restored parent file.
  const ordered = [...changes].sort((left, right) =>
    workspacePathDepth(left.path) - workspacePathDepth(right.path) || left.path.localeCompare(right.path));
  for (const change of ordered) {
    await rm(join(targetContentDir, change.path), { recursive: true, force: true });
  }
  for (const change of ordered) {
    if (change.kind === "added") continue;
    const target = join(targetContentDir, change.path);
    const source = join(beforeContentDir, change.path);
    await mkdir(dirname(target), { recursive: true });
    await copyContentNode(source, target);
  }
}

/** Commit the content of a git-worktree slot into the shared repository and
 * fast-forward it onto the source HEAD when that is still possible. The ref
 * is always written so the winner's commit survives cleanup of the worktree.
 * `changed` is false when the slot committed no edits (its fork point is the
 * winner). */
async function mergeGitWorktreeWinner(
  record: WorkflowWorkspaceRecord,
  executionId: string,
  sourceIdentity: WorkspaceDirectoryIdentity,
): Promise<{ readonly commit: string; readonly changed: boolean; readonly merged: boolean; readonly reason?: string }> {
  const gitRoot = record.gitRoot;
  if (gitRoot === undefined) {
    throw workflowError("schedule", record.cwd, "git winner workspace has no repository root");
  }
  await assertGitRootBound(record.sourceCwd, gitRoot);
  await execFileAsync("git", ["-C", record.cwd, "add", "-A", "--", ".", `:(exclude)${slotIdentityMarkerPrefix}*`], { encoding: "utf8" });
  const status = await execFileAsync("git", ["-C", record.cwd, "status", "--porcelain=v1", "--untracked-files=no"], { encoding: "utf8" });
  if (status.stdout.trim() === "") {
    // The slot tree equals its fork point; nothing changed to merge, but the
    // fork point is still a valid winner identity and is already on the source.
    const head = (await execFileAsync("git", ["-C", record.cwd, "rev-parse", "HEAD"], { encoding: "utf8" })).stdout.trim();
    return { commit: head, changed: false, merged: true };
  }
  // Checkouts are detached worktrees with no common author config; stamp one so
  // committing never inherits global config that a host may not have set.
  await execFileAsync("git", [
    "-C", record.cwd,
    "-c", "user.name=Piano",
    "-c", "user.email=piano-winner@localhost",
    "commit",
    "-q",
    "-m", `piano: apply winning tournament slot ${record.key}`,
  ], { encoding: "utf8" });
  const commit = (await execFileAsync("git", ["-C", record.cwd, "rev-parse", "HEAD"], { encoding: "utf8" })).stdout.trim();
  const refName = `refs/piano/${executionId}/${record.key.replace(/[^A-Za-z0-9._/-]/g, "_")}`;
  await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source before Git ref update");
  try {
    await execFileAsync("git", ["-C", gitRoot, "update-ref", refName, commit], { encoding: "utf8" });
  } catch (cause) {
    // Without the retained ref, cleanup could make the winner commit
    // unreachable. Surface this as a carry failure so the caller can preserve
    // the slot for recovery; do not return a skipped/retained result.
    throw workflowError("schedule", gitRoot, `winner commit could not be retained under ${refName}: ${errorMessage(cause)}`);
  }
  await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source after Git ref update");
  try {
    await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source before Git merge");
    await execFileAsync("git", ["-C", gitRoot, "merge", "--ff-only", commit], { encoding: "utf8" });
    await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source after Git merge");
    return { commit, changed: true, merged: true };
  } catch (cause) {
    if (cause instanceof WorkflowError) throw cause;
    // The source HEAD advanced past this slot's fork point during the run, so
    // a fast-forward is impossible. Keep the slot's commit reachable under its
    // ref so the operator can merge or inspect it later; cleanup still removes
    // only the worktree working copy.
    return { commit, changed: true, merged: false, reason: errorMessage(cause) };
  }
}

export interface WorkflowWinnerResult {
  readonly key: string;
  readonly method: "git-ff" | "git-no-changes" | "snapshot-copy";
  readonly commit?: string;
  /** A non-fast-forward source HEAD left the winner commit un-merged but the
   * commit stays reachable under refs/piano/<exec>/<key>. */
  readonly skipped?: { readonly reason: string };
}

/** Apply one selected slot directly to the declared source workspace. The
 * winner is never materialized as a second run-owned "winner" directory.
 *
 * A git-worktree slot is committed in the shared repository and fast-forwarded
 * onto the source HEAD (true lineage: the working tree now *is* the winner's
 * committed tree, with a retained ref under refs/piano/<exec>/<key>). A
 * directory-snapshot slot — the reachable strategy for dirty or non-Git sources
 * — keeps the validated content-copy so unsaved user edits still land. When the
 * source cannot fast-forward, the winner commit is retained and reported via
 * `skipped` rather than destroying source state. */
export function applyWinnerWorkspace(
  runDir: string,
  executionId: string,
  winnerKey: string,
  sourceCwd: string,
): Effect.Effect<WorkflowWinnerResult, WorkflowError, FileSystem.FileSystem | Logging> {
  return Effect.tryPromise({
    try: async () => {
      const runRoot = await canonicalRunRoot(runDir, false);
      const sourceIdentity = await captureWorkspaceDirectoryIdentity(sourceCwd, "workspace source");
      const source = sourceIdentity.canonical;
      const run = runRoot.canonical;
      const records = await readWorkspaceRecords(runRoot, executionId, source);
      const selected = records.find(({ record }) => record.key === winnerKey);
      if (selected === undefined) {
        throw workflowError("schedule", executionDirectory(run, executionId), `winner workspace "${winnerKey}" is not owned by this execution`);
      }
      if (selected.record.status === "cleaned") {
        throw workflowError("schedule", selected.path, `winner workspace "${winnerKey}" was already cleaned`);
      }
      try {
        await assertRunOwnedWorkspaceDirectory(executionDirectory(run, executionId), selected.record.cwd, selected.record.slotIdentity);
      } catch (error) {
        if (missingPath(error)) {
          throw workflowError("schedule", selected.path, `winner workspace is missing at ${selected.record.cwd}`);
        }
        throw error;
      }
      const applying: WorkflowWorkspaceRecord = {
        ...selected.record,
        phase: "applying",
        updatedAt: new Date().toISOString(),
      };
      await writeWorkspaceRecord(selected.path, applying, runRoot);
      await assertWorkspaceDirectoryIdentity(sourceIdentity, "workspace source");
      await assertCanonicalRunRoot(runRoot);
      if (applying.strategy === "git-worktree") {
        const merged = await mergeGitWorktreeWinner(applying, executionId, sourceIdentity);
        const result: WorkflowWinnerResult = {
          key: applying.key,
          method: merged.changed === true ? "git-ff" : "git-no-changes",
          commit: merged.commit,
          ...(merged.merged === false ? { skipped: { reason: merged.reason ?? "source advanced; winner commit retained under refs/piano" } } : {}),
        };
        return result;
      }
      await applyWorkspaceContents(applying.cwd, source, run, runRoot, sourceIdentity);
      return { key: applying.key, method: "snapshot-copy" as const };
    },
    catch: (cause) => cause instanceof WorkflowError
      ? cause
      : workflowError("schedule", sourceCwd, errorMessage(cause)),
  }).pipe(Effect.mapError((cause) => cause instanceof WorkflowError
    ? cause
    : workflowError("schedule", sourceCwd, errorMessage(cause))));
}
