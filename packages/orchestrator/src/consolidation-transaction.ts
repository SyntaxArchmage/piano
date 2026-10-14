import { FileSystem } from "@effect/platform";
import { Effect, Either } from "effect";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  errorMessage,
  implementationDefect,
  ImplementationDefectError,
  WorkflowError,
  workflowError,
} from "./errors.js";
import {
  beginGitMetadataTransaction,
  GitMetadataTransactionError,
  type GitMetadataRollbackReport,
  type GitMetadataTransaction,
} from "./git-metadata-transaction.js";
import { pathWithin } from "./path-within.js";
import {
  captureWorkspaceChangeSet,
  diffWorkspaceChangeSet,
  inventoryWorkspaceLstat,
  restoreWorkspaceLstat,
  snapshotWorkspaceContent,
  workspaceContentChanges,
  type WorkflowCarrying,
  type WorkspaceChangeSet,
  type WorkspaceContentChange,
} from "./workspace.js";

const EXTERNAL_SCHEMA = "piano.consolidation.evidence/v1";
const ROOT_KIND = "directory" as const;

export interface ConsolidationDirectoryIdentity {
  readonly lexicalPath: string;
  readonly realPath: string;
  readonly dev: number;
  readonly ino: number;
}

interface SnapshotEntry {
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink" | "fifo" | "other";
  readonly mode: number;
  readonly contentHash?: string;
  readonly symlinkTarget?: string;
}

interface SnapshotManifest {
  readonly root: typeof ROOT_KIND;
  readonly entries: readonly SnapshotEntry[];
  readonly digest: string;
}

interface ExternalEvidenceManifest {
  readonly schema: typeof EXTERNAL_SCHEMA;
  readonly transactionId: string;
  readonly sourceCwd: string;
  readonly runDir: string;
  readonly excluded: readonly string[];
  readonly snapshots: {
    readonly targetBefore: SnapshotManifest;
    readonly winnerChange: SnapshotManifest;
  };
  readonly changeSet: {
    readonly changes: readonly WorkspaceContentChange[];
  };
  readonly manifestDigest: string;
}

export interface ConsolidationEvidenceInput {
  readonly sourceCwd: string;
  readonly runDir: string;
  readonly winnerContentDir: string;
  /** Complete winner tree used to rebuild the canonical external delta when a
   * runtime caller supplies only its declared change list. */
  readonly baselineContentDir?: string;
  /** Runtime callers provide the already frozen delta. Legacy callers omit it
   * and derive the equivalent whole-tree delta from target-before. */
  readonly changeSet?: WorkspaceChangeSet;
  readonly excludeUnder: readonly string[];
}

export interface PreparedConsolidationEvidence {
  readonly transactionId: string;
  readonly sourceCwd: string;
  readonly runDir: string;
  readonly externalRoot: string;
  readonly targetBeforeDir: string;
  readonly winnerChangeDir: string;
  readonly manifestPath: string;
  readonly manifestDigest: string;
  readonly sentinelPath: string;
  readonly sentinelHash: string;
  readonly convenienceEvidencePath: string;
  readonly convenienceEvidenceHash: string;
  readonly sourceIdentity: ConsolidationDirectoryIdentity;
  readonly runDirIdentity: ConsolidationDirectoryIdentity;
  readonly excluded: readonly string[];
  readonly changeSet: WorkspaceChangeSet;
}

type CanonicalEvidenceReference = Pick<PreparedConsolidationEvidence,
  | "transactionId"
  | "externalRoot"
  | "targetBeforeDir"
  | "winnerChangeDir"
  | "manifestPath"
  | "manifestDigest"
>;

export interface ConsolidationCarrying extends WorkflowCarrying {
  readonly sourceState: "known" | "unknown";
  /** Present whenever the external evidence must remain available for repair or
   * operator recovery. It is intentionally absent after a clean success. */
  readonly externalEvidenceRoot?: string;
}

export interface ConsolidationTransactionInput<R> {
  readonly evidence: PreparedConsolidationEvidence;
  /** One worker turn. The callback owns continuation/session state; the core
   * only decides whether another repair turn is allowed. */
  readonly runTurn: (repair?: readonly string[]) => Effect.Effect<void, WorkflowError, R>;
  readonly persistAfterCarry?: () => Effect.Effect<void, WorkflowError, R>;
  readonly repairAttempts: number;
  /** Dependency injection is intentionally limited to transaction creation so
   * focused tests can exercise independent Git rollback failure. Runtime uses
   * beginGitMetadataTransaction and starts it immediately before runTurn. */
  readonly gitMetadataFactory?: (sourceCwd: string) => Effect.Effect<GitMetadataTransaction, GitMetadataTransactionError>;
}

