import { FileSystem } from "@effect/platform";
import { Effect, Exit } from "effect";
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
  WorkflowTrajectory,
} from "@piano/trajectory";
import {
  compileWorkflow,
  isWorkflowIdentifier,
  type CompiledWorkflow,
  type WorkflowHarness,
} from "./workflow.js";
import {
  loadDefaultWorkflow,
  loadWorkflow,
  workerResourcesKey,
  type LoadedWorkflow,
} from "./workflow-file.js";
import { errorMessage, WorkflowError, workflowError } from "./errors.js";
import type {
  ActorExecutionContext,
  ActorState,
  InternalStageResult,
  WorkflowStageExecutionResult,
} from "./execution-types.js";
import {
  COMPILE_SOURCE,
  EXPLICIT_LOAD_SOURCE,
  LOAD_SOURCE,
  WORKFLOW_LOG,
  WORKFLOW_SOURCE,
} from "./execution-logs.js";
import { STAGE_CONTEXT_GUARD_RAILS, wholeWorkflowTask } from "./stage-prompt.js";
import { type StageRunnerContext, type StageRunnerCounters } from "./stage-runner.js";
import {
  createScopeWalker,
  type WalkerWorkspaceState,
} from "./scope-walker.js";
import {
  projectionNumber,
  projectionString,
  resultProjectionValue,
  VALIDATE_REPAIR_ATTEMPTS,
  workflowProgressPlan,
} from "./stage-runner-support.js";
import type { WorkflowExecutionContinuation } from "./workflow-resume.js";
import {
  actorSessionDirectory,
  runId as normalizeExecutionId,
  migrateLegacyActorKey,
} from "./workflow-runtime.js";
import {
  type HandoffMapItem,
} from "./handoff.js";
import {
  readInvocationRecords,
} from "./invocations.js";
import {
  cleanupMapWorkspaces,
  mnemonicNamespace,
  sharedWorkspaceBinding,
  type WorkspaceBaseline,
  type WorkspaceChangeSet,
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
  appendWorkflowProgress,
  finalizeWorkflowProgress,
  initializeWorkflowProgress,
  type WorkflowProgressRegionFinalizedRecord,
  type WorkflowRegionFinalizedPayload,
} from "./progress.js";
import { readRunStatus, runStatusPath } from "./run-status.js";
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
  readonly runId?: string;
  /** Continue a long-lived execution: reopen `execution.id`'s evidence
   * directory and resume each actor's prior harness session instead of opening
   * fresh chats. One Piano run is one execution, so every prompt after the first
   * arrives here. One-shot callers omit it and keep the strict
   * fresh-directory guarantee; when present it takes precedence over
   * `runId`. */
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
    /** Regions that already exited in this job, keyed by runtime instance.
     * A region found here is skipped whole: its boundary is rebuilt from the
     * accepted invocations' evidence instead of re-entering its workers. */
    readonly regions?: ReadonlyMap<string, WorkflowProgressRegionFinalizedRecord>;
  };
  readonly cwd: string;
  readonly prompt: string;
  /** Lane namespace (`<task-slug>-<runId>`) for this run's map/tournament
   * branches. The caller resolves an explicit override; omitted runs get the
   * recorded namespace on resume, else the preflight summary, else
   * `<workflow.mnemonic|name>-<runId>`. A resumed run rejects a differing
   * value. */
  readonly mnemonic?: string;
  /** One preflight agent turn naming the task; the CLI supplies it for
   * workflows that declare lanes. Omitted (tests, lane-free workflows) means
   * the workflow's own mnemonic is used without a model call. */
  readonly summarizeMnemonic?: () => Effect.Effect<string | undefined, never, FileSystem.FileSystem | Logging>;
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


export interface WorkflowWorkspaceSelectionContext {
  readonly runId: string;
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
  readonly runId: string;
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
  /** Deprecated alias for `statusPath`, kept while the headless
   * `progress_path` key retires. Current runs write no progress stream. */
  readonly progressPath: string;
  /** Where the run's one state document lives, for monitors. */
  readonly statusPath?: string;
}


export type WorkflowExecutionError =
  | WorkflowError
  | WorkerError
  | ContractValidationError
  | WorkerContractValidationError;

















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

/** What the run's own ledger says about its jobs before a new one starts: the
 * ordinal it must not reuse, and the jobs a close already abandoned. Both come
 * from one fold of the evidence — the ledger's spans and the invocation
 * stream's job ordinals — with the resume state's index as a floor only. A
 * hint that lags behind cannot reopen an ordinal another job's evidence
 * already holds. */
