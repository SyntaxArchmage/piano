// Walking one execution's plan: the scopes, loops, and tournament lanes that
// turn a compiled workflow into concrete stage invocations.
//
// A factory rather than a module of free functions: the walker is one closure
// cluster over a single context, so the closures stay closures and the
// context is destructured once at the top.

import { Either, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import type { Logging } from "@piano/logging";
import {
  allocateMapWorkspace,
  applyWinnerWorkspace,
  carryLanded,
  cleanupMapWorkspaces,
  prepareMapLaneFork,
  workspaceBaselineChanges,
  type MapLaneFork,
  type WorkspaceBaseline,
  type WorkspaceChangeSet,
  type WorkspaceContentChange,
  type WorkflowCarrying,
  type WorkflowWorkspaceBinding,
} from "./workspace.js";
import { executeStage, rebuildAcceptedStage, type StageRunnerContext } from "./stage-runner.js";
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
  actorLane,
  mapOverParts,
  runtimeFramesFromInstanceId,
  runtimeInstanceId,
  runtimeInvocationId,
  runtimeRegionInstanceId,
  type WorkflowRuntimeFrame,
} from "./workflow-runtime.js";
import { appendWorkflowProgress, type WorkflowProgressRegionFinalizedRecord, type WorkflowRegionFinalizedPayload } from "./progress.js";
import { actorTurnRow } from "./resume-state.js";
import type {
  WorkflowRegionPlan,
  WorkflowRuntimeNode,
} from "./workflow.js";
import type {
  InternalStageResult,
} from "./execution-types.js";
import type {
  ConsolidateAndGateRequest,
  WorkflowExecutionError,
  WorkflowWorkspaceCandidate,
} from "./workflow-execution.js";
import type { ConsolidationCarrying } from "./consolidation-transaction.js";

/** Mutable state the walker and the composer's finalizer share. */
export interface WalkerWorkspaceState {
  preserve: boolean;
}

/** Everything the scope walker reaches outside itself. The run/actor/semaphore
 * state it shares with the stage runner lives in `stageRunnerContext` alone —
 * one copy, so the two can never disagree. */