/** Preparation can fail after the external root has been created. In that
 * case the caller must be able to carry the preserved root to recovery rather
 * than turning a cleanup residue into an untraceable directory. */
export class ConsolidationEvidencePreparationError extends Error {
  readonly externalEvidenceRoot?: string;

  constructor(message: string, externalEvidenceRoot?: string) {
    super(message);
    this.name = "ConsolidationEvidencePreparationError";
    if (externalEvidenceRoot !== undefined) this.externalEvidenceRoot = externalEvidenceRoot;
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, stableValue(child)]));
}

function digest(value: unknown): string {
  const encoded = JSON.stringify(stableValue(value));
  return createHash("sha256")
    .update(encoded === undefined ? "undefined" : encoded)
    .digest("hex");
}

function digestBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function directoryIdentity(path: string, label: string): Promise<ConsolidationDirectoryIdentity> {
  const lexicalPath = resolve(path);
  const lexicalInfo = await lstat(lexicalPath);
  if (lexicalInfo.isSymbolicLink() || !lexicalInfo.isDirectory()) {
    throw workflowError("schedule", lexicalPath, `${label} must be a real directory`);
  }
  const realPath = await realpath(lexicalPath);
  const realInfo = await lstat(realPath);
  if (realInfo.isSymbolicLink() || !realInfo.isDirectory()) {
    throw workflowError("schedule", lexicalPath, `${label} resolves to a non-directory`);
  }
  return { lexicalPath, realPath, dev: realInfo.dev, ino: realInfo.ino };
}

async function assertDirectoryIdentity(
  identity: ConsolidationDirectoryIdentity,
  label: string,
): Promise<void> {
  const lexicalInfo = await lstat(identity.lexicalPath);
  if (lexicalInfo.isSymbolicLink() || !lexicalInfo.isDirectory()) {
    throw workflowError("schedule", identity.lexicalPath, `${label} was replaced by a non-directory`);
  }
  const actualRealPath = await realpath(identity.lexicalPath);
  if (resolve(actualRealPath) !== resolve(identity.realPath)) {
    throw workflowError("schedule", identity.lexicalPath, `${label} realpath changed during consolidation`);
  }
  const realInfo = await lstat(identity.realPath);
  if (realInfo.isSymbolicLink() || !realInfo.isDirectory() ||
    realInfo.dev !== identity.dev || realInfo.ino !== identity.ino) {
    throw workflowError("schedule", identity.lexicalPath, `${label} identity changed during consolidation`);
  }
}

async function createExternalRoot(
  source: ConsolidationDirectoryIdentity,
  runDir: ConsolidationDirectoryIdentity,
): Promise<string> {
  const parents = [...new Set([
    dirname(source.realPath),
    dirname(runDir.realPath),
    tmpdir(),
  ].map((path) => resolve(path)))];
  for (const parentCandidate of parents) {
    let parent: string;
    try {
      parent = await realpath(parentCandidate);
    } catch {
      continue;
    }
    // The transaction root must not be a descendant of either protected tree.
    if (pathWithin(source.realPath, parent) || pathWithin(runDir.realPath, parent)) continue;
    let root: string;
    try {
      root = await mkdtemp(join(parent, ".piano-consolidation-"));
    } catch {
      continue;
    }
    const canonicalRoot = await realpath(root);
    if (pathWithin(source.realPath, canonicalRoot) || pathWithin(runDir.realPath, canonicalRoot)) {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
      continue;
    }
    return canonicalRoot;
  }
  throw workflowError(
    "schedule",
    source.realPath,
    "cannot allocate a consolidation transaction root outside source and run directories",
  );
}

async function captureInventory(root: string, excluded: readonly string[] = []): Promise<readonly SnapshotEntry[]> {
  const entries = await inventoryWorkspaceLstat(root, excluded);
  return entries.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    mode: entry.mode,
    ...(entry.contentHash === undefined ? {} : { contentHash: entry.contentHash }),
    ...(entry.symlinkTarget === undefined ? {} : { symlinkTarget: entry.symlinkTarget }),
  }));
}

function snapshotManifest(entries: readonly SnapshotEntry[]): SnapshotManifest {
  const content = { root: ROOT_KIND, entries };
  return { ...content, digest: digest(content) };
}

function changesEqual(left: readonly WorkspaceContentChange[], right: readonly WorkspaceContentChange[]): boolean {
  if (left.length !== right.length) return false;
  const normalize = (changes: readonly WorkspaceContentChange[]) => changes
    .map((change) => `${change.kind}:${change.path}`)
    .sort();
  return normalize(left).every((change, index) => change === normalize(right)[index]);
}

async function writeExclusiveJson(path: string, value: unknown): Promise<string> {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.write(bytes);
    await handle.sync();
  } finally {
    await handle.close().catch(() => undefined);
  }
  return digestBytes(bytes);
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} does not contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

function unsignedManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  const { manifestDigest: _manifestDigest, ...unsigned } = manifest;
  return unsigned;
}

async function verifyCanonicalEvidence(evidence: CanonicalEvidenceReference): Promise<void> {
  const manifest = await readJson(evidence.manifestPath);
  if (manifest.schema !== EXTERNAL_SCHEMA || manifest.transactionId !== evidence.transactionId ||
    manifest.manifestDigest !== evidence.manifestDigest ||
    digest(unsignedManifest(manifest)) !== evidence.manifestDigest) {
    throw workflowError("schedule", evidence.manifestPath, "canonical consolidation manifest was modified");
  }
  const snapshots = manifest.snapshots;
  if (typeof snapshots !== "object" || snapshots === null || Array.isArray(snapshots)) {
    throw workflowError("schedule", evidence.manifestPath, "canonical consolidation manifest has no snapshots");
  }
  for (const [name, directory] of [["target-before", evidence.targetBeforeDir], ["winner-change", evidence.winnerChangeDir]] as const) {
    const expected = (snapshots as Record<string, unknown>)[name === "target-before" ? "targetBefore" : "winnerChange"];
    if (typeof expected !== "object" || expected === null || Array.isArray(expected)) {
      throw workflowError("schedule", evidence.manifestPath, `canonical ${name} manifest is missing`);
    }
    const entries = await captureInventory(directory);
    const actual = snapshotManifest(entries);
    if (digest(expected) !== digest(actual)) {
      throw workflowError("schedule", directory, `canonical ${name} snapshot inventory/hash changed`);
    }
  }
}

async function verifyFullEvidence(evidence: PreparedConsolidationEvidence): Promise<void> {
  await verifyCanonicalEvidence(evidence);
  await assertDirectoryIdentity(evidence.sourceIdentity, "source workspace");
  await assertDirectoryIdentity(evidence.runDirIdentity, "run directory");
  const sentinel = await readFile(evidence.sentinelPath);
  if (digestBytes(sentinel) !== evidence.sentinelHash) {
    throw workflowError("schedule", evidence.sentinelPath, "consolidation sentinel was modified");
  }
  const sentinelValue = JSON.parse(sentinel.toString("utf8")) as Record<string, unknown>;
  if (sentinelValue.transactionId !== evidence.transactionId || sentinelValue.manifestDigest !== evidence.manifestDigest) {
    throw workflowError("schedule", evidence.sentinelPath, "consolidation sentinel does not match canonical evidence");
  }
  const convenience = await readFile(evidence.convenienceEvidencePath);
  if (digestBytes(convenience) !== evidence.convenienceEvidenceHash) {
    throw workflowError("schedule", evidence.convenienceEvidencePath, "consolidation convenience evidence was modified");
  }
}

interface IntegrityCheck {
  readonly ok: boolean;
  readonly canonicalTrusted: boolean;
  readonly reason?: string;
}

async function checkEvidence(evidence: PreparedConsolidationEvidence): Promise<IntegrityCheck> {
  try {
    await verifyFullEvidence(evidence);
    return { ok: true, canonicalTrusted: true };
  } catch (cause) {
    try {
      await verifyCanonicalEvidence(evidence);
      return { ok: false, canonicalTrusted: true, reason: errorMessage(cause) };
    } catch {
      return { ok: false, canonicalTrusted: false, reason: errorMessage(cause) };
    }
  }
}

async function verifySourceMatchesTargetBefore(
  evidence: PreparedConsolidationEvidence,
  phase: "before first worker turn" | "before first worker turn after Git metadata transaction creation" | "after rollback",
): Promise<void> {
  await assertDirectoryIdentity(evidence.sourceIdentity, "source workspace");
  const sourceEntries = await captureInventory(evidence.sourceCwd, evidence.excluded);
  const beforeEntries = await captureInventory(evidence.targetBeforeDir);
  const before = snapshotManifest(beforeEntries);
  const source = snapshotManifest(sourceEntries);
  if (before.digest !== source.digest || JSON.stringify(before.entries) !== JSON.stringify(source.entries)) {
    throw workflowError("schedule", evidence.sourceCwd, `source workspace does not match target-before ${phase}`);
  }
}

async function verifySourceRestored(evidence: PreparedConsolidationEvidence): Promise<void> {
  await verifySourceMatchesTargetBefore(evidence, "after rollback");
}