function readRunJobLedger(
  runDir: string,
  hint: number | undefined,
): Effect.Effect<
  { readonly nextOrdinal: number; readonly abandonedOrdinals: readonly number[]; readonly mnemonic?: string },
  WorkflowError,
  FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const status = yield* readRunStatus(runDir);
    const rows = yield* readInvocationRecords(runDir);
    const recordedOrdinals = rows.map((row) => row.jobOrdinal);
    const jobOrdinals = status?.jobs.map((job) => job.jobOrdinal) ?? [];
    return {
      nextOrdinal: Math.max(0, hint ?? 0, ...jobOrdinals, ...recordedOrdinals) + 1,
      abandonedOrdinals: (status?.jobs ?? [])
        .filter((job) => job.state === "finished" && job.outcome === "restarted")
        .map((job) => job.jobOrdinal),
      ...(status?.mnemonic === undefined ? {} : { mnemonic: status.mnemonic }),
    };
  });
}

/** A closed job is abandoned for good — nothing may continue it — so the next
 * run reclaims the slot directories its pause preserved. The ledger is the
 * authority here, not the moment of closing: a crash right after the close
 * must not strand them. Best-effort like the run-end backstop — a cleanup
 * failure is logged, never fatal, and the record stays in its latest phase so
 * recovery can finish what it started. */
const reclaimAbandonedSlots = (
  runDir: string,
  runId: string,
  ordinals: readonly number[],
): Effect.Effect<void, never, FileSystem.FileSystem | Logging> =>
  Effect.forEach(ordinals, (ordinal) => cleanupMapWorkspaces(runDir, {
    keyPrefix: `job-${ordinal}/`,
  }).pipe(Effect.asVoid), { discard: true }).pipe(
    Effect.tapError((error) => WORKFLOW_LOG.error("workspace.reclaim.failed", {
      outcome: "failure",
      data: { runId, error: failureDetails(error) },
    })),
    Effect.catchAll(() => Effect.void),
  );



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

