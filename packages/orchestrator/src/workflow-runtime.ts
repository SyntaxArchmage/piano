import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { WorkflowRegionPlan } from "./workflow.js";

/** One loop expansion frame: identifies evidence only. */
interface WorkflowLoopFrame {
  readonly kind: "loop";
  readonly regionId: string;
  readonly iteration: number;
}

/** One fan-out expansion frame: also defines an independent actor lane. */
interface WorkflowMapFrame {
  readonly kind: "map";
  readonly regionId: string;
  readonly slot: number;
}

/** One dynamic expansion frame. */
export type WorkflowRuntimeFrame = WorkflowLoopFrame | WorkflowMapFrame;

/** The frames of one kind, in chain order. The only place that narrows the
 * frame union by kind; callers never repeat the type predicate. */
export function loopFrames(frames: readonly WorkflowRuntimeFrame[]): readonly WorkflowLoopFrame[] {
  return frames.filter((frame): frame is WorkflowLoopFrame => frame.kind === "loop");
}

export function mapFrames(frames: readonly WorkflowRuntimeFrame[]): readonly WorkflowMapFrame[] {
  return frames.filter((frame): frame is WorkflowMapFrame => frame.kind === "map");
}

/** One concrete execution of a statically compiled stage. */
export interface WorkflowRuntimeInvocation {
  readonly runId: string;
  readonly jobOrdinal: number;
  readonly stageId: string;
  readonly stageName: string;
  readonly frames: readonly WorkflowRuntimeFrame[];
}

const DEFAULT_EXECUTION_ID_PREFIX = "execution";

/** A caller-provided execution id is deliberately narrow because it becomes
 * part of the run evidence path. Callers that omit it receive a unique id. */
export function runId(value?: string): string | undefined {
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

/** The runtime instance of one region: its frame chain plus the region id.
 * The single spelling `region-finalized` records are keyed by — written and
 * read through this function so the two can never disagree. A frame chain is
 * absent for a top-level region, so the region instance is just its id
 * (`tune`); a slot invocation inside it spells `tune/slot-0` — the region
 * instance plus the frame, exactly as `runtimeInstanceId` writes it. */
export function runtimeRegionInstanceId(
  frames: readonly WorkflowRuntimeFrame[],
  regionId: string,
): string {
  const chain = runtimeInstanceId(frames);
  return chain === undefined ? regionId : `${chain}/${regionId}`;
}

/** Rebuild the frame chain `runtimeInstanceId` spelled — the inverse both
 * directions test against each other. Mechanical use only: a continue that
 * holds an accepted invocation's instance string needs the frames back to
 * address its evidence. `undefined` for a string the speller could not have
 * produced. */
export function runtimeFramesFromInstanceId(
  instance: string,
): readonly WorkflowRuntimeFrame[] | undefined {
  const segments = instance.split("/");
  let index = segments[0] === "root" ? 1 : 0;
  const frames: WorkflowRuntimeFrame[] = [];
  while (index < segments.length) {
    const regionId = segments[index];
    const marker = segments[index + 1];
    if (regionId === undefined || regionId === "" || marker === undefined) return undefined;
    const iteration = /^iter-(\d+)$/.exec(marker);
    const slot = /^slot-(\d+)$/.exec(marker);
    if (iteration !== null) {
      frames.push({ kind: "loop", regionId, iteration: Number(iteration[1]) });
    } else if (slot !== null) {
      frames.push({ kind: "map", regionId, slot: Number(slot[1]) });
    } else {
      return undefined;
    }
    index += 2;
  }
  return frames;
}

/** Path segments shared by all per-invocation evidence. Static names and frame
 * values originate from the validated workflow or generated integers. */
function runtimeInvocationPathSegments(
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
    String(invocation.jobOrdinal),
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
 * across iterations. Exported so the ledger's `actor-turn` record spells the
 * lane the same way the actor key and session directory do. */
function actorLaneSegments(frames: readonly WorkflowRuntimeFrame[]): readonly string[] {
  return mapFrames(frames)
    .flatMap((frame) => [frame.regionId, `slot-${frame.slot}`]);
}

/** The actor identity: session × harness × worker × lane, under a versioned
 * prefix. Worker — the recipe's role — rather than logical stage: one worker
 * continues a single conversation across stages, loop iterations, workflow
 * switches, and prompts of a session, which is what lets "run a workflow,
 * then keep working on it" resume the same chat. Keys written before this
 * format used the stage id on the opposite reading (that two stages sharing a
 * worker must not share a chat); {@link migrateLegacyActorKey} rewrites them. */
/** The actor's lane as path segments: `["root"]` for an actor with no map
 * frame, the map frame pairs otherwise. The one spelling the actor key, the
 * session directory, and the ledger's `actor-turn` row share. */
export function actorLane(frames: readonly WorkflowRuntimeFrame[]): readonly string[] {
  const lane = actorLaneSegments(frames);
  return lane.length === 0 ? ["root"] : lane;
}

export function workflowActorKey(
  invocation: WorkflowRuntimeInvocation,
  harness: string,
  worker: string,
): string {
  return [ACTOR_KEY_VERSION, invocation.runId, harness, worker, ...actorLane(invocation.frames)].join("/");
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
  const [runId, harness, stageId] = parts;
  if (runId === undefined || harness === undefined || stageId === undefined || parts.length < 4) return undefined;
  const worker = stageToWorker.get(stageId);
  if (worker === undefined) return undefined;
  return [ACTOR_KEY_VERSION, runId, harness, worker, ...parts.slice(3)].join("/");
}

export function actorSessionDirectory(
  runDir: string,
  invocation: WorkflowRuntimeInvocation,
  harness: string,
  worker: string,
): string {
  // One flat, human-readable name per conversation: the lane rides as the
  // worker name's suffix (`tuning-slot-0`), never as nested directories.
  return join(
    runDir,
    "sessions",
    `trajectory-${harness}-${worker}-${actorLane(invocation.frames).join("-")}`,
  );
}

export function mapOverParts(region: WorkflowRegionPlan): readonly [string, readonly string[]] | undefined {
  if (region.kind !== "map" || region.over === undefined) return undefined;
  const [source, ...path] = region.over.split(".");
  return source === undefined || source === "" ? undefined : [source, path];
}