async function removeExternalRootPath(externalRoot: string): Promise<void> {
  const info = await lstat(externalRoot);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw workflowError("schedule", externalRoot, "refusing to cleanup a substituted transaction root");
  }
  const actual = await realpath(externalRoot);
  if (resolve(actual) !== resolve(externalRoot)) {
    throw workflowError("schedule", externalRoot, "transaction root realpath changed before cleanup");
  }
  // Move the validated root out of the public evidence name before deleting
  // it. If recursive deletion fails, put the path back; callers still verify
  // its manifest and snapshots because the returned tree may be partial.
  const tombstone = `${externalRoot}.cleanup-${randomUUID()}`;
  await rename(externalRoot, tombstone);
  try {
    await rm(tombstone, { recursive: true, force: true });
  } catch (cause) {
    try {
      await rename(tombstone, externalRoot);
    } catch (restoreCause) {
      throw new AggregateError(
        [cause, restoreCause],
        `external evidence cleanup failed and could not restore ${externalRoot}`,
      );
    }
    throw cause;
  }
}

async function removeExternalRoot(evidence: PreparedConsolidationEvidence): Promise<void> {
  await removeExternalRootPath(evidence.externalRoot);
}

async function removeConvenienceEvidenceFiles(
  runDirIdentity: ConsolidationDirectoryIdentity,
  sentinelPath: string,
  convenienceEvidencePath: string,
): Promise<void> {
  await assertDirectoryIdentity(runDirIdentity, "run directory");
  const removed = await Promise.allSettled([
    rm(sentinelPath, { force: true }),
    rm(convenienceEvidencePath, { force: true }),
  ]);
  const failures = removed
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => errorMessage(result.reason));
  if (failures.length > 0) {
    throw new Error(`run directory convenience cleanup failed: ${failures.join("; ")}`);
  }
}

async function removeConvenienceEvidence(evidence: PreparedConsolidationEvidence): Promise<void> {
  await removeConvenienceEvidenceFiles(evidence.runDirIdentity, evidence.sentinelPath, evidence.convenienceEvidencePath);
}

async function existingExternalEvidenceRoot(externalRoot: string): Promise<string | undefined> {
  try {
    const info = await lstat(externalRoot);
    if (info.isSymbolicLink() || !info.isDirectory()) return undefined;
    const actual = await realpath(externalRoot);
    return resolve(actual) === resolve(externalRoot) ? externalRoot : undefined;
  } catch {
    return undefined;
  }
}

interface ExternalEvidenceRetention {
  readonly root?: string;
  readonly reason: string;
}

async function verifiedExternalEvidenceRetention(
  evidence: CanonicalEvidenceReference,
): Promise<ExternalEvidenceRetention> {
  const root = await existingExternalEvidenceRoot(evidence.externalRoot);
  if (root === undefined) {
    return {
      reason: `external evidence root ${evidence.externalRoot} is missing, substituted, or non-canonical; externalEvidenceRoot omitted`,
    };
  }
  try {
    await verifyCanonicalEvidence(evidence);
  } catch (cause) {
    return {
      reason: `canonical external evidence manifest/snapshot verification failed at ${root}: ${errorMessage(cause)}; externalEvidenceRoot omitted`,
    };
  }
  return {
    root,
    reason: `verified canonical external evidence preserved at ${root}`,
  };
}

