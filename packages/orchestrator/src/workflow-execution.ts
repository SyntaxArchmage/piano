import type { TurnOutcome } from "@piano/base";
import { ensureDashboard } from "@piano/dashboard";
import { FileSystem } from "@effect/platform";
import { Effect, Exit } from "effect";
import { dirname } from "node:path";
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
import { WorkerError } from "@piano/workers";
import {
  WorkerContractValidationError,
} from "@piano/contract";
import {
  WorkflowTrajectory,
} from "@piano/trajectory";
import {
  compileWorkflow,
  isSingleStageWorkflow,
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
  WorkflowStageExecutionResult,
} from "./execution-types.js";
import {
  COMPILE_SOURCE,
  EXPLICIT_LOAD_SOURCE,
  LOAD_SOURCE,
  WORKFLOW_LOG,
  WORKFLOW_SOURCE,
} from "./execution-logs.js";
import { type StageRunnerContext, type StageRunnerCounters } from "./stage-runner.js";
import {
  createScopeWalker,
  type WalkerWorkspaceState,
} from "./scope-walker.js";
import {
  workflowProgressPlan,
} from "./stage-runner-support.js";
import type { WorkflowExecutionContinuation } from "./workflow-resume.js";
import { runId as normalizeExecutionId } from "./workflow-runtime.js";
import {
  type WorkflowMapItem,
} from "./acceptance.js";
import {
  readInvocationRecords,
} from "./invocations.js";
import {
  cleanupMapWorkspaces,
  mnemonicNamespace,
  sharedWorkspaceBinding,
  type WorkflowWorkspaceBinding,
} from "./workspace.js";
import {
  appendWorkflowProgress,
  finalizeWorkflowProgress,
  initializeWorkflowProgress,
  reconcileCrashedRun,
  type WorkflowLoopCommitRecord,
  type WorkflowProgressRegionFinalizedRecord,
  type WorkflowRegionFinalizedPayload,
} from "./progress.js";
import { nextJobOrdinal, readRunStatus, runStatusPath, type RunStatus } from "./run-status.js";
import type { SystemOneProvider } from "@piano/system-one";
import {
  buildCommitMessage,
  commitFiles,
  extractTicket,
  gitWorkspaceRoot,
  planLoopCommit,
  snapshotDirtyFiles,
  workspaceChanges,
  type CommitMessageInput,
} from "./loop-commit.js";

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
  /** Restart a paused job: close it as `restarted` and start the next job in
   * one state transition. The close folds into the same `status.json` write,
   * so the two are never observed apart. */
  readonly restartOrdinal?: number;
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
  /** Local System One provider. Omitted uses the default Laya service at
   * `PIANO_LAYA_URL`; only stages declaring `skippable: true` call it. */
  readonly systemOne?: SystemOneProvider;
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
   * stage's worker has a contract. */
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
  readonly mapItem: WorkflowMapItem;
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
  /** Recipe repository root override, mirroring `loadWorkflow`'s argument.
   * Omitted callers use the installed registry. */
  readonly recipeRepositoryRoot?: string;
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

/** What the run's state document says before a prompt starts: its status, the
 * next ordinal, and the jobs a restart already abandoned. The document is the
 * only identity source — invocation rows are evidence, not a second ordinal
 * ledger. Rows without a job table mean the document was lost; minting from 1
 * then would alias the old job's `inv-<ref>` names, so the run refuses
 * instead. */
