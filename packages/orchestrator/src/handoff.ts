import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { type WorkflowError, workflowError } from "./errors.js";
import {
  acceptedInvocations,
  appendInvocationRecord,
  invocationContextDir,
  readInvocationRecords,
  type InvocationAcceptedRecord,
  type InvocationRecord,
} from "./invocations.js";
import {
  runtimeInstanceId,
  runtimeInvocationId,
  type WorkflowRuntimeInvocation,
} from "./workflow-runtime.js";
import type { WorkflowWorkspaceBinding } from "./workspace.js";
import type { WorkerContractReference } from "./contract-snapshot.js";
import type { ContractMetric, ContractProjection } from "@piano/contract";

/** Immutable evidence emitted by the orchestrator after a producer has
 * completed (and, when requested, passed validation). */
export interface HandoffProducer {
  readonly id: string;
  readonly stageId: string;
  /** The flat evidence name (`inv-<serial>`) this acceptance's result file
   * and context directory were published under. */
  readonly ref: string;
  readonly stage: string;
  readonly worker: string;
  readonly instanceId?: string;
  readonly text: string;
  readonly sessionId: string;
  readonly transcriptPath: string;
  /** The attempt number this acceptance closed, so a continue can rebuild the
   * result without re-deriving it from the stream. Absent in records written
   * before it was kept; the cursor supplies the number there instead. */
  readonly attempt?: number;
  /** The conversation this acceptance belongs to, so a rebuilt result re-enters
   * the actor that produced it even when the workflow's worker or harness
   * spelling changed since. Absent in records written before it was kept; the
   * rebuild recomputes the current spelling there. */
  readonly actorKey?: string;
  /** Configuration requested by the workflow before provider capability
   * resolution. Keep it separate from the effective harness values below. */
  readonly requestedModel?: string;
  readonly requestedThinkingLevel?: string;
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly workspace: WorkflowWorkspaceBinding;
  readonly resultPath?: string;
  /** The published result file this acceptance vouches for, pinned by content.
   * `path` is the worker's `results/<ref>-attempt-<k>.json` — a published
   * contract whose path never moves — and `trust` says who last wrote what the
   * record carries: the worker itself, or the orchestrator's GPU-round
   * materialization, which rewrites the accepted payload after the worker's
   * bytes were validated. A reader can therefore tell evidence that still
   * holds exactly the worker's file from evidence the orchestrator
   * re-materialised. */
  readonly result?: {
    readonly path: string;
    readonly sha256: string;
    readonly trust: "worker" | "orchestrator-materialized";
  };
  readonly resultPayload?: unknown;
  /** Contract-declared metrics of the accepted result, so a rebuilt result
   * carries what tournament selection reads. */
  readonly metrics?: readonly ContractMetric[];
  /** Named values declared by the producer contract for downstream use. */
  readonly projections?: readonly ContractProjection[];
  readonly contract?: WorkerContractReference;
}

export interface HandoffMapItem {
  readonly over: string;
  readonly index: number;
  readonly value: unknown;
}

function mapFsError(path: string, cause: unknown): WorkflowError {
  return workflowError("schedule", path, String(cause));
}

function safeRelativePath(
  base: string,
  path: string,
  sourcePath: string,
): Effect.Effect<string, WorkflowError> {
  if (path.trim() === "" || isAbsolute(path)) {
    return Effect.fail(workflowError("compile", sourcePath, "handoff must be a non-empty relative file path"));
  }
  const resolved = resolve(base, path);
  const rel = relative(base, resolved);
  if (rel === "" || rel === "." || rel.startsWith("..") || isAbsolute(rel)) {
    return Effect.fail(workflowError("compile", sourcePath, `handoff path "${path}" escapes its invocation directory`));
  }
  return Effect.succeed(resolved);
}

function writeJsonAtomic(
  path: string,
  value: unknown,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, {
    temporaryPath: () => `${path}.${randomUUID()}.tmp`,
    mapError: (cause) => mapFsError(path, cause),
  });
}

/** The content pin of a result file — the one `sha256:<hex>` spelling a
 * record's `result.sha256` carries and its verifier recomputes. */
export function sha256Bytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Persist a producer's accepted result as immutable orchestrator-owned
 * evidence. Agent code never chooses this path or writes this metadata.
 *
 * The acceptance is one row on the run's `system-log/invocations.jsonl`
 * stream — the metadata home. */
export function writeHandoffRecord(
  runDir: string,
  invocation: WorkflowRuntimeInvocation,
  producer: Omit<HandoffProducer, "id" | "stageId" | "instanceId">,
): Effect.Effect<HandoffProducer, WorkflowError, FileSystem.FileSystem> {
  const instanceId = runtimeInstanceId(invocation.frames);
  const record: HandoffProducer = {
    id: runtimeInvocationId(invocation),
    stageId: invocation.stageId,
    ...(instanceId === undefined ? {} : { instanceId }),
    ...producer,
  };
  return appendInvocationRecord(runDir, invocationAcceptedRow(invocation, record)).pipe(
    Effect.as(record),
  );
}

