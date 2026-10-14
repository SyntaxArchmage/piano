// Durable GPU-round materialization: the file-side half of a tuning round.
// `inspectGpuRound` performs every check that can reject the worker's output —
// read-only, before any write — and `materializeGpuPromotion` applies the
// inspected batch through one transaction. Extracted verbatim from
// workflow-execution.ts so the stage runner reaches it without the executor
// in between.

import { FileSystem } from "@effect/platform";
import { Effect, Either } from "effect";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import {
  projectContractProjections,
  WorkerContractValidationError,
  type ContractMetric,
  type ContractProjection,
} from "@piano/contract";
import {
  isNotFoundFileSystemError,
  isNotLinkFileSystemError,
  preflightWritePath,
  rejectPathAliases,
  workspaceArtifactPath,
} from "./artifact-paths.js";
import { installStagingFile, writeFileAtomic } from "./atomic-write.js";
import { gpuRoundMaterializationProtocol, replaceProjectedValue } from "./gpu-round-protocol.js";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";
import { validateStagePayload } from "./stage-validation.js";
import type { WorkflowWorkspaceBinding } from "./workspace.js";
import type { ResolvedStageValidation } from "./execution-types.js";
import {
  formatBenchmarkIdentity,
  materializedMetricCompatibilityAliases,
  normalizeDurableMetricCompatibility,
  parseBenchmarkIdentity,
} from "./stage-metrics.js";
function sha256Bytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function writeJsonAtomicWorkflow(
  path: string,
  value: unknown,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, {
    // A random, exclusive sibling avoids following a pre-created predictable
    // temp symlink. The preflight checks below still cannot close an OS-level
    // same-UID concurrent replacement race; use an OS sandbox/openat boundary
    // or a different UID when that threat model matters.
    temporaryPath: () => join(dirname(path), `.${basename(path)}.piano-${randomUUID()}.tmp`),
    mapError: (cause) => workflowError("schedule", path, errorMessage(cause)),
    exclusiveStaging: true,
    installWithBackup: true,
  });
}

function writeBytesAtomicWorkflow(
  path: string,
  value: Uint8Array,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return writeFileAtomic(path, value, {
    temporaryPath: () => join(dirname(path), `.${basename(path)}.piano-${randomUUID()}.tmp`),
    mapError: (cause) => workflowError("schedule", path, errorMessage(cause)),
    exclusiveStaging: true,
    installWithBackup: true,
  });
}

interface FileSnapshot {
  readonly path: string;
  readonly existed: boolean;
  readonly type?: FileSystem.File.Type;
  readonly mode?: number;
  readonly bytes?: Uint8Array;
}

