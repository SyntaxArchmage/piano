import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { type WorkflowError, workflowError } from "./errors.js";
import {
  invocationDirectory,
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
  readonly resultPayload?: unknown;
  /** Contract-declared metrics of the accepted result, so a rebuilt result
   * carries what tournament selection reads. */
  readonly metrics?: readonly ContractMetric[];
  /** Named values declared by the producer contract for downstream use. */
  readonly projections?: readonly ContractProjection[];
  readonly contract?: WorkerContractReference;
  readonly recordPath: string;
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

function handoffRecordPath(runDir: string, invocation: WorkflowRuntimeInvocation): string {
  return join(invocationDirectory(runDir, invocation), "handoff", "record.json");
}

/** Persist a producer's accepted result as immutable orchestrator-owned
 * evidence. Agent code never chooses this path or writes this metadata. */
export function writeHandoffRecord(
  runDir: string,
  invocation: WorkflowRuntimeInvocation,
  producer: Omit<HandoffProducer, "id" | "stageId" | "instanceId" | "recordPath">,
): Effect.Effect<HandoffProducer, WorkflowError, FileSystem.FileSystem> {
  const recordPath = handoffRecordPath(runDir, invocation);
  const instanceId = runtimeInstanceId(invocation.frames);
  const record: HandoffProducer = {
    id: runtimeInvocationId(invocation),
    stageId: invocation.stageId,
    ...(instanceId === undefined ? {} : { instanceId }),
    ...producer,
    recordPath,
  };
  return writeJsonAtomic(recordPath, { version: 1, producer: record }).pipe(
    Effect.as(record),
  );
}

/** Read a producer's persisted record back, or `undefined` when it is missing
 * or unreadable. A continue rebuilds a skipped invocation's result from this
 * record; absence makes the caller re-run the stage instead. */
export function readHandoffRecord(
  runDir: string,
  invocation: WorkflowRuntimeInvocation,
): Effect.Effect<HandoffProducer | undefined, WorkflowError, FileSystem.FileSystem> {
  const path = handoffRecordPath(runDir, invocation);
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem.readFileString(path).pipe(Effect.orElseSucceed(() => undefined));
    if (raw === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const document = parsed as { version?: unknown; producer?: unknown };
    if (document.version !== 1 || typeof document.producer !== "object" || document.producer === null) {
      return undefined;
    }
    return document.producer as HandoffProducer;
  });
}

/** Materialize a consumer's ordered workflow context. A configured handoff
 * file is always scoped below this exact invocation, so loop/map expansion
 * cannot overwrite a sibling's input even when they use the same DSL path. */
/** Where a consumer's handoff context file lives — the writer's own rule,
 * exposed so a rebuilt invocation can list the file without rewriting it. */
export function handoffContextPath(
  runDir: string,
  consumer: WorkflowRuntimeInvocation,
  configuredPath: string,
  sourcePath: string,
): Effect.Effect<string, WorkflowError> {
  return safeRelativePath(join(invocationDirectory(runDir, consumer), "handoff-context"), configuredPath, sourcePath);
}

export function writeHandoffContext(
  runDir: string,
  consumer: WorkflowRuntimeInvocation,
  configuredPath: string,
  producers: readonly HandoffProducer[],
  workspace: WorkflowWorkspaceBinding,
  sourcePath: string,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  return handoffContextPath(runDir, consumer, configuredPath, sourcePath).pipe(
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
export function mapItemContextPath(runDir: string, consumer: WorkflowRuntimeInvocation): string {
  return join(invocationDirectory(runDir, consumer), "map-item.json");
}

/** Map item values are also orchestrator-owned context. They are injected only
 * into the map region's entry stage; descendants receive data through normal
 * explicit handoff files. */
export function writeMapItemContext(
  runDir: string,
  consumer: WorkflowRuntimeInvocation,
  item: HandoffMapItem,
  workspace: WorkflowWorkspaceBinding,
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  const path = mapItemContextPath(runDir, consumer);
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