/** The stream row for one acceptance: the producer's evidence under the
 * stream's envelope. `resultPayload` stays out — it lives in its result file
 * behind the `sha256` pin, so the stream never holds a second copy of a
 * worker's JSON. */
function invocationAcceptedRow(
  invocation: WorkflowRuntimeInvocation,
  record: HandoffProducer,
): InvocationAcceptedRecord {
  const { id, resultPayload: _resultPayload, ...evidence } = record;
  return {
    version: 1,
    kind: "invocation-accepted",
    timestamp: new Date().toISOString(),
    runId: invocation.runId,
    jobOrdinal: invocation.jobOrdinal,
    invocationId: id,
    ...evidence,
  };
}

/** Read a producer's persisted record back, or `undefined` when it is missing
 * or unreadable. A continue rebuilds a skipped invocation's result from this
 * record; absence makes the caller re-run the stage instead. */
export function readHandoffRecord(
  runDir: string,
  invocation: WorkflowRuntimeInvocation,
): Effect.Effect<HandoffProducer | undefined, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const rows = yield* readInvocationRecords(runDir);
    const row = findAcceptedRow(rows, invocation);
    return row === undefined ? undefined : yield* producerFromRow(row);
  });
}

/** The newest acceptance row for this job's invocation, or `undefined`. */
function findAcceptedRow(
  rows: readonly InvocationRecord[],
  invocation: WorkflowRuntimeInvocation,
): InvocationAcceptedRecord | undefined {
  const invocationId = runtimeInvocationId(invocation);
  return acceptedInvocations(rows)
    .filter((row) => row.jobOrdinal === invocation.jobOrdinal && row.invocationId === invocationId)
    .at(-1);
}

/** A stream row as the producer it records. `undefined` when the acceptance
 * pinned a result file the reader can no longer load or verify — evidence that
 * drifted is not evidence, so the caller re-runs the stage instead. */
function producerFromRow(
  row: InvocationAcceptedRecord,
): Effect.Effect<HandoffProducer | undefined, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    let resultPayload: unknown;
    if (row.result !== undefined) {
      const fileSystem = yield* FileSystem.FileSystem;
      const bytes = yield* fileSystem.readFile(row.result.path).pipe(Effect.orElseSucceed(() => undefined));
      if (bytes === undefined) return undefined;
      if (sha256Bytes(bytes) !== row.result.sha256) return undefined;
      try {
        resultPayload = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return undefined;
      }
    }
    const { version: _version, kind: _kind, timestamp: _timestamp, runId: _runId, jobOrdinal: _jobOrdinal, invocationId, ...evidence } = row;
    return {
      ...evidence,
      id: invocationId,
      ...(resultPayload === undefined ? {} : { resultPayload }),
    };
  });
}

/** Materialize a consumer's ordered workflow context. A configured handoff
 * file is always scoped below this exact invocation, so loop/map expansion
 * cannot overwrite a sibling's input even when they use the same DSL path. */
/** Where a consumer's handoff context file lives — the writer's own rule,
 * exposed so a rebuilt invocation can list the file without rewriting it. */
export function handoffContextPath(
  runDir: string,
  ref: string,
  configuredPath: string,
  sourcePath: string,
): Effect.Effect<string, WorkflowError> {
  return safeRelativePath(invocationContextDir(runDir, ref), configuredPath, sourcePath);
}

export function writeHandoffContext(
  runDir: string,
  consumer: WorkflowRuntimeInvocation,
  ref: string,
  configuredPath: string,
  producers: readonly HandoffProducer[],
  workspace: WorkflowWorkspaceBinding,
  sourcePath: string,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  return handoffContextPath(runDir, ref, configuredPath, sourcePath).pipe(
    Effect.flatMap((contextPath) => writeJsonAtomic(contextPath, {
      version: 1,
      consumer: {
        id: runtimeInvocationId(consumer),
        stageId: consumer.stageId,
        stage: consumer.stageName,
        workspace,
        ...(runtimeInstanceId(consumer.frames) === undefined
          ? {}
          : { instanceId: runtimeInstanceId(consumer.frames) }),
      },
      inputs: producers,
    }).pipe(Effect.as(contextPath))),
  );
}

/** Where a consumer's map item context lives — the writer's own rule, exposed
 * so a rebuilt invocation can list the file without rewriting it. */
export function mapItemContextPath(runDir: string, ref: string): string {
  return join(invocationContextDir(runDir, ref), "map-item.json");
}

/** Map item values are also orchestrator-owned context. They are injected only
 * into the map region's entry stage; descendants receive data through normal
 * explicit handoff files. */
export function writeMapItemContext(
  runDir: string,
  consumer: WorkflowRuntimeInvocation,
  ref: string,
  item: HandoffMapItem,
  workspace: WorkflowWorkspaceBinding,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = mapItemContextPath(runDir, ref);
  return writeJsonAtomic(path, {
    version: 1,
    consumer: {
      id: runtimeInvocationId(consumer),
      stageId: consumer.stageId,
      stage: consumer.stageName,
      workspace,
    },
    item,
  }).pipe(Effect.as(path));
}
