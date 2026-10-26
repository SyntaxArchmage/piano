import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { join } from "node:path";
import { writeFileAtomic } from "@piano/base";
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
import type { ContractMetric, ContractProjection } from "@piano/contract";

/** Why an accepted stage result did not satisfy its worker contract. The
 * stage still publishes the worker's text and session — validation is a
 * quality signal, not a gate — so the warning travels with the evidence and
 * tells downstream consumers to verify the result instead of trusting it. */
export interface StageValidationWarning {
  readonly worker: string;
  /** Absolute path of the worker contract the result failed, when one exists. */
  readonly contractPath?: string;
  readonly message: string;
}

/** Immutable evidence emitted by the orchestrator after a producer has
 * completed (and, when a contract is present, been validated). */
export interface AcceptedInvocation {
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
  /** The worker's `results/<ref>-attempt-<k>.json` file this acceptance
   * vouches for. The path never moves; the run-local contract copy under
   * `contracts/<worker>.json` is what a reader validates it against. */
  readonly resultPath?: string;
  readonly resultPayload?: unknown;
  /** Contract-declared metrics of the accepted result, so a rebuilt result
   * carries what tournament selection reads. */
  readonly metrics?: readonly ContractMetric[];
  /** Named values declared by the producer contract for downstream use. */
  readonly projections?: readonly ContractProjection[];
  /** Present when the worker's result failed its contract even after the one
   * repair turn. The acceptance then carries no payload, metrics or
   * projections: `resultPath` is retained only as the invalid evidence path. */
  readonly validationWarning?: StageValidationWarning;
}

/** One item of a map region's automatic per-lane context. */
export interface WorkflowMapItem {
  readonly over: string;
  readonly index: number;
  readonly value: unknown;
}

function mapFsError(path: string, cause: unknown): WorkflowError {
  return workflowError("schedule", path, String(cause));
}

function writeJsonAtomic(
  path: string,
  value: unknown,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, {
    mapError: (cause) => mapFsError(path, cause),
  });
}

/** Persist a producer's accepted result as immutable orchestrator-owned
 * evidence. Agent code never chooses this path or writes this metadata.
 *
 * The acceptance is one row on the run's `system-log/invocations.jsonl`
 * stream — the metadata home. */
export function writeAcceptanceRecord(
  runDir: string,
  invocation: WorkflowRuntimeInvocation,
  producer: Omit<AcceptedInvocation, "id" | "stageId" | "instanceId">,
): Effect.Effect<AcceptedInvocation, WorkflowError, FileSystem.FileSystem> {
  const instanceId = runtimeInstanceId(invocation.frames);
  const record: AcceptedInvocation = {
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
 * stream's envelope. `resultPayload` stays out — it lives in its result file,
 * so the stream never holds a second copy of a worker's JSON. */
function invocationAcceptedRow(
  invocation: WorkflowRuntimeInvocation,
  record: AcceptedInvocation,
): InvocationAcceptedRecord {
  const { id, resultPayload: _resultPayload, ...evidence } = record;
  return {
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
export function readAcceptanceRecord(
  runDir: string,
  invocation: WorkflowRuntimeInvocation,
): Effect.Effect<AcceptedInvocation | undefined, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const rows = yield* readInvocationRecords(runDir);
    const row = findAcceptedRow(rows, invocation);
    return row === undefined ? undefined : yield* acceptedInvocationFromRow(row);
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

/** A stream row as the acceptance it records. `undefined` when the acceptance
 * names a result file the reader can no longer load — evidence that is gone is
 * not evidence, so the caller re-runs the stage instead. */
function acceptedInvocationFromRow(
  row: InvocationAcceptedRecord,
): Effect.Effect<AcceptedInvocation | undefined, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    let resultPayload: unknown;
    // A warned acceptance deliberately has no accepted payload: its result
    // path is the invalid evidence, not a value a reader may reconstruct.
    if (row.resultPath !== undefined && row.validationWarning === undefined) {
      const fileSystem = yield* FileSystem.FileSystem;
      const bytes = yield* fileSystem.readFile(row.resultPath).pipe(Effect.orElseSucceed(() => undefined));
      if (bytes === undefined) return undefined;
      try {
        resultPayload = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return undefined;
      }
    }
    // Rows written before the contract-version/result-pin removal may still
    // carry those fields; an acceptance rebuilt from them must not.
    const { kind: _kind, timestamp: _timestamp, runId: _runId, jobOrdinal: _jobOrdinal, invocationId, ...rawEvidence } = row;
    const {
      version: _legacyVersion,
      result: _legacyResult,
      contract: _legacyContract,
      ...evidence
    } = rawEvidence as typeof rawEvidence & {
      version?: unknown;
      result?: unknown;
      contract?: unknown;
    };
    return {
      ...evidence,
      id: invocationId,
      ...(resultPayload === undefined ? {} : { resultPayload }),
    };
  });
}

/** Where a consumer's automatic stage-input context lives: the standard
 * `inputs.json` beneath the consumer invocation's private context directory.
 * Exposed so a rebuilt invocation can list the file without rewriting it. */
export function inputsContextPath(runDir: string, ref: string): string {
  return join(invocationContextDir(runDir, ref), "inputs.json");
}

/** Materialize a consumer's ordered upstream results as automatic stage
 * input. The file is always scoped below the exact invocation, so loop/map
 * expansion cannot overwrite a sibling's input. */
export function writeInputsContext(
  runDir: string,
  consumer: WorkflowRuntimeInvocation,
  ref: string,
  producers: readonly AcceptedInvocation[],
  workspace: WorkflowWorkspaceBinding,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const contextPath = inputsContextPath(runDir, ref);
  return writeJsonAtomic(contextPath, {
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
  }).pipe(Effect.as(contextPath));
}

/** Where a consumer's map item context lives — the writer's own rule, exposed
 * so a rebuilt invocation can list the file without rewriting it. */
export function mapItemContextPath(runDir: string, ref: string): string {
  return join(invocationContextDir(runDir, ref), "map-item.json");
}

/** Map item values are also orchestrator-owned context. They are injected only
 * into the map region's entry stage; descendants receive data through the
 * automatic inputs.json context. */
export function writeMapItemContext(
  runDir: string,
  consumer: WorkflowRuntimeInvocation,
  ref: string,
  item: WorkflowMapItem,
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