function snapshotMaterializationFile(
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<FileSnapshot, WorkflowError> {
  return Effect.gen(function* () {
    const link = yield* Effect.either(fileSystem.readLink(path));
    if (Either.isRight(link)) {
      return yield* Effect.fail(workflowError("schedule", path, "materialization snapshot refuses a symbolic link"));
    }
    if (!isNotLinkFileSystemError(link.left)) {
      return yield* Effect.fail(workflowError("schedule", path, `materialization snapshot link check failed: ${errorMessage(link.left)}`));
    }
    const stat = yield* Effect.either(fileSystem.stat(path));
    if (Either.isLeft(stat)) {
      if (isNotFoundFileSystemError(stat.left)) return { path, existed: false };
      return yield* Effect.fail(workflowError("schedule", path, `materialization snapshot failed: ${errorMessage(stat.left)}`));
    }
    if (stat.right.type !== "File") {
      return yield* Effect.fail(workflowError("schedule", path, `materialization snapshot requires a regular file, got ${stat.right.type}`));
    }
    const bytes = yield* fileSystem.readFile(path).pipe(
      Effect.mapError((cause) => workflowError("schedule", path, `materialization snapshot read failed: ${errorMessage(cause)}`)),
    );
    return {
      path,
      existed: true,
      type: stat.right.type,
      mode: stat.right.mode,
      bytes: new Uint8Array(bytes),
    };
  });
}

function restoreMaterializationFile(
  fileSystem: FileSystem.FileSystem,
  snapshot: FileSnapshot,
): Effect.Effect<void, WorkflowError> {
  return Effect.gen(function* () {
    if (!snapshot.existed) {
      const link = yield* Effect.either(fileSystem.readLink(snapshot.path));
      if (Either.isRight(link)) {
        yield* fileSystem.remove(snapshot.path).pipe(
          Effect.mapError((cause) => workflowError("schedule", snapshot.path, `materialization rollback remove failed: ${errorMessage(cause)}`)),
        );
      } else {
        if (!isNotLinkFileSystemError(link.left)) {
          return yield* Effect.fail(workflowError("schedule", snapshot.path, `materialization rollback link check failed: ${errorMessage(link.left)}`));
        }
        const stat = yield* Effect.either(fileSystem.stat(snapshot.path));
        if (Either.isLeft(stat) && !isNotFoundFileSystemError(stat.left)) {
          return yield* Effect.fail(workflowError("schedule", snapshot.path, `materialization rollback existence check failed: ${errorMessage(stat.left)}`));
        }
        if (Either.isRight(stat)) {
          yield* fileSystem.remove(snapshot.path).pipe(
            Effect.mapError((cause) => workflowError("schedule", snapshot.path, `materialization rollback remove failed: ${errorMessage(cause)}`)),
          );
        }
      }
      return;
    }
    if (snapshot.type !== "File" || snapshot.bytes === undefined || snapshot.mode === undefined) {
      return yield* Effect.fail(workflowError("schedule", snapshot.path, "materialization rollback has an incomplete file snapshot"));
    }
    const snapshotBytes = snapshot.bytes;
    const snapshotMode = snapshot.mode;
    // Never write through the destination during rollback: another actor may
    // have replaced it with a symlink. A same-directory rename replaces the
    // directory entry itself. As above, this is not a complete defense from a
    // malicious same-UID concurrent writer without OS-level openat/sandboxing.
    const temporary = join(dirname(snapshot.path), `.${basename(snapshot.path)}.piano-rollback-${randomUUID()}.tmp`);
    yield* Effect.gen(function* () {
      yield* fileSystem.writeFile(temporary, snapshotBytes, { flag: "wx" }).pipe(
        Effect.mapError((cause) => workflowError("schedule", snapshot.path, `materialization rollback write failed: ${errorMessage(cause)}`)),
      );
      yield* fileSystem.chmod(temporary, snapshotMode).pipe(
        Effect.mapError((cause) => workflowError("schedule", snapshot.path, `materialization rollback chmod failed: ${errorMessage(cause)}`)),
      );
      yield* installStagingFile(fileSystem, temporary, snapshot.path, (cause) => workflowError("schedule", snapshot.path, errorMessage(cause))).pipe(
        Effect.mapError((cause) => workflowError("schedule", snapshot.path, `materialization rollback replace failed: ${errorMessage(cause)}`)),
      );
    }).pipe(Effect.ensuring(fileSystem.remove(temporary).pipe(Effect.ignore)));
  });
}

function materializationTransaction(
  writes: readonly { readonly path: string; readonly write: Effect.Effect<void, WorkflowError, FileSystem.FileSystem> }[],
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const uniquePaths = [...new Set(writes.map(({ path }) => path))];
    const snapshots = yield* Effect.all(uniquePaths.map((path) => snapshotMaterializationFile(fileSystem, path)));
    const attempt = yield* Effect.either(Effect.gen(function* () {
      for (const { write } of writes) yield* write;
    }));
    if (Either.isRight(attempt)) return;

    const rollback = yield* Effect.all(snapshots.map((snapshot) => Effect.either(restoreMaterializationFile(fileSystem, snapshot))));
    const rollbackErrors = rollback.flatMap((result) => Either.isLeft(result) ? [result.left.message] : []);
    const rollbackStatus = rollbackErrors.length === 0
      ? "rollback completed"
      : `rollback incomplete: ${rollbackErrors.join("; ")}`;
    return yield* Effect.fail(workflowError(
      "schedule",
      uniquePaths.join(","),
      `GPU materialization transaction failed: ${attempt.left.message}; ${rollbackStatus}`,
    ));
  });
}