export async function prepareConsolidationEvidence(
  input: ConsolidationEvidenceInput,
): Promise<PreparedConsolidationEvidence> {
  const sourceIdentity = await directoryIdentity(input.sourceCwd, "source workspace");
  const runDirIdentity = await directoryIdentity(input.runDir, "run directory");
  const externalRoot = await createExternalRoot(sourceIdentity, runDirIdentity);
  const transactionId = randomUUID();
  const targetBeforeDir = join(externalRoot, "target-before");
  const winnerChangeDir = join(externalRoot, "winner-change");
  const manifestPath = join(externalRoot, "manifest.json");
  const sentinelPath = join(runDirIdentity.lexicalPath, `.piano-consolidation-${transactionId}.sentinel`);
  const convenienceEvidencePath = join(runDirIdentity.lexicalPath, `.piano-consolidation-${transactionId}.json`);
  const excluded = [...new Set([
    ...input.excludeUnder.map((entry) => resolve(entry)),
    ...(pathWithin(sourceIdentity.realPath, runDirIdentity.realPath, false) ? [runDirIdentity.realPath] : []),
  ])];
  let canonicalEvidence: CanonicalEvidenceReference | undefined;
  try {
    await snapshotWorkspaceContent(sourceIdentity.lexicalPath, targetBeforeDir, excluded);
    let changeSet: WorkspaceChangeSet;
    if (input.changeSet !== undefined) {
      if (input.baselineContentDir !== undefined) {
        const materialized = await captureWorkspaceChangeSet(
          input.baselineContentDir,
          input.winnerContentDir,
          winnerChangeDir,
          excluded,
        );
        if (!changesEqual(materialized.changes, input.changeSet.changes)) {
          throw workflowError("schedule", input.winnerContentDir, "winner tree does not match its declared change set");
        }
        changeSet = materialized;
      } else {
        await snapshotWorkspaceContent(input.changeSet.winnerContentDir, winnerChangeDir);
        const winnerEntries = await captureInventory(winnerChangeDir);
        const actualPaths = winnerEntries.filter((entry) => entry.kind !== "directory").map((entry) => entry.path).sort();
        const expectedPaths = input.changeSet.changes.filter((change) => change.kind !== "deleted").map((change) => change.path).sort();
        if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
          throw workflowError("schedule", input.winnerContentDir, "frozen winner change does not match its declared change set");
        }
        changeSet = { winnerContentDir: winnerChangeDir, changes: input.changeSet.changes };
      }
    } else {
      changeSet = await captureWorkspaceChangeSet(
        targetBeforeDir,
        input.winnerContentDir,
        winnerChangeDir,
        excluded,
      );
    }
    await assertDirectoryIdentity(sourceIdentity, "source workspace");
    await assertDirectoryIdentity(runDirIdentity, "run directory");
    const manifestWithoutDigest = {
      schema: EXTERNAL_SCHEMA,
      transactionId,
      sourceCwd: sourceIdentity.realPath,
      runDir: runDirIdentity.realPath,
      excluded,
      snapshots: {
        targetBefore: snapshotManifest(await captureInventory(targetBeforeDir)),
        winnerChange: snapshotManifest(await captureInventory(winnerChangeDir)),
      },
      changeSet: { changes: changeSet.changes },
    } satisfies Omit<ExternalEvidenceManifest, "manifestDigest">;
    const manifestDigest = digest(manifestWithoutDigest);
    const manifest: ExternalEvidenceManifest = { ...manifestWithoutDigest, manifestDigest };
    await writeExclusiveJson(manifestPath, manifest);
    canonicalEvidence = {
      transactionId,
      externalRoot,
      targetBeforeDir,
      winnerChangeDir,
      manifestPath,
      manifestDigest,
    };
    const sentinelHash = await writeExclusiveJson(sentinelPath, {
      schema: EXTERNAL_SCHEMA,
      transactionId,
      manifestDigest,
    });
    const convenienceEvidenceHash = await writeExclusiveJson(convenienceEvidencePath, {
      schema: EXTERNAL_SCHEMA,
      transactionId,
      externalRoot,
      targetBeforeDir,
      winnerChangeDir,
      manifestPath,
      manifestDigest,
      sentinelPath,
    });
    return {
      transactionId,
      sourceCwd: sourceIdentity.lexicalPath,
      runDir: runDirIdentity.lexicalPath,
      externalRoot,
      targetBeforeDir,
      winnerChangeDir,
      manifestPath,
      manifestDigest,
      sentinelPath,
      sentinelHash,
      convenienceEvidencePath,
      convenienceEvidenceHash,
      sourceIdentity,
      runDirIdentity,
      excluded,
      changeSet,
    };
  } catch (cause) {
    const cleanupFailures: string[] = [];
    try {
      await removeConvenienceEvidenceFiles(runDirIdentity, sentinelPath, convenienceEvidencePath);
    } catch (cleanupCause) {
      // Do not remove the canonical root after a runDir cleanup failure: the
      // external evidence is the only reliable recovery handle left.
      cleanupFailures.push(errorMessage(cleanupCause));
    }
    if (cleanupFailures.length === 0) {
      try {
        await removeExternalRootPath(externalRoot);
      } catch (cleanupCause) {
        cleanupFailures.push(errorMessage(cleanupCause));
      }
    }
    if (cleanupFailures.length > 0) {
      const retention = canonicalEvidence === undefined
        ? {
          reason: "canonical external evidence was not completed; externalEvidenceRoot omitted",
        } satisfies ExternalEvidenceRetention
        : await verifiedExternalEvidenceRetention(canonicalEvidence);
      throw new ConsolidationEvidencePreparationError(
        `consolidation evidence preparation failed: ${errorMessage(cause)}; cleanup failed: ${cleanupFailures.join("; ")}; ${retention.reason}`,
        retention.root,
      );
    }
    throw cause;
  }
}

interface GateResult {
  readonly equal: boolean;
  readonly differing: readonly string[];
}

async function inspectGate(evidence: PreparedConsolidationEvidence): Promise<GateResult> {
  const expected = await diffWorkspaceChangeSet(evidence.sourceCwd, evidence.changeSet);
  const unexpected = (await workspaceContentChanges(
    evidence.targetBeforeDir,
    evidence.sourceCwd,
    evidence.excluded,
  ))
    .filter((change) => !evidence.changeSet.changes.some((expectedChange) => expectedChange.path === change.path))
    .map((change) => change.path);
  const differing = [
    ...expected.differing,
    ...unexpected.map((path) => `unexpected: ${path}`),
  ];
  return { equal: expected.equal && unexpected.length === 0, differing };
}

