import { FileSystem } from "@effect/platform";
import { Effect, Either, Exit } from "effect";
import {
  failureDetails,
  isCancellation,
  TRACE,
  type Logging,
} from "@piano/logging";
import {
  type AgentContinuation,
  type AgentEvent,
  type AgentHarnessOptions,
  type AgentRunner,
  type SteeringChannel,
  type ThinkingLevel,
} from "@piano/harness";
import {
  executeWorker,
  WorkerError,
} from "@piano/workers";
import {
  ContractValidationError,
  WorkerContractValidationError,
} from "@piano/contract";
import {
} from "./legacy-contract-projections.js";
import {
} from "./gpu-round-protocol.js";
import { join } from "node:path";
import {
  WorkflowTrajectory,
} from "@piano/trajectory";
import {
  compileWorkflow,
  scheduleWorkflow,
  type CompiledWorkflow,
  type WorkflowHarness,
  type WorkflowRegionPlan,
} from "./workflow.js";
import {
  loadDefaultWorkflow,
  loadWorkflow,
  workerResourcesKey,
  type LoadedWorkflow,
} from "./workflow-file.js";
import { errorMessage, WorkflowError, workflowError } from "./errors.js";
import {
} from "./stage-metrics.js";
import type {
  ActorExecutionContext,
  ActorState,
  InternalStageResult,
  WorkflowStageExecutionResult,
} from "./execution-types.js";
export type { WorkflowStageExecutionResult } from "./execution-types.js";
import {
  COMPILE_SOURCE,
  EXPLICIT_LOAD_SOURCE,
  LOAD_SOURCE,
  SCHEDULE_SOURCE,
  WORKFLOW_LOG,
  WORKFLOW_SOURCE,
} from "./execution-logs.js";
import {
} from "./artifact-paths.js";
import {
} from "./gpu-round-materialization.js";
import { wholeWorkflowTask } from "./stage-prompt.js";
import { executeStage, type StageRunnerContext, type StageRunnerCounters } from "./stage-runner.js";
import {
  projectionNumber,
  projectionString,
  projectionValue,
  resultProjectionValue,
  workflowProgressPlan,
} from "./stage-runner-support.js"; 
import { VALIDATE_REPAIR_ATTEMPTS } from "./stage-runner-support.js";
export { RETRY_DEFAULT_BACKOFF_MAX_SECONDS, RETRY_DEFAULT_BACKOFF_SECONDS, VALIDATE_REPAIR_ATTEMPTS, retryBackoffSeconds } from "./stage-runner-support.js";
import type { WorkflowExecutionContinuation } from "./workflow-resume.js";
import { writeResumeState } from "./resume-state.js";
import {
  actorSessionDirectory,
  buildWorkflowRuntimePlan,
  executionDirectory,
  executionId as normalizeExecutionId,
  mapOverParts,
  migrateLegacyActorKey,
  runtimeInstanceId,
  runtimeInvocationId,
  type WorkflowRuntimeFrame,
  type WorkflowRuntimeNode,
} from "./workflow-runtime.js";
import {
  type HandoffMapItem,
} from "./handoff.js";
import {
  allocateMapWorkspace,
  cleanupMapWorkspaces,
  sharedWorkspaceBinding,
  snapshotWorkspaceContent,
  workspaceContentChanges,
  type WorkflowCarrying,
  type WorkspaceChangeSet,
  type WorkspaceContentChange,
  type WorkflowWorkspaceBinding,
} from "./workspace.js";
import {
  ConsolidationEvidencePreparationError,
  prepareConsolidationEvidence,
  runConsolidationTransaction,
  type ConsolidationCarrying,
  type PreparedConsolidationEvidence,
} from "./consolidation-transaction.js";
import {
  admitWinner,
  selectWinner,
  type SelectionBranch,
  type SelectionIncumbent,
  type SelectionOutcome,
  type SelectionReferee,
} from "./selection.js";
import {
  finalizeWorkflowProgress,
  initializeWorkflowProgress,
  workflowProgressPath,
  workflowProgressSnapshotPath,
} from "./progress.js";
import {
} from "./contract-snapshot.js";
import {
  buildCommitMessage,
  commitRoundFiles,
  extractTicket,
  safeChangedFiles,
  snapshotDirtyFiles,
  type WinnerCommitMessageInput,
} from "./winner-commit.js";

export interface WorkflowExecutionRequest {
  readonly runDir: string;
  /** Optional caller identity for one user task. TUI callers may use a fresh
   * value per prompt; omitted calls receive a unique execution directory. */
  readonly executionId?: string;
  /** Continue a long-lived execution: reopen `execution.id`'s evidence
   * directory and resume each actor's prior harness session instead of opening
   * fresh chats. One Piano run is one execution, so every prompt after the first
   * arrives here. One-shot callers omit it and keep the strict
   * fresh-directory guarantee; when present it takes precedence over
   * `executionId`. */
  readonly execution?: WorkflowExecutionContinuation;
  /** Continue a paused job from its cursor. Invocations already accepted in
   * any span of this job are rebuilt from their evidence instead of run
   * again, and this span repeats the job's ordinal so the stream groups it
   * with the spans before it. */
  readonly continueJob?: {
    readonly jobOrdinal: number;
    /** Invocation ids accepted across the job's earlier spans. */
    readonly accepted: ReadonlySet<string>;
    /** Highest attempt number recorded per invocation in the job so far, so a
     * re-run's new attempt does not overwrite the evidence it follows. */
    readonly attempts: ReadonlyMap<string, number>;
  };
  readonly cwd: string;
  readonly prompt: string;
  readonly signal?: AbortSignal;
  /** Mid-turn steering channel for whichever stage worker is live. The engine
   * threads it exactly like `signal` — transport only, never interpreted. */
  readonly steering?: SteeringChannel;
  readonly model?: string;
  /** Request-level effort override; stage.thinkingLevel is the next fallback. */
  readonly thinkingLevel?: ThinkingLevel;
  readonly agentOptions?: AgentHarnessOptions;
  readonly agentRunner?: AgentRunner;
  readonly onEvent?: (event: AgentEvent) => void;
  /** Human sign-off channel for stages declaring `signoff: true`. The engine
   * calls it after each attempt that is otherwise ready to be published, and
   * blocks until the reviewer chooses: `continue` publishes the attempt,
   * `retry` reopens the same actor for another one. Runs that contain sign-off
   * stages but provide no channel fail before executing. Cancelling the review
   * (Esc) should fail this Effect, not return a decision. */
  readonly signoff?: (request: WorkflowSignoffRequest) => Effect.Effect<WorkflowSignoffDecision, WorkflowError>;
  /** Supervisor discussion channel for stages declaring `discuss: true`. */
  readonly discuss?: (request: WorkflowDiscussRequest) => Effect.Effect<WorkflowDiscussDecision, WorkflowError>;
  /** Optional plugin contract for map-slot winner application. No fixed
   * aggregate stage is introduced into the workflow DSL. */
  readonly workspace?: WorkflowWorkspaceLifecycleOptions;
}