interface ScopeWalkerContext {
  readonly stageRunnerContext: StageRunnerContext;
  /** Append one `region-finalized` line under the progress semaphore. The
   * composer owns identity (execution id, job ordinal); the walker owns the
   * moment a region exits. */
  readonly persistRegionFinalized: (payload: WorkflowRegionFinalizedPayload) => Effect.Effect<void, WorkflowError, FileSystem.FileSystem>;
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

interface ResultGroup {
  readonly results: readonly InternalStageResult[];
}

interface NodeExecution {
  readonly boundary: ResultGroup;
  readonly stages: readonly InternalStageResult[];
  /** A validated stage explicitly reported a terminal blocked outcome. */
  readonly stopped?: boolean;
}

/** The direct-child completion table is local to one runtime scope. A loop
 * uses it only to retrieve an explicitly named feedback child after an
 * iteration; it never turns an upstream actor continuation into feedback. */
interface ScopeExecution extends NodeExecution {
  readonly completed: ReadonlyMap<string, ResultGroup>;
}

interface RuntimeTournamentCandidate extends WorkflowWorkspaceCandidate {
  readonly boundaryResults: readonly InternalStageResult[];
  readonly stopped?: boolean;
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** A node's name in its scope: the stage name, or the region name. */
function nodeName(node: WorkflowRuntimeNode): string {
  return "stage" in node ? node.stage.name : node.name;
}

/** The local `from` names a node declares — sibling names in its own scope,
 * before lowering rewires a leaf's edges to exit-stage ids. */
function nodeFrom(node: WorkflowRuntimeNode): readonly string[] {
  return "stage" in node ? node.stage.from : node.from;
}

/** Terminal results of a scope, in the order their nodes finished. A scope runs
 * one ready node at a time and `completed` is inserted in that order, which is
 * the dependency order of the leaf DAG — not the declaration order the tree
 * carries. Consumers pick a run's final result from the tail of this list. */
function terminalGroups(
  nodes: readonly WorkflowRuntimeNode[],
  completed: ReadonlyMap<string, ResultGroup>,
): readonly InternalStageResult[] {
  const consumed = new Set(nodes.flatMap(nodeFrom));
  const finishOrder = new Map([...completed.keys()].map((name, index) => [name, index]));
  return nodes
    .filter((node) => !consumed.has(nodeName(node)) && completed.has(nodeName(node)))
    .sort((left, right) =>
      (finishOrder.get(nodeName(left)) ?? 0) - (finishOrder.get(nodeName(right)) ?? 0))
    .flatMap((node) => completed.get(nodeName(node))?.results ?? []);
}

/** Automatic tournament promotion, limited to the unambiguous single-referee
 * shape: derive the referee from the map-region exit metric every competing slot
 * reports and pick `selectWinner`. Returns undefined when no referee can be
 * derived (metric-less report/fan-out is left inert) or when destinations are
 * ambiguous. A stopped candidate may still establish the shared metric
 * identity, but is never eligible to win. */
function automaticTournamentOutcome(
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
function mergeScopeInputs(
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

function isBlockedStageResult(result: InternalStageResult): boolean {
  return resultProjectionValue(result, "workflow.status") === "blocked" ||
    resultProjectionValue(result, "round.decision") === "BLOCKED";
}

/** A blocked loop round is terminal when its block is global-scoped (or
 * unlabeled, which defaults to global) or it fired on the loop's own entry
 * stage. A hypothesis-scoped block is absorbed and the loop continues. */
function loopBlockIsTerminal(child: ScopeExecution, entryStageId: string | undefined): boolean {
  const blocked = child.boundary.results.filter(isBlockedStageResult);
  if (blocked.length === 0) return true;
  return blocked.some((result) =>
    (entryStageId !== undefined && result.stageId === entryStageId) ||
    resultProjectionValue(result, "workflow.block-scope") !== "iteration",
  );
}

/** Only a worker-contract projection may end a successful loop. Payload fields
 * with similar names remain ordinary domain data and cannot control scheduling. */
function loopStopRequested(results: readonly InternalStageResult[]): boolean {
  return results.some((result) => resultProjectionValue(result, "workflow.loop-control") === "stop");
}

export function createScopeWalker(context: ScopeWalkerContext) {
  const {
    stageRunnerContext,
    persistRegionFinalized,
    autoCommit,
    preExistingDirty,
    workspaceState,
    commitRoundWinner,
    consolidate,
  } = context;
  const {
    request,
    loaded,
    compiled,
    runId,
    mnemonic,
    jobOrdinal,
    actors,
    actorContexts,
    knownLoopIterations,
    progressSemaphore,
    workflowTrajectory,
  } = stageRunnerContext;

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
  const preservation = yield* cleanupMapWorkspaces(request.runDir, {
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
  /** Why the region exited, when it exited decisively: `undefined` for the
   * empty-candidate case, which writes no `region-finalized` record. */
  readonly outcome?: "carried" | "admitted-not-carried" | "no-winner" | "terminal-blocked";
  readonly notCarriedReason?: "admission" | "stopped";
  /** The incumbent as the region left it, recorded for a skip to restore. */
  readonly incumbent?: SelectionIncumbent;
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
      runId,
      timestamp: new Date().toISOString(),
      outcome: "no-winner",
      skipped: `tournament contains terminal blocked result(s): ${blockedIds.join(", ")}`,
    }).pipe(Effect.catchAll(() => Effect.void));
    yield* cleanupMapWorkspaces(request.runDir, {
      sourceCwd,
      keys: candidates.map((candidate) => candidate.key),
      preserve: options?.preserve === true,
    });
    return { terminalBlocked: blockedResults, stopped: true, outcome: "terminal-blocked" };
  }
  let winnerKey: string | undefined;
  let selectionReferee: SelectionReferee | undefined;
  let selectionBranches: readonly SelectionBranch[] = [];
  /** The incumbent map as a record field, evaluated at each return so a
   * carried winner is recorded in its post-admission state. */
  const incumbentForRecord = (): SelectionIncumbent | undefined => {
    if (selectionReferee === undefined) return undefined;
    const key = tournamentIncumbentKey(region, frames);
    return key === undefined ? undefined : tournamentIncumbents.get(key);
  };
  if (options?.winner !== undefined) {
    // An explicit host-plugin selector overrides the metric referee.
    try {
      winnerKey = options.winner === "first"
        ? candidates[0]?.key
        : options.winner === "last"
          ? candidates.at(-1)?.key
          : options.winner({ runId, sourceCwd, candidates });
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
        runId,
        timestamp: new Date().toISOString(),
        outcome: "no-winner",
        referee: auto.referee,
      }).pipe(Effect.catchAll(() => Effect.void));
    } else {
      yield* workflowTrajectory.observe({
        type: "selection",
        runId,
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
        runId,
        timestamp: new Date().toISOString(),
        outcome: "no-winner",
        referee: selectionReferee,
        winnerKey,
        carrying,
      }).pipe(Effect.catchAll(() => Effect.void));
      yield* cleanupMapWorkspaces(request.runDir, {
        sourceCwd,
        keys: cleanupKeys,
        preserve: options?.preserve === true,
      });
      return {
        outcome: "admitted-not-carried",
        notCarriedReason: "admission",
        ...(incumbentForRecord() === undefined ? {} : { incumbent: incumbentForRecord() }),
        ...(winnerCandidate === undefined ? {} : { winner: winnerCandidate }),
      };
    }
    const winnerBlocked = winnerCandidate?.boundaryResults.some(isBlockedStageResult) === true;
    if (winnerCandidate?.stopped === true || winnerBlocked) {
      const carrying: WorkflowCarrying = {
        kind: "admitted-not-carried",
        reason: `winner "${winnerKey}" is stopped/BLOCKED and cannot be selected for carry`,
      };
      yield* workflowTrajectory.observe({
        type: "selection",
        runId,
        timestamp: new Date().toISOString(),
        outcome: "no-winner",
        ...(selectionReferee === undefined ? {} : { referee: selectionReferee }),
        winnerKey,
        carrying,
      }).pipe(Effect.catchAll(() => Effect.void));
      yield* cleanupMapWorkspaces(request.runDir, {
        sourceCwd,
        keys: cleanupKeys,
        preserve: options?.preserve === true,
      });
      return {
        outcome: "admitted-not-carried",
        notCarriedReason: "stopped",
        ...(incumbentForRecord() === undefined ? {} : { incumbent: incumbentForRecord() }),
      };
    }
    const excludeUnder = [request.runDir];
    let consolidating: WorkflowCarrying;
    if (winnerContentDir === undefined || winnerCandidate === undefined) {
      consolidating = { kind: "carry-failed", reason: `winner "${winnerKey}" has no materialised slot content` };
    } else if (winnerCandidate.workspace.strategy === "git-worktree") {
      // A git-worktree winner is merged, not consolidated: its worktree holds
      // the winning edits, git fast-forwards the parent onto the commit it
      // makes of them, and the lane branch is the record. Git carries the
      // delta and git is the verification — no frozen file delta and no
      // worker turn. A source that cannot fast-forward is a carry failure:
      // the winner's work did not reach the parent, and saying otherwise
      // would be the silent loss the delta gate exists to catch.
      const applied = yield* applyWinnerWorkspace(request.runDir, winnerKey, sourceCwd).pipe(
        Effect.map((result): WorkflowCarrying => result.skipped === undefined
          ? { kind: "git-merged", ...(result.commit === undefined ? {} : { commit: result.commit }) }
          : {
            kind: "carry-failed",
            reason: result.skipped.reason,
            ...(result.commit === undefined ? {} : { commit: result.commit }),
          }),
        Effect.catchAll((error): Effect.Effect<WorkflowCarrying> =>
          Effect.succeed({ kind: "carry-failed", reason: errorMessage(error) })),
      );
      consolidating = applied;
    } else if (winnerCandidate.workspace.baseCommit === undefined) {
      consolidating = { kind: "carry-failed", reason: `winner "${winnerKey}" has no forked base commit to measure against` };
    } else {
      // The lane record carries what it forked from; a store lane's fork is
      // also the region's drift reference (every sibling shares it).
      const laneBaseline: WorkspaceBaseline = {
        runDir: request.runDir,
        refName: `lane/${winnerKey}`,
        commit: winnerCandidate.workspace.baseCommit,
      };
      const frozen = yield* Effect.tryPromise({
        try: async () => {
          const [changes, parentChanges] = await Promise.all([
            workspaceBaselineChanges(
            laneBaseline,
            winnerContentDir,
            excludeUnder,
            ),
            workspaceBaselineChanges(laneBaseline, sourceCwd, excludeUnder),
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
              changes: changeSet.changes,
              winnerBaseline: laneBaseline,
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
              // The consolidation turn changes the winner actor's state, so it
              // appends that actor's own `actor-turn` row — the one record a
              // resume folds — and the carry needs no table snapshot of its
              // own. Concurrent nested consolidations serialize through the
              // same semaphore as stage progress.
              persistAfterCarry: () => progressSemaphore.withPermits(1)(Effect.suspend(() => {
                const winnerState = actors.get(actorContext.actorKey);
                if (winnerState === undefined) return Effect.void;
                const row = actorTurnRow({
                  runId,
                  jobOrdinal,
                  invocationId: runtimeInvocationId(actorContext.invocation),
                  attempt: winnerExitResult?.attempts ?? 1,
                  actorKey: actorContext.actorKey,
                  harness: winnerHarness,
                  worker: winnerWorker,
                  lane: actorLane(actorContext.invocation.frames).join("/"),
                  state: winnerState,
                });
                if (row === undefined) return Effect.void;
                return appendWorkflowProgress(request.runDir, row).pipe(Effect.asVoid);
              })),
            });
          }
        }
      }
    }
    yield* WORKFLOW_LOG.info("workspace.winner.consolidated", {
      outcome: carryLanded(consolidating.kind) ? "success" : "no-winner",
      data: { runId, winnerKey, sourceCwd, carrying: consolidating },
    }).pipe(Effect.catchAll(() => Effect.void));
    yield* workflowTrajectory.observe({
      type: "selection",
      runId,
      timestamp: new Date().toISOString(),
      outcome: carryLanded(consolidating.kind) ? "carried" : "no-winner",
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
  yield* cleanupMapWorkspaces(request.runDir, {
    sourceCwd,
    keys: cleanupKeys,
    preserve: options?.preserve === true,
  });
  const winner = winnerKey === undefined
    ? undefined
    : candidates.find((candidate) => candidate.key === winnerKey);
  return {
    outcome: winnerKey === undefined ? "no-winner" : "carried",
    ...(incumbentForRecord() === undefined ? {} : { incumbent: incumbentForRecord() }),
    ...(winner === undefined ? {} : { winner }),
  };
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
  const pending = new Map(nodes.map((node) => [nodeName(node), node]));
  const allStages: InternalStageResult[] = [];

  /** Rebuild a finalized region's exit from evidence alone: every accepted
   * invocation inside it, read back through the same rebuild a continue's
   * cursor uses, then the boundary the region's own exit decided (the winner
   * slot's exit result, all slots for a no-winner tournament, the blocked
   * results, or the last iteration's exit for a loop). `undefined` abandons
   * the skip: normal re-entry is slower but always answers in the same
   * shape, so missing evidence degrades instead of guessing. */
  const rebuildFinalizedRegion = (
    region: WorkflowRegionPlan,
    frames: readonly WorkflowRuntimeFrame[],
    finalized: WorkflowProgressRegionFinalizedRecord,
  ): Effect.Effect<NodeExecution | undefined, WorkflowExecutionError, FileSystem.FileSystem | Logging> => Effect.gen(function* () {
    const cursor = request.continueJob;
    if (cursor === undefined) return undefined;
    const instance = runtimeRegionInstanceId(frames, region.id);
    // A loop that never entered (its prerequisite was already blocked when
    // the region was reached) owns no invocation: re-entry decides that from
    // live inputs and runs no worker either way.
    if (region.kind === "loop" && (finalized.iterations ?? 0) === 0) return undefined;
    const inside = [...cursor.accepted]
      .map((invocationId) => {
        const at = invocationId.indexOf("@");
        if (at <= 0) return undefined;
        const stageId = invocationId.slice(0, at);
        const target = invocationId.slice(at + 1);
        if (target !== instance && !target.startsWith(`${instance}/`)) return undefined;
        const rebuiltFrames = runtimeFramesFromInstanceId(target);
        return rebuiltFrames === undefined ? undefined : { stageId, target, frames: rebuiltFrames };
      })
      .filter((entry): entry is { stageId: string; target: string; frames: readonly WorkflowRuntimeFrame[] } => entry !== undefined)
      .sort((left, right) => left.target.localeCompare(right.target) || left.stageId.localeCompare(right.stageId));
    if (inside.length === 0) return undefined;
    const rebuilt: InternalStageResult[] = [];
    for (const entry of inside) {
      const result = yield* rebuildAcceptedStage(request.runDir, {
        runId,
        jobOrdinal: cursor.jobOrdinal,
        stageId: entry.stageId,
        stageName: entry.stageId,
        frames: entry.frames,
      }, cursor);
      if (result === undefined) return undefined;
      rebuilt.push(result);
    }
    const exitResults = rebuilt.filter((result) => result.stageId === region.exitStageId);
    let boundary: readonly InternalStageResult[];
    if (region.kind === "map") {
      if (finalized.outcome === "terminal-blocked") {
        boundary = rebuilt.filter(isBlockedStageResult);
      } else if (finalized.winnerInstanceId !== undefined) {
        boundary = exitResults.filter((result) => result.instanceId === finalized.winnerInstanceId);
      } else {
        boundary = exitResults;
      }
    } else {
      // Spelled through runtimeInstanceId, the one writer of instance ids:
      // the last iteration's id is the frame chain plus its loop frame.
      const lastIteration = runtimeInstanceId([
        ...frames,
        { kind: "loop", regionId: region.id, iteration: (finalized.iterations ?? 1) - 1 },
      ]);
      boundary = exitResults.filter((result) => result.instanceId === lastIteration);
    }
    if (boundary.length === 0) return undefined;
    if (finalized.incumbent !== undefined) {
      const incumbentKey = tournamentIncumbentKey(region, frames);
      if (incumbentKey !== undefined) tournamentIncumbents.set(incumbentKey, finalized.incumbent);
    }
    // "Ended early" is derived, not stored: a blocked region, or a tournament
    // whose winner was stopped and could not be carried.
    const stopped = finalized.outcome === "terminal-blocked" || finalized.notCarriedReason === "stopped";
    return {
      boundary: { results: boundary },
      stages: rebuilt,
      ...(stopped ? { stopped: true } : {}),
    } satisfies NodeExecution;
  });

  /** A region the job already finalized is skipped whole: its workers do not
   * run again, and its boundary comes from the evidence they left. */
  const runNode = (
    node: WorkflowRuntimeNode,
  ): Effect.Effect<NodeExecution, WorkflowExecutionError, FileSystem.FileSystem | Logging> => {
    if (!("stage" in node)) {
      const finalized = request.continueJob?.regions?.get(runtimeRegionInstanceId(frames, node.id));
      if (finalized !== undefined) {
        return rebuildFinalizedRegion(node, frames, finalized).pipe(
          Effect.flatMap((skipped) => skipped === undefined ? runNodeDirect(node) : Effect.succeed(skipped)),
        );
      }
    }
    return runNodeDirect(node);
  };

  const runNodeDirect = (node: WorkflowRuntimeNode): Effect.Effect<NodeExecution, WorkflowExecutionError, FileSystem.FileSystem | Logging> => {
    const directInputs = nodeFrom(node).flatMap((dependency) => completed.get(dependency)?.results ?? []);
    const inputs = mergeScopeInputs(inheritedInputs, directInputs);
    if ("stage" in node) {
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
    const region = node;
    if (region.kind === "loop") {
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
          yield* persistRegionFinalized({
            instance: runtimeRegionInstanceId(frames, region.id),
            regionId: region.id,
            regionKind: "loop",
            outcome: "terminal-blocked",
            iterations: 0,
          });
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
        /** Which bound ended the loop, captured at the break so the exit can
         * record it — a monitor reading `region-finalized` sees why. */
        let bound: "bound-iterations" | "bound-duration" | "feedback-stop" = "bound-iterations";
        while (true) {
          // The bound is consulted *between* iterations, and never before
          // the first: a duration that has already elapsed when the region
          // starts (a resumed run, a long upstream stage) must still run
          // once, because zero iterations is not a loop. One iteration may
          // therefore overshoot the bound; a stage is not interruptible
          // mid-turn by a region clock, only by `stage.timeout` or a human.
          if (iteration > 0) {
            if (iterations !== undefined && iteration >= iterations) {
              bound = "bound-iterations";
              break;
            }
            if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
              yield* WORKFLOW_LOG.info("workflow.loop.duration.reached", {
                data: {
                  region: region.id,
                  durationSeconds,
                  completedIterations: iteration,
                },
              }).pipe(Effect.catchAll(() => Effect.void));
              bound = "bound-duration";
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
            yield* persistRegionFinalized({
              instance: runtimeRegionInstanceId(frames, region.id),
              regionId: region.id,
              regionKind: "loop",
              outcome: "terminal-blocked",
              iterations: iteration + 1,
            });
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
            bound = "feedback-stop";
            break;
          }
        }
        if (final === undefined) {
          return yield* Effect.fail(workflowError("schedule", loaded.workflowPath, `loop "${region.name}" produced no iteration`));
        }
        yield* persistRegionFinalized({
          instance: runtimeRegionInstanceId(frames, region.id),
          regionId: region.id,
          regionKind: "loop",
          outcome: bound,
          iterations,
        });
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
      const slotBindings = [] as Array<{
        readonly item: HandoffMapItem;
        readonly frames: readonly WorkflowRuntimeFrame[];
        readonly workspace: WorkflowWorkspaceBinding;
      }>;
      // One fork per region entry: every lane of this tournament starts from
      // the same commit. The thunk keeps it lazy — a resume whose slots all
      // exist never pays for a seed commit it will not use.
      let forkPromise: Promise<MapLaneFork> | undefined;
      const fork = (): Promise<MapLaneFork> => (forkPromise ??= prepareMapLaneFork(workspace.cwd, {
        runDir: request.runDir,
        runId,
        jobOrdinal,
        frames,
        parent: workspace,
      }));
      yield* Effect.gen(function* () {
        for (const item of items) {
          const slotFrames = [...frames, { kind: "map" as const, regionId: region.id, slot: item.index }];
          const slotWorkspace = yield* allocateMapWorkspace(
            request.runDir,
            runId,
            jobOrdinal,
            slotFrames,
            workspace.cwd,
            {
              mnemonic,
              fork,
            },
          );
          slotBindings.push({ item, frames: slotFrames, workspace: slotWorkspace });
          yield* WORKFLOW_LOG.info("workspace.prepared", {
            data: {
              runId,
              instanceId: runtimeInstanceId(slotFrames),
              workspace: slotWorkspace,
            },
          });
        }
      }).pipe(Effect.catchAll((cause) => failTournamentWithPreservedSlots(
        region,
        workspace.cwd,
        slotBindings.map((slot) => slot.workspace.key),
        `workspace preparation failed: ${errorMessage(cause)}`,
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
      const finalization = yield* finalizeTournament(region, frames, workspace, slotBindings.map((slot, index) => ({
        key: slot.workspace.key,
        workspace: slot.workspace,
        mapItem: slot.item,
        boundaryResults: slots[index]?.boundary.results ?? [],
        stages: slots[index]?.stages ?? [],
        ...(slots[index]?.stopped === true ? { stopped: true } : {}),
      })));
      if (finalization.outcome !== undefined) {
        const winnerItem = finalization.winner?.mapItem;
        yield* persistRegionFinalized({
          instance: runtimeRegionInstanceId(frames, region.id),
          regionId: region.id,
          regionKind: "map",
          outcome: finalization.outcome,
          ...(finalization.notCarriedReason === undefined ? {} : { notCarriedReason: finalization.notCarriedReason }),
          ...(finalization.incumbent === undefined ? {} : { incumbent: finalization.incumbent }),
          ...(finalization.winner === undefined ? {} : {
            ...(winnerItem === undefined ? {} : {
              // The slot's own instanceId speller (see slotFrames): the winner
              // key and the result it must match come from one function.
              winnerInstanceId: runtimeInstanceId([
                ...frames,
                { kind: "map", regionId: region.id, slot: winnerItem.index },
              ]),
            }),
          }),
        });
      }
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
        nodeFrom(node).every((dependency) => completed.has(dependency)),
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
      completed.set(nodeName(node), outcome.right.boundary);
      allStages.push(...outcome.right.stages);
      pending.delete(nodeName(node));
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