function readRunJobLedger(
  runDir: string,
): Effect.Effect<
  {
    readonly runStatus?: RunStatus;
    readonly nextOrdinal: number;
    readonly abandonedOrdinals: readonly number[];
  },
  WorkflowError,
  FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const status = yield* readRunStatus(runDir);
    const jobs = status?.jobs ?? [];
    if (jobs.length === 0 && (yield* readInvocationRecords(runDir)).length > 0) {
      return yield* Effect.fail(workflowError(
        "schedule",
        runDir,
        "run state has no job table but its invocation evidence exists; the state document is missing",
      ));
    }
    return {
      ...(status === undefined ? {} : { runStatus: status }),
      nextOrdinal: nextJobOrdinal(jobs),
      abandonedOrdinals: jobs
        .filter((job) => job.outcome === "restarted")
        .map((job) => job.jobOrdinal),
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






/** Execute a workflow with runtime expansion. Acceptance records and
 * continuation state live in distinct stores: records move between stages,
 * while a harness continuation is only ever reopened for the same
 * actor/lane. */
export function loadAndExecuteWorkflow(
  request: LoadAndExecuteWorkflowRequest,
): Effect.Effect<
  WorkflowExecutionResult,
  WorkflowExecutionError,
  FileSystem.FileSystem | Logging
> {
  const load = request.workflowPath === undefined
    ? loadDefaultWorkflow(request.root, request.recipeRepositoryRoot)
    : loadWorkflow(request.workflowPath, request.root, request.recipeRepositoryRoot);
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
 * region boundaries. Only a leaf exit whose worker has a contract is a
 * contender; a contract-less exit never projects a referee signal.
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
    if (exitLeaf === undefined) continue;
    const contract = loaded.workerResources?.get(
      workerResourcesKey(exitLeaf.stage.worker, exitLeaf.stage.harness),
    )?.contract;
    if (contract === undefined || contract.manifest.outputs.metrics.length < 2) continue;
    const metricIds = contract.manifest.outputs.metrics.map((metric) => metric.pointer).join(", ");
    offenders.push(
      `tournament "${region.name}" exit stage "${exitLeaf.stage.name}": ` +
      `worker "${contract.worker}" declares ${contract.manifest.outputs.metrics.length} ` +
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
    // A loop commits every iteration. Snapshot the dirty files at run start so
    // each iteration's commit never sweeps in pre-existing user / other-task
    // changes. A non-git workspace snapshots as empty and later reports that
    // it has no commit target; a git workspace whose status cannot be read
    // fails the run here rather than risking that sweep.
    const preExistingDirty = yield* snapshotDirtyFiles(sharedWorkspace.cwd);
    if (compiled.stages.length === 0) {
      return yield* Effect.fail(workflowError(
        "schedule",
        compiled.sourcePath,
        "workflow compiled to no stage",
      ));
    }
    yield* createExecutionDirectory(request.runDir);
    // Monitoring is a sidecar, never a run dependency: a missing server script
    // or a busy port leaves the workflow untouched. The server is shared by
    // every run under this runs root, so repeated prompts reuse it.
    if (compiled.monitor) {
      yield* Effect.tryPromise({
        try: () => ensureDashboard({ runId, runsRoot: dirname(request.runDir) }),
        catch: (cause) => new Error(errorMessage(cause)),
      }).pipe(
        Effect.tap((handle) => handle === undefined
          ? WORKFLOW_LOG.warn("dashboard.unavailable", { data: { runId } })
          : WORKFLOW_LOG.info("dashboard.ready", {
            data: { url: handle.url, port: handle.port, reused: handle.reused },
          })),
        Effect.catchAll((cause) => WORKFLOW_LOG.warn("dashboard.failed", {
          data: { error: errorMessage(cause) },
        })),
      );
    }
    const progressPlan = workflowProgressPlan(compiled);
    // A process can die after announcing its execution but before installing
    // the finalizer, leaving the run `running` with nothing working it. One
    // process runs a run, so a run this process is not running is over: fold
    // the end it never wrote, exactly as the resume picker does.
    yield* reconcileCrashedRun(request.runDir);
    const jobLedger = yield* readRunJobLedger(request.runDir);
    const runStatus = jobLedger.runStatus;
    const latestJob = runStatus?.jobs.at(-1);
    // Lifecycle decisions read the run's status, the one enum every module
    // polls; the job table supplies identity and the cursor.
    let continueJob = request.continueJob;
    if (continueJob !== undefined && latestJob?.jobOrdinal !== continueJob.jobOrdinal) {
      return yield* Effect.fail(workflowError(
        "schedule",
        loaded.workflowPath,
        "cannot continue a job that is not this run's latest",
      ));
    }
    if (request.restartOrdinal !== undefined
      && (runStatus?.status !== "paused" || latestJob?.jobOrdinal !== request.restartOrdinal)) {
      return yield* Effect.fail(workflowError(
        "schedule",
        loaded.workflowPath,
        "cannot restart a job the run does not hold paused",
      ));
    }
    const pausedJob = runStatus?.status === "paused" ? latestJob : undefined;
    if (continueJob === undefined && request.restartOrdinal === undefined && pausedJob !== undefined) {
      // A one-node workflow's restart and continue both re-enter that node, so
      // a plain prompt resumes it. Accepted work is deliberately not skipped:
      // the new prompt is new work, not a request to replay the old answer.
      if (!isSingleStageWorkflow(loaded.document)) {
        return yield* Effect.fail(workflowError(
          "schedule",
          loaded.workflowPath,
          "run is paused mid-workflow; use /continue or /restart",
        ));
      }
      continueJob = {
        jobOrdinal: pausedJob.jobOrdinal,
        accepted: new Set(),
        attempts: new Map(Object.entries(pausedJob.attempts)),
      };
    }
    const jobOrdinal = continueJob?.jobOrdinal ?? jobLedger.nextOrdinal;
    // The stage runner reads the cursor from the request; a synthesized
    // implicit continue must be visible there too, not only to this block.
    const executionRequest: WorkflowExecutionRequest = continueJob === request.continueJob
      ? request
      : { ...request, continueJob };
    // The lane namespace is the run's task identity. A resumed run keeps the
    // one it recorded; a new run takes the caller's value, else a preflight
    // summary when the workflow has lanes, else the workflow's own mnemonic.
    // A conflicting caller value is a mistake: the user is resuming a
    // different task under this run id.
    const recordedMnemonic = runStatus?.mnemonic;
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
    yield* initializeWorkflowProgress(
      request.runDir,
      runId,
      progressPlan,
      jobOrdinal,
      request.prompt,
      request.execution !== undefined,
      {
        ...(mnemonic === undefined ? {} : { mnemonic }),
        ...(request.restartOrdinal === undefined ? {} : { restartOrdinal: request.restartOrdinal }),
      },
    );
    // Reclaim only once the new job's start is committed: a validation
    // failure leaves the paused job's preserved slots untouched, and a
    // crash after the write is finished by the next job's ledger sweep.
    yield* reclaimAbandonedSlots(request.runDir, runId, [
      ...jobLedger.abandonedOrdinals,
      ...(request.restartOrdinal === undefined ? [] : [request.restartOrdinal]),
    ]);
    const workflowTrajectory = yield* WorkflowTrajectory.open(request.runDir, runId);
    const closeWorkflowTrajectory = (status: TurnOutcome) =>
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
    const counters: StageRunnerCounters = { completedByStage: new Map<string, number>() };
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
    if (continueJob !== undefined) {
      for (const invocationId of continueJob.accepted) {
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
      request: executionRequest,
      loaded,
      compiled,
      runId,
      mnemonic,
      jobOrdinal,
      actors,
      announcedContinuations,
      actorContexts,
      counters,
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


    /** Build the neutral loop commit message: the loop's own identity (region
     * name, iteration) and how many files the commit carries. Tuning
     * projections are deliberately not read: shipped contracts produce none,
     * and a commit message must not depend on optional worker output. */
    function loopCommitMessage(
      region: { readonly name: string },
      iteration: number,
      changedFiles: number,
      prompt: string,
    ): CommitMessageInput {
      const ticket = extractTicket(prompt);
      const fileCount = changedFiles === 1 ? "1 changed file" : `${changedFiles} changed files`;
      return {
        ...(ticket === undefined ? {} : { ticket }),
        operator: region.name,
        iteration,
        hypothesis: `loop "${region.name}" iteration ${iteration} completed`,
        solution: `commit ${fileCount} after loop "${region.name}" iteration ${iteration}`,
        test: "not reported",
      };
    }

    /** Commit one loop iteration's workspace changes. The workspace is scanned
     * at commit time — never a worker-declared file list — so files an agent
     * wrote outside its declared result (a memory/notes document, a state
     * file, an untracked artifact) are included. Pre-existing dirty files are
     * excluded; an unchanged workspace is a logged no-op; a non-git workspace
     * is a logged skip with no commit target. A commit that still fails after
     * `COMMIT_MAX_ATTEMPTS` fails the run. */
    function commitLoopIteration(
      region: { readonly id: string; readonly name: string },
      iteration: number,
      prompt: string,
      dirty: ReadonlySet<string>,
      cwd: string,
    ): Effect.Effect<WorkflowLoopCommitRecord | undefined, WorkflowError, Logging | FileSystem.FileSystem> {
      return Effect.gen(function* () {
        const root = yield* gitWorkspaceRoot(cwd);
        if (root === undefined) {
          yield* WORKFLOW_LOG.warn("auto.commit.skipped", {
            outcome: "skipped",
            data: { reason: "not-a-git-worktree", cwd, loop: region.name, iteration },
          });
          return undefined;
        }
        const changes = yield* workspaceChanges(cwd).pipe(
          Effect.mapError((cause) => workflowError(
            "schedule",
            cwd,
            `cannot read workspace changes for loop "${region.name}" iteration ${iteration}: ${errorMessage(cause)}`,
          )),
        );
        const plan = planLoopCommit(changes, dirty);
        if (plan.changed.length === 0) {
          yield* WORKFLOW_LOG.info("auto.commit.skipped", {
            outcome: "skipped",
            data: { reason: "no-changes", cwd, loop: region.name, iteration },
          });
          return undefined;
        }
        const message = buildCommitMessage(loopCommitMessage(region, iteration, plan.changed.length, prompt));
        const result = yield* commitFiles(root, plan, message);
        yield* WORKFLOW_LOG.info("auto.commit.committed", {
          outcome: "success",
          data: {
            cwd,
            loop: region.name,
            iteration,
            commit: result.commit,
            subject: result.subject,
            files: plan.changed.length,
          },
        });
        return { iteration, commit: result.commit };
      });
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
        preExistingDirty,
        workspaceState,
        commitLoopIteration: (region, _stages, iteration, prompt, dirty, cwd) =>
          commitLoopIteration(region, iteration, prompt, dirty, cwd),
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
      // Only loops commit. A stage outside a loop that writes files leaves
      // them in the workspace; a workflow that needs that committed needs a
      // loop (or a separate explicit step), not a second commit path here.
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
        // An execution that failed before it had an identity never started a
        // schedule, so it has no outcome of its own to record.
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