/** One human sign-off request for an accepted stage attempt. The engine
 * builds it from the attempt's final evidence; the caller renders it (Piano
 * owns the terminal — no harness is involved in the question). */
export interface WorkflowSignoffRequest {
  readonly stageId: string;
  readonly invocationId: string;
  readonly stage: string;
  readonly worker: string;
  readonly harness: WorkflowHarness;
  /** 1-based number of sign-off requests for this invocation; grows with each
   * retry round. */
  readonly round: number;
  /** Path to the validated result JSON inside the run directory, when the
   * stage validates. */
  readonly resultPath?: string;
  /** Transcript the reviewer can inspect for full detail. */
  readonly transcriptPath: string;
  /** Short excerpt of the worker's final message for the prompt. */
  readonly excerpt: string;
  /** Static ids of the stages that declare this one in their `from:`.
   *
   * A `continue` note is delivered to exactly these stage ids, so the reviewer
   * can be told where their words will land — and warned when the answer is
   * "nowhere", which is the case for a stage no other stage consumes. Told
   * rather than assumed: a note that quietly evaporates is worse than no
   * note field at all. */
  readonly consumers: readonly string[];
}

/** What the reviewer decided about one accepted attempt. The two choices are
 * a fork in the workflow, not a verdict on the worker, and **both may carry a
 * note**: the note is the reviewer's own words, delivered to an agent exactly
 * once.
 *
 * `retry` reopens the same actor conversation for another attempt and gives
 * the note to that attempt. `continue` publishes this attempt and gives the
 * note to the stages that consume this one — the human's instruction travels
 * with the result it was written about, and no further. */
export type WorkflowSignoffDecision =
  | { readonly type: "continue"; readonly note?: string }
  | { readonly type: "retry"; readonly note?: string };

export interface WorkflowDiscussRequest {
  readonly stageId: string;
  readonly invocationId: string;
  readonly stage: string;
  readonly worker: string;
  readonly harness: WorkflowHarness;
  readonly round: number;
  readonly transcriptPath: string;
  readonly question: string;
}

export interface WorkflowDiscussDecision {
  readonly answer: string;
}

export interface WorkflowWorkspaceCandidate {
  readonly key: string;
  readonly workspace: WorkflowWorkspaceBinding;
  readonly mapItem: HandoffMapItem;
  readonly stages: readonly WorkflowStageExecutionResult[];
}

interface RuntimeTournamentCandidate extends WorkflowWorkspaceCandidate {
  readonly boundaryResults: readonly InternalStageResult[];
  readonly baselineContentDir: string;
  readonly stopped?: boolean;
}

export interface WorkflowWorkspaceSelectionContext {
  readonly executionId: string;
  readonly sourceCwd: string;
  readonly candidates: readonly WorkflowWorkspaceCandidate[];
}

export type WorkflowWorkspaceWinner =
  | "first"
  | "last"
  | ((context: WorkflowWorkspaceSelectionContext) => string | undefined);

export interface WorkflowWorkspaceLifecycleOptions {
  /** A plugin may return a candidate key, or use a deterministic first/last
   * policy when the workflow has no metric-specific selector. */
  readonly winner?: WorkflowWorkspaceWinner;
  /** Preserve slot directories and metadata for diagnosis/recovery. */
  readonly preserve?: boolean;
}

/** Convenience input for callers that deliberately want this module to load
 * the workflow before executing it. The core executor takes LoadedWorkflow. */
export interface LoadAndExecuteWorkflowRequest extends WorkflowExecutionRequest {
  readonly root: string;
  readonly workflowPath?: string;
}

export interface WorkflowExecutionResult {
  readonly workflow: string;
  readonly executionId: string;
  readonly stage: string;
  readonly worker: string;
  readonly text: string;
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly requestedModel?: string;
  readonly requestedThinkingLevel?: ThinkingLevel;
  readonly model?: string;
  readonly thinkingLevel?: ThinkingLevel;
  /** Every completed concrete stage invocation in deterministic runtime order. */
  readonly stages: readonly WorkflowStageExecutionResult[];
  /** The terminal root-node output(s). A single downstream join produces one
   * item; a terminal map deliberately exposes its ordered slot outputs. */
  readonly terminalStages: readonly WorkflowStageExecutionResult[];
  /** Run-level append-only progress stream, including every loop iteration. */
  readonly progressPath: string;
  /** Latest worker-neutral progress view for monitors. */
  readonly progressSnapshotPath?: string;
}


export type WorkflowExecutionError =
  | WorkflowError
  | WorkerError
  | ContractValidationError
  | WorkerContractValidationError;





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











