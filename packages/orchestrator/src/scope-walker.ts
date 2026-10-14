// Walking one execution's plan: the scopes, loops, and tournament lanes that
// turn a compiled workflow into concrete stage invocations.
//
// A factory rather than a module of free functions: the walker is one closure
// cluster over a single context, so the closures stay closures and the
// context is destructured once at the top.

import { Either, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { join } from "node:path";
import type { AgentContinuation } from "@piano/harness";
import type { Logging } from "@piano/logging";
import type { WorkflowTrajectory } from "@piano/trajectory";
import {
  allocateMapWorkspace,
  cleanupMapWorkspaces,
  snapshotWorkspaceContent,
  workspaceContentChanges,
  type WorkspaceChangeSet,
  type WorkspaceContentChange,
  type WorkflowCarrying,
  type WorkflowWorkspaceBinding,
} from "./workspace.js";
import { executeStage, type StageRunnerContext } from "./stage-runner.js";
import { resultProjectionValue } from "./stage-runner-support.js";
import { WORKFLOW_LOG } from "./execution-logs.js";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";
import {
  admitWinner,
  selectWinner,
  type SelectionBranch,
  type SelectionIncumbent,
  type SelectionOutcome,
  type SelectionReferee,
} from "./selection.js";
import type { HandoffMapItem } from "./handoff.js";
import {
  executionDirectory,
  mapOverParts,
  runtimeInstanceId,
  runtimeInvocationId,
  type WorkflowRuntimeFrame,
  type WorkflowRuntimeNode,
} from "./workflow-runtime.js";
import type { CompiledWorkflow, WorkflowRegionPlan } from "./workflow.js";
import type { LoadedWorkflow } from "./workflow-file.js";
import type {
  ActorExecutionContext,
  ActorState,
  InternalStageResult,
} from "./execution-types.js";
import type {
  ConsolidateAndGateRequest,
  WorkflowExecutionError,
  WorkflowExecutionRequest,
  WorkflowWorkspaceCandidate,
} from "./workflow-execution.js";
import type { ConsolidationCarrying } from "./consolidation-transaction.js";

/** Mutable state the walker and the composer's finalizer share. */
export interface WalkerWorkspaceState {
  preserve: boolean;
}

/** Everything the scope walker reaches outside itself. */
export interface ScopeWalkerContext {
  readonly stageRunnerContext: StageRunnerContext;
  readonly request: WorkflowExecutionRequest;
  readonly loaded: LoadedWorkflow;
  readonly compiled: CompiledWorkflow;
  readonly executionId: string;
  readonly promptIndex: number;
  readonly actors: Map<string, ActorState>;
  readonly announcedContinuations: Map<string, AgentContinuation>;
  readonly actorContexts: Map<string, ActorExecutionContext>;
  readonly knownLoopIterations: Map<string, number>;
  readonly progressSemaphore: Effect.Semaphore;
  readonly persistActors: () => Effect.Effect<void, WorkflowError, FileSystem.FileSystem>;
  readonly workflowTrajectory: WorkflowTrajectory;
  readonly autoCommit: boolean;
  readonly preExistingDirty: ReadonlySet<string>;
  readonly workspaceState: WalkerWorkspaceState;
  readonly commitRoundWinner: (
    stages: readonly InternalStageResult[],
    iteration: number,
    prompt: string,
    dirty: ReadonlySet<string>,
    cwd: string,
  ) => Effect.Effect<void, never, FileSystem.FileSystem | Logging>;
  readonly consolidate: (args: ConsolidateAndGateRequest) => Effect.Effect<ConsolidationCarrying, never, FileSystem.FileSystem | Logging>;
}

export interface ResultGroup {
  readonly results: readonly InternalStageResult[];
}

export interface NodeExecution {
  readonly boundary: ResultGroup;
  readonly stages: readonly InternalStageResult[];
  /** A validated stage explicitly reported a terminal blocked outcome. */
  readonly stopped?: boolean;
}

/** The direct-child completion table is local to one runtime scope. A loop
 * uses it only to retrieve an explicitly named feedback child after an
 * iteration; it never turns an upstream actor continuation into feedback. */
export interface ScopeExecution extends NodeExecution {
  readonly completed: ReadonlyMap<string, ResultGroup>;
}

interface RuntimeTournamentCandidate extends WorkflowWorkspaceCandidate {
  readonly boundaryResults: readonly InternalStageResult[];
  readonly baselineContentDir: string;
  readonly stopped?: boolean;
}

export function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function terminalGroups(
  nodes: readonly WorkflowRuntimeNode[],
  completed: ReadonlyMap<string, ResultGroup>,
): readonly InternalStageResult[] {
  const consumed = new Set(nodes.flatMap((node) => node.dependencies));
  const terminals = nodes.filter((node) => !consumed.has(node.name));
  return terminals.flatMap((node) => completed.get(node.name)?.results ?? []);
}

/** Automatic tournament promotion, limited to the unambiguous single-referee
 * shape: derive the referee from the map-region exit metric every competing slot
 * reports and pick `selectWinner`. Returns undefined when no referee can be
 * derived (metric-less report/fan-out is left inert) or when destinations are
 * ambiguous. A stopped candidate may still establish the shared metric
 * identity, but is never eligible to win. */
export function automaticTournamentOutcome(
  exitStageId: string,
  candidates: readonly RuntimeTournamentCandidate[],
): {
  readonly outcome: SelectionOutcome;
  readonly referee: SelectionReferee;
  readonly branches: readonly SelectionBranch[];
} | undefined {
  let referee: SelectionReferee | undefined;
  const branches: SelectionBranch[] = [];
  for (const candidate of candidates) {
    const exit = candidate.boundaryResults.find((stage) =>
      stage.stageId === exitStageId && stage.metrics !== undefined && stage.metrics.length === 1,
    );
    const metric = exit?.metrics?.[0]?.value;
    if (metric === undefined || exit === undefined) {
      branches.push({ key: candidate.key, index: branches.length, accepted: false });
      continue;
    }
    const identity: SelectionReferee = { name: metric.name, unit: metric.unit, direction: metric.direction };
    if (referee === undefined) {
      referee = identity;
    } else if (!(referee.name === identity.name && referee.unit === identity.unit && referee.direction === identity.direction)) {
      // A second, conflicting exit identity appeared across slots — no single
      // referee, so refuse to promote rather than mis-select.
      return undefined;
    }
    const result = exit.resultPayload;
    const changedFiles = typeof result === "object" && result !== null &&
      typeof (result as Record<string, unknown>).changed_files === "number"
      ? (result as Record<string, unknown>).changed_files as number : undefined;
    const changedLoc = typeof result === "object" && result !== null &&
      typeof (result as Record<string, unknown>).changed_loc === "number"
      ? (result as Record<string, unknown>).changed_loc as number : undefined;
    branches.push({
      key: candidate.key,
      index: branches.length,
      // A terminal BLOCKED result can legally carry evidence, but it is not a
      // successful branch. Keep its metric for referee identity while making
      // eligibility explicit so selectWinner cannot promote it.
      accepted: candidate.stopped !== true,
      ...(changedFiles !== undefined && changedLoc !== undefined
        ? { tieBreak: { changedFiles, changedLoc } } : {}),
      metric: { name: metric.name, unit: metric.unit, direction: metric.direction, best: metric.best },
    });
  }
  if (referee === undefined) return undefined;
  const outcome = selectWinner(branches, referee);
  return { outcome, referee, branches };
}

/** Preserve the lexical scope context for every child while retaining the
 * child's explicit dependency order. A producer can be both inherited from a
 * parent scope and named as a direct dependency; keep the first occurrence so
 * its immutable handoff provenance is emitted exactly once. */
export function mergeScopeInputs(
  inherited: readonly InternalStageResult[],
  direct: readonly InternalStageResult[],
): readonly InternalStageResult[] {
  const seen = new Set<string>();
  return [...inherited, ...direct].filter((result) => {
    const producerId = result.handoff.id;
    if (seen.has(producerId)) return false;
    seen.add(producerId);
    return true;
  });
}

export function isBlockedStageResult(result: InternalStageResult): boolean {
  return resultProjectionValue(result, "workflow.status") === "blocked" ||
    resultProjectionValue(result, "round.decision") === "BLOCKED";
}

/** A blocked loop round is terminal when its block is global-scoped (or
 * unlabeled, which defaults to global) or it fired on the loop's own entry
 * stage. A hypothesis-scoped block is absorbed and the loop continues. */
export function loopBlockIsTerminal(child: ScopeExecution, entryStageId: string | undefined): boolean {
  const blocked = child.boundary.results.filter(isBlockedStageResult);
  if (blocked.length === 0) return true;
  return blocked.some((result) =>
    (entryStageId !== undefined && result.stageId === entryStageId) ||
    resultProjectionValue(result, "workflow.block-scope") !== "iteration",
  );
}

/** Only a worker-contract projection may end a successful loop. Payload fields
 * with similar names remain ordinary domain data and cannot control scheduling. */
export function loopStopRequested(results: readonly InternalStageResult[]): boolean {
  return results.some((result) => resultProjectionValue(result, "workflow.loop-control") === "stop");
}

export function createScopeWalker(context: ScopeWalkerContext) {
  const {
    stageRunnerContext,
    request,
    loaded,
    compiled,
    executionId,
    promptIndex,
    actors,
    actorContexts,
    knownLoopIterations,
    progressSemaphore,
    persistActors,
    workflowTrajectory,
    autoCommit,
    preExistingDirty,
    workspaceState,
    commitRoundWinner,
    consolidate,
  } = context;

const mapItems = (
  region: WorkflowRegionPlan,
  source: readonly InternalStageResult[],
): Effect.Effect<readonly HandoffMapItem[], WorkflowError, FileSystem.FileSystem | Logging> => Effect.gen(function* () {
  const parts = mapOverParts(region);
  if (parts === undefined || region.count === undefined || region.over === undefined) {
    return yield* Effect.fail(workflowError("schedule", loaded.workflowPath, `map "${region.name}" is missing over/count controls`));
  }
  const [, path] = parts;
  const values: unknown[] = [];
  for (const result of source) {
    const projected = resultProjectionValue(result, "workflow.map-items");
    let selected: unknown;
    if (projected !== undefined) {
      selected = projected;
    } else {
      // Compatibility boundary for contracts authored before semantic
      // projections existed. New contracts declare workflow.map-items;
      // only an accepted named-validator result may use the adapter below
      // to interpret the legacy DSL payload path. Canonical worker
      // contracts must declare workflow.map-items and fail closed here.
      if (result.contract !== undefined) {
        return yield* Effect.fail(workflowError(
          "schedule",
          loaded.workflowPath,
          `map "${region.name}" source "${region.over}" uses a canonical worker contract without required projection "workflow.map-items"`,
        ));
      }
      if (result.resultPayload === undefined || result.resultPath === undefined) {
        return yield* Effect.fail(workflowError(
          "schedule",
          loaded.workflowPath,
          `map "${region.name}" source "${region.over}" must declare projection "workflow.map-items" or provide a legacy accepted validate result`,
        ));
      }
      selected = valueAtPath(result.resultPayload, path);
      yield* WORKFLOW_LOG.warn("workflow.map.legacy-payload-adapter", {
        outcome: "deprecated",
        data: {
          map: region.name,
          source: result.stageId,
          over: region.over,
          message: "declare outputs.projections id workflow.map-items in the source worker contract",
        },
      });
    }
    if (!Array.isArray(selected)) {
      return yield* Effect.fail(workflowError(
        "schedule",
        loaded.workflowPath,
        `map "${region.name}" projection "workflow.map-items" must resolve to an array`,
      ));
    }
    values.push(...selected);
  }
  if (values.length < region.count) {
    return yield* Effect.fail(workflowError(
      "schedule",
      loaded.workflowPath,
      `map "${region.name}" over "${region.over}" produced ${values.length} item(s), fewer than count ${region.count}`,
    ));
  }
  return values.slice(0, region.count).map((value, index) => ({ over: region.over!, index, value }));
});

const tournamentIncumbents = new Map<string, SelectionIncumbent>();

const failTournamentWithPreservedSlots = (
  region: WorkflowRegionPlan,
  sourceCwd: string,
  keys: readonly string[],
  reason: string,
): Effect.Effect<never, WorkflowError, FileSystem.FileSystem | Logging> => Effect.gen(function* () {
  workspaceState.preserve = true;
  const preservation = yield* cleanupMapWorkspaces(request.runDir, executionId, {
    sourceCwd,
    keys,
    preserve: true,
  }).pipe(Effect.either);
  const detail = Either.isLeft(preservation)
    ? `${reason}; additionally failed to preserve tournament slots: ${errorMessage(preservation.left)}`
    : reason;
  return yield* Effect.fail(workflowError(
    "schedule",
    loaded.workflowPath,
    `tournament "${region.name}" ${detail}`,
  ));
});

/** Incumbents exist only across repetitions under a loop. Keep every outer
 * frame in the key, but erase the innermost loop's iteration so adjacent
 * repetitions compare only with their own prior winner. */
const tournamentIncumbentKey = (
  region: WorkflowRegionPlan,
  frames: readonly WorkflowRuntimeFrame[],
): string | undefined => {
  let loopIndex = -1;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (frames[index]?.kind === "loop") {
      loopIndex = index;
      break;
    }
  }
  if (loopIndex < 0) return undefined;
  return [
    ...frames.map((frame, index) => frame.kind === "loop"
      ? `${frame.regionId}/iter-${index === loopIndex ? "*" : frame.iteration}`
      : `${frame.regionId}/slot-${frame.slot}`),
    region.id,
  ].join("/");
};

interface TournamentFinalization {
  readonly winner?: RuntimeTournamentCandidate;
  readonly terminalBlocked?: readonly InternalStageResult[];
  readonly stopped?: boolean;
}

// A tournament is one region: however many stages it contains, it decides
// its winner exactly once, when the region exits — before its parent
// consumes the result or, inside a loop, the next iteration begins. The
// decision and the winner's consolidation into the shared source happen
// here; the run-end finalizer keeps only the workspace cleanup backstop.
const finalizeTournament = (
  region: WorkflowRegionPlan,
  frames: readonly WorkflowRuntimeFrame[],
  parentWorkspace: WorkflowWorkspaceBinding,
  baselineContentDir: string,
  candidates: readonly RuntimeTournamentCandidate[],
): Effect.Effect<TournamentFinalization, WorkflowError, FileSystem.FileSystem | Logging> => Effect.gen(function* () {
  if (candidates.length === 0) return {};
  const sourceCwd = parentWorkspace.cwd;
  const options = request.workspace;
  const blockedResults = candidates.flatMap((candidate) =>
    candidate.boundaryResults.filter(isBlockedStageResult));
  const terminalBlocked = blockedResults.filter((result) =>
    result.stageId === region.entryStageId ||
    resultProjectionValue(result, "workflow.block-scope") !== "iteration");
  if (terminalBlocked.length > 0) {
    const blockedIds = terminalBlocked.map((result) => result.id);
    yield* workflowTrajectory.observe({
      type: "selection",
      executionId,
      timestamp: new Date().toISOString(),
      outcome: "no-winner",
      skipped: `tournament contains terminal blocked result(s): ${blockedIds.join(", ")}`,
    }).pipe(Effect.catchAll(() => Effect.void));
    yield* cleanupMapWorkspaces(request.runDir, executionId, {
      sourceCwd,
      keys: candidates.map((candidate) => candidate.key),
      preserve: options?.preserve === true,
    });
    return { terminalBlocked: blockedResults, stopped: true };
  }
  let winnerKey: string | undefined;
  let selectionReferee: SelectionReferee | undefined;
  let selectionBranches: readonly SelectionBranch[] = [];
  if (options?.winner !== undefined) {
    // An explicit host-plugin selector overrides the metric referee.
    try {
      winnerKey = options.winner === "first"
        ? candidates[0]?.key
        : options.winner === "last"
          ? candidates.at(-1)?.key
          : options.winner({ executionId, sourceCwd, candidates });
    } catch (cause) {
      return yield* Effect.fail(workflowError("schedule", loaded.workflowPath, `workspace winner selector failed: ${errorMessage(cause)}`));
    }
  } else {
    // Automatic tournament: promote only when a single map-region exit
    // metric referee is genuinely present across the competing slots.
    // Metric-less fan-out stays a report/fan-out (no promotion).
    const auto = automaticTournamentOutcome(region.exitStageId, candidates);
    if (auto?.outcome.kind === "selected") {
      winnerKey = auto.outcome.winnerKey;
      selectionReferee = auto.referee;
      selectionBranches = auto.branches;
    } else if (auto !== undefined) {
      yield* workflowTrajectory.observe({
        type: "selection",
        executionId,
        timestamp: new Date().toISOString(),
        outcome: "no-winner",
        referee: auto.referee,
      }).pipe(Effect.catchAll(() => Effect.void));
    } else {
      yield* workflowTrajectory.observe({
        type: "selection",
        executionId,
        timestamp: new Date().toISOString(),
        outcome: "metricless",
      }).pipe(Effect.catchAll(() => Effect.void));
    }
  }
  const cleanupKeys = candidates.map((candidate) => candidate.key);
  if (winnerKey !== undefined) {
    // Winner consolidation is a worker activity (§6): the engine never
    // merges or copies. The winning slot's own coding-agent worker
    // consolidates the shared source by continuing in the parent scope;
    // the engine only re-checks the winner's content against the shared
    // tree with a read-only directory gate, rejecting like a validation
    // failure and feeding back what still differs until the content
    // matches (bounded by the shared repair cap).
    const winnerCandidate = candidates.find((candidate) => candidate.key === winnerKey);
    const winnerContentDir = winnerCandidate?.workspace.cwd;
    // Drive consolidation on the winner's deciding map-region exit
    // worker/harness, so a real coding harness re-opens as the same kind
    // of agent that produced the winning result.
    const winnerExitLeaf = compiled.stages.find((leaf) => leaf.id === region.exitStageId);
    const winnerExitResult = winnerCandidate?.boundaryResults.find((stage) => stage.stageId === region.exitStageId);
    const winnerWorker = winnerExitLeaf?.stage.worker ?? winnerCandidate?.stages.at(-1)?.worker ?? "basic";
    const winnerHarness = winnerExitLeaf?.stage.harness ?? "pi";
    const incumbentKey = selectionReferee === undefined
      ? undefined
      : tournamentIncumbentKey(region, frames);
    const admission = selectionReferee === undefined
      ? undefined
      : admitWinner(
        { kind: "selected", winnerKey, runnerUpKeys: [] },
        selectionBranches,
        selectionReferee,
        incumbentKey === undefined ? undefined : tournamentIncumbents.get(incumbentKey),
      );
    if (admission !== undefined && admission.kind !== "admitted") {
      const carrying: WorkflowCarrying = { kind: "admitted-not-carried", reason: admission.detail };
      yield* workflowTrajectory.observe({
        type: "selection",
        executionId,
        timestamp: new Date().toISOString(),
        outcome: "no-winner",
        referee: selectionReferee,
        winnerKey,
        carrying,
      }).pipe(Effect.catchAll(() => Effect.void));
      yield* cleanupMapWorkspaces(request.runDir, executionId, {
        sourceCwd,
        keys: cleanupKeys,
        preserve: options?.preserve === true,
      });
      return { ...(winnerCandidate === undefined ? {} : { winner: winnerCandidate }) };
    }
    const winnerBlocked = winnerCandidate?.boundaryResults.some(isBlockedStageResult) === true;
    if (winnerCandidate?.stopped === true || winnerBlocked) {
      const carrying: WorkflowCarrying = {
        kind: "admitted-not-carried",
        reason: `winner "${winnerKey}" is stopped/BLOCKED and cannot be selected for carry`,
      };
      yield* workflowTrajectory.observe({
        type: "selection",
        executionId,
        timestamp: new Date().toISOString(),
        outcome: "no-winner",
        ...(selectionReferee === undefined ? {} : { referee: selectionReferee }),
        winnerKey,
        carrying,
      }).pipe(Effect.catchAll(() => Effect.void));
      yield* cleanupMapWorkspaces(request.runDir, executionId, {
        sourceCwd,
        keys: cleanupKeys,
        preserve: options?.preserve === true,
      });
      return {};
    }
    const excludeUnder = [executionDirectory(request.runDir, executionId)];
    let consolidating: WorkflowCarrying;
    if (winnerContentDir === undefined || winnerCandidate === undefined) {
      consolidating = { kind: "carry-failed", reason: `winner "${winnerKey}" has no materialised slot content` };
    } else {
      const frozen = yield* Effect.tryPromise({
        try: async () => {
          const [changes, parentChanges] = await Promise.all([
            workspaceContentChanges(
            winnerCandidate.baselineContentDir,
            winnerContentDir,
            excludeUnder,
            ),
            workspaceContentChanges(baselineContentDir, sourceCwd, excludeUnder),
          ]);
          return {
            changeSet: { winnerContentDir, changes },
            parentChanges,
          } satisfies { readonly changeSet: WorkspaceChangeSet; readonly parentChanges: readonly WorkspaceContentChange[] };
        },
        catch: (cause) => workflowError("schedule", sourceCwd, `cannot inspect tournament winner delta: ${errorMessage(cause)}`),
      }).pipe(Effect.either);
      if (Either.isLeft(frozen)) {
        consolidating = {
          kind: "carry-failed",
          reason: errorMessage(frozen.left),
        };
      } else {
        const { changeSet, parentChanges } = frozen.right;
        const winnerPaths = new Set(changeSet.changes.map((change) => change.path));
        const conflicts = parentChanges.filter((change) => winnerPaths.has(change.path));
        if (conflicts.length > 0) {
          consolidating = {
            kind: "carry-failed",
            reason: `the tournament parent changed after branch allocation at: ${conflicts.map((change) => change.path).join(", ")}`,
          };
        } else if (changeSet.changes.length === 0) {
          consolidating = { kind: "worker-consolidated" };
        } else {
          const actorContext = winnerExitResult === undefined
            ? undefined
            : [...actorContexts.values()].find((context) =>
              runtimeInvocationId(context.invocation) === winnerExitResult.id);
          const actor = actorContext === undefined ? undefined : actors.get(actorContext.actorKey);
          if (actorContext === undefined) {
            consolidating = {
              kind: "carry-failed",
              reason: `winner "${winnerKey}" has no accepted exit-actor context`,
            };
          } else {
            consolidating = yield* consolidate({
              request,
              winnerKey,
              winnerContentDir,
              sourceCwd,
              winnerWorker,
              winnerHarness,
              excludeUnder,
              changeSet,
              winnerBaselineContentDir: winnerCandidate.baselineContentDir,
              winnerActor: {
                ...actorContext,
                ...(actor?.continuation === undefined ? {} : { continuation: actor.continuation }),
                onTurn: (worker) => {
                  actors.set(actorContext.actorKey, {
                    turns: (actors.get(actorContext.actorKey)?.turns ?? 0) + 1,
                    harness: winnerHarness,
                    sessionId: worker.sessionId,
                    transcriptPath: worker.transcriptPath,
                    ...(worker.continuation === undefined ? {} : { continuation: worker.continuation }),
                  });
                },
              },
              // Consolidations can finish concurrently in nested map
              // slots. Defer the actor-table snapshot until the same
              // semaphore used by stage progress persistence is held;
              // locking only the file write would still allow a stale
              // read/modify/write snapshot to overwrite a sibling.
              persistAfterCarry: () => progressSemaphore.withPermits(1)(
                Effect.suspend(() => persistActors()),
              ),
            });
          }
        }
      }
    }
    yield* WORKFLOW_LOG.info("workspace.winner.consolidated", {
      outcome: consolidating.kind === "worker-consolidated" ? "success" : "no-winner",
      data: { executionId, winnerKey, sourceCwd, carrying: consolidating },
    }).pipe(Effect.catchAll(() => Effect.void));
    yield* workflowTrajectory.observe({
      type: "selection",
      executionId,
      timestamp: new Date().toISOString(),
      outcome: consolidating.kind === "worker-consolidated" ? "carried" : "no-winner",
      ...(selectionReferee === undefined ? {} : { referee: selectionReferee }),
      winnerKey,
      ...(consolidating.commit === undefined ? {} : { commit: consolidating.commit }),
      carrying: consolidating,
    }).pipe(Effect.catchAll(() => Effect.void));
    if (consolidating.kind === "carry-failed") {
      return yield* failTournamentWithPreservedSlots(
        region,
        sourceCwd,
        cleanupKeys,
        `winner carry failed: ${consolidating.reason ?? "unknown failure"}`,
      );
    }
    if (incumbentKey !== undefined && admission?.kind === "admitted") {
      tournamentIncumbents.set(incumbentKey, admission.winner);
    }
  }
  yield* cleanupMapWorkspaces(request.runDir, executionId, {
    sourceCwd,
    keys: cleanupKeys,
    preserve: options?.preserve === true,
  });
  const winner = winnerKey === undefined
    ? undefined
    : candidates.find((candidate) => candidate.key === winnerKey);
  return { ...(winner === undefined ? {} : { winner }) };
});

const executeScope = (
  nodes: readonly WorkflowRuntimeNode[],
  scopeId: string | undefined,
  frames: readonly WorkflowRuntimeFrame[],
  inheritedInputs: readonly InternalStageResult[],
  entryStageId: string | undefined,
  mapItem: HandoffMapItem | undefined,
  workspace: WorkflowWorkspaceBinding,
): Effect.Effect<ScopeExecution, WorkflowExecutionError, FileSystem.FileSystem | Logging> => Effect.suspend(() => {
  const completed = new Map<string, ResultGroup>();
  const pending = new Map(nodes.map((node) => [node.name, node]));
  const allStages: InternalStageResult[] = [];

  const runNode = (node: WorkflowRuntimeNode): Effect.Effect<NodeExecution, WorkflowExecutionError, FileSystem.FileSystem | Logging> => {
    const directInputs = node.dependencies.flatMap((dependency) => completed.get(dependency)?.results ?? []);
    const inputs = mergeScopeInputs(inheritedInputs, directInputs);
    if (node.kind === "stage") {
      return executeStage(
        stageRunnerContext,
        node,
        frames,
        inputs,
        mapItem?.over !== undefined && mapItem.index >= 0 && node.id === entryStageId ? mapItem : undefined,
        workspace,
      ).pipe(Effect.map((result) => ({
        boundary: { results: [result] },
        stages: [result],
        ...(isBlockedStageResult(result) ? { stopped: true } : {}),
      })));
    }
    const region = node.region;
    if (node.kind === "loop") {
      const iterations = region.iterations;
      const durationSeconds = region.duration;
      if (iterations === undefined && durationSeconds === undefined) {
        return Effect.fail(workflowError("schedule", loaded.workflowPath, `loop "${region.name}" is missing a bound (iterations or duration)`));
      }
      return Effect.gen(function* () {
        // A blocked prerequisite is already a complete, truthful outcome;
        // do not enter the loop and issue repeated agent turns.
        const inheritedBlocked = inputs.find(isBlockedStageResult);
        if (inheritedBlocked !== undefined) {
          return {
            boundary: { results: [inheritedBlocked] },
            stages: [],
            stopped: true,
          } satisfies NodeExecution;
        }
        let final: ScopeExecution | undefined;
        const stages: InternalStageResult[] = [];
        let priorFeedback: readonly InternalStageResult[] = [];
        // One deadline sampled at entry, so the bound measures wall clock
        // spent *inside the region*: re-deriving it from the last
        // iteration's end would let bookkeeping between rounds extend the
        // run indefinitely.
        const deadlineMs = durationSeconds === undefined
          ? undefined
          : Date.now() + durationSeconds * 1000;
        let iteration = 0;
        while (true) {
          // The bound is consulted *between* iterations, and never before
          // the first: a duration that has already elapsed when the region
          // starts (a resumed run, a long upstream stage) must still run
          // once, because zero iterations is not a loop. One iteration may
          // therefore overshoot the bound; a stage is not interruptible
          // mid-turn by a region clock, only by `stage.timeout` or a human.
          if (iteration > 0) {
            if (iterations !== undefined && iteration >= iterations) break;
            if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
              yield* WORKFLOW_LOG.info("workflow.loop.duration.reached", {
                data: {
                  region: region.id,
                  durationSeconds,
                  completedIterations: iteration,
                },
              }).pipe(Effect.catchAll(() => Effect.void));
              break;
            }
          }
          const child = yield* executeScope(
            node.children,
            node.id,
            [...frames, { kind: "loop", regionId: region.id, iteration }],
            region.feedback === undefined ? inputs : [...inputs, ...priorFeedback],
            node.entryStageId,
            mapItem,
            workspace,
          );
          final = child;
          stages.push(...child.stages);
          if (child.stopped === true && loopBlockIsTerminal(child, node.entryStageId)) {
            // Global-scoped block (prerequisite gone) or entry-stage block:
            // no future round can do useful work, so terminate the loop.
            return {
              boundary: child.boundary,
              stages,
              stopped: true,
            } satisfies NodeExecution;
          }
          let stopRequested = false;
          if (region.feedback !== undefined) {
            const feedback = child.completed.get(region.feedback);
            if (feedback !== undefined) {
              priorFeedback = feedback.results;
              stopRequested = loopStopRequested(feedback.results);
            } else if (child.stopped === true) {
              // Absorbed hypothesis-scoped block before the feedback stage:
              // thread the blocked report as pseudo-feedback so the next
              // round's idea sees the variable was tried and blocked.
              priorFeedback = child.boundary.results;
            } else {
              return yield* Effect.fail(workflowError(
                "schedule",
                loaded.workflowPath,
                `loop "${region.name}" feedback "${region.feedback}" did not complete in iteration ${iteration}`,
              ));
            }
          }
          // ISSUE-017: commit this KEEP round's winner files immediately,
          // before the next iteration mutates the workspace further. Commit
          // failures are non-fatal — auto-commit is bookkeeping and must
          // not kill the tuning run.
          if (autoCommit) {
            yield* commitRoundWinner(child.stages, iteration, request.prompt, preExistingDirty, workspace.cwd);
          }
          iteration += 1;
          if (stopRequested) {
            knownLoopIterations.set(region.id, iteration);
            yield* WORKFLOW_LOG.info("workflow.loop.stop.requested", {
              outcome: "success",
              data: {
                region: region.id,
                completedIterations: iteration,
                feedback: region.feedback,
              },
            }).pipe(Effect.catchAll(() => Effect.void));
            break;
          }
        }
        if (final === undefined) {
          return yield* Effect.fail(workflowError("schedule", loaded.workflowPath, `loop "${region.name}" produced no iteration`));
        }
        return { boundary: final.boundary, stages } satisfies NodeExecution;
      });
    }
    return Effect.gen(function* () {
      const parts = mapOverParts(region);
      if (parts === undefined) {
        return yield* Effect.fail(workflowError("schedule", loaded.workflowPath, `map "${region.name}" is missing over`));
      }
      const [sourceName] = parts;
      const source = completed.get(sourceName);
      if (source === undefined) {
        return yield* Effect.fail(workflowError(
          "schedule",
          loaded.workflowPath,
          `map "${region.name}" source "${sourceName}" is not a completed dependency in scope "${scopeId ?? "root"}"`,
        ));
      }
      const items = yield* mapItems(region, source.results);
      const tournamentSnapshotRoot = join(
        request.runDir,
        "prompts",
        String(promptIndex),
        "tournaments",
        encodeURIComponent(`${runtimeInstanceId(frames) ?? "root"}/${region.id}`),
      );
      const baselineContentDir = join(tournamentSnapshotRoot, "baseline");
      const slotBindings = [] as Array<{
        readonly item: HandoffMapItem;
        readonly frames: readonly WorkflowRuntimeFrame[];
        readonly workspace: WorkflowWorkspaceBinding;
        readonly baselineContentDir: string;
      }>;
      yield* Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => snapshotWorkspaceContent(
            workspace.cwd,
            baselineContentDir,
            [executionDirectory(request.runDir, executionId)],
          ),
          catch: (cause) => workflowError(
            "schedule",
            workspace.cwd,
            `cannot snapshot tournament parent: ${errorMessage(cause)}`,
          ),
        });
        for (const item of items) {
          const slotFrames = [...frames, { kind: "map" as const, regionId: region.id, slot: item.index }];
          const slotWorkspace = yield* allocateMapWorkspace(
            request.runDir,
            executionId,
            slotFrames,
            workspace.cwd,
          );
          const slotBaselineContentDir = join(
            tournamentSnapshotRoot,
            "slot-baselines",
            encodeURIComponent(slotWorkspace.key),
          );
          slotBindings.push({
            item,
            frames: slotFrames,
            workspace: slotWorkspace,
            baselineContentDir: slotBaselineContentDir,
          });
          yield* Effect.tryPromise({
            try: () => snapshotWorkspaceContent(
              slotWorkspace.cwd,
              slotBaselineContentDir,
              [executionDirectory(request.runDir, executionId)],
            ),
            catch: (cause) => workflowError(
              "schedule",
              slotWorkspace.cwd,
              `cannot snapshot tournament slot "${slotWorkspace.key}" baseline: ${errorMessage(cause)}`,
            ),
          });
          yield* WORKFLOW_LOG.info("workspace.prepared", {
            data: {
              executionId,
              instanceId: runtimeInstanceId(slotFrames),
              workspace: slotWorkspace,
            },
          });
        }
      }).pipe(Effect.catchAll((cause) => failTournamentWithPreservedSlots(
        region,
        workspace.cwd,
        slotBindings.map((slot) => slot.workspace.key),
        `workspace snapshot failed: ${errorMessage(cause)}`,
      )));
      // Collect each slot as its own Either so one failing slot does not
      // cancel already-started siblings (Effect.all is fail-fast by
      // default and drops their evidence with the whole scope). A map with
      // any failed slot still fails as a node, but the completed slots'
      // evidence is retained and surfaced instead of silently discarded.
      // Lanes race by default. A tournament declaring `parallel: false`
      // runs them one at a time, which trades wall-clock for uncontended
      // GPU and harness capacity.
      const slotOutcomes = yield* Effect.all(slotBindings.map((slot) => executeScope(
        node.children,
        node.id,
        slot.frames,
        inputs,
        node.entryStageId,
        slot.item,
        slot.workspace,
      ).pipe(Effect.either)), { concurrency: region.parallel === false ? 1 : "unbounded" });
      const failures = slotOutcomes.filter(Either.isLeft);
      if (failures.length > 0) {
        const retained = slotOutcomes.filter(Either.isRight).flatMap((slot) => slot.right.stages);
        yield* WORKFLOW_LOG.info("map.slot.partial-failure", {
          outcome: "failure",
          data: {
            region: region.id,
            totalSlots: slotBindings.length,
            failedSlots: failures.length,
            completedSlots: slotBindings.length - failures.length,
            retainedStages: retained.length,
            retainedStageIds: retained.map((stage) => stage.id),
            reasons: failures.map((slot) => errorMessage(slot.left)),
          },
        }).pipe(Effect.catchAll(() => Effect.void));
        return yield* Effect.fail(workflowError(
          "schedule",
          loaded.workflowPath,
          `map "${region.name}" failed ${failures.length}/${slotBindings.length} slot(s); ` +
            `retained ${retained.length} stage result(s) from ${slotBindings.length - failures.length} completed slot(s)`,
        ));
      }
      const slots = slotOutcomes.map((slot) => Either.getOrThrow(slot));
      // The region just exited: decide the winner and consolidate it into
      // the shared source now — one decision per tournament, per instance.
      // A failed slot set keeps upstream's fail-net effect (the node
      // fails above and no consolidation runs).
      const finalization = yield* finalizeTournament(region, frames, workspace, baselineContentDir, slotBindings.map((slot, index) => ({
        key: slot.workspace.key,
        workspace: slot.workspace,
        mapItem: slot.item,
        boundaryResults: slots[index]?.boundary.results ?? [],
        stages: slots[index]?.stages ?? [],
        baselineContentDir: slot.baselineContentDir,
        ...(slots[index]?.stopped === true ? { stopped: true } : {}),
      })));
      const stopped = finalization.winner === undefined
        ? finalization.stopped === true || slots.some((slot) => slot.stopped === true)
        : finalization.winner.stopped === true;
      return {
        boundary: {
          results: finalization.terminalBlocked ??
            finalization.winner?.boundaryResults ??
            slots.flatMap((slot) => slot.boundary.results),
        },
        stages: slots.flatMap((slot) => slot.stages),
        ...(stopped ? { stopped: true } : {}),
      };
    });
  };

  const run = (): Effect.Effect<ScopeExecution, WorkflowExecutionError, FileSystem.FileSystem | Logging> => Effect.gen(function* () {
    while (pending.size > 0) {
      const ready = [...pending.values()].filter((node) =>
        node.dependencies.every((dependency) => completed.has(dependency)),
      );
      if (ready.length === 0) {
        return yield* Effect.fail(workflowError(
          "schedule",
          loaded.workflowPath,
          `workflow scope "${scopeId ?? "root"}" has no ready node`,
        ));
      }
      // A scope has one mutable workspace binding. The DSL does not carry
      // read-only/write ownership, so stable-order execution avoids races
      // and makes map snapshots deterministic. Run one ready node at a
      // time so a validated blocked result can stop the scope before later
      // independent nodes consume more model turns. Map slots receive
      // distinct bindings below and remain the intentional parallel
      // boundary.
      const node = ready[0];
      if (node === undefined) {
        return yield* Effect.fail(workflowError(
          "schedule",
          loaded.workflowPath,
          `workflow scope "${scopeId ?? "root"}" selected no ready node`,
        ));
      }
      const outcome = yield* runNode(node).pipe(Effect.either);
      if (Either.isLeft(outcome)) return yield* Effect.fail(outcome.left);
      completed.set(node.name, outcome.right.boundary);
      allStages.push(...outcome.right.stages);
      pending.delete(node.name);
      // A stopped child scope (loop/map lane) returns its terminal result
      // to its parent, which may still have a downstream summary node. At
      // the root scope we therefore record the result and continue normal
      // dependency scheduling; only a non-root scope must stop consuming
      // its remaining local nodes.
      if (outcome.right.stopped === true && scopeId !== undefined) {
        return {
          boundary: outcome.right.boundary,
          stages: allStages,
          completed,
          stopped: true,
        } satisfies ScopeExecution;
      }
    }
    return {
      boundary: { results: terminalGroups(nodes, completed) },
      stages: allStages,
      completed,
    };
  });
  return run();
});

// Run-end backstop: tournaments clean their own slots at region exit, but
// a failure inside a region can strand slots, so sweep whatever remains.
//
// Called once, from the run's finalizer, on every exit path. It used to be
// called from inside the run body as well, which is what the once-only
// guard beside it was for.
//
// Suspended, not merely called: the effect is built before the run starts,
// so `preserve` has to be read when the finalizer runs — a region that
// failed part way sets that flag while the run is in flight.

  return { executeScope };
}
