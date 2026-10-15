import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  CompiledWorkflow,
  WorkflowRegionPlan,
  WorkflowStage,
} from "./workflow.js";

/** One dynamic expansion frame. Loop frames identify evidence only; map frames
 * also define an independent actor lane. */
export type WorkflowRuntimeFrame =
  | { readonly kind: "loop"; readonly regionId: string; readonly iteration: number }
  | { readonly kind: "map"; readonly regionId: string; readonly slot: number };

/** One concrete execution of a statically compiled stage. */
export interface WorkflowRuntimeInvocation {
  readonly executionId: string;
  readonly promptIndex: number;
  readonly stageId: string;
  readonly stageName: string;
  readonly frames: readonly WorkflowRuntimeFrame[];
}

export interface WorkflowRuntimeStageNode {
  readonly kind: "stage";
  readonly name: string;
  readonly id: string;
  readonly entryStageId: string;
  readonly exitStageId: string;
  readonly dependencies: readonly string[];
  readonly stage: WorkflowStage;
  readonly order: number;
}

export interface WorkflowRuntimeRegionNode {
  readonly kind: "loop" | "map";
  readonly name: string;
  readonly id: string;
  readonly entryStageId: string;
  readonly exitStageId: string;
  readonly dependencies: readonly string[];
  readonly region: WorkflowRegionPlan;
  readonly children: readonly WorkflowRuntimeNode[];
  readonly order: number;
}

export type WorkflowRuntimeNode = WorkflowRuntimeStageNode | WorkflowRuntimeRegionNode;

export const DEFAULT_EXECUTION_ID_PREFIX = "execution";

/** A caller-provided execution id is deliberately narrow because it becomes
 * part of the run evidence path. Callers that omit it receive a unique id. */
export function executionId(value?: string): string | undefined {
  if (value === undefined) return `${DEFAULT_EXECUTION_ID_PREFIX}-${randomUUID()}`;
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ? value : undefined;
}

export function runtimeInstanceId(frames: readonly WorkflowRuntimeFrame[]): string | undefined {
  if (frames.length === 0) return undefined;
  return frames.flatMap((frame) => frame.kind === "loop"
    ? [frame.regionId, `iter-${frame.iteration}`]
    : [frame.regionId, `slot-${frame.slot}`]).join("/");
}

/** The zero-based iteration of the innermost loop frame carried by an
 * invocation id (`stageId@…/iter-N[/…]`), or undefined when it carries none.
 * Inverse of the `iter-N` spelling {@link runtimeInstanceId} produces, kept
 * beside it so parser and speller cannot drift. Tail-anchored patterns miss
 * map-in-loop ids (`…/iter-2/…/slot-1`); a segment scan does not. Values that
 * cannot be rendered safely (consumers display `iteration + 1`) yield
 * undefined. */
export function iterationOfInvocationId(invocationId: string | undefined): number | undefined {
  if (invocationId === undefined) return undefined;
  const at = invocationId.indexOf("@");
  const instance = at === -1 ? invocationId : invocationId.slice(at + 1);
  let iteration: number | undefined;
  for (const segment of instance.split("/")) {
    const match = /^iter-(\d+)$/.exec(segment);
    if (match === null) continue;
    const value = Number(match[1]);
    iteration = Number.isSafeInteger(value) && value < Number.MAX_SAFE_INTEGER ? value : undefined;
  }
  return iteration;
}

export function runtimeInvocationId(invocation: WorkflowRuntimeInvocation): string {
  return `${invocation.stageId}@${runtimeInstanceId(invocation.frames) ?? "root"}`;
}

/** Path segments shared by all per-invocation evidence. Static names and frame
 * values originate from the validated workflow or generated integers. */
export function runtimeInvocationPathSegments(
  invocation: WorkflowRuntimeInvocation,
): readonly string[] {
  return [
    invocation.stageId,
    runtimeInstanceId(invocation.frames) ?? "root",
  ];
}

export function invocationDirectory(runDir: string, invocation: WorkflowRuntimeInvocation): string {
  return join(
    runDir,
    "prompts",
    String(invocation.promptIndex),
    "invocations",
    ...runtimeInvocationPathSegments(invocation),
  );
}

export function validationResultPath(
  runDir: string,
  invocation: WorkflowRuntimeInvocation,
  attempt: number,
): string {
  return join(invocationDirectory(runDir, invocation), "attempts", String(attempt), "result.json");
}

/** The actor key's version marker. Keys written before actors were keyed by
 * worker carried the logical stage id as their third segment; the marker is
 * what lets a reader tell the two formats apart without guessing. */