function validateWorkspace(
  workspace: WorkflowWorkspaceBinding,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const info = yield* fileSystem.stat(workspace.cwd).pipe(
      Effect.mapError((cause) => workflowError("schedule", workspace.cwd, `workspace is not accessible: ${errorMessage(cause)}`)),
    );
    if (info.type !== "Directory") {
      return yield* Effect.fail(workflowError("schedule", workspace.cwd, "workspace cwd must be a directory"));
    }
  });
}




/** The run directory is session-owned (created by createSession or a staging
 * commit); the execution reuses it across prompts. This only guarantees it
 * exists before the first stage writes evidence into it. */
function createExecutionDirectory(
  runDir: string,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.makeDirectory(runDir, { recursive: true })),
    Effect.mapError((cause) => workflowError("schedule", runDir, String(cause))),
  );
}

function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function terminalGroups(
  nodes: readonly WorkflowRuntimeNode[],
  completed: ReadonlyMap<string, ResultGroup>,
): readonly InternalStageResult[] {
  const consumed = new Set(nodes.flatMap((node) => node.dependencies));
  const terminals = nodes.filter((node) => !consumed.has(node.name));
  return terminals.flatMap((node) => completed.get(node.name)?.results ?? []);
}

/**
 * A blocked report is a truthful terminal outcome for a workflow branch. It
 * must not be mistaken for a successful tuning iteration, nor should a loop
 * keep spending model turns after its prerequisite (for example CUDA) is
 * unavailable. Control authority comes only from contract-declared semantic
 * projections; similarly named payload fields remain audit data and cannot
 * stop execution on their own. The accepted record remains available to
 * downstream summary/report stages.
 *
 * A blocked report may project `workflow.block-scope` as `global` or
 * `iteration`:
 * - `"global"` (default when absent): a prerequisite is unavailable, so no
 *   future round can do useful work — the loop should terminate.
 * - `"iteration"`: this round's specific hypothesis is unimplementable (e.g. a
 *   kernel variant that violates a hardware contract). The next round can
 *   propose a different variable, so the loop absorbs the round and continues.
 */

function isBlockedStageResult(result: InternalStageResult): boolean {
  return resultProjectionValue(result, "workflow.status") === "blocked" ||
    resultProjectionValue(result, "round.decision") === "BLOCKED";
}

/** Only a worker-contract projection may end a successful loop. Payload fields
 * with similar names remain ordinary domain data and cannot control scheduling. */