export interface ConsolidateAndGateRequest {
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
  /** The baseline the winner delta is measured against, so the transaction
   * can re-derive and verify the declared change list. */
  readonly winnerBaseline?: WorkspaceBaseline;
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
        ...STAGE_CONTEXT_GUARD_RAILS,
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
      ...(args.winnerBaseline === undefined ? {} : { baseline: args.winnerBaseline }),
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
  const runId = normalizeExecutionId(request.execution?.id ?? request.runId);
  return TRACE(WORKFLOW_SOURCE, Effect.gen(function* () {
    yield* WORKFLOW_LOG.info("agentic.task.started", { data: { promptLength: request.prompt.length } });
    const sharedWorkspace = sharedWorkspaceBinding(request.cwd);
    yield* validateWorkspace(sharedWorkspace);
    yield* WORKFLOW_LOG.info("workspace.prepared", {
      data: {
        runId: request.runId,
        workspace: sharedWorkspace,
        ownership: "shared-root",
      },
    });
    if (runId === undefined) {
      return yield* Effect.fail(workflowError(
        "schedule",
        loaded.workflowPath,
        "runId must contain only letters, numbers, underscores, and hyphens",
      ));
    }
    yield* WORKFLOW_LOG.info("workflow.loaded", {
      data: {
        path: loaded.workflowPath,
        name: loaded.document.workflow.name,
        runId,
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
    if (compiled.stages.length === 0) {
      return yield* Effect.fail(workflowError(
        "schedule",
        compiled.sourcePath,
        "workflow compiled to no stage",
      ));
    }
    yield* createExecutionDirectory(request.runDir);
    const progressPlan = workflowProgressPlan(compiled);
    // A continue repeats its job's ordinal: the span belongs to the same job,
    // so its evidence lands under the same job's stream rows and result files.
    // A fresh job takes the next ordinal the run's own evidence leaves — the
    // resume state's index is only a floor there.
    const jobLedger = yield* readRunJobLedger(request.runDir, request.execution?.jobOrdinal);
    yield* reclaimAbandonedSlots(request.runDir, runId, jobLedger.abandonedOrdinals);
    const jobOrdinal = request.continueJob?.jobOrdinal ?? jobLedger.nextOrdinal;
    const knownLoopIterations = new Map<string, number>();
    // The lane namespace is the run's task identity. A resumed run keeps the
    // one it recorded; a new run takes the caller's value, else a preflight
    // summary when the workflow has lanes, else the workflow's own mnemonic.
    // A conflicting caller value is a mistake: the user is resuming a
    // different task under this run id.
    const recordedMnemonic = jobLedger.mnemonic;
    if (request.mnemonic !== undefined && recordedMnemonic !== undefined && request.mnemonic !== recordedMnemonic) {
      return yield* Effect.fail(workflowError(
        "schedule",
        loaded.workflowPath,
        `run already uses lane namespace "${recordedMnemonic}"; resume it or start a new run`,
      ));
    }
    let mnemonic = request.mnemonic ?? recordedMnemonic;
    if (mnemonic === undefined) {
      const summary = request.summarizeMnemonic === undefined
        || !compiled.regions.some((region) => region.kind === "map")
        ? undefined
        : yield* request.summarizeMnemonic();
      mnemonic = mnemonicNamespace(summary ?? compiled.mnemonic ?? compiled.name, runId);
    }
    if (!isWorkflowIdentifier(mnemonic)) {
      return yield* Effect.fail(workflowError(
        "schedule",
        loaded.workflowPath,
        `lane namespace must be a simple workflow identifier: ${mnemonic}`,
      ));
    }
    yield* initializeWorkflowProgress(request.runDir, runId, progressPlan, jobOrdinal, request.prompt, request.execution !== undefined, mnemonic);
    const workflowTrajectory = yield* WorkflowTrajectory.open(request.runDir, runId);
    const closeWorkflowTrajectory = (status: "completed" | "failed" | "cancelled") =>
      Effect.gen(function* () {
        yield* workflowTrajectory.close(status);
        yield* Effect.forEach(
          workflowTrajectory.snapshot().streams.filter((stream) => stream.status === "error"),
          (stream) => WORKFLOW_LOG.error("workflow.trajectory.incomplete", {
            outcome: "failure",
            data: { runId, stream: stream.id, errors: stream.errors },
          }).pipe(Effect.catchAll(() => Effect.void)),
          { discard: true },
        );
      });
    yield* WORKFLOW_LOG.info("workflow.compiled", {
      data: {
        stages: compiled.stages.map((stage) => stage.id),
        runId,
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
    /** Shared with the scope walker: it records a workspace that must survive a
     * failed run for recovery, and the finalizer here honors it. */
    const workspaceState: WalkerWorkspaceState = { preserve: false };
    /** Set by the exit classifier below before the finalizer runs: a human
     * pause (`/exit`, Escape on a stuck prompt) must keep this job's slots so
     * a continue can rebind them instead of finding them deleted. */
    let pausedExit = false;
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

    /** Everything the stage runner reaches outside itself. */
    const stageRunnerContext: StageRunnerContext = {
      request,
      loaded,
      compiled,
      runId,
      mnemonic,
      jobOrdinal,
      actors,
      announcedContinuations,
      actorContexts,
      counters,
      knownLoopIterations,
      progressSemaphore,
      signoffSemaphore,
      semaphoreForActor,
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

    const finalizeWorkspaces = (preserveSlots: boolean): Effect.Effect<void, WorkflowError, FileSystem.FileSystem | Logging> =>
      Effect.uninterruptible(Effect.suspend(() => cleanupMapWorkspaces(request.runDir, {
        // A nested map slot legitimately records its immediate parent slot as
        // sourceCwd. The execution id and run-owned record path already bound
        // this backstop to the current run; applying the root source identity
        // here would reject valid nested records.
        preserve: preserveSlots || request.workspace?.preserve === true || workspaceState.preserve,
        // Only this job's slots: a completed prompt must never sweep the
        // preserved slots a paused job left for its continue to rebind.
        keyPrefix: `job-${jobOrdinal}/`,
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
      const changedFiles = resultProjectionValue(implementation, "workspace.changed-files");
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
      const verifyStatus = resultProjectionValue(measure, "verification.passed") === true ? "verify passed" : "verify failed";
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
      /** One `region-finalized` line, appended under the same semaphore as
       * every other ledger write: the walker owns the moment, this owns the
       * identity the record carries. */
      const persistRegionFinalized = (
        payload: WorkflowRegionFinalizedPayload,
      ): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> =>
        progressSemaphore.withPermits(1)(appendWorkflowProgress(request.runDir, {
          kind: "region-finalized",
          runId,
          jobOrdinal,
          ...payload,
        }).pipe(Effect.asVoid));
      const walker = createScopeWalker({
        stageRunnerContext,
        persistRegionFinalized,
        autoCommit,
        preExistingDirty,
        workspaceState,
        commitRoundWinner: (stages, iteration, prompt, dirty, cwd) =>
          commitRoundWinner(stages, iteration, prompt, dirty, cwd),
        consolidate: (args) => consolidateAndGate(args),
      });
      const completed = yield* walker.executeScope(
        compiled.nodes,
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
      yield* finalizeWorkflowProgress(request.runDir, runId, "completed").pipe(
        Effect.catchAll(() => Effect.void),
      );
      yield* WORKFLOW_LOG.info("agentic.task.completed", {
        stage: final.stageId,
        agent: final.worker,
        outcome: "success",
        data: {
          runId,
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
        runId,
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
        progressPath: runStatusPath(request.runDir),
        statusPath: runStatusPath(request.runDir),
      };
    });
    const cleanupAfterExit = (preserveSlots: boolean) => finalizeWorkspaces(preserveSlots).pipe(
      Effect.tapError((error) => WORKFLOW_LOG.error("workspace.cleanup.failed", {
        outcome: "failure",
        data: { runId, error: failureDetails(error) },
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
        pausedExit = cancelled;
        const details = failureDetails(exit.cause);
        // An execution that failed before it had an identity never opened a
        // stream or a snapshot, so it has no outcome of its own to record.
        if (runId !== undefined) {
          yield* finalizeWorkflowProgress(
            request.runDir,
            runId,
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
      Effect.ensuring(Effect.suspend(() => cleanupAfterExit(pausedExit))),
    );
  }));
}
