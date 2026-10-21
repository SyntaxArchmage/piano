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
  captureWorkspaceBaselineChanges,
  diffWorkspaceChangeSet,
  freezeWorkspaceBaseline,
  inventoryWorkspaceLstat,
  restoreWorkspaceLstat,
  snapshotWorkspaceContent,
  workspaceBaselineChanges,
  workspaceRefName,
  type WorkflowCarrying,
  type WorkspaceBaseline,
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
  /** The baseline the winner delta is measured against, so the transaction
   * can re-derive and verify the declared change list. */
  readonly baseline: WorkspaceBaseline;
  /** The declared winner delta (paths and kinds). The transaction derives the
   * canonical frozen files from the baseline and rejects a winner tree that
   * disagrees. */
  readonly changes: readonly WorkspaceContentChange[];
  readonly excludeUnder: readonly string[];
}

export interface PreparedConsolidationEvidence {
  readonly transactionId: string;
  readonly sourceCwd: string;
  readonly runDir: string;
  readonly externalRoot: string;
  readonly targetBeforeDir: string;
  /** The commit form of target-before: what every delta in this transaction
   * is measured against. The directory beside it is the worker's evidence. */
  readonly targetBeforeBaseline: WorkspaceBaseline;
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
   * focused tests can exercise independent Git rollback failure. Runtime builds
   * beginGitMetadataTransaction and runs it immediately before runTurn, which
   * is when the transaction's baseline snapshot is taken. */
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
    const targetBeforeBaseline = await freezeWorkspaceBaseline(sourceIdentity.lexicalPath, {
      runDir: input.runDir,
      refName: workspaceRefName("tx", `${transactionId}/target-before`),
      excludeUnder: excluded,
    });
    const changeSet = await captureWorkspaceBaselineChanges(
      input.baseline,
      input.winnerContentDir,
      winnerChangeDir,
      excluded,
    );
    if (!changesEqual(changeSet.changes, input.changes)) {
      throw workflowError("schedule", input.winnerContentDir, "winner tree does not match its declared change set");
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
      targetBeforeBaseline,
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
  const unexpected = (await workspaceBaselineChanges(
    evidence.targetBeforeBaseline,
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

/** Fold a step that returns a promise into an Either, keeping whatever it
 * rejected with so the carry reason can render it the way it always has. A
 * promise rejection is a failure here, unlike at the injection seams, where
 * the implementation is somebody else's and a defect is reported as one. */
function promiseEither<A>(run: () => Promise<A>): Effect.Effect<Either.Either<A, unknown>> {
  return Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(Effect.either);
}

/** Run one caller-supplied effect and fold everything that ended it into an
 * Either. The dependency-injection seam admits any implementation, so one that
 * ends in a defect — a rejected `Effect.promise` — or a factory that throws
 * synchronously is reported as an {@link ImplementationDefectError} instead of
 * crashing the carry: by the time these run the worker has usually already
 * mutated the parent workspace, and that state has to reach the rollback.
 * Interruption is not a transaction failure and is left alone. */
function seamEither<A, E, R>(
  run: () => Effect.Effect<A, E, R>,
): Effect.Effect<Either.Either<A, E | ImplementationDefectError>, never, R> {
  return Effect.try({ try: run, catch: implementationDefect }).pipe(
    Effect.flatten,
    Effect.either,
    Effect.catchAllDefect((defect) => Effect.succeed(Either.left(implementationDefect(defect)))),
  );
}

/** The carry's running verdict. It lives in one object because six checks
 * mutate the same three facts, and a caller that forgets one of them fails
 * silently rather than loudly. */
interface CarryVerdict {
  canonicalEvidenceTrusted: boolean;
  integrityFailure: boolean;
  failureReason: string | undefined;
}

/** Fold one canonical-evidence check into the carry's verdict. A failed check
 * is what makes the source state unknown, so it always flips
 * `integrityFailure`; `label` is the wording the caller wants recorded, and a
 * caller that has already recorded a reason passes none. */
function noteIntegrity(verdict: CarryVerdict, integrity: IntegrityCheck, label?: string): void {
  if (integrity.ok) return;
  verdict.integrityFailure = true;
  verdict.canonicalEvidenceTrusted = integrity.canonicalTrusted;
  if (label !== undefined) verdict.failureReason += `; ${label}: ${integrity.reason ?? "unknown failure"}`;
}

/** Answer a carry that leaves evidence behind: the retention verdict says
 * whether the external tree is still there and where, and its message joins the
 * reason so whoever reads the carry knows what survived. */
async function carryingWithRetention(
  evidence: PreparedConsolidationEvidence,
  carrying: {
    readonly kind: NonNullable<ConsolidationCarrying["kind"]>;
    readonly sourceState: "known" | "unknown";
    readonly reason: string;
  },
): Promise<ConsolidationCarrying> {
  const retention = await verifiedExternalEvidenceRetention(evidence);
  return {
    kind: carrying.kind,
    sourceState: carrying.sourceState,
    reason: `${carrying.reason}; ${retention.reason}`,
    ...(retention.root === undefined ? {} : { externalEvidenceRoot: retention.root }),
  };
}

async function rollbackPrepared(
  evidence: PreparedConsolidationEvidence,
  gitMetadata: GitMetadataTransaction | undefined,
  verdict: CarryVerdict,
): Promise<ConsolidationCarrying> {
  const reason = verdict.failureReason ?? "consolidation did not complete";
  const filesystemRollback = verdict.canonicalEvidenceTrusted
    ? Effect.tryPromise({
      try: () => restoreWorkspaceLstat(evidence.sourceCwd, evidence.targetBeforeDir, undefined, evidence.excluded),
      catch: (cause) => cause,
    })
    : Effect.fail(new Error("canonical external evidence is not trusted; filesystem rollback was withheld"));
  // Both rollbacks are Effect now, and both fold their outcome into an Either
  // so one failing half cannot hide the report of the other. `Effect.all` is
  // sequential by default; these two have always run side by side. The Git half
  // is built inside the thunk so an implementation that throws before it
  // returns an effect is folded the same way one that ends in a defect is.
  const [filesystem, git] = await Effect.runPromise(Effect.all([
    Effect.either(filesystemRollback),
    seamEither(() => gitMetadata === undefined
      ? Effect.fail(new GitMetadataTransactionError("invalid-state", "Git metadata transaction was not created"))
      : gitMetadata.rollback()),
  ], { concurrency: "unbounded" }));
  const filesystemReason = Either.isLeft(filesystem) ? errorMessage(filesystem.left) : undefined;
  let gitReason: string | undefined;
  let gitRestored = false;
  if (Either.isRight(git)) {
    gitRestored = git.right.restored;
    if (!gitRestored) gitReason = reportMessage(git.right);
  } else {
    const failure = git.left;
    const report = failure !== null && typeof failure === "object" && "report" in failure
      ? (failure as { readonly report?: GitMetadataRollbackReport }).report
      : undefined;
    gitReason = report === undefined ? errorMessage(failure) : reportMessage(report);
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
  const fullyRestored = Either.isRight(filesystem) && gitRestored && sourceReason === undefined && !verdict.integrityFailure;
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
      details.push(`external evidence cleanup failed: ${errorMessage(cause)}`);
      return carryingWithRetention(evidence, {
        kind: "carry-failed",
        sourceState: "known",
        reason: details.join("; "),
      });
    }
    return { kind: "carry-failed", sourceState: "known", reason: details.join("; ") };
  }
  if (verdict.integrityFailure) details.push("consolidation integrity verification failed; source state is unknown");
  return carryingWithRetention(evidence, {
    kind: "carry-failed",
    sourceState: "unknown",
    reason: details.join("; "),
  });
}

/** Run the one canonical consolidation lifecycle for every consolidation
 * caller. The core owns only evidence, gate, rollback, and Git metadata; the
 * caller owns worker prompts, actor continuation, and workflow-specific state. */
export function runConsolidationTransaction<R>(
  input: ConsolidationTransactionInput<R>,
): Effect.Effect<ConsolidationCarrying, never, R | FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const evidence = input.evidence;
    const verdict: CarryVerdict = {
      canonicalEvidenceTrusted: true,
      integrityFailure: false,
      failureReason: undefined,
    };
    // This closes the deterministic prepare-to-worker gap. A same-UID writer
    // can still race after this check, so the per-turn gate remains required.
    const preWorker = yield* promiseEither(async () => {
      await verifyFullEvidence(evidence);
      await verifySourceMatchesTargetBefore(evidence, "before first worker turn");
    });
    if (preWorker._tag === "Left") {
      return yield* Effect.promise(() => carryingWithRetention(evidence, {
        kind: "carry-failed",
        sourceState: "unknown",
        reason: `pre-worker consolidation baseline verification failed: ${errorMessage(preWorker.left)}`,
      }));
    }
    const gitFactory = input.gitMetadataFactory ?? beginGitMetadataTransaction;
    const begun = yield* seamEither(() => gitFactory(evidence.sourceCwd));
    if (begun._tag === "Left") {
      return yield* Effect.promise(() => carryingWithRetention(evidence, {
        kind: "carry-failed",
        sourceState: "unknown",
        reason: `cannot start Git metadata transaction: ${errorMessage(begun.left)}`,
      }));
    }
    const gitMetadata = begun.right;
    // Creating the Git transaction performs an asynchronous metadata
    // discovery/snapshot. Recheck the source baseline after that gap and
    // before the first worker side effect. If it drifted, the transaction is
    // already open, so every rollback path must run through the same dual
    // rollback core used for worker failures.
    const postFactoryPreWorker = yield* promiseEither(async () => {
      await verifyFullEvidence(evidence);
      await verifySourceMatchesTargetBefore(evidence, "before first worker turn after Git metadata transaction creation");
    });
    if (postFactoryPreWorker._tag === "Left") {
      verdict.failureReason = `pre-worker consolidation baseline verification failed after Git metadata transaction creation: ${errorMessage(postFactoryPreWorker.left)}`;
      noteIntegrity(verdict, yield* Effect.promise(() => checkEvidence(evidence)), "external evidence verification failed");
      return yield* Effect.promise(() => rollbackPrepared(evidence, gitMetadata, verdict));
    }
    let repair: readonly string[] | undefined;
    for (let attempt = 0; attempt <= input.repairAttempts; attempt += 1) {
      const turn = yield* seamEither(() => input.runTurn(repair));
      const observed = yield* seamEither(() => Effect.gen(function* () {
        const changed = yield* gitMetadata!.observe();
        yield* Effect.tryPromise({ try: () => verifyFullEvidence(evidence), catch: (cause) => cause });
        return changed;
      }));
      if (turn._tag === "Left") {
        verdict.failureReason = `winner consolidation worker failed: ${errorMessage(turn.left)}`;
        if (observed._tag === "Left") {
          verdict.integrityFailure = true;
          verdict.failureReason += `; post-worker integrity/metadata check failed: ${errorMessage(observed.left)}`;
          noteIntegrity(verdict, yield* Effect.promise(() => checkEvidence(evidence)), "external evidence verification failed");
        } else {
          noteIntegrity(verdict, yield* Effect.promise(() => checkEvidence(evidence)), "post-worker integrity verification failed");
        }
        break;
      }
      if (observed._tag === "Left") {
        verdict.failureReason = `consolidation turn integrity/metadata check failed: ${errorMessage(observed.left)}`;
        verdict.integrityFailure = true;
        noteIntegrity(verdict, yield* Effect.promise(() => checkEvidence(evidence)));
        break;
      }
      const gate = yield* promiseEither(() => inspectGate(evidence));
      if (gate._tag === "Left") {
        verdict.failureReason = `consolidation gate failed: ${errorMessage(gate.left)}`;
        break;
      }
      if (!gate.right.equal) {
        if (attempt < input.repairAttempts) {
          repair = gate.right.differing.slice(0, 20);
          continue;
        }
        verdict.failureReason = `the parent never matched the frozen winning delta; still differing (${gate.right.differing.length}): ${gate.right.differing.slice(0, 5).join(", ")}`;
        break;
      }
      if (input.persistAfterCarry !== undefined) {
        const persistAfterCarry = input.persistAfterCarry;
        const persisted = yield* seamEither(() => persistAfterCarry());
        if (persisted._tag === "Left") {
          verdict.failureReason = `actor/resume-state persistence failed: ${errorMessage(persisted.left)}`;
          break;
        }
        const afterPersist = yield* promiseEither(() => verifyFullEvidence(evidence));
        if (afterPersist._tag === "Left") {
          verdict.failureReason = `post-persistence integrity verification failed: ${errorMessage(afterPersist.left)}`;
          verdict.integrityFailure = true;
          noteIntegrity(verdict, yield* Effect.promise(() => checkEvidence(evidence)));
          break;
        }
        const postPersistenceGate = yield* promiseEither(() => inspectGate(evidence));
        if (postPersistenceGate._tag === "Left") {
          verdict.failureReason = `post-persistence source delta gate failed: ${errorMessage(postPersistenceGate.left)}`;
          break;
        }
        if (!postPersistenceGate.right.equal) {
          verdict.failureReason = `post-persistence source delta gate rejected changes (${postPersistenceGate.right.differing.length}): ${postPersistenceGate.right.differing.slice(0, 5).join(", ")}`;
          break;
        }
      }
      const committed = yield* seamEither(() => gitMetadata!.commit());
      if (committed._tag === "Left") {
        verdict.failureReason = `Git metadata transaction commit failed: ${errorMessage(committed.left)}`;
        break;
      }
      const convenienceCleaned = yield* promiseEither(() => removeConvenienceEvidence(evidence));
      if (convenienceCleaned._tag === "Left") {
        return yield* Effect.promise(() => carryingWithRetention(evidence, {
          kind: "worker-consolidated",
          sourceState: "known",
          reason: `consolidation succeeded but runDir convenience cleanup failed: ${errorMessage(convenienceCleaned.left)}`,
        }));
      }
      const cleaned = yield* promiseEither(() => removeExternalRoot(evidence));
      if (cleaned._tag === "Left") {
        return yield* Effect.promise(() => carryingWithRetention(evidence, {
          kind: "worker-consolidated",
          sourceState: "known",
          reason: `consolidation succeeded but external evidence cleanup failed: ${errorMessage(cleaned.left)}`,
        }));
      }
      return { kind: "worker-consolidated", sourceState: "known" } satisfies ConsolidationCarrying;
    }
    // A carry that failed without recording why still has to name itself before
    // the final check can append to the reason.
    if (verdict.failureReason === undefined) verdict.failureReason = "consolidation did not complete";
    if (!verdict.integrityFailure) {
      noteIntegrity(verdict, yield* Effect.promise(() => checkEvidence(evidence)), "final integrity verification failed");
    }
    return yield* Effect.promise(() => rollbackPrepared(evidence, gitMetadata, verdict));
  });
}