function loopStopRequested(results: readonly InternalStageResult[]): boolean {
  return results.some((result) => resultProjectionValue(result, "workflow.loop-control") === "stop");
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



/** Execute a workflow with runtime expansion. Handoff data and continuation
 * state live in distinct stores: records move between stages, while a harness
 * continuation is only ever reopened for the same actor/lane. */
export function loadAndExecuteWorkflow(
  request: LoadAndExecuteWorkflowRequest,
): Effect.Effect<
  WorkflowExecutionResult,
  WorkflowExecutionError,
  FileSystem.FileSystem | Logging
> {
  const load = request.workflowPath === undefined
    ? loadDefaultWorkflow(request.root)
    : loadWorkflow(request.workflowPath, request.root);
  return TRACE(
    request.workflowPath === undefined ? LOAD_SOURCE : EXPLICIT_LOAD_SOURCE,
    load,
    {
      root: request.root,
      ...(request.workflowPath === undefined ? {} : { workflowPath: request.workflowPath }),
    },
  ).pipe(Effect.flatMap((loaded) => executeWorkflow(loaded, request)));
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

/**
 * Load-time guard for tournament winner selection (§4.2/§4.3): a competing
 * tournament exit is decided by a single metric, so an exit stage whose worker
 * contract declares 2+ output metrics cannot be ordered. This refuses to
 * schedule the run rather than mis-selecting at regional exit. Metric-less
 * (0 declared) exits stay legal report/fan-out and carry nothing.
 *
 * It runs here (after compile, before any worker) because `compileWorkflow`
 * only sees the DSL; the exit contract's declared `outputs.metrics` is
 * resolvable only once worker resources are loaded alongside the compiled
 * region boundaries. Only a validating (`validate: true`) leaf exit stage is a
 * contender; non-validating handoff exits never project a referee signal.
 */
function validateTournamentExitMetricArity(
  loaded: LoadedWorkflow,
  compiled: CompiledWorkflow,
): Effect.Effect<void, WorkflowError> {
  const exitStagesById = new Map(compiled.stages.map((leaf) => [leaf.id, leaf]));
  const offenders: string[] = [];
  for (const region of compiled.regions) {
    if (region.kind !== "map") continue;
    const exitLeaf = exitStagesById.get(region.exitStageId);
    if (exitLeaf === undefined || exitLeaf.stage.validate !== true) continue;
    const contract = loaded.workerResources?.get(
      workerResourcesKey(exitLeaf.stage.worker, exitLeaf.stage.harness),
    )?.contract;
    if (contract === undefined || contract.manifest.outputs.metrics.length < 2) continue;
    const metricIds = contract.manifest.outputs.metrics.map((metric) => metric.pointer).join(", ");
    offenders.push(
      `tournament "${region.name}" exit stage "${exitLeaf.stage.name}": ` +
      `worker "${contract.manifest.id}" declares ${contract.manifest.outputs.metrics.length} ` +
      `output metric(s) [${metricIds}]`,
    );
  }
  if (offenders.length === 0) return Effect.void;
  return Effect.fail(workflowError(
    "load",
    compiled.sourcePath,
    `a single-metric referee decides each tournament, but a competing exit declares 2+ metrics:\n` +
    offenders.join("\n") +
    `\nTrim each deciding exit to one declared output metric, or move extras to an inner report stage.`,
  ));
}

interface ConsolidateAndGateRequest {
  readonly request: WorkflowExecutionRequest;
  readonly winnerKey: string;
  /** Frozen winner tree for legacy callers, or the frozen changed-file tree
   * paired with changeSet for runtime tournament calls. */
  readonly winnerContentDir: string;
  readonly winnerWorker: string;
  readonly winnerHarness: string;
  readonly sourceCwd: string;
  readonly excludeUnder: readonly string[];
  /** Runtime callers provide the declared baseline-relative delta. The
   * transaction re-materialises its canonical copy outside source/runDir. */
  readonly changeSet?: WorkspaceChangeSet;
  /** Complete runtime winner tree used to rebuild the external delta. */
  readonly winnerBaselineContentDir?: string;
  /** Deprecated compatibility input. It is never trusted as canonical evidence. */
  readonly targetBeforeDir?: string;
  readonly winnerActor?: ActorExecutionContext & {
    readonly continuation?: AgentContinuation;
    readonly onTurn: (worker: {
      readonly sessionId: string;
      readonly transcriptPath: string;
      readonly continuation?: AgentContinuation;
    }) => void;
  };
  readonly persistAfterCarry?: () => Effect.Effect<void, WorkflowError, FileSystem.FileSystem>;
}

/**
 * Worker-specific adapter for the unified consolidation transaction. The
 * transaction core owns external evidence, integrity checks, the read-only
 * delta gate, Git metadata, rollback, and source-state classification.
 */
function runPreparedConsolidation(
  args: ConsolidateAndGateRequest,
  evidence: PreparedConsolidationEvidence,
): Effect.Effect<ConsolidationCarrying, never, FileSystem.FileSystem | Logging> {
  const {
    request,
    winnerKey,
    winnerWorker,
    winnerHarness,
    winnerActor,
    persistAfterCarry,
  } = args;
  const consolidationAgentOptions: AgentHarnessOptions = {
    ...(request.agentOptions ?? {}),
    additionalWritableDirs: [
      ...new Set([
        ...(request.agentOptions?.additionalWritableDirs ?? []),
        request.runDir,
      ]),
    ],
  };
  let continuation = winnerActor?.memory === false ? undefined : winnerActor?.continuation;
  return runConsolidationTransaction<FileSystem.FileSystem | Logging>({
    evidence,
    repairAttempts: VALIDATE_REPAIR_ATTEMPTS,
    runTurn: (repair) => Effect.gen(function* () {
      const sourceCwd = evidence.sourceCwd;
      const changes = evidence.changeSet.changes
        .map((change) => "- " + change.kind + ": " + change.path)
        .join("\n");
      const instruction = [
        ...wholeWorkflowTask(request.prompt),
        repair === undefined
          ? "Apply your winning change from `" + evidence.winnerChangeDir + "` to the tournament parent at `" + sourceCwd +
            "`. This is the frozen file delta; change only these paths:\n" + (changes || "(no file changes)") +
            "\nPreserve every other parent file, then reply when done."
          : "The tournament parent still differs from your frozen file delta at `" +
            evidence.winnerChangeDir +
            "`. Continue from where you were and resolve every point below without changing unrelated paths, then reply when done." +
            "\n\nStill differing:\n" + repair.join("\n") +
            "\n\nRe-apply those paths from the frozen delta with permission-preserving copies (for example `cp -p`); the gate also compares file modes, so a copied file whose mode differs from the delta (such as a world-executable bit added by `install`) still counts as differing.",
        "",
        "## Workflow stage context",
        "The user task above is the complete task for the whole workflow. Use this stage only to advance that task.",
        "Do not replace, broaden, or reinterpret it as a repository review, an autonomous development loop, or duration-based work session unless the user explicitly asks for that.",
        "Repository instruction files constrain how you execute the task; they do not replace or broaden it.",
        "You are executing workflow stage `$consolidate/" + winnerKey + "` (winner consolidation).",
        "Treat the tournament parent `" + sourceCwd + "` as the only mutable target; your frozen file delta is saved at `" + evidence.winnerChangeDir + "`.",
        "Apply only the frozen file delta listed above through normal file-editing tools. Copy files so their permission bits match the delta (for example `cp -p`); the acceptance gate compares content and file modes. Leave Git metadata untouched: do not change HEAD, refs, index, locks, or operation state.",
      ].join("\n");
      const stageTimeoutSeconds = winnerActor?.timeout;
      const stageSignal = stageTimeoutSeconds === undefined
        ? request.signal
        : request.signal === undefined
          ? AbortSignal.timeout(stageTimeoutSeconds * 1000)
          : AbortSignal.any([request.signal, AbortSignal.timeout(stageTimeoutSeconds * 1000)]);
      const winner = yield* executeWorker({
        stage: "$consolidate/" + winnerKey,
        worker: winnerWorker,
        harness: winnerHarness,
        prompt: instruction,
        cwd: sourceCwd,
        ...(stageSignal === undefined ? {} : { signal: stageSignal }),
        ...(request.steering === undefined ? {} : { steering: request.steering }),
        ...(winnerActor?.resources.systemPromptPath === undefined ? {} : { systemPromptPath: winnerActor.resources.systemPromptPath }),
        contextFilePaths: winnerActor?.contextFilePaths ?? [],
        skillPaths: winnerActor?.resources.skillPaths ?? [],
        ...(winnerActor?.tools === undefined ? {} : { tools: winnerActor.tools }),
        ...(winnerActor?.model === undefined ? request.model === undefined ? {} : { model: request.model } : { model: winnerActor.model }),
        ...(winnerActor?.thinkingLevel === undefined ? {} : { thinkingLevel: winnerActor.thinkingLevel }),
        ...(winnerActor?.invocation === undefined ? {} : { sessionDir: actorSessionDirectory(request.runDir, winnerActor.invocation, winnerHarness, winnerWorker) }),
        onEvent: request.onEvent,
        ...(request.agentRunner === undefined ? {} : { agentRunner: request.agentRunner }),
        ...(continuation === undefined ? {} : { continuation }),
      }, consolidationAgentOptions).pipe(
        Effect.mapError((error) => workflowError(
          "schedule",
          sourceCwd,
          "winner consolidation agent failed: " + errorMessage(error),
        )),
      );
      continuation = winnerActor?.memory === false ? undefined : winner.continuation;
      winnerActor?.onTurn(winner);
      yield* WORKFLOW_LOG.info("workspace.winner.consolidation.turn", {
        outcome: "success",
        data: { winnerKey, worker: winnerWorker, transcriptPath: winner.transcriptPath },
      }).pipe(Effect.catchAll(() => Effect.void));
    }),
    persistAfterCarry,
  });
}

export function consolidateAndGate(
  args: ConsolidateAndGateRequest,
): Effect.Effect<ConsolidationCarrying, never, FileSystem.FileSystem | Logging> {
  const prepare = Effect.tryPromise({
    try: () => prepareConsolidationEvidence({
      sourceCwd: args.sourceCwd,
      runDir: args.request.runDir,
      winnerContentDir: args.winnerContentDir,
      ...(args.winnerBaselineContentDir === undefined ? {} : { baselineContentDir: args.winnerBaselineContentDir }),
      ...(args.changeSet === undefined ? {} : { changeSet: args.changeSet }),
      excludeUnder: args.excludeUnder,
    }),
    catch: (cause) => cause instanceof ConsolidationEvidencePreparationError
      ? cause
      : new ConsolidationEvidencePreparationError(
        "cannot prepare external consolidation evidence: " + errorMessage(cause),
      ),
  });
  return prepare.pipe(
    Effect.flatMap((evidence) => runPreparedConsolidation(args, evidence)),
    Effect.catchAll((cause) => Effect.succeed({
      kind: "carry-failed" as const,
      sourceState: "unknown" as const,
      reason: errorMessage(cause),
      ...(cause instanceof ConsolidationEvidencePreparationError && cause.externalEvidenceRoot !== undefined
        ? { externalEvidenceRoot: cause.externalEvidenceRoot }
        : {}),
    })),
  );
}

/** Execute one already-loaded workflow. This is the core runtime boundary: it
 * performs no workflow-file I/O, so callers own loading and load failures. */
export function executeWorkflow(
  loaded: LoadedWorkflow,
  request: WorkflowExecutionRequest,
): Effect.Effect<
  WorkflowExecutionResult,
  WorkflowExecutionError,
  FileSystem.FileSystem | Logging
> {
  // Normalized outside the generator so the exit-level finalizer below can
  // name the execution it is closing, where the generator's locals are gone.
  const executionId = normalizeExecutionId(request.execution?.id ?? request.executionId);
  return TRACE(WORKFLOW_SOURCE, Effect.gen(function* () {
    yield* WORKFLOW_LOG.info("agentic.task.started", { data: { promptLength: request.prompt.length } });
    const sharedWorkspace = sharedWorkspaceBinding(request.cwd);
    yield* validateWorkspace(sharedWorkspace);
    yield* WORKFLOW_LOG.info("workspace.prepared", {
      data: {
        executionId: request.executionId,
        workspace: sharedWorkspace,
        ownership: "shared-root",
      },
    });
    if (executionId === undefined) {
      return yield* Effect.fail(workflowError(
        "schedule",
        loaded.workflowPath,
        "executionId must contain only letters, numbers, underscores, and hyphens",
      ));
    }
    yield* WORKFLOW_LOG.info("workflow.loaded", {
      data: {
        path: loaded.workflowPath,
        name: loaded.document.workflow.name,
        executionId,
      },
    });
    const compiled = yield* TRACE(
      COMPILE_SOURCE,
      compileWorkflow(loaded.document, loaded.workflowPath),
      { workflow: loaded.document.workflow.name },
    );
    yield* validateTournamentExitMetricArity(loaded, compiled);
    // Fail before any stage runs rather than minutes in, at the first
    // sign-off gate, when the caller has no way to ask a human.
    if (request.signoff === undefined && compiled.stages.some((entry) => entry.stage.signoff === true)) {
      return yield* Effect.fail(workflowError(
        "schedule",
        loaded.workflowPath,
        "workflow has sign-off stages but this run has no sign-off channel (an interactive terminal is required)",
      ));
    }
    if (request.discuss === undefined && compiled.stages.some((entry) => entry.stage.discuss === true)) {
      return yield* Effect.fail(workflowError(
        "schedule",
        loaded.workflowPath,
        "workflow has discuss stages but this run has no discuss channel (a supervisor channel is required)",
      ));
    }
    // ISSUE-017: opt-in per-workflow winner auto-commit. Snapshot the dirty
    // files at run start so each round's commit never sweeps in pre-existing
    // user / other-task changes.
    const autoCommit = compiled.autoCommit === true;
    const preExistingDirty = autoCommit
      ? yield* snapshotDirtyFiles(sharedWorkspace.cwd)
      : new Set<string>();
    const scheduled = yield* TRACE(
      SCHEDULE_SOURCE,
      scheduleWorkflow(compiled),
      { workflow: compiled.name },
    );
    if (scheduled.length === 0) {
      return yield* Effect.fail(workflowError(
        "schedule",
        compiled.sourcePath,
        "scheduler produced no stage",
      ));
    }
    const runtimePlan = buildWorkflowRuntimePlan(compiled);
    if (runtimePlan.length === 0) {
      return yield* Effect.fail(workflowError("schedule", compiled.sourcePath, "runtime planner produced no root node"));
    }
    yield* createExecutionDirectory(request.runDir);
    const progressPlan = workflowProgressPlan(compiled);
    // A continue repeats its job's ordinal: the span belongs to the same job,
    // so its evidence lands in the same prompts/<i>/ tree and the stream
    // groups the spans together. A fresh job takes the next ordinal.
    const promptIndex = request.continueJob?.jobOrdinal ?? (request.execution?.promptIndex ?? 0) + 1;
    const knownLoopIterations = new Map<string, number>();
    yield* initializeWorkflowProgress(request.runDir, executionId, progressPlan, promptIndex, request.prompt, request.execution !== undefined);
    const workflowTrajectory = yield* WorkflowTrajectory.open(request.runDir, executionId);
    const closeWorkflowTrajectory = (status: "completed" | "failed" | "cancelled") =>
      Effect.gen(function* () {
        yield* workflowTrajectory.close(status);
        yield* Effect.forEach(
          workflowTrajectory.snapshot().streams.filter((stream) => stream.status === "error"),
          (stream) => WORKFLOW_LOG.error("workflow.trajectory.incomplete", {
            outcome: "failure",
            data: { executionId, stream: stream.id, errors: stream.errors },
          }).pipe(Effect.catchAll(() => Effect.void)),
          { discard: true },
        );
      });
    yield* WORKFLOW_LOG.info("workflow.compiled", {
      data: {
        stages: scheduled.map((invocation) => invocation.id),
        executionId,
        plannedStages: progressPlan.plannedStages,
      },
    });

    // Seeded from a prior execution when the caller continues one. Loading stays
    // lazy: only when a stage actually runs does its continuation reach the
    // worker request, so the harness reopens exactly the transcripts this prompt
    // touches and nothing else.
    const actors = new Map<string, ActorState>(request.execution?.actors);
    // Actors written before they were keyed by worker carry the stage id in
    // their key. Rekey them once here: the compiled workflow is the only place
    // the stage→worker mapping exists, so this is the one moment the rewrite
    // is possible. An actor whose stage the current workflow does not hold
    // keeps its old key and is simply not looked up.
    if (request.execution !== undefined) {
      const stageToWorker = new Map(compiled.stages.map((stage) => [stage.id, stage.stage.worker]));
      for (const [key, state] of [...actors]) {
        const migratedKey = migrateLegacyActorKey(key, stageToWorker);
        if (migratedKey === undefined || actors.has(migratedKey)) continue;
        actors.delete(key);
        actors.set(migratedKey, state);
      }
    }
    const workflowAgentOptions: AgentHarnessOptions = {
      ...(request.agentOptions ?? {}),
      // Codex's workspace-write sandbox only grants the task cwd by default;
      // validated stage results and workflow evidence live under runDir.
      additionalWritableDirs: [
        ...new Set([
          ...(request.agentOptions?.additionalWritableDirs ?? []),
          request.runDir,
        ]),
      ],
    };
    // Sessions a *running* attempt has announced. A turn that is interrupted
    // returns no result and no error, so this is the only record of it — and
    // the reason an interrupt pauses a conversation instead of abandoning it.
    const announcedContinuations = new Map<string, AgentContinuation>();
    const actorContexts = new Map<string, ActorExecutionContext>();
    const counters: StageRunnerCounters = { acceptedStageCount: 0, completedByStage: new Map<string, number>() };
    // A continue's snapshot starts where the job left off: the invocations
    // accepted in earlier spans are not re-run, so nothing would count them
    // again and the run's counts would restart from the continue instead.
    if (request.continueJob !== undefined) {
      for (const invocationId of request.continueJob.accepted) {
        counters.acceptedStageCount += 1;
        const stageId = invocationId.split("@", 1)[0] ?? invocationId;
        counters.completedByStage.set(stageId, (counters.completedByStage.get(stageId) ?? 0) + 1);
      }
    }
    // Map slots intentionally run in parallel. Serialize only the small
    // progress writes so no read/modify/write snapshot update is lost.
    const progressSemaphore = Effect.unsafeMakeSemaphore(1);
    // Map slots may reach their sign-off gates concurrently; one human can
    // only answer one prompt at a time, so the questions are serialized.
    const signoffSemaphore = Effect.unsafeMakeSemaphore(1);
    // The static consumer edges, read from the compiled graph's resolved
    // `dependsOn` rather than from a stage's own `from:` list. Compile folds a
    // region's `from:` into its entry leaf, so a loop's entry stage is a real
    // consumer of whatever the region depends on even though its own `from:` is
    // empty. Driving both the promise ("your note goes to these stages") and
    // the delivery (which stages actually read it) from this one table is what
    // keeps them from disagreeing: a note the reviewer was told would arrive
    // must never be dropped, and one they were told had nowhere to go must not
    // silently reappear.
    const dependsOnByStage = new Map<string, readonly string[]>();
    const consumersByStage = new Map<string, string[]>();
    for (const entry of compiled.stages) {
      dependsOnByStage.set(entry.id, entry.dependsOn);
      for (const dependency of entry.dependsOn) {
        const consumers = consumersByStage.get(dependency);
        if (consumers === undefined) consumersByStage.set(dependency, [entry.id]);
        else consumers.push(entry.id);
      }
    }
    const actorSemaphores = new Map<string, Effect.Semaphore>();
    const semaphoreForActor = (actorKey: string): Effect.Semaphore => {
      const existing = actorSemaphores.get(actorKey);
      if (existing !== undefined) return existing;
      const created = Effect.unsafeMakeSemaphore(1);
      actorSemaphores.set(actorKey, created);
      return created;
    };
    const persistActors = () => writeResumeState(request.runDir, {
      version: 1,
      executionId,
      promptIndex,
      actors: Object.fromEntries([...actors.entries()].flatMap(([key, state]) => {
        if (state.harness === undefined || state.sessionId === undefined || state.transcriptPath === undefined) return [];
        return [[key, {
          harness: state.harness,
          sessionId: state.sessionId,
          transcriptPath: state.transcriptPath,
          turns: state.turns,
          ...(state.continuation === undefined ? {} : { continuation: state.continuation }),
        }]];
      })),
    });

    /** Everything the stage runner reaches outside itself. */
    const stageRunnerContext: StageRunnerContext = {
      request,
      loaded,
      compiled,
      executionId,
      promptIndex,
      actors,
      announcedContinuations,
      actorContexts,
      counters,
      knownLoopIterations,
      progressSemaphore,
      signoffSemaphore,
      semaphoreForActor,
      persistActors,
      workflowTrajectory,
      agentOptions: workflowAgentOptions,
      consumersByStage,
      dependsOnByStage,
    };

    /** Rebuild an already-accepted invocation's result from the evidence it
     * left, so a continue can skip its worker turn. `undefined` means the
     * producer record is gone or unreadable — the caller falls through to
     * re-running the invocation, which is slower but answers in the same
     * shape. */

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
    let preserveWorkspacesAfterFailure = false;

    const failTournamentWithPreservedSlots = (
      region: WorkflowRegionPlan,
      sourceCwd: string,
      keys: readonly string[],
      reason: string,
    ): Effect.Effect<never, WorkflowError, FileSystem.FileSystem | Logging> => Effect.gen(function* () {
      preserveWorkspacesAfterFailure = true;
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
                consolidating = yield* consolidateAndGate({
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
    const finalizeWorkspaces = (): Effect.Effect<void, WorkflowError, FileSystem.FileSystem | Logging> =>
      Effect.uninterruptible(Effect.suspend(() => cleanupMapWorkspaces(request.runDir, executionId, {
        // A nested map slot legitimately records its immediate parent slot as
        // sourceCwd. The execution id and run-owned record path already bound
        // this backstop to the current run; applying the root source identity
        // here would reject valid nested (including already-cleaned) records.
        preserve: request.workspace?.preserve === true || preserveWorkspacesAfterFailure,
      }).pipe(Effect.asVoid)));


    interface AmbiguousCommitProjection {
      readonly id: string;
      readonly producers: readonly {
        readonly stageId: string;
        readonly invocationId: string;
      }[];
    }

    interface RoundWinnerCommitExtraction {
      readonly facts?: {
        readonly files: readonly string[];
        readonly input: WinnerCommitMessageInput;
      };
      readonly ambiguous?: readonly AmbiguousCommitProjection[];
    }

    function projectionProducers(
      stages: readonly InternalStageResult[],
      id: string,
    ): readonly InternalStageResult[] {
      return stages.filter((result) => result.projections?.some((projection) => projection.id === id) === true);
    }

    /** ISSUE-017: extract winner-commit facts for one KEEP round. Every value
     * comes from an explicit producer-contract projection; resultPayload is
     * retained for audit/handoff compatibility but is never inspected here.
     * Returns no facts when the round was not a KEEP or produced no changed
     * files after the pre-existing-dirty suppression. A projection with more
     * than one stage producer is ambiguous: fail closed instead of combining
     * values from whichever stage happened to appear first. */
    function roundWinnerCommitFacts(
      stages: readonly InternalStageResult[],
      iteration: number,
      prompt: string,
      dirty: ReadonlySet<string>,
    ): RoundWinnerCommitExtraction {
      const requiredProjections = ["workspace.changed-files", "round.decision"];
      const producers = new Map(requiredProjections.map((id) => [id, projectionProducers(stages, id)]));
      const ambiguous = requiredProjections.flatMap((id) => {
        const matches = producers.get(id) ?? [];
        return matches.length < 2 ? [] : [{
          id,
          producers: matches.map((result) => ({ stageId: result.stageId, invocationId: result.id })),
        }];
      });
      if (ambiguous.length > 0) return { ambiguous };

      const implementation = producers.get("workspace.changed-files")?.[0];
      const measure = producers.get("round.decision")?.[0];
      if (implementation === undefined || measure === undefined || projectionString(measure, "round.decision") !== "KEEP") return {};
      const changedFiles = projectionValue(implementation, "workspace.changed-files");
      if (!Array.isArray(changedFiles)) return {};
      const files = safeChangedFiles(
        changedFiles.filter((file): file is string => typeof file === "string"),
        dirty,
      );
      if (files.length === 0) return {};
      const operator = projectionString(implementation, "build.target") ?? "operator";
      const latency = projectionNumber(measure, "profile.kernel-latency-us")?.toFixed(2);
      const rw = projectionNumber(measure, "profile.llc-rw-bandwidth-gbps")?.toFixed(2);
      const regressionValue = projectionNumber(measure, "round.regression-pp");
      const regression = regressionValue === undefined ? undefined : `${regressionValue}pp`;
      const verifyStatus = projectionValue(measure, "verification.passed") === true ? "verify passed" : "verify failed";
      const test = [
        latency !== undefined && rw !== undefined ? `${latency}us / ${rw} GB/s` : undefined,
        regression,
        verifyStatus,
      ].filter((part): part is string => part !== undefined).join("; ");
      const ticket = extractTicket(prompt);
      return {
        facts: {
          files,
          input: {
            ...(ticket === undefined ? {} : { ticket }),
            operator,
            iteration,
            hypothesis: projectionString(measure, "round.hypothesis") ?? "",
            solution: projectionString(implementation, "change.summary") ?? "",
            test,
          },
        },
      };
    }

    /** Commit one KEEP round's winner files with the winner-commit template
     * (no push). Never fails — see `commitRoundFiles`. */
    function commitRoundWinner(
      stages: readonly InternalStageResult[],
      iteration: number,
      prompt: string,
      dirty: ReadonlySet<string>,
      cwd: string,
    ): Effect.Effect<void, never, Logging | FileSystem.FileSystem> {
      const extraction = roundWinnerCommitFacts(stages, iteration, prompt, dirty);
      if (extraction.ambiguous !== undefined) {
        return WORKFLOW_LOG.warn("auto.commit.skipped", {
          outcome: "skipped",
          data: {
            reason: "ambiguous projection producers",
            projections: extraction.ambiguous,
          },
        });
      }
      if (extraction.facts === undefined) return Effect.void;
      return commitRoundFiles(cwd, extraction.facts.files, buildCommitMessage(extraction.facts.input));
    }

    /** ISSUE-017: follow-up commit for the summary stage's progress-record
     * write-back (progress records stay separate from per-round source
     * commits). `[Docs]` type. */
    function commitSummaryProgressRecord(
      stages: readonly InternalStageResult[],
      prompt: string,
      dirty: ReadonlySet<string>,
      cwd: string,
    ): Effect.Effect<void, never, Logging | FileSystem.FileSystem> {
      const producers = projectionProducers(stages, "progress-record.path");
      if (producers.length > 1) {
        return WORKFLOW_LOG.warn("auto.commit.skipped", {
          outcome: "skipped",
          data: {
            reason: "ambiguous projection producers",
            projections: [{
              id: "progress-record.path",
              producers: producers.map((result) => ({ stageId: result.stageId, invocationId: result.id })),
            }],
          },
        });
      }
      const result = producers[0];
      if (result === undefined) return Effect.void;
      const filePath = projectionString(result, "progress-record.path");
      if (filePath === undefined) return Effect.void;
      const files = safeChangedFiles([filePath], dirty);
      if (files.length === 0) return Effect.void;
      const ticket = extractTicket(prompt);
      return commitRoundFiles(cwd, files, buildCommitMessage({
        type: "Docs",
        ...(ticket === undefined ? {} : { ticket }),
        operator: "tuning",
        iteration: 0,
        hypothesis: "progress record write-back after tuning summary",
        solution: `record the run outcome at ${filePath}`,
        test: "tuning run",
        impactArea: "ops",
      }));
    }

    const runExecution = Effect.gen(function* () {
      const completed = yield* executeScope(
        runtimePlan,
        undefined,
        [],
        [],
        undefined,
        undefined,
        sharedWorkspace,
      );
      const terminal = completed.boundary.results;
      const final = terminal.at(-1) ?? completed.stages.at(-1);
      if (final === undefined) {
        return yield* Effect.fail(workflowError("schedule", loaded.workflowPath, "workflow completed without a stage result"));
      }
      // The outcome is settled the moment the terminal stage resolves, so it
      // is recorded before any cleanup runs. Cleanup is re-entrant, optional
      // and allowed to fail; the record of what happened is none of those, and
      // a cleanup that wedges must not be able to leave the run looking live.
      //
      // `commitSummaryProgressRecord` is not cleanup: it is work whose failure
      // changes the outcome, so it stays on this side of the record. The
      // workspace sweep that used to sit here was cleanup in the middle of
      // that work, and `cleanupAfterFailure` below runs it on every path.
      if (autoCommit) {
        yield* commitSummaryProgressRecord(completed.stages, request.prompt, preExistingDirty, sharedWorkspace.cwd);
      }
      yield* finalizeWorkflowProgress(request.runDir, executionId, "completed").pipe(
        Effect.catchAll(() => Effect.void),
      );
      yield* WORKFLOW_LOG.info("agentic.task.completed", {
        stage: final.stageId,
        agent: final.worker,
        outcome: "success",
        data: {
          executionId,
          completedStages: completed.stages.length,
          terminalStages: terminal.map((result) => result.id),
          sessionId: final.sessionId,
          transcriptPath: final.transcriptPath,
          workspace: final.workspace,
          textLength: final.text.length,
        },
      });
      return {
        workflow: compiled.name,
        executionId,
        stage: final.stage,
        worker: final.worker,
        text: final.text,
        sessionId: final.sessionId,
        transcriptPath: final.transcriptPath,
        ...(final.requestedModel === undefined ? {} : { requestedModel: final.requestedModel }),
        ...(final.requestedThinkingLevel === undefined ? {} : { requestedThinkingLevel: final.requestedThinkingLevel }),
        ...(final.model === undefined ? {} : { model: final.model }),
        ...(final.thinkingLevel === undefined ? {} : { thinkingLevel: final.thinkingLevel }),
        stages: completed.stages,
        terminalStages: terminal,
        progressPath: workflowProgressPath(request.runDir),
        progressSnapshotPath: workflowProgressSnapshotPath(request.runDir),
      };
    });
    const cleanupAfterFailure = finalizeWorkspaces().pipe(
      Effect.tapError((error) => WORKFLOW_LOG.error("workspace.cleanup.failed", {
        outcome: "failure",
        data: { executionId, error: failureDetails(error) },
      })),
      // Preserve the primary workflow failure/cancellation. The durable
      // record remains in its latest phase so recovery can finish cleanup.
      Effect.catchAll(() => Effect.void),
    );
    return yield* runExecution.pipe(
      // Exit-level, not error-level: a bare fiber interrupt — no typed error,
      // no abort signal, exactly what `/exit` performs on a stuck prompt — is
      // the same human pause as a cancelled worker call and must not finalize
      // the run as "failed". Error-channel taps ignore interrupts.
      //
      // Registered on the run itself rather than outside the cleanup below, so
      // the outcome lands in evidence first: it is settled the moment the run
      // fails, and a cleanup that wedges must not be able to swallow it.
      Effect.onExit((exit) => Exit.isFailure(exit) ? Effect.gen(function* () {
        const cancelled = isCancellation(exit.cause);
        const details = failureDetails(exit.cause);
        // An execution that failed before it had an identity never opened a
        // stream or a snapshot, so it has no outcome of its own to record.
        if (executionId !== undefined) {
          yield* finalizeWorkflowProgress(
            request.runDir,
            executionId,
            cancelled ? "paused" : "failed",
            cancelled ? undefined : details.message,
          ).pipe(
            Effect.catchAll(() => Effect.void),
          );
        }
        yield* (cancelled ? WORKFLOW_LOG.info : WORKFLOW_LOG.error)(
          cancelled ? "agentic.task.cancelled" : "agentic.task.failed",
          {
            outcome: cancelled ? "cancelled" : "failure",
            data: { error: details },
          },
        );
      }) : Effect.void),
      // Closed before the cleanup below for the same reason the outcome is
      // recorded before it: the index is evidence about a finished run, and a
      // cleanup that wedges must not leave it saying the run is still going.
      Effect.onExit((exit) => closeWorkflowTrajectory(
        Exit.isSuccess(exit) ? "completed" : isCancellation(exit.cause) ? "cancelled" : "failed",
      )),
      Effect.ensuring(cleanupAfterFailure),
    );
  }));
}