export const ACTOR_KEY_VERSION = "v2";

/** Fan-out lane segments of an invocation: every active map slot is an
 * isolated actor; loop frames contribute nothing, so the same actor resumes
 * across iterations. */
function actorLaneSegments(frames: readonly WorkflowRuntimeFrame[]): readonly string[] {
  return frames
    .filter((frame): frame is Extract<WorkflowRuntimeFrame, { kind: "map" }> => frame.kind === "map")
    .flatMap((frame) => [frame.regionId, `slot-${frame.slot}`]);
}

/** The actor identity: session × harness × worker × lane, under a versioned
 * prefix. Worker — the recipe's role — rather than logical stage: one worker
 * continues a single conversation across stages, loop iterations, workflow
 * switches, and prompts of a session, which is what lets "run a workflow,
 * then keep working on it" resume the same chat. Keys written before this
 * format used the stage id on the opposite reading (that two stages sharing a
 * worker must not share a chat); {@link migrateLegacyActorKey} rewrites them. */
export function workflowActorKey(
  invocation: WorkflowRuntimeInvocation,
  harness: string,
  worker: string,
): string {
  const lane = actorLaneSegments(invocation.frames);
  return [ACTOR_KEY_VERSION, invocation.executionId, harness, worker, ...(lane.length === 0 ? ["root"] : lane)].join("/");
}

/** Rewrite one legacy stage-keyed actor key into the worker-keyed form, or
 * `undefined` when the key is not legacy or names a stage the current
 * workflow does not hold. Migration is best-effort by design: an actor whose
 * stage is gone keeps its old key and is simply not looked up. */
export function migrateLegacyActorKey(
  key: string,
  stageToWorker: ReadonlyMap<string, string>,
): string | undefined {
  if (key.startsWith(`${ACTOR_KEY_VERSION}/`)) return undefined;
  const parts = key.split("/");
  const [executionId, harness, stageId] = parts;
  if (executionId === undefined || harness === undefined || stageId === undefined || parts.length < 4) return undefined;
  const worker = stageToWorker.get(stageId);
  if (worker === undefined) return undefined;
  return [ACTOR_KEY_VERSION, executionId, harness, worker, ...parts.slice(3)].join("/");
}

export function actorSessionDirectory(
  runDir: string,
  invocation: WorkflowRuntimeInvocation,
  harness: string,
  worker: string,
): string {
  const lane = actorLaneSegments(invocation.frames);
  return join(
    runDir,
    "actors",
    harness,
    worker,
    ...(lane.length === 0 ? ["root"] : lane),
    "session",
  );
}

/** Reconstruct lexical runtime scopes from the compiler's leaves and their
 * enclosing-region pointers. The compiler remains responsible for graph
 * validation; this structure only controls dynamic loop/map expansion. */
export function buildWorkflowRuntimePlan(
  compiled: CompiledWorkflow,
): readonly WorkflowRuntimeNode[] {
  const orderById = new Map(compiled.stages.map((stage, order) => [stage.id, order]));
  const buildScope = (scopeId: string | undefined): readonly WorkflowRuntimeNode[] => {
    const stages: WorkflowRuntimeNode[] = compiled.stages
      .filter((stage) => stage.parentId === scopeId)
      .map((stage) => ({
        kind: "stage" as const,
        name: stage.stage.name,
        id: stage.id,
        entryStageId: stage.id,
        exitStageId: stage.id,
        dependencies: stage.stage.from,
        stage: stage.stage,
        order: orderById.get(stage.id) ?? Number.MAX_SAFE_INTEGER,
      }));
    const regions: WorkflowRuntimeNode[] = compiled.regions
      .filter((region) => region.parentId === scopeId)
      .map((region) => ({
        kind: region.kind,
        name: region.name,
        id: region.id,
        entryStageId: region.entryStageId,
        exitStageId: region.exitStageId,
        dependencies: region.from,
        region,
        children: buildScope(region.id),
        order: orderById.get(region.entryStageId) ?? Number.MAX_SAFE_INTEGER,
      }));
    return [...stages, ...regions].sort((left, right) =>
      left.order === right.order ? left.name.localeCompare(right.name) : left.order - right.order);
  };
  return buildScope(undefined);
}

export function mapOverParts(region: WorkflowRegionPlan): readonly [string, readonly string[]] | undefined {
  if (region.kind !== "map" || region.over === undefined) return undefined;
  const [source, ...path] = region.over.split(".");
  return source === undefined || source === "" ? undefined : [source, path];
}
