import { execFile } from "node:child_process";
import { lstat, open, readFile, readdir, realpath, rename, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { errorMessage, isMissingPathError } from "./errors.js";

const execFileAsync = promisify(execFile);
const MARKERS = ["ORIG_HEAD", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "AUTO_MERGE", "BISECT_HEAD", "MERGE_MSG", "SQUASH_MSG"];
const OPERATION_DIRS = ["sequencer", "rebase-merge", "rebase-apply"];

type FileState = { readonly data: Buffer; readonly mode: number } | undefined;
type RefState = { readonly oid: string; readonly symbolicTarget?: string };
type Lifecycle = "open" | "committed" | "rolled-back" | "failed";

interface Repository {
  readonly cwd: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly headPath: string;
  readonly indexPath: string;
  readonly markerPaths: ReadonlyMap<string, string>;
  readonly operationDirs: ReadonlyMap<string, string>;
  readonly lockRoots: readonly string[];
}

interface Snapshot {
  readonly head: FileState;
  readonly refs: ReadonlyMap<string, RefState>;
  readonly index: FileState;
  readonly sharedIndexes: ReadonlyMap<string, FileState>;
  readonly markers: ReadonlyMap<string, FileState>;
  readonly operationDirs: ReadonlyMap<string, boolean>;
}

export interface GitMetadataRollbackReport {
  readonly kind: "git" | "non-git";
  readonly restored: boolean;
  readonly changed: readonly string[];
  readonly residues: readonly string[];
  readonly failures: readonly string[];
}

export class GitMetadataTransactionError extends Error {
  readonly code: "invalid-state" | "capture-failed" | "unsafe-mutation" | "concurrent-mutation" | "restore-failed";
  readonly report?: GitMetadataRollbackReport;

  constructor(code: GitMetadataTransactionError["code"], message: string, report?: GitMetadataRollbackReport) {
    super(message);
    this.name = "GitMetadataTransactionError";
    this.code = code;
    this.report = report;
  }
}

export interface GitMetadataTransaction {
  readonly kind: "git" | "non-git";
  readonly sourceCwd: string;
  observe(): Effect.Effect<readonly string[], GitMetadataTransactionError>;
  commit(): Effect.Effect<void, GitMetadataTransactionError>;
  rollback(): Effect.Effect<GitMetadataRollbackReport, GitMetadataTransactionError>;
}

/** A failure of this module leaves through an Effect channel: the async core
 * throws {@link GitMetadataTransactionError}, and the boundary carries that
 * same instance into the error channel rather than re-describing it. A raw
 * filesystem rejection keeps its own message and takes the code of the entry
 * point it broke in, so a caller that branches on the code is never told a
 * rollback failed while the transaction was still being captured. */
function toGitMetadataTransactionError(
  cause: unknown,
  code: GitMetadataTransactionError["code"],
): GitMetadataTransactionError {
  return cause instanceof GitMetadataTransactionError
    ? cause
    : new GitMetadataTransactionError(code, errorMessage(cause));
}

function effectify<A>(
  run: () => Promise<A>,
  code: GitMetadataTransactionError["code"],
): Effect.Effect<A, GitMetadataTransactionError> {
  return Effect.tryPromise({ try: run, catch: (cause) => toGitMetadataTransactionError(cause, code) });
}

/** The transaction's async core: exactly the three operations the Effect API
 * exposes, before the promise/Effect seam is applied. Both construction
 * branches build one of these, so the seam is crossed in a single place. */
interface TransactionCore {
  observe(): Promise<readonly string[]>;
  commit(): Promise<void>;
  rollback(): Promise<GitMetadataRollbackReport>;
}

function liftTransaction(
  core: TransactionCore,
): Pick<GitMetadataTransaction, "observe" | "commit" | "rollback"> {
  return {
    observe: () => effectify(core.observe, "capture-failed"),
    commit: () => effectify(core.commit, "capture-failed"),
    rollback: () => effectify(core.rollback, "restore-failed"),
  };
}

/** A symlinked metadata node can point the transaction at a different
 * repository, so both reads and replacements refuse one outright. */
function assertNotSymlink(info: Awaited<ReturnType<typeof lstat>>, reason: string): void {
  if (info.isSymbolicLink()) throw new GitMetadataTransactionError("unsafe-mutation", reason);
}

/** Metadata roots and lock-bearing directories must additionally be real
 * directories: a substituted node changes what the lock scan sees. */
function assertRealDirectory(info: Awaited<ReturnType<typeof lstat>>, reason: string): void {
  if (info.isSymbolicLink() || !info.isDirectory()) throw new GitMetadataTransactionError("unsafe-mutation", reason);
}

function message(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const value = error as { stderr?: string | Buffer; message?: string };
    const stderr = typeof value.stderr === "string" ? value.stderr : value.stderr?.toString("utf8");
    return stderr?.trim() || value.message || String(error);
  }
  return String(error);
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return result.stdout;
}