function reportMessage(report: GitMetadataRollbackReport): string {
  return [
    `Git rollback restored=${String(report.restored)}`,
    ...(report.failures.length === 0 ? [] : [`failures: ${report.failures.join("; ")}`]),
    ...(report.residues.length === 0 ? [] : [`residues: ${report.residues.join("; ")}`]),
  ].join(", ");
}

/** Run one caller-supplied effect and fold everything that ended it into an
 * Either. The dependency-injection seam admits any implementation, so one that
 * ends in a defect — a rejected `Effect.promise` — or a factory that throws
 * synchronously is reported as an {@link ImplementationDefectError} instead of
 * crashing the carry: by the time these run the worker has usually already
 * mutated the parent workspace, and that state has to reach the rollback.
 * Interruption is not a transaction failure and is left alone. */
function seamEither<A, E>(
  run: () => Effect.Effect<A, E>,
): Effect.Effect<Either.Either<A, E | ImplementationDefectError>> {
  return Effect.try({ try: run, catch: implementationDefect }).pipe(
    Effect.flatten,
    Effect.either,
    Effect.catchAllDefect((defect) => Effect.succeed(Either.left(implementationDefect(defect)))),
  );
}

async function rollbackPrepared(
  evidence: PreparedConsolidationEvidence,
  gitMetadata: GitMetadataTransaction | undefined,
  reason: string,
  canonicalEvidenceTrusted: boolean,
  integrityFailure: boolean,
): Promise<ConsolidationCarrying> {
  const filesystemRollback = canonicalEvidenceTrusted
    ? restoreWorkspaceLstat(evidence.sourceCwd, evidence.targetBeforeDir, undefined, evidence.excluded)
    : Promise.reject(new Error("canonical external evidence is not trusted; filesystem rollback was withheld"));
  const gitRollback = gitMetadata === undefined
    ? Effect.fail(new GitMetadataTransactionError("invalid-state", "Git metadata transaction was not created"))
    : gitMetadata.rollback();
  // The two rollbacks run concurrently and only one of them is an Effect, so
  // the Git half is driven here rather than composed: the seam helper keeps
  // every way that half can end — including a defect — on the Either side.
  const [filesystem, git] = await Promise.allSettled([
    filesystemRollback,
    Effect.runPromise(seamEither(() => gitRollback)),
  ]);
  let filesystemReason: string | undefined;
  if (filesystem.status === "rejected") filesystemReason = errorMessage(filesystem.reason);
  let gitReason: string | undefined;
  let gitRestored = false;
  if (git.status === "fulfilled") {
    if (Either.isRight(git.value)) {
      gitRestored = git.value.right.restored;
      if (!gitRestored) gitReason = reportMessage(git.value.right);
    } else {
      const failure = git.value.left;
      const report = failure instanceof GitMetadataTransactionError ? failure.report : undefined;
      gitReason = report === undefined ? errorMessage(failure) : reportMessage(report);
    }
  } else {
    gitReason = errorMessage(git.reason);
  }
  let sourceReason: string | undefined;
  try {
    // Source verification is independent of the restore operation's result:
    // a partial restore can still leave a provable source, while a rejected
    // restore must never suppress the final state check.
    await verifySourceRestored(evidence);
  } catch (cause) {
    sourceReason = errorMessage(cause);
  }
  const fullyRestored = filesystem.status === "fulfilled" && gitRestored && sourceReason === undefined && !integrityFailure;
  const details = [
    reason,
    filesystemReason === undefined ? "filesystem rollback completed" : `filesystem rollback failed: ${filesystemReason}`,
    gitReason === undefined ? "Git metadata rollback completed" : `Git metadata rollback failed: ${gitReason}`,
    sourceReason === undefined ? "source rollback verification completed" : `source rollback verification failed: ${sourceReason}`,
  ];
  if (fullyRestored) {
    try {
      await removeConvenienceEvidence(evidence);
      await removeExternalRoot(evidence);
    } catch (cause) {
      const retention = await verifiedExternalEvidenceRetention(evidence);
      details.push(`external evidence cleanup failed: ${errorMessage(cause)}`);
      details.push(retention.reason);
      return {
        kind: "carry-failed",
        sourceState: "known",
        reason: details.join("; "),
        ...(retention.root === undefined ? {} : { externalEvidenceRoot: retention.root }),
      };
    }
    return { kind: "carry-failed", sourceState: "known", reason: details.join("; ") };
  }
  if (integrityFailure) details.push("consolidation integrity verification failed; source state is unknown");
  const retention = await verifiedExternalEvidenceRetention(evidence);
  details.push(retention.reason);
  return {
    kind: "carry-failed",
    sourceState: "unknown",
    reason: details.join("; "),
    ...(retention.root === undefined ? {} : { externalEvidenceRoot: retention.root }),
  };
}