interface MaterializedStagePayload {
  readonly value: unknown;
  readonly metrics: readonly ContractMetric[];
  readonly projections: readonly ContractProjection[];
  readonly applied: boolean;
}

/** The read-only half of GPU-round materialization: every check that can
 * reject the worker's output, plus the exact write batch that application
 * will commit. Built before any mutation so it can run pre-acceptance (repair
 * feedback) and again post-acceptance (crash consistency) from one source. */
interface GpuRoundInspection {
  readonly payload: unknown;
  readonly metrics: readonly ContractMetric[];
  readonly projections: readonly ContractProjection[];
  readonly writes: readonly { readonly path: string; readonly write: Effect.Effect<void, WorkflowError, FileSystem.FileSystem> }[];
}


/** Apply an already-inspected GPU round. Every rejection of worker output
 * happens inside `inspectGpuRound` — before the first write — so the attempt
 * loop can surface those errors to the worker as repair feedback instead of
 * aborting the run mid-materialization. */
export function materializeGpuPromotion(
  payload: unknown,
  metrics: readonly ContractMetric[],
  projections: readonly ContractProjection[],
  validation: ResolvedStageValidation,
  stageIdentity: string,
  workspace: WorkflowWorkspaceBinding,
  sourcePath: string,
  acceptedResultPath: string | undefined,
  resultRoot: string,
): Effect.Effect<MaterializedStagePayload, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const inspection = yield* inspectGpuRound(
      payload, projections, validation, stageIdentity, workspace, sourcePath, acceptedResultPath, resultRoot,
    );
    if (inspection === undefined) return { value: payload, metrics, projections, applied: false };
    yield* materializationTransaction(inspection.writes);
    return { value: inspection.payload, metrics: inspection.metrics, projections: inspection.projections, applied: true };
  });
}

/** Materialize an explicitly declared GPU-round protocol before downstream
 * stages run. Contract projections bind semantic fields to payload pointers;
 * this core neither knows the worker nor assumes a payload layout. Returns
 * undefined when the validation declares no GPU round protocol. */