async function file(path: string): Promise<FileState> {
  try {
    const info = await lstat(path);
    if (!info.isFile()) throw new GitMetadataTransactionError("capture-failed", `unsupported Git metadata node: ${path}`);
    return { data: await readFile(path), mode: info.mode & 0o7777 };
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

function fileEqual(left: FileState, right: FileState): boolean {
  return left === undefined || right === undefined ? left === right : left.mode === right.mode && left.data.equals(right.data);
}

async function refs(cwd: string): Promise<ReadonlyMap<string, RefState>> {
  const result = new Map<string, RefState>();
  const output = await git(cwd, ["for-each-ref", "--format=%(refname)%09%(objectname)%09%(symref)"]);
  for (const line of output.trim().split(/\r?\n/u)) {
    if (line === "") continue;
    const [name, oid, symbolicTarget] = line.split("\t");
    if (!name || !oid) throw new GitMetadataTransactionError("capture-failed", `invalid Git ref record: ${line}`);
    result.set(name, { oid, ...(symbolicTarget ? { symbolicTarget } : {}) });
  }
  return result;
}

function mapEqual<T>(left: ReadonlyMap<string, T>, right: ReadonlyMap<string, T>, equal: (a: T, b: T) => boolean): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    const candidate = right.get(key);
    if (candidate === undefined || !equal(value, candidate)) return false;
  }
  return true;
}

const filesEqual = (left: ReadonlyMap<string, FileState>, right: ReadonlyMap<string, FileState>): boolean =>
  mapEqual(left, right, fileEqual);

async function paths(cwd: string, names: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const result = new Map<string, string>();
  for (const name of names) {
    const raw = (await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", name])).trim();
    result.set(name, resolve(isAbsolute(raw) ? raw : join(cwd, raw)));
  }
  return result;
}

async function lockFiles(directory: string): Promise<readonly string[]> {
  try {
    const info = await lstat(directory);
    assertNotSymlink(info, `symbolic Git refs directory: ${directory}`);
    if (!info.isDirectory()) return [];
    const found: string[] = [];
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const child = await lstat(path);
      assertNotSymlink(child, `symbolic Git refs directory entry: ${path}`);
      if (name.endsWith(".lock")) found.push(path);
      else if (child.isDirectory()) found.push(...await lockFiles(path));
    }
    return found;
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
}

async function rootLockFiles(directory: string): Promise<readonly string[]> {
  const info = await lstat(directory).catch((error: unknown) => {
    if (isMissingPathError(error)) {
      throw new GitMetadataTransactionError("capture-failed", `missing Git metadata directory: ${directory}`);
    }
    throw error;
  });
  assertRealDirectory(info, `unsafe Git metadata directory: ${directory}`);
  const found: string[] = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".lock")) continue;
    const path = join(directory, name);
    const child = await lstat(path);
    assertNotSymlink(child, `symbolic Git lock: ${path}`);
    found.push(path);
  }
  return found;
}