/** Run the one canonical consolidation lifecycle for both runtime and legacy
 * callers. The core owns only evidence, gate, rollback, and Git metadata; the
 * caller owns worker prompts, actor continuation, and workflow-specific state. */
export function runConsolidationTransaction<R>(
  input: ConsolidationTransactionInput<R>,
): Effect.Effect<ConsolidationCarrying, never, R | FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const evidence = input.evidence;
    let canonicalEvidenceTrusted = true;
    let integrityFailure = false;
    let failureReason: string | undefined;
    // This closes the deterministic prepare-to-worker gap. A same-UID writer
    // can still race after this check, so the per-turn gate remains required.
    const preWorker = yield* Effect.tryPromise({
      try: async () => {
        await verifyFullEvidence(evidence);
        await verifySourceMatchesTargetBefore(evidence, "before first worker turn");
      },
      catch: (cause) => cause,
    }).pipe(Effect.either);
    if (preWorker._tag === "Left") {
      const retention = yield* Effect.promise(() => verifiedExternalEvidenceRetention(evidence));
      return {
        kind: "carry-failed",
        sourceState: "unknown",
        reason: `pre-worker consolidation baseline verification failed: ${errorMessage(preWorker.left)}; ${retention.reason}`,
        ...(retention.root === undefined ? {} : { externalEvidenceRoot: retention.root }),
      } satisfies ConsolidationCarrying;
    }
    const gitFactory = input.gitMetadataFactory ?? beginGitMetadataTransaction;
    const begun = yield* seamEither(() => gitFactory(evidence.sourceCwd));
    if (begun._tag === "Left") {
      const retention = yield* Effect.promise(() => verifiedExternalEvidenceRetention(evidence));
      return {
        kind: "carry-failed",
        sourceState: "unknown",
        reason: `cannot start Git metadata transaction: ${errorMessage(begun.left)}; ${retention.reason}`,
        ...(retention.root === undefined ? {} : { externalEvidenceRoot: retention.root }),
      } satisfies ConsolidationCarrying;
    }
    const gitMetadata = begun.right;
    // Creating the Git transaction performs an asynchronous metadata
    // discovery/snapshot. Recheck the source baseline after that gap and
    // before the first worker side effect. If it drifted, the transaction is
    // already open, so every rollback path must run through the same dual
    // rollback core used for worker failures.
    const postFactoryPreWorker = yield* Effect.tryPromise({
      try: async () => {
        await verifyFullEvidence(evidence);
        await verifySourceMatchesTargetBefore(evidence, "before first worker turn after Git metadata transaction creation");
      },
      catch: (cause) => cause,
    }).pipe(Effect.either);
    if (postFactoryPreWorker._tag === "Left") {
      failureReason = `pre-worker consolidation baseline verification failed after Git metadata transaction creation: ${errorMessage(postFactoryPreWorker.left)}`;
      const integrity = yield* Effect.promise(() => checkEvidence(evidence));
      if (!integrity.ok) {
        integrityFailure = true;
        canonicalEvidenceTrusted = integrity.canonicalTrusted;
        failureReason += `; external evidence verification failed: ${integrity.reason ?? "unknown failure"}`;
      }
      return yield* Effect.promise(() => rollbackPrepared(
        evidence,
        gitMetadata,
        failureReason!,
        canonicalEvidenceTrusted,
        integrityFailure,
      ));
    }
    let repair: readonly string[] | undefined;
    for (let attempt = 0; attempt <= input.repairAttempts; attempt += 1) {
      const turn = yield* input.runTurn(repair).pipe(Effect.either);
      const observed = yield* seamEither(() => Effect.gen(function* () {
        const changed = yield* gitMetadata!.observe();
        yield* Effect.tryPromise({ try: () => verifyFullEvidence(evidence), catch: (cause) => cause });
        return changed;
      }));
      if (turn._tag === "Left") {
        failureReason = `winner consolidation worker failed: ${errorMessage(turn.left)}`;
        if (observed._tag === "Left") {
          integrityFailure = true;
          failureReason += `; post-worker integrity/metadata check failed: ${errorMessage(observed.left)}`;
          const integrity = yield* Effect.promise(() => checkEvidence(evidence));
          canonicalEvidenceTrusted = integrity.canonicalTrusted;
          if (!integrity.ok) failureReason += `; external evidence verification failed: ${integrity.reason ?? "unknown failure"}`;
        } else {
          const integrity = yield* Effect.promise(() => checkEvidence(evidence));
          if (!integrity.ok) {
            integrityFailure = true;
            canonicalEvidenceTrusted = integrity.canonicalTrusted;
            failureReason += `; post-worker integrity verification failed: ${integrity.reason ?? "unknown failure"}`;
          }
        }
        break;
      }
      if (observed._tag === "Left") {
        failureReason = `consolidation turn integrity/metadata check failed: ${errorMessage(observed.left)}`;
        integrityFailure = true;
        const integrity = yield* Effect.promise(() => checkEvidence(evidence));
        canonicalEvidenceTrusted = integrity.canonicalTrusted;
        break;
      }
      const gate = yield* Effect.tryPromise({
        try: () => inspectGate(evidence),
        catch: (cause) => cause,
      }).pipe(Effect.either);
      if (gate._tag === "Left") {
        failureReason = `consolidation gate failed: ${errorMessage(gate.left)}`;
        break;
      }
      if (!gate.right.equal) {
        if (attempt < input.repairAttempts) {
          repair = gate.right.differing.slice(0, 20);
          continue;
        }
        failureReason = `the parent never matched the frozen winning delta; still differing (${gate.right.differing.length}): ${gate.right.differing.slice(0, 5).join(", ")}`;
        break;
      }
      if (input.persistAfterCarry !== undefined) {
        const persisted = yield* input.persistAfterCarry().pipe(Effect.either);
        if (persisted._tag === "Left") {
          failureReason = `actor/resume-state persistence failed: ${errorMessage(persisted.left)}`;
          break;
        }
        const afterPersist = yield* Effect.tryPromise({
          try: () => verifyFullEvidence(evidence),
          catch: (cause) => cause,
        }).pipe(Effect.either);
        if (afterPersist._tag === "Left") {
          failureReason = `post-persistence integrity verification failed: ${errorMessage(afterPersist.left)}`;
          integrityFailure = true;
          const integrity = yield* Effect.promise(() => checkEvidence(evidence));
          canonicalEvidenceTrusted = integrity.canonicalTrusted;
          break;
        }
        const postPersistenceGate = yield* Effect.tryPromise({
          try: () => inspectGate(evidence),
          catch: (cause) => cause,
        }).pipe(Effect.either);
        if (postPersistenceGate._tag === "Left") {
          failureReason = `post-persistence source delta gate failed: ${errorMessage(postPersistenceGate.left)}`;
          break;
        }
        if (!postPersistenceGate.right.equal) {
          failureReason = `post-persistence source delta gate rejected changes (${postPersistenceGate.right.differing.length}): ${postPersistenceGate.right.differing.slice(0, 5).join(", ")}`;
          break;
        }
      }
      const committed = yield* seamEither(() => gitMetadata!.commit());
      if (committed._tag === "Left") {
        failureReason = `Git metadata transaction commit failed: ${errorMessage(committed.left)}`;
        break;
      }
      const convenienceCleaned = yield* Effect.tryPromise({
        try: () => removeConvenienceEvidence(evidence),
        catch: (cause) => cause,
      }).pipe(Effect.either);
      if (convenienceCleaned._tag === "Left") {
        const retention = yield* Effect.promise(() => verifiedExternalEvidenceRetention(evidence));
        return {
          kind: "worker-consolidated",
          sourceState: "known",
          reason: `consolidation succeeded but runDir convenience cleanup failed: ${errorMessage(convenienceCleaned.left)}; ${retention.reason}`,
          ...(retention.root === undefined ? {} : { externalEvidenceRoot: retention.root }),
        } satisfies ConsolidationCarrying;
      }
      const cleaned = yield* Effect.tryPromise({
        try: () => removeExternalRoot(evidence),
        catch: (cause) => cause,
      }).pipe(Effect.either);
      if (cleaned._tag === "Left") {
        const retention = yield* Effect.promise(() => verifiedExternalEvidenceRetention(evidence));
        return {
          kind: "worker-consolidated",
          sourceState: "known",
          reason: `consolidation succeeded but external evidence cleanup failed: ${errorMessage(cleaned.left)}; ${retention.reason}`,
          ...(retention.root === undefined ? {} : { externalEvidenceRoot: retention.root }),
        } satisfies ConsolidationCarrying;
      }
      return { kind: "worker-consolidated", sourceState: "known" } satisfies ConsolidationCarrying;
    }
    if (failureReason === undefined) failureReason = "consolidation did not complete";
    if (!integrityFailure) {
      const integrity = yield* Effect.promise(() => checkEvidence(evidence));
      if (!integrity.ok) {
        integrityFailure = true;
        canonicalEvidenceTrusted = integrity.canonicalTrusted;
        failureReason += `; final integrity verification failed: ${integrity.reason ?? "unknown failure"}`;
      }
    }
    return yield* Effect.promise(() => rollbackPrepared(
      evidence,
      gitMetadata,
      failureReason!,
      canonicalEvidenceTrusted,
      integrityFailure,
    ));
  });
}