export function inspectGpuRound(
  payload: unknown,
  projections: readonly ContractProjection[],
  validation: ResolvedStageValidation,
  stageIdentity: string,
  workspace: WorkflowWorkspaceBinding,
  sourcePath: string,
  acceptedResultPath: string | undefined,
  resultRoot: string,
): Effect.Effect<GpuRoundInspection | undefined, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const declarations = validation.projectionDeclarations;
    const protocol = yield* Effect.try({
      try: () => gpuRoundMaterializationProtocol(declarations, projections),
      catch: (cause) => workflowError("schedule", sourcePath, errorMessage(cause)),
    });
    if (protocol === undefined) return undefined;

    const {
      benchmark,
      candidate,
      currentBest,
      decision,
      iteration,
      promotion,
      records,
    } = protocol;
    const resultingBest = promotion.resulting_best;
    const candidatePath = yield* workspaceArtifactPath(workspace, candidate.path, "candidate.path", sourcePath);
    const workerCurrentBestPath = yield* workspaceArtifactPath(workspace, currentBest.path, "current_best.path", sourcePath);
    const workerResultingBestPath = yield* workspaceArtifactPath(workspace, resultingBest.path, "promotion.resulting_best.path", sourcePath);
    const statePath = yield* workspaceArtifactPath(workspace, records.state_path, "records.state_path", sourcePath);
    const roundPath = yield* workspaceArtifactPath(workspace, records.round_path, "records.round_path", sourcePath);
    const fileSystem = yield* FileSystem.FileSystem;
    const candidatePreflight = yield* preflightWritePath(fileSystem, workspace.cwd, candidatePath, "candidate.path");
    yield* preflightWritePath(fileSystem, workspace.cwd, workerCurrentBestPath, "current_best.path");
    yield* preflightWritePath(fileSystem, workspace.cwd, workerResultingBestPath, "promotion.resulting_best.path");
    const statePreflight = yield* preflightWritePath(fileSystem, workspace.cwd, statePath, "records.state_path");
    const roundPreflight = yield* preflightWritePath(fileSystem, workspace.cwd, roundPath, "records.round_path");
    const acceptedResultPreflight = acceptedResultPath === undefined
      ? undefined
      : yield* preflightWritePath(fileSystem, resultRoot, acceptedResultPath, "acceptedResultPath");
    // Worker current_best/resulting_best paths are validated evidence and may
    // legitimately echo the durable best. Only write destinations participate
    // in alias rejection; an alias among those destinations would make the
    // compensating transaction unable to restore independent records.
    yield* rejectPathAliases([
      { label: "candidate.path", value: candidatePreflight },
      { label: "records.state_path", value: statePreflight },
      { label: "records.round_path", value: roundPreflight },
      ...(acceptedResultPreflight === undefined ? [] : [{ label: "acceptedResultPath", value: acceptedResultPreflight }]),
    ], sourcePath);
    // The worker's current_best/resulting_best paths are evidence, not
    // authority for the promoted-source location. Read the durable state
    // before materializing the round so an agent that reports the candidate
    // path for KEEP cannot silently move the canonical source (profile stages
    // consume state.current_best.path on the next iteration).
    const stateRaw = yield* fileSystem.readFileString(statePath).pipe(
      Effect.mapError((cause) => workflowError("schedule", statePath, `round state is not readable: ${errorMessage(cause)}`)),
    );
    let state: Record<string, unknown>;
    try {
      const parsed = JSON.parse(stateRaw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("state must be an object");
      state = parsed as Record<string, unknown>;
    } catch (cause) {
      return yield* Effect.fail(workflowError("schedule", statePath, `round state is not valid JSON: ${errorMessage(cause)}`));
    }
    const durableBest = typeof state.current_best === "object" && state.current_best !== null && !Array.isArray(state.current_best)
      ? state.current_best as Record<string, unknown>
      : undefined;
    if (durableBest === undefined || typeof durableBest.path !== "string" || durableBest.path.trim() === "") {
      return yield* Effect.fail(workflowError(
        "schedule",
        statePath,
        "round state must contain a non-empty current_best.path; worker current_best.path is not a fallback",
      ));
    }
    const canonicalBestPath = yield* workspaceArtifactPath(workspace, durableBest.path, "state.current_best.path", sourcePath);
    const canonicalBestPreflight = yield* preflightWritePath(fileSystem, workspace.cwd, canonicalBestPath, "state.current_best.path");
    const canonicalBestRefPath = canonicalBestPreflight.relativeRef;
    yield* rejectPathAliases([
      { label: "candidate.path", value: candidatePreflight },
      { label: "records.state_path", value: statePreflight },
      { label: "records.round_path", value: roundPreflight },
      { label: "state.current_best.path", value: canonicalBestPreflight },
      ...(acceptedResultPreflight === undefined ? [] : [{ label: "acceptedResultPath", value: acceptedResultPreflight }]),
    ], sourcePath);
    // Tuning is non-monotonic: a candidate that does not beat the durable best
    // is a regression, not an error. The worker reports its decision, but the
    // orchestrator owns truth — a KEEP whose measured metric is worse than the
    // current best is demoted to a non-fatal DISCARD (current-best unchanged,
    // the round record preserved). Never turn a regression into a hard failure.
    const benchmarkIdentity = benchmark === undefined
      ? undefined
      : yield* Effect.try({
        try: () => parseBenchmarkIdentity(benchmark, "round benchmark"),
        catch: (cause) => workflowError("schedule", sourcePath, errorMessage(cause)),
      });
    const metricName = benchmarkIdentity?.name;
    const metricBest = typeof benchmark?.best === "number" && Number.isFinite(benchmark.best) ? benchmark.best : undefined;
    const existingBestMetric =
      typeof state.current_best === "object" && state.current_best !== null && !Array.isArray(state.current_best)
        ? state.current_best as Record<string, unknown>
        : {};
    const metricCompatibility = yield* Effect.try({
      try: () => normalizeDurableMetricCompatibility(existingBestMetric, benchmarkIdentity),
      catch: (cause) => workflowError("schedule", statePath, errorMessage(cause)),
    });
    const durableBenchmark = metricCompatibility.benchmark;
    const durableBenchmarkIdentity = durableBenchmark?.identity;
    const legacyStateUpgrade = benchmarkIdentity !== undefined && durableBenchmarkIdentity !== undefined &&
      durableBenchmarkIdentity.legacy && !benchmarkIdentity.legacy &&
      durableBenchmarkIdentity.name === benchmarkIdentity.name &&
      durableBenchmarkIdentity.direction === benchmarkIdentity.direction;
    if (benchmarkIdentity !== undefined && durableBenchmarkIdentity !== undefined &&
        !legacyStateUpgrade &&
        (benchmarkIdentity.legacy !== durableBenchmarkIdentity.legacy ||
          benchmarkIdentity.name !== durableBenchmarkIdentity.name ||
          benchmarkIdentity.unit !== durableBenchmarkIdentity.unit ||
          benchmarkIdentity.direction !== durableBenchmarkIdentity.direction)) {
      return yield* Effect.fail(workflowError(
        "schedule",
        statePath,
        `benchmark identity mismatch: round=${formatBenchmarkIdentity(benchmarkIdentity)}, durable=${formatBenchmarkIdentity(durableBenchmarkIdentity)}`,
      ));
    }
    // A legacy durable metric has no unit to compare. A modern result with the
    // same name/direction performs an explicit one-way migration and writes
    // the full identity below; it is not treated as a unit-less modern match.
    const previousMetric = metricName === undefined
      ? undefined
      : metricCompatibility.previousBest;
    const direction = benchmarkIdentity?.direction ?? "higher";
    const isRegression = metricBest !== undefined && previousMetric !== undefined &&
      (direction === "higher" ? metricBest < previousMetric : metricBest > previousMetric);
    let effectiveDecision = decision;
    if (decision === "KEEP" && isRegression) {
      effectiveDecision = "DISCARD";
    }
    const bestPath = canonicalBestPath;
    let bestDigest: string;
    let candidateDigest: string | undefined;
    let artifactWrite: { readonly path: string; readonly source: Uint8Array } | undefined;
    let materializedResultingBest: Record<string, unknown> = { path: canonicalBestRefPath };

    if (effectiveDecision === "KEEP") {
      if (promotion.promoted !== true) {
        return yield* Effect.fail(workflowError(
          "schedule",
          sourcePath,
          "round.decision KEEP requires round.promotion.promoted=true",
        ));
      }
      const candidateSource = yield* fileSystem.readFile(candidatePath).pipe(
        Effect.mapError((cause) => workflowError("schedule", candidatePath, `KEEP candidate is not readable: ${errorMessage(cause)}`)),
      );
      bestDigest = sha256Bytes(candidateSource);
      candidateDigest = bestDigest;
      if (typeof candidate.digest === "string" && candidate.digest !== bestDigest) {
        return yield* Effect.fail(workflowError(
          "schedule",
          candidatePath,
          `KEEP candidate digest mismatch: payload=${candidate.digest}, actual=${bestDigest}`,
        ));
      }
      if (typeof resultingBest.digest === "string" && resultingBest.digest !== bestDigest) {
        return yield* Effect.fail(workflowError(
          "schedule",
          bestPath,
          `KEEP resulting-best digest mismatch: payload=${resultingBest.digest}, actual=${bestDigest}`,
        ));
      }
      if (candidatePath !== canonicalBestPath) {
        artifactWrite = { path: bestPath, source: candidateSource };
      }
      materializedResultingBest = { path: canonicalBestRefPath, digest: bestDigest };
    } else {
      const currentBestSource = yield* fileSystem.readFile(canonicalBestPath).pipe(
        Effect.mapError((cause) => workflowError("schedule", canonicalBestPath, `current-best is not readable: ${errorMessage(cause)}`)),
      );
      bestDigest = sha256Bytes(currentBestSource);
      // A compile/verify failure may not leave a candidate file. When a
      // candidate exists, capture its digest before restoring it so the round
      // record remains truthful about what was discarded; current-best itself
      // is always required and authoritative.
      const candidateExists = yield* fileSystem.exists(candidatePath).pipe(
        Effect.mapError((cause) => workflowError("schedule", candidatePath, `candidate existence check failed: ${errorMessage(cause)}`)),
      );
      if (candidateExists) {
        const candidateSource = yield* fileSystem.readFile(candidatePath).pipe(
          Effect.mapError((cause) => workflowError("schedule", candidatePath, `candidate is not readable: ${errorMessage(cause)}`)),
        );
        candidateDigest = sha256Bytes(candidateSource);
        if (typeof candidate.digest === "string" && candidate.digest !== candidateDigest) {
          return yield* Effect.fail(workflowError(
            "schedule",
            candidatePath,
            `candidate digest mismatch: payload=${candidate.digest}, actual=${candidateDigest}`,
          ));
        }
      }
      if (candidatePath !== canonicalBestPath && candidateExists) {
        artifactWrite = { path: candidatePath, source: currentBestSource };
      }
      materializedResultingBest = { path: canonicalBestRefPath, digest: bestDigest };
    }

    const promotedAt = new Date().toISOString();
    const materializedCurrentBest = effectiveDecision === "KEEP"
      ? {
        ...existingBestMetric,
        path: canonicalBestRefPath,
        digest: bestDigest,
        sha256: bestDigest,
        verified: true,
        source: candidatePreflight.relativeRef,
        // The protocol has already enforced the finite, non-negative integer
        // domain shared by the legacy and canonical validators. Preserve that
        // accepted value instead of silently narrowing only durable state.
        iteration,
        promoted_at: promotedAt,
        ...(metricName === undefined || metricBest === undefined || benchmarkIdentity === undefined ? {} : {
          metric: {
            name: metricName,
            ...(benchmarkIdentity.unit === undefined ? {} : { unit: benchmarkIdentity.unit }),
            best: metricBest,
            median: benchmark?.median,
            direction: benchmarkIdentity.direction,
          },
          ...materializedMetricCompatibilityAliases(metricCompatibility, benchmarkIdentity, metricBest),
        }),
      }
      : {
        ...existingBestMetric,
        path: canonicalBestRefPath,
        digest: bestDigest,
        sha256: bestDigest,
      };
    if (state.history !== undefined && !Array.isArray(state.history)) {
      return yield* Effect.fail(workflowError(
        "schedule",
        statePath,
        "round state history must be an array when present",
      ));
    }
    const history = state.history === undefined ? [] : state.history;
    const materializedState = {
      ...state,
      current_best: materializedCurrentBest,
      history: [
        ...history,
        {
          stage: stageIdentity,
          action: effectiveDecision === "KEEP" ? "promote" : "record",
          candidate: candidatePreflight.relativeRef,
          current_best: canonicalBestRefPath,
          digest: bestDigest,
          decision: effectiveDecision,
          ...(decision !== effectiveDecision ? { demoted_from_keep: true } : {}),
          ...(candidateDigest === undefined ? {} : { candidate_digest: candidateDigest }),
          ...(metricName === undefined || metricBest === undefined || benchmarkIdentity === undefined ? {} : {
            metric: metricName,
            ...(benchmarkIdentity.unit === undefined ? {} : { unit: benchmarkIdentity.unit }),
            direction: benchmarkIdentity.direction,
            value: metricBest,
          }),
        },
      ],
    };

    const materializedCandidate = {
      path: candidatePreflight.relativeRef,
      ...(candidateDigest === undefined ? {} : { digest: candidateDigest }),
    };
    const acceptedCurrentBest = {
      path: canonicalBestRefPath,
      digest: bestDigest,
    };
    const materializedPromotion = {
      ...promotion,
      promoted: effectiveDecision === "KEEP",
      resulting_best: materializedResultingBest,
    };
    let materializedPayload = payload;
    if (decision !== effectiveDecision) {
      materializedPayload = replaceProjectedValue(materializedPayload, protocol.marker, {
        ...(protocol.marker.value as Record<string, unknown>),
        demoted_from_keep: true,
      });
    }
    materializedPayload = replaceProjectedValue(materializedPayload, protocol.decisionProjection, effectiveDecision);
    materializedPayload = replaceProjectedValue(materializedPayload, protocol.candidateProjection, materializedCandidate);
    materializedPayload = replaceProjectedValue(materializedPayload, protocol.currentBestProjection, acceptedCurrentBest);
    materializedPayload = replaceProjectedValue(materializedPayload, protocol.promotionProjection, materializedPromotion);

    const revalidated = validateStagePayload(validation, materializedPayload);
    if (!revalidated.success) {
      return yield* Effect.fail(workflowError(
        "schedule",
        sourcePath,
        `materialized result failed validator "${validation.id}": ${revalidated.error.message}`,
      ));
    }
    // Canonical contracts may normalize (notably strip) values during
    // validation, so their normalized output is the only accepted payload.
    // Deprecated named validators strip unknown object keys with Zod. Keep
    // their orchestrator-owned demotion audit marker during migration; the
    // original worker payload had already passed through that validator, so
    // this compatibility branch cannot reintroduce worker-owned unknowns.
    const acceptedMaterializedPayload = validation.kind === "legacy" && decision !== effectiveDecision
      ? materializedPayload
      : revalidated.payload.value;
    const materializedProjections = projectContractProjections(
      validation.id,
      declarations,
      acceptedMaterializedPayload,
    );
    if (materializedProjections instanceof WorkerContractValidationError) {
      return yield* Effect.fail(workflowError("schedule", sourcePath, materializedProjections.message));
    }
    const refreshedProtocol = yield* Effect.try({
      try: () => gpuRoundMaterializationProtocol(declarations, materializedProjections),
      catch: (cause) => workflowError("schedule", sourcePath, errorMessage(cause)),
    });
    if (refreshedProtocol === undefined || refreshedProtocol.decision !== effectiveDecision ||
        refreshedProtocol.currentBest.path !== canonicalBestRefPath ||
        refreshedProtocol.promotion.promoted !== (effectiveDecision === "KEEP")) {
      return yield* Effect.fail(workflowError(
        "schedule",
        sourcePath,
        "materialized GPU round projections do not match the effective result",
      ));
    }

    // All contract/projection/path checks happen before the first write. The
    // artifact, durable state, round record, and accepted result are one
    // compensating transaction so a later failure cannot leave mixed truth.
    const transactionWrites: Array<{ readonly path: string; readonly write: Effect.Effect<void, WorkflowError, FileSystem.FileSystem> }> = [];
    if (artifactWrite !== undefined) {
      transactionWrites.push({ path: artifactWrite.path, write: writeBytesAtomicWorkflow(artifactWrite.path, artifactWrite.source) });
    }
    transactionWrites.push({ path: statePath, write: writeJsonAtomicWorkflow(statePath, materializedState) });
    transactionWrites.push({ path: roundPath, write: writeJsonAtomicWorkflow(roundPath, acceptedMaterializedPayload) });
    if (acceptedResultPath !== undefined) {
      transactionWrites.push({ path: acceptedResultPath, write: writeJsonAtomicWorkflow(acceptedResultPath, acceptedMaterializedPayload) });
    }
    return {
      payload: acceptedMaterializedPayload,
      metrics: revalidated.payload.metrics,
      projections: materializedProjections,
      writes: transactionWrites,
    };
  });
}