async function assertMetadataRoots(gitDir: string, commonDir: string): Promise<readonly string[]> {
  const roots = [...new Set([gitDir, commonDir])];
  for (const root of roots) {
    assertRealDirectory(await lstat(root), `unsafe Git metadata root: ${root}`);
  }
  const refsRoots = [...new Set(roots.map((root) => join(root, "refs")))];
  for (const refsRoot of refsRoots) {
    const info = await lstat(refsRoot).catch((error: unknown) => {
      if (isMissingPathError(error)) return undefined;
      throw error;
    });
    if (info) assertRealDirectory(info, `unsafe Git refs root: ${refsRoot}`);
  }
  return refsRoots;
}

async function metadataLockPaths(repository: Repository): Promise<readonly string[]> {
  const roots = await assertMetadataRoots(repository.gitDir, repository.commonDir);
  const rootLocks = await Promise.all(repository.lockRoots.map((root) => rootLockFiles(root)));
  const refsLocks = await Promise.all(roots.map((root) => lockFiles(root)));
  return [...new Set([
    `${repository.headPath}.lock`, `${repository.indexPath}.lock`,
    ...rootLocks.flat(), ...refsLocks.flat(),
  ])];
}

async function assertNoMetadataLocks(repository: Repository): Promise<void> {
  for (const path of await metadataLockPaths(repository)) {
    try {
      await lstat(path);
      throw new GitMetadataTransactionError("unsafe-mutation", `Git metadata is locked: ${path}`);
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
  }
}

async function discover(sourceCwd: string): Promise<Repository | undefined> {
  const cwd = await realpath(resolve(sourceCwd));
  let bare: string;
  try {
    bare = (await git(cwd, ["rev-parse", "--is-bare-repository"])).trim();
  } catch (error) {
    if (/not a git repository|not a git work tree/u.test(message(error))) return undefined;
    throw new GitMetadataTransactionError("capture-failed", `cannot inspect Git workspace: ${message(error)}`);
  }
  if (bare === "true") throw new GitMetadataTransactionError("unsafe-mutation", "bare Git repositories are not source workspaces");
  if ((await git(cwd, ["rev-parse", "--is-inside-work-tree"])).trim() !== "true") {
    if ((await git(cwd, ["rev-parse", "--is-inside-git-dir"])).trim() === "true") {
      throw new GitMetadataTransactionError("unsafe-mutation", "Git metadata directories are not source workspaces");
    }
    return undefined;
  }
  const worktreeRoot = await realpath((await git(cwd, ["rev-parse", "--show-toplevel"])).trim());
  const worktreeGitEntry = await lstat(join(worktreeRoot, ".git"));
  assertNotSymlink(worktreeGitEntry, `symbolic Git metadata entry: ${join(worktreeRoot, ".git")}`);
  const absolute = (value: string): string => resolve(isAbsolute(value.trim()) ? value.trim() : join(cwd, value.trim()));
  const headPath = absolute(await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "HEAD"]));
  const indexPath = absolute(await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"]));
  const commonDir = absolute(await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const gitDir = absolute(await git(cwd, ["rev-parse", "--absolute-git-dir"]));
  await assertMetadataRoots(gitDir, commonDir);
  return {
    cwd,
    gitDir,
    commonDir,
    headPath,
    indexPath,
    markerPaths: await paths(cwd, MARKERS),
    operationDirs: await paths(cwd, OPERATION_DIRS),
    lockRoots: [gitDir, commonDir],
  };
}

async function sharedIndexes(repository: Repository): Promise<ReadonlyMap<string, FileState>> {
  const result = new Map<string, FileState>();
  for (const directory of new Set([dirname(repository.indexPath), repository.gitDir, repository.commonDir])) {
    for (const name of await readdir(directory)) {
      if (name.startsWith("sharedindex.")) result.set(join(directory, name), await file(join(directory, name)));
    }
  }
  return result;
}

async function snapshot(repository: Repository): Promise<Snapshot> {
  await assertNoMetadataLocks(repository);
  const refState = await refs(repository.cwd);
  const head = await file(repository.headPath);
  if (head === undefined || !/^(ref: .+|[0-9a-f]{40,64})\n?$/u.test(head.data.toString("utf8"))) {
    throw new GitMetadataTransactionError("capture-failed", "Git HEAD is neither symbolic nor detached");
  }
  const markers = new Map<string, FileState>();
  for (const [name, path] of repository.markerPaths) markers.set(name, await file(path));
  const operationDirs = new Map<string, boolean>();
  for (const [name, path] of repository.operationDirs) {
    const present = await lstat(path).then(() => true, (error: unknown) => {
      if (isMissingPathError(error)) return false;
      throw error;
    });
    operationDirs.set(name, present);
  }
  const result = { head, refs: refState, index: await file(repository.indexPath), sharedIndexes: await sharedIndexes(repository), markers, operationDirs };
  await assertNoMetadataLocks(repository);
  return result;
}

function refEqual(left: RefState | undefined, right: RefState | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.symbolicTarget !== undefined || right.symbolicTarget !== undefined) return left.symbolicTarget === right.symbolicTarget;
  return left.oid === right.oid;
}

function differences(left: Snapshot, right: Snapshot): string[] {
  const changed: string[] = [];
  if (!fileEqual(left.head, right.head)) changed.push("HEAD");
  for (const name of new Set([...left.refs.keys(), ...right.refs.keys()])) {
    const a = left.refs.get(name); const b = right.refs.get(name);
    if (!refEqual(a, b)) changed.push(`ref:${name}`);
  }
  if (!fileEqual(left.index, right.index)) changed.push("index");
  if (!filesEqual(left.sharedIndexes, right.sharedIndexes)) changed.push("split-index");
  for (const name of left.markers.keys()) if (!fileEqual(left.markers.get(name), right.markers.get(name))) changed.push(`marker:${name}`);
  for (const [name, present] of left.operationDirs) if (right.operationDirs.get(name) !== present) changed.push(`operation-dir:${name}`);
  return changed;
}

function symbolicRefMutation(before: Snapshot, after: Snapshot): string | undefined {
  for (const name of new Set([...before.refs.keys(), ...after.refs.keys()])) {
    const a = before.refs.get(name); const b = after.refs.get(name);
    if ((a?.symbolicTarget ?? b?.symbolicTarget) && a?.symbolicTarget !== b?.symbolicTarget) return name;
  }
  return undefined;
}

async function restoreRef(cwd: string, name: string, original: RefState | undefined, expected: RefState | undefined): Promise<void> {
  if (original?.symbolicTarget !== undefined || expected?.symbolicTarget !== undefined) {
    if (original?.symbolicTarget === expected?.symbolicTarget) return;
    throw new GitMetadataTransactionError("unsafe-mutation", `symbolic ref cannot be restored: ${name}`);
  }
  if (refEqual(original, expected)) return;
  try {
    if (original === undefined) {
      if (expected === undefined) return;
      await git(cwd, ["update-ref", "-d", "-m", "piano: rollback metadata", name, expected.oid]);
    } else {
      await git(cwd, ["update-ref", "-m", "piano: rollback metadata", name, original.oid, expected?.oid ?? ""]);
    }
  } catch (error) {
    throw new GitMetadataTransactionError("concurrent-mutation", `${name} changed or is locked: ${message(error)}`);
  }
}

async function replaceLocked(path: string, original: FileState, expected: FileState): Promise<void> {
  const lockPath = `${path}.lock`;
  const lock = await open(lockPath, "wx", 0o600).catch((error: unknown) => {
    throw new GitMetadataTransactionError("concurrent-mutation", `cannot acquire ${lockPath}: ${message(error)}`);
  });
  try {
    if (!fileEqual(await file(path), expected)) throw new GitMetadataTransactionError("concurrent-mutation", `${path} changed after observe()`);
    if (original === undefined) {
      const current = await file(path);
      if (current !== undefined) await unlink(path);
      await lock.close(); await rm(lockPath, { force: true });
    } else {
      const temporary = join(dirname(path), `.piano-rollback-${randomUUID()}`);
      const temp = await open(temporary, "wx", 0o600);
      try {
        await temp.writeFile(original.data);
        await temp.chmod(original.mode);
        await temp.sync();
        await temp.close();
        await rename(temporary, path);
      } finally {
        await temp.close().catch(() => undefined);
        await rm(temporary, { force: true }).catch(() => undefined);
      }
      await lock.close(); await rm(lockPath, { force: true });
    }
  } catch (error) {
    await lock.close().catch(() => undefined); await rm(lockPath, { force: true }).catch(() => undefined); throw error;
  }
}

function report(kind: "git" | "non-git", restored: boolean, changed: readonly string[], failures: readonly string[] = [], residues: readonly string[] = []): GitMetadataRollbackReport {
  return { kind, restored, changed, residues, failures };
}

/** Snapshot and restore semantic Git state only. Worktree files are never read
 * or written; object files and reflogs are intentionally retained as residue.
 * Failures reach the caller on the Effect error channel as
 * {@link GitMetadataTransactionError}. */
export function beginGitMetadataTransaction(
  sourceCwd: string,
): Effect.Effect<GitMetadataTransaction, GitMetadataTransactionError> {
  return effectify(() => openGitMetadataTransaction(sourceCwd), "capture-failed");
}

/** The async core behind {@link beginGitMetadataTransaction}. It stays
 * promise-based because the transaction works at the file-descriptor level —
 * `open` with an exclusive lock, `sync`, `chmod`, rename — and through
 * `execFile`, and because its states are read back with `lstat`/`realpath`. */
async function openGitMetadataTransaction(sourceCwd: string): Promise<GitMetadataTransaction> {
  const repository = await discover(sourceCwd);
  if (repository === undefined) {
    let state: Lifecycle = "open";
    const requireOpen = (operation: string): void => { if (state !== "open") throw new GitMetadataTransactionError("invalid-state", `cannot ${operation} transaction in state ${state}`); };
    const core: TransactionCore = {
      observe: async () => { requireOpen("observe"); return []; },
      commit: async () => { requireOpen("commit"); state = "committed"; },
      rollback: async () => {
        if (state === "committed") throw new GitMetadataTransactionError("invalid-state", "cannot rollback a committed transaction");
        if (state === "rolled-back") return report("non-git", true, []);
        state = "rolled-back"; return report("non-git", true, []);
      },
    };
    return { kind: "non-git", sourceCwd: resolve(sourceCwd), ...liftTransaction(core) };
  }
  const before = await snapshot(repository);
  if ([...before.operationDirs.values()].some(Boolean)) throw new GitMetadataTransactionError("unsafe-mutation", "an existing rebase/sequencer operation cannot be snapshotted safely");
  let observed = before;
  let explicitlyObserved = false;
  let state: Lifecycle = "open";
  let prior: GitMetadataRollbackReport | undefined;
  const requireOpen = (operation: string): void => {
    if (state !== "open") throw new GitMetadataTransactionError("invalid-state", `cannot ${operation} transaction in state ${state}`);
  };
  const unsafeReasons = (after: Snapshot): string[] => {
    const reasons = differences(before, after).filter((entry) => entry.startsWith("operation-dir:"));
    const symbolic = symbolicRefMutation(before, after);
    if (symbolic) reasons.push(`symbolic ref changed:${symbolic}`);
    return reasons;
  };
  const observe = async (): Promise<readonly string[]> => {
    requireOpen("observe");
    const next = await snapshot(repository);
    const unsafe = unsafeReasons(next);
    const changed = differences(before, next);
    if (unsafe.length) throw new GitMetadataTransactionError("unsafe-mutation", unsafe.join("; "), report("git", false, changed, unsafe));
    observed = next;
    explicitlyObserved = true;
    return changed;
  };
  const fail = (code: GitMetadataTransactionError["code"], changed: readonly string[], failures: readonly string[], residues: readonly string[]): never => {
    state = "failed";
    const result = report("git", false, changed, failures, residues);
    throw new GitMetadataTransactionError(code, `Git metadata rollback was best-effort and incomplete: ${failures.join("; ")}`, result);
  };
  const residueNotes = (changed: readonly string[]): string[] => {
    const residues = ["rollback is best-effort; no atomic guarantee"];
    if (changed.some((entry) => entry === "HEAD" || entry.startsWith("ref:"))) residues.push("unreachable objects retained", "reflog entries retained");
    return residues;
  };
  const core: TransactionCore = {
    observe,
    commit: async () => {
      requireOpen("commit");
      const current = await snapshot(repository);
      const conflicts = differences(observed, current);
      if (conflicts.length) {
        throw new GitMetadataTransactionError("concurrent-mutation", conflicts.join("; "), report("git", false, differences(before, observed), conflicts));
      }
      state = "committed";
    },
    rollback: async () => {
      if (state === "committed") throw new GitMetadataTransactionError("invalid-state", "cannot rollback a committed transaction");
      if (prior) return prior;
      requireOpen("rollback");

      if (!explicitlyObserved) {
        // This is the only safe expected-state available when a worker failed
        // before calling observe(). It cannot detect a writer before this read.
        observed = await snapshot(repository);
        const unsafe = unsafeReasons(observed);
        if (unsafe.length) fail("unsafe-mutation", differences(before, observed), unsafe, residueNotes(differences(before, observed)));
      } else {
        const current = await snapshot(repository);
        const conflicts = differences(observed, current);
        if (conflicts.length) fail("concurrent-mutation", differences(before, observed), conflicts, residueNotes(differences(before, observed)));
      }

      const changed = differences(before, observed);
      if (changed.length === 0) {
        state = "rolled-back";
        prior = report("git", true, changed);
        return prior;
      }
      const residues = residueNotes(changed);
      const failures: string[] = [];
      let sawConcurrent = false;
      const attempt = async (label: string, action: () => Promise<void>): Promise<void> => {
        try { await action(); } catch (error) {
          if (error instanceof GitMetadataTransactionError && error.code === "concurrent-mutation") sawConcurrent = true;
          failures.push(`${label}: ${message(error)}`);
        }
      };

      for (const name of new Set([...before.refs.keys(), ...observed.refs.keys()])) {
        const original = before.refs.get(name);
        const expected = observed.refs.get(name);
        if (original?.oid === expected?.oid && original?.symbolicTarget === expected?.symbolicTarget) continue;
        await attempt(`ref:${name}`, () => restoreRef(repository.cwd, name, original, expected));
      }
      for (const [name, path] of repository.markerPaths) {
        const original = before.markers.get(name);
        const expected = observed.markers.get(name);
        if (fileEqual(original, expected)) continue;
        await attempt(`marker:${name}`, () => replaceLocked(path, original, expected));
      }
      for (const path of new Set([...before.sharedIndexes.keys(), ...observed.sharedIndexes.keys()])) {
        const original = before.sharedIndexes.get(path);
        const expected = observed.sharedIndexes.get(path);
        if (fileEqual(original, expected)) continue;
        await attempt(`split-index:${path}`, () => replaceLocked(path, original, expected));
      }
      if (!fileEqual(before.head, observed.head)) await attempt("HEAD", () => replaceLocked(repository.headPath, before.head, observed.head));
      if (!fileEqual(before.index, observed.index)) await attempt("index", () => replaceLocked(repository.indexPath, before.index, observed.index));

      let restored: Snapshot | undefined;
      try { restored = await snapshot(repository); } catch (error) { failures.push(`verification: ${message(error)}`); }
      if (restored) {
        const remaining = differences(before, restored);
        for (const entry of remaining) failures.push(`verification: ${entry}`);
        for (const path of restored.sharedIndexes.keys()) {
          if (!before.sharedIndexes.has(path)) residues.push(`worker-created split-index sidecar retained: ${path}`);
        }
      }
      if (failures.length) {
        const code: GitMetadataTransactionError["code"] = sawConcurrent
          ? "concurrent-mutation" : "restore-failed";
        fail(code, changed, failures, residues);
      }
      state = "rolled-back";
      prior = report("git", true, changed, [], residues);
      return prior;
    },
  };
  return { kind: "git", sourceCwd: repository.cwd, ...liftTransaction(core) };
}
