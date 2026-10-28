// One stage invocation, start to finish: the actor it talks to, the worker
// turn it runs (with validation, repair, retries, sign-off, and the
// epilogue), and the evidence it publishes.
//
// Extracted verbatim from workflow-execution.ts. Everything it needs that is
// not itself arrives through `StageRunnerContext`; the executor imports this
// module forward, so the dependency stays one-way.

import { FileSystem } from "@effect/platform";
import { Duration, Either, Effect } from "effect";
import { TRACE, failureDetails, isCancellation, type Logging } from "@piano/logging";
import {
  failedAttemptContinuation,
  transcriptTokenUsage,
  type AgentContinuation,
  type AgentEvent,
  type AgentHarnessOptions,
  type ThinkingLevel,
} from "@piano/harness";
import { executeWorker, WorkerError } from "@piano/workers";
import {
  inputsContextPath,
  mapItemContextPath,
  readAcceptanceRecord,
  writeAcceptanceRecord,
  writeInputsContext,
  writeMapItemContext,
  type StageValidationWarning,
  type WorkflowMapItem,
} from "./acceptance.js";
import { snapshotWorkerContract, workerContractSnapshotPath } from "./contract-snapshot.js";
import { WorkflowError, workflowError } from "./errors.js";
import { WORKER_LOG, WORKER_SOURCE, WORKFLOW_LOG } from "./execution-logs.js";
import {
  actorLane,
  actorSessionDirectory,
  loopFrames,
  mapFrames,
  runtimeInstanceId,
  runtimeInvocationId,
  workflowActorKey,
  type WorkflowRuntimeFrame,
  type WorkflowRuntimeInvocation,
} from "./workflow-runtime.js";
import { invocationResultPath, recordInvocationStart } from "./invocations.js";
import {
  resolveWorkerResources,
  workerResourcesKey,
  type LoadedWorkflow,
  type WorkerResources,
} from "./workflow-file.js";
import { stageModelForSlot, type CompiledStage, type CompiledWorkflow } from "./workflow.js";
import { inspectGpuRound, materializeGpuPromotion } from "./gpu-round-materialization.js";
import { stagePrompt } from "./stage-prompt.js";
import { appendWorkflowProgress, markWorkflowStageStarted } from "./progress.js";
import { actorTurnRow } from "./resume-state.js";
import {
  VALIDATE_REPAIR_ATTEMPTS,
  attributeTrajectoryObservation,
  workflowProgressPlan,
  ensureResultDirectory,
  projectionString,
  resultProjectionValue,
  scheduleStageRetry,
  trajectoryAgentObservation,
  validateStageResult,
  workflowProgressProjection,
} from "./stage-runner-support.js";
import {
  workerContractGuidance,
  type ContractMetric,
  type ContractProjection,
} from "@piano/contract";
import type {
  ActorExecutionContext,
  ActorState,
  InternalStageResult,
  ResolvedStageValidation,
  SignoffRetry,
  StageReviewNote,
  UpstreamValidationWarning,
  ValidatedStagePayload,
} from "./execution-types.js";
import type {
  WorkflowExecutionError,
  WorkflowExecutionRequest,
  WorkflowSignoffDecision,
} from "./workflow-execution.js";
import type { TrajectoryRecordContext, WorkflowObservation, WorkflowTrajectory } from "@piano/trajectory";
import type { WorkflowWorkspaceBinding } from "./workspace.js";

/** The mutable slice of an execution the runner advances. Kept as an object
 * because the runner mutates it and the executor seeds it on a continue. The
 * per-stage counts are the only counter: their sum is the accepted total. */
export interface StageRunnerCounters {
  readonly completedByStage: Map<string, number>;
}

/** Everything the stage runner reaches outside itself. The executor builds
 * one per execution; the runner destructures it at its own head. */
export interface StageRunnerContext {
  readonly request: WorkflowExecutionRequest;
  readonly loaded: LoadedWorkflow;
  readonly compiled: CompiledWorkflow;
  readonly runId: string;
  /** Lane namespace (`<task-slug>-<runId>`) for map/tournament branches. */
  readonly mnemonic: string;
  readonly jobOrdinal: number;
  readonly actors: Map<string, ActorState>;
  readonly announcedContinuations: Map<string, AgentContinuation>;
  readonly actorContexts: Map<string, ActorExecutionContext>;
  readonly counters: StageRunnerCounters;
  readonly knownLoopIterations: Map<string, number>;
  readonly progressSemaphore: Effect.Semaphore;
  readonly signoffSemaphore: Effect.Semaphore;
  readonly semaphoreForActor: (actorKey: string) => Effect.Semaphore;
  readonly workflowTrajectory: WorkflowTrajectory;
  readonly agentOptions: AgentHarnessOptions;
  /** Direct consumers of each stage id, for review-note delivery. */
  readonly consumersByStage: ReadonlyMap<string, readonly string[]>;
  /** Direct dependencies of each stage id, for review-note attribution. */
  readonly dependsOnByStage: ReadonlyMap<string, readonly string[]>;
}

/** Rebuild an accepted invocation's result from the evidence it left, so a
 * continue can skip its worker turn. `undefined` means the acceptance record is
 * gone or unreadable — the caller falls through to re-running the invocation.
 * Exported for the scope walker's region skip: a finalized region rebuilds
 * every invocation it accepted through the same rule. */
export function rebuildAcceptedStage(
  runDir: string,
  invocation: WorkflowRuntimeInvocation,
  cursor: NonNullable<WorkflowExecutionRequest["continueJob"]>,
): Effect.Effect<InternalStageResult | undefined, WorkflowError, FileSystem.FileSystem | Logging> {
  return Effect.gen(function* () {
    const acceptance = yield* readAcceptanceRecord(runDir, invocation);
    const invocationId = runtimeInvocationId(invocation);
    if (acceptance === undefined) {
      yield* WORKFLOW_LOG.warn("stage.continue.evidence-missing", {
        data: { invocationId, runId: invocation.runId },
      }).pipe(Effect.catchAll(() => Effect.void));
      return undefined;
    }
    return {
      id: invocationId,
      stageId: invocation.stageId,
      ...(acceptance.instanceId === undefined ? {} : { instanceId: acceptance.instanceId }),
      stage: acceptance.stage,
      worker: acceptance.worker,
      text: acceptance.text,
      sessionId: acceptance.sessionId,
      transcriptPath: acceptance.transcriptPath,
      ...(acceptance.requestedModel === undefined ? {} : { requestedModel: acceptance.requestedModel }),
      ...(acceptance.requestedThinkingLevel === undefined
        ? {}
        : { requestedThinkingLevel: acceptance.requestedThinkingLevel as ThinkingLevel }),
      ...(acceptance.model === undefined ? {} : { model: acceptance.model }),
      ...(acceptance.thinkingLevel === undefined ? {} : { thinkingLevel: acceptance.thinkingLevel as ThinkingLevel }),
      attempts: acceptance.attempt ?? cursor.attempts.get(invocationId) ?? 1,
      workspace: acceptance.workspace,
      ...(acceptance.resultPath === undefined ? {} : { resultPath: acceptance.resultPath }),
      ...(acceptance.resultPayload === undefined ? {} : { resultPayload: acceptance.resultPayload }),
      ...(acceptance.metrics === undefined ? {} : { metrics: acceptance.metrics }),
      ...(acceptance.projections === undefined ? {} : { projections: acceptance.projections }),
      ...(acceptance.validationWarning === undefined ? {} : { validationWarning: acceptance.validationWarning }),
      acceptance,
    };
  });
}

export function executeStage(
  context: StageRunnerContext,
  node: CompiledStage,
  frames: readonly WorkflowRuntimeFrame[],
  inputs: readonly InternalStageResult[],
  mapItem: WorkflowMapItem | undefined,
  workspace: WorkflowWorkspaceBinding,
): Effect.Effect<InternalStageResult, WorkflowExecutionError, FileSystem.FileSystem | Logging> {
  const {
    request,
    loaded,
    compiled,
    runId,
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
    agentOptions,
    consumersByStage,
    dependsOnByStage,
  } = context;
  // The same pure computation the executor did before opening the stream:
  // identical inputs, identical plan.
  const progressPlan = workflowProgressPlan(compiled);
  const invocation: WorkflowRuntimeInvocation = {
    runId,
    jobOrdinal,
    stageId: node.id,
    stageName: node.stage.name,
    frames,
  };
  // A per-lane model list resolves to this lane's entry. The lane is the
  // innermost fan-out frame, which is the same region compile validated the
  // list against, so the index is always in range.
  const laneSlot = mapFrames(frames).at(-1)?.slot;
  const stageModel = stageModelForSlot(node.stage.model, laneSlot);
  const actorKey = workflowActorKey(invocation, node.stage.harness, node.stage.worker);
  const memoryEnabled = node.stage.memory !== false;
  const actorSemaphore = semaphoreForActor(actorKey);
  const stageLog = WORKER_LOG.with({ stage: node.id, agent: node.stage.worker });
  const trajectoryContext = (
    attempt: number,
    worker?: { readonly sessionId: string; readonly transcriptPath: string },
  ): TrajectoryRecordContext => {
    const loopFrame = loopFrames(frames).at(-1);
    const mapFrame = mapFrames(frames).at(-1);
    return {
      version: 1,
      timestamp: new Date().toISOString(),
      runId,
      invocationId: runtimeInvocationId(invocation),
      stageId: node.id,
      stage: node.stage.name,
      worker: node.stage.worker,
      attempt,
      ...(loopFrame === undefined ? {} : { iteration: loopFrame.iteration }),
      ...(runtimeInstanceId(frames) === undefined ? {} : { instanceId: runtimeInstanceId(frames) }),
      ...(mapFrame === undefined ? {} : { mapSlot: mapFrame.slot }),
      actorKey,
      ...(worker === undefined ? {} : {
        sessionId: worker.sessionId,
        transcriptPath: worker.transcriptPath,
      }),
    };
  };
  /** The stage's worker resources: the loaded workflow's cache first, the
   * recipe repository second — the one spelling both a live turn and a
   * rebuilt one resolve through. */
  const stageResources = (): Effect.Effect<WorkerResources, WorkflowError, FileSystem.FileSystem> => {
    const cached = loaded.workerResources?.get(workerResourcesKey(node.stage.worker, node.stage.harness));
    return cached === undefined
      ? resolveWorkerResources(
        node.stage.worker,
        loaded.recipeRepositoryRoot,
        loaded.workflowPath,
        node.stage.harness,
      )
      : Effect.succeed(cached);
  };
  /** The actor identity a stage runs under — the one spelling both a live turn
   * and a rebuilt one register through. */
  const actorContextFor = (
    identity: string,
    resources: WorkerResources,
    contextFilePaths: readonly string[],
  ): ActorExecutionContext => ({
    actorKey: identity,
    invocation,
    worker: node.stage.worker,
    harness: node.stage.harness,
    workspaceKey: workspace.key,
    memory: memoryEnabled,
    resources,
    contextFilePaths,
    ...(node.stage.tools === undefined ? {} : { tools: node.stage.tools }),
    ...((request.model ?? stageModel) === undefined ? {} : { model: request.model ?? stageModel }),
    ...((request.thinkingLevel ?? node.stage.thinkingLevel) === undefined
      ? {}
      : { thinkingLevel: request.thinkingLevel ?? node.stage.thinkingLevel }),
    ...(node.stage.timeout === undefined ? {} : { timeout: node.stage.timeout }),
  });
  /** A rebuilt invocation's actor identity is part of its acceptance, not a
   * by-product of running it: the tournament winner carry resumes exactly
   * this conversation. The record's own actor key wins over the current
   * spelling, so a workflow edit between spans cannot redirect the resume.
   * Context files are re-derived by the writers' own path rules and listed
   * only when they are still there — a rebuild rewrites nothing. */
  const registerRebuiltActor = (
    rebuilt: InternalStageResult,
  ): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> => Effect.gen(function* () {
    const resources = yield* stageResources();
    const candidates = [
      ...resources.contextFilePaths,
      ...(resources.contract === undefined
        ? []
        : [workerContractSnapshotPath(request.runDir, node.stage.worker)]),
      inputsContextPath(request.runDir, rebuilt.acceptance.ref),
      ...(mapItem === undefined ? [] : [mapItemContextPath(request.runDir, rebuilt.acceptance.ref)]),
    ];
    const fileSystem = yield* FileSystem.FileSystem;
    const contextFilePaths: string[] = [];
    for (const candidate of candidates) {
      const present = yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false));
      if (present) contextFilePaths.push(candidate);
    }
    const identity = rebuilt.acceptance.actorKey ?? actorKey;
    actorContexts.set(identity, actorContextFor(identity, resources, contextFilePaths));
  });
  /** One actor state change, written once: the run's in-memory table, the
   * ledger's `actor-turn` row the table can be folded from, and the resume
   * table's own snapshot — all under the progress semaphore so a concurrent
   * sibling cannot interleave a stale read/modify/write. A failed ledger or
   * table write never fails the stage: the conversation it records is already
   * on disk in the harness's own transcript. */
  const recordActorState = (
    state: ActorState,
    turnAttempt: number,
  ): Effect.Effect<void, never, FileSystem.FileSystem | Logging> => Effect.suspend(() => {
    actors.set(actorKey, state);
    const row = actorTurnRow({
      runId,
      jobOrdinal,
      invocationId: runtimeInvocationId(invocation),
      attempt: turnAttempt,
      actorKey,
      harness: node.stage.harness,
      worker: node.stage.worker,
      lane: actorLane(frames).join("/"),
      state,
    });
    if (row === undefined) return Effect.void;
    // Same serialization as the accepted-stage write; a failed state write
    // never fails the stage — the conversation it records is already on disk
    // in the harness's own transcript.
    return progressSemaphore.withPermits(1)(appendWorkflowProgress(request.runDir, row))
      .pipe(Effect.asVoid, Effect.catchAll(() => Effect.void));
  });
  const core = Effect.gen(function* () {
    const invocationId = runtimeInvocationId(invocation);
    // A continue rebuilds an already-accepted invocation from the evidence
    // it left instead of running it again — the worker turn, its
    // validation, its sign-off, and its epilogue all already happened in
    // an earlier span of this job.
    if (request.continueJob !== undefined && request.continueJob.accepted.has(invocationId)) {
      const rebuilt = yield* rebuildAcceptedStage(request.runDir, invocation, request.continueJob);
      if (rebuilt !== undefined) {
        yield* registerRebuiltActor(rebuilt);
        return rebuilt;
      }
    }
    const previous = actors.get(actorKey);
    if (memoryEnabled && previous !== undefined && previous.turns > 0 && previous.continuation === undefined) {
      return yield* Effect.fail(workflowError(
        "schedule",
        loaded.workflowPath,
        `actor "${actorKey}" has no continuation after an earlier turn and cannot resume safely`,
      ));
    }
    const resources = yield* stageResources();
    // Contract presence is the only validation gate: a worker with no
    // `recipes/contracts/<worker>.json` runs unvalidated, and a stage naming
    // such a worker is never warned about a contract it does not have.
    const validation: ResolvedStageValidation | undefined = resources.contract === undefined
      ? undefined
      : {
        id: resources.contract.worker,
        guidance: workerContractGuidance(resources.contract),
        projectionDeclarations: resources.contract.manifest.outputs.projections,
        contract: resources.contract,
        snapshotPath: yield* snapshotWorkerContract(request.runDir, resources.contract),
      };
    // The flat name this invocation's evidence paths use; the allocator
    // serializes its own read–compute–append.
    const ref = yield* recordInvocationStart(request.runDir, {
      runId: invocation.runId,
      jobOrdinal: invocation.jobOrdinal,
      invocationId: runtimeInvocationId(invocation),
      stageId: node.id,
    });
    // Upstream results are routed automatically: a stage with direct or
    // inherited inputs gets one standard inputs.json, and a stage with none
    // gets no file at all.
    const inputsPath = inputs.length === 0
      ? undefined
      : yield* writeInputsContext(
        request.runDir,
        invocation,
        ref,
        inputs.map((input) => input.acceptance),
        workspace,
      );
    const mapItemPath = mapItem === undefined
      ? undefined
      : yield* writeMapItemContext(request.runDir, invocation, ref, mapItem, workspace);
    const contextFilePaths = [
      ...resources.contextFilePaths,
      ...(validation === undefined ? [] : [validation.snapshotPath]),
      ...(inputsPath === undefined ? [] : [inputsPath]),
      ...(mapItemPath === undefined ? [] : [mapItemPath]),
    ];
    actorContexts.set(actorKey, actorContextFor(actorKey, resources, contextFilePaths));
    yield* WORKFLOW_LOG.info("workflow.scheduled", {
      stage: node.id,
      agent: node.stage.worker,
      data: {
        id: runtimeInvocationId(invocation),
        stageId: node.id,
        instanceId: runtimeInstanceId(frames) ?? "root",
        actorKey,
        workspace,
        inputCount: inputs.length,
        harness: node.stage.harness,
        ...((request.model ?? stageModel) === undefined ? {} : { requestedModel: request.model ?? stageModel }),
        ...((request.thinkingLevel ?? node.stage.thinkingLevel) === undefined ? {} : { requestedThinkingLevel: request.thinkingLevel ?? node.stage.thinkingLevel }),
        ...(node.stage.tools === undefined ? {} : { tools: node.stage.tools }),
        ...(inputsPath === undefined ? {} : { inputsPath }),
        ...(mapItemPath === undefined ? {} : { mapItemPath }),
      },
    });
    yield* stageLog.info("stage.started", {
      data: {
        id: runtimeInvocationId(invocation),
        actorKey,
        workspace,
        inputCount: inputs.length,
        ...((request.model ?? stageModel) === undefined ? {} : { requestedModel: request.model ?? stageModel }),
        ...((request.thinkingLevel ?? node.stage.thinkingLevel) === undefined ? {} : { requestedThinkingLevel: request.thinkingLevel ?? node.stage.thinkingLevel }),
        ...(inputsPath === undefined ? {} : { inputsPath }),
      },
    });

    // A continue's re-run follows the attempts this job already recorded;
    // starting from one again would overwrite the first attempt's result file.
    let attempt = request.continueJob === undefined
      ? 1
      : (request.continueJob.attempts.get(invocationId) ?? 0) + 1;
    let repairAttempts = 0;
    /** Set by a `retry`: the next attempt at this stage is a human rerun,
     * and this carries the reviewer's own words when they wrote any. */
    let signoffRetry: SignoffRetry | undefined;
    /** Set by a `continue`: the reviewer's note, published on this stage's
     * result so the stages that consume it can be told. */
    let reviewNote: string | undefined;
    /** Retries already performed under `node.stage.retry`. Distinct from
     * `attempt`, which also counts resume turns the engine takes on its own
     * (repairs, sign-off rejections) and therefore cannot bound a policy. */
    let retries = 0;
    const retryPolicy = node.stage.retry;
    let signoffRounds = 0;
    let repairError: string | undefined;
    let acceptedWorker: {
      readonly text: string;
      readonly sessionId: string;
      readonly transcriptPath: string;
      readonly model?: string;
      readonly thinkingLevel?: ThinkingLevel;
      readonly continuation?: AgentContinuation;
    } | undefined;
    let acceptedPayload: unknown;
    let acceptedMetrics: readonly ContractMetric[] = [];
    let acceptedProjections: readonly ContractProjection[] = [];
    let acceptedResultPath: string | undefined;
    /** Set when the final attempt still failed its contract: the worker's
     * text/session are accepted, but without a payload or projections, and
     * downstream stages are told the result is untrusted. */
    let acceptedValidationWarning: StageValidationWarning | undefined;
    /** Accept the worker's turn despite a failed contract check. The repair
     * budget is spent (or no continuation makes a repair impossible), so the
     * stage continues with a warning instead of retrying or failing: the
     * worker's text and session stand, but the invalid result file is kept
     * only as evidence and no payload, metrics or projections are published. */
    const acceptWithValidationWarning = (
      resolved: ResolvedStageValidation,
      accepted: {
        readonly text: string;
        readonly sessionId: string;
        readonly transcriptPath: string;
        readonly model?: string;
        readonly thinkingLevel?: ThinkingLevel;
        readonly continuation?: AgentContinuation;
      },
      warningMessage: string,
      error: unknown,
      attemptNumber: number,
      failedResultPath: string | undefined,
    ): Effect.Effect<void, never, FileSystem.FileSystem | Logging> => Effect.gen(function* () {
      yield* stageLog.warn("stage.validation.warning", {
        data: {
          id: runtimeInvocationId(invocation),
          validate: resolved.id,
          attempt: attemptNumber,
          resultPath: failedResultPath,
          error: failureDetails(error),
        },
      });
      acceptedWorker = accepted;
      acceptedResultPath = failedResultPath;
      acceptedValidationWarning = {
        worker: node.stage.worker,
        ...(resolved.contract.path === "" ? {} : { contractPath: resolved.contract.path }),
        message: warningMessage,
      };
    });
    /** The reviewer's note arriving from the upstream stages this one is
     * declared to consume.
     *
     * Filtered by this stage's resolved `dependsOn` rather than by its own
     * `from:` list, because `inputs` also carries results inherited from
     * an enclosing region and those must not deliver a note the reviewer
     * was never told about. This is the delivery half of the same table
     * `consumers` is built from. */
    const declaredDependencies = new Set(dependsOnByStage.get(node.id) ?? []);
    const reviewNotes: readonly StageReviewNote[] = inputs.flatMap((input) =>
      input.reviewNote === undefined || !declaredDependencies.has(input.stageId)
        ? []
        : [{ stageId: input.stageId, note: input.reviewNote }]);
    /** Upstream results this stage consumes that failed validation. Unlike a
     * reviewer note, a warning is not filtered by declared dependencies: an
     * inherited result inside a loop or tournament is still input this stage
     * must not trust. */
    const upstreamValidationWarnings: readonly UpstreamValidationWarning[] = inputs.flatMap((input) =>
      input.validationWarning === undefined
        ? []
        : [{
          stageId: input.stageId,
          worker: input.validationWarning.worker,
          ...(input.validationWarning.contractPath === undefined
            ? {}
            : { contractPath: input.validationWarning.contractPath }),
          message: input.validationWarning.message,
        }]);
    /** Static ids of the stages that consume this one — the only stages a
     * `continue` note can reach, told to the reviewer up front so the
     * answer to "where does my note go?" is never a surprise. */
    const stageConsumers = consumersByStage.get(node.id) ?? [];
    /** Ask the run's human reviewer to sign off one finished attempt.
     * Returns undefined when the stage asks for no gate. The two decisions
     * are a fork in the workflow: `retry` reopens the same actor and keeps
     * the note for its next attempt, `continue` publishes the attempt and
     * carries the note forward on the result. Harness-independent: the
     * worker has already finished and the question is rendered by Piano
     * itself, never by the harness. */
    const requestSignoff = (
      worker: {
        readonly text: string;
        readonly sessionId: string;
        readonly transcriptPath: string;
      },
      validatedResultPath: string | undefined,
    ): Effect.Effect<
      WorkflowSignoffDecision | undefined,
      WorkflowError,
      FileSystem.FileSystem | Logging
    > => {
      if (node.stage.signoff !== true) return Effect.succeed(undefined);
      const signoff = request.signoff;
      if (signoff === undefined) {
        // Unreachable in practice: the run fails up front when no channel
        // is provided (see the preflight in executeWorkflow).
        return Effect.fail(workflowError(
          "schedule",
          loaded.workflowPath,
          `stage "${node.id}" requests signoff but this run has no signoff channel`,
        ));
      }
      const reviewedAttempt = attempt;
      return signoffSemaphore.withPermits(1)(Effect.gen(function* () {
        signoffRounds += 1;
        yield* stageLog.info("stage.signoff.requested", {
          data: { id: runtimeInvocationId(invocation), attempt: reviewedAttempt, round: signoffRounds },
        });
        const decision = yield* signoff({
          stageId: node.id,
          invocationId: runtimeInvocationId(invocation),
          stage: node.stage.name,
          worker: node.stage.worker,
          harness: node.stage.harness,
          round: signoffRounds,
          ...(validatedResultPath === undefined ? {} : { resultPath: validatedResultPath }),
          transcriptPath: worker.transcriptPath,
          excerpt: worker.text.slice(0, 600),
          consumers: stageConsumers,
        });
        // The note is the reviewer's own prose. The engine records that one
        // was given and how large it is, never the text itself — the same
        // convention `input.accepted` follows for the task prompt, which
        // logs a length. The words are durably attributable anyway: they
        // reach a worker's prompt and therefore that worker's transcript.
        const noteLength = decision.note?.length ?? 0;
        if (decision.type === "continue") {
          yield* stageLog.info("stage.signoff.continued", {
            data: {
              id: runtimeInvocationId(invocation),
              attempt: reviewedAttempt,
              round: signoffRounds,
              noteLength,
              ...(stageConsumers.length === 0 ? {} : { consumers: stageConsumers }),
            },
          });
          return decision;
        }
        yield* stageLog.info("stage.signoff.retried", {
          data: { id: runtimeInvocationId(invocation), attempt: reviewedAttempt, round: signoffRounds, noteLength },
        });
        // Stays `signoff_rejected`: the trajectory schemas are validated on
        // read (`packages/trajectory/src/storage.ts`), so the persisted
        // vocabulary is additive-only and renaming a value would stop older
        // runs from loading. It also remains accurate — a retry is exactly
        // the reason this attempt did not become the stage's accepted one.
        yield* workflowTrajectory.observe({
          type: "stage_attempt_finished",
          context: trajectoryContext(reviewedAttempt, worker),
          monotonicMs: performance.now(),
          outcome: "signoff_rejected",
        });
        return decision;
      }));
    };
    // Front and back matter for this stage. A stage that states its own
    // wins; otherwise the worker plugin's default applies, so a worker can
    // carry the instruction instead of every workflow repeating it.
    // Resolved once here so both uses agree on which text is in force.
    const prologue = node.stage.prologue ?? resources.prologue;
    const epilogue = node.stage.epilogue ?? resources.epilogue;
    /** Attribute one agent event to this exact stage invocation. The TUI
     * renders streaming text per stage, so every turn of this actor — the
     * stage's own and an `epilogue` follow-up — must carry the same
     * attribution or its output would appear unattached. */
    const decorateEvent = (event: AgentEvent): AgentEvent => ({
      ...event,
      workflow: {
        stageId: node.id,
        invocationId: runtimeInvocationId(invocation),
        worker: node.stage.worker,
        attempt,
        workspaceKey: workspace.key,
        workspaceCwd: workspace.cwd,
        ...(workspace.recordPath === undefined ? {} : { workspaceRecordPath: workspace.recordPath }),
      },
    });
    /** Collect tool observations from one agent turn and forward the event.
     * Every turn of this actor — the stage's own and an `epilogue` follow-up —
     * uses it, so tool facts always land on the same observation path. The
     * type check comes first: streaming noise must not pay for a context. */
    const collectObservation = (sink: WorkflowObservation[]) => (event: AgentEvent): void => {
      const decorated = decorateEvent(event);
      if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
        const observation = trajectoryAgentObservation(decorated, trajectoryContext(attempt));
        if (observation !== undefined) sink.push(observation);
      }
      request.agentEventExport?.(decorated);
      request.onEvent?.(decorated);
    };
    while (true) {
      const attemptObservations: WorkflowObservation[] = [];
      const loopFrame = loopFrames(frames).at(-1);
      const instanceId = runtimeInstanceId(frames);
      // This snapshot is a convenience monitor view. A filesystem issue
      // must not hide a real worker result; the canonical stage evidence
      // and validation path remain authoritative.
      yield* progressSemaphore.withPermits(1)(markWorkflowStageStarted(request.runDir, runId, {
        invocationId: runtimeInvocationId(invocation),
        stageId: node.id,
        stage: node.stage.name,
        worker: node.stage.worker,
        attempt,
        // The snapshot records cumulative stage time per invocation; the
        // instance id is what lets a reader keep concurrent map lanes
        // apart while still summing a loop's sequential iterations.
        ...(instanceId === undefined ? {} : { instanceId }),
        ...(loopFrame === undefined ? {} : { iteration: loopFrame.iteration }),
        ...(repairError === undefined ? {} : { error: repairError }),
      })).pipe(Effect.catchAll(() => Effect.void));
      const resultPath = validation === undefined
        ? undefined
        : invocationResultPath(request.runDir, ref, attempt);
      if (resultPath !== undefined) yield* ensureResultDirectory(resultPath);
      yield* workflowTrajectory.observe({
        type: "stage_attempt_started",
        context: trajectoryContext(attempt),
        monotonicMs: performance.now(),
      });
      // Whole-stage wall-clock cap: abort the SDK session (and fail the
      // stage) when a stage declared `timeout`. Composed with the caller's
      // external signal so either trigger cancels the agent.
      const stageTimeoutSeconds = node.stage.timeout;
      const stageSignal = stageTimeoutSeconds === undefined
        ? request.signal
        : request.signal === undefined
          ? AbortSignal.timeout(stageTimeoutSeconds * 1000)
          : AbortSignal.any([request.signal, AbortSignal.timeout(stageTimeoutSeconds * 1000)]);
      const stageContinuation = memoryEnabled
        ? actors.get(actorKey)?.continuation
        : undefined;
      const workerEffect = executeWorker({
        stage: runtimeInvocationId(invocation),
        worker: node.stage.worker,
        harness: node.stage.harness,
        prompt: stagePrompt(
          request.prompt,
          invocation,
          workspace,
          contextFilePaths,
          validation,
          resultPath,
          repairError,
          signoffRetry,
          reviewNotes,
          upstreamValidationWarnings,
          request.model ?? stageModel,
          request.thinkingLevel ?? node.stage.thinkingLevel,
          prologue,
        ),
        cwd: workspace.cwd,
        ...(stageSignal === undefined ? {} : { signal: stageSignal }),
    ...(request.steering === undefined ? {} : { steering: request.steering }),
        ...(resources.systemPromptPath === undefined ? {} : { systemPromptPath: resources.systemPromptPath }),
        contextFilePaths,
        skillPaths: resources.skillPaths,
        ...(node.stage.tools === undefined ? {} : { tools: node.stage.tools }),
        ...(request.model ?? stageModel ? { model: request.model ?? stageModel } : {}),
        ...((request.thinkingLevel ?? node.stage.thinkingLevel) === undefined
          ? {}
          : { thinkingLevel: request.thinkingLevel ?? node.stage.thinkingLevel }),
        sessionDir: actorSessionDirectory(request.runDir, invocation, node.stage.harness, node.stage.worker),
        ...(stageContinuation === undefined
          ? {}
          : { continuation: stageContinuation }),
        onContinuation: (continuation: AgentContinuation) => {
          announcedContinuations.set(actorKey, continuation);
        },
        onEvent: collectObservation(attemptObservations),
        ...(request.agentRunner === undefined ? {} : { agentRunner: request.agentRunner }),
        ...(node.stage.discuss !== true || request.discuss === undefined ? {} : {
          // The supervisor channel and the worker contract are both Effect;
          // the SDK tool's Promise adapter lives only in the harness.
          discuss: (question: string) => Effect.map(
            request.discuss!({
              stageId: node.id,
              invocationId: runtimeInvocationId(invocation),
              stage: node.stage.name,
              worker: node.stage.worker,
              harness: node.stage.harness,
              round: attempt,
              transcriptPath: actors.get(actorKey)?.transcriptPath ?? "",
              question,
            }),
            (decision) => decision.answer,
          ),
        }),
      }, agentOptions).pipe(Effect.tapError((error) => {
        const cancelled = isCancellation(error);
        return (cancelled ? stageLog.info : stageLog.error)(cancelled ? "stage.cancelled" : "stage.failed", {
          outcome: cancelled ? "cancelled" : "failure",
          data: { error: failureDetails(error) },
        });
      }));
      // A successful turn records itself below, with its incremented count.
      // Every other way this attempt can end — a typed cancellation, a
      // failure, a stage timeout, or a bare fiber interrupt that `/exit`
      // performs on a stuck prompt — reaches none of that code, so record
      // the announced session here instead of losing it. `/exit` interrupts
      // the worker effect rather than letting it fail, and an interrupt
      // carries no error for `Effect.either` to observe, so this finalizer
      // is the only place left that runs.
      const recordAnnouncedContinuation = Effect.suspend(() => {
        const announced = announcedContinuations.get(actorKey);
        if (announced === undefined) return Effect.void;
        // Same serialization as the accepted-stage write; a failed state
        // write must never mask the cancellation the user triggered.
        return recordActorState({
          // The interrupted turn was not accepted: `turns` is unchanged, so
          // the resumed conversation picks up where it was paused.
          turns: actors.get(actorKey)?.turns ?? 0,
          harness: node.stage.harness,
          sessionId: announced.sessionId,
          transcriptPath: announced.transcriptPath,
          continuation: announced,
        }, attempt);
      });
      const workerWithAnnouncement = workerEffect.pipe(
        // Runs on success too, where the stage's own write follows with the
        // incremented count and supersedes it. Paying one small write for
        // the guarantee that an interrupt between a finished turn and its
        // bookkeeping cannot lose the turn as well.
        Effect.onExit(() => Effect.uninterruptible(recordAnnouncedContinuation)),
      );
      const workerOutcome = yield* TRACE(WORKER_SOURCE, stageTimeoutSeconds === undefined
        ? workerWithAnnouncement
        : workerWithAnnouncement.pipe(Effect.timeoutFail({
          duration: Duration.seconds(stageTimeoutSeconds),
          onTimeout: () => new WorkerError({
            stage: runtimeInvocationId(invocation),
            worker: node.stage.worker,
            message: `stage "${node.id}" timed out after ${stageTimeoutSeconds}s`,
          }),
        })), {
        stage: node.id,
        worker: node.stage.worker,
        invocationId: runtimeInvocationId(invocation),
        attempt,
        workspaceKey: workspace.key,
        workspaceCwd: workspace.cwd,
        workspaceKind: workspace.kind,
        ...(workspace.recordPath === undefined ? {} : { workspaceRecordPath: workspace.recordPath }),
      }).pipe(Effect.either);
      // Token accounting is one snapshot per attempt, read from the actor
      // transcript at the end of the turn. The per-call `usage` events the
      // harness streamed serve the live counters and the side panel; a stream
      // of per-call values cannot state what the attempt cost in total, so the
      // durable file is the source here. A failed attempt still has a
      // transcript when its harness announced a session, so it is attributed
      // through that announcement rather than dropped.
      const attemptWorker = Either.isRight(workerOutcome) ? workerOutcome.right : announcedContinuations.get(actorKey);
      const attemptUsage = yield* transcriptTokenUsage(attemptWorker?.transcriptPath);
      yield* Effect.forEach(
        [
          ...attemptObservations,
          ...(attemptUsage === undefined ? [] : [{
            type: "token_usage" as const,
            context: trajectoryContext(attempt),
            usage: attemptUsage,
          }]),
        ],
        (observation) => workflowTrajectory.observe(attributeTrajectoryObservation(
          observation,
          attemptWorker,
        )),
        { discard: true },
      );
      if (Either.isLeft(workerOutcome)) {
        const cancelled = isCancellation(workerOutcome.left);
        yield* workflowTrajectory.observe({
          type: "stage_attempt_finished",
          context: trajectoryContext(attempt),
          monotonicMs: performance.now(),
          outcome: cancelled ? "cancelled" : "failed",
        });
        // A human interrupt (Escape / `/exit`) and a retryable failure both
        // leave a session on disk: the harness stashed its continuation on
        // the error. Adopt it so the next attempt reopens the same actor
        // conversation instead of starting fresh — a cancellation must not
        // strand the partial transcript, and a long unattended round must
        // not lose everything it worked out because a gateway returned a
        // 502. The interrupted turn is not accepted: the turn count is kept.
        const resumable = cancelled || retryPolicy !== undefined
          ? failedAttemptContinuation(workerOutcome.left)
          : undefined;
        if (resumable !== undefined && resumable.unresolvable !== true) {
          // Same serialization as the accepted-stage write; a failed state
          // write must never mask the cancellation the user triggered.
          yield* recordActorState({
            // Live count: an earlier turn that completed inside this same
            // prompt (rejected or awaiting repair) already counted itself
            // durable; the stale pre-attempt `previous` must not rewind it.
            turns: actors.get(actorKey)?.turns ?? 0,
            harness: node.stage.harness,
            sessionId: resumable.sessionId,
            transcriptPath: resumable.transcriptPath,
            continuation: resumable,
          }, attempt);
        }
        if (!cancelled) {
          const waited = yield* scheduleStageRetry(
            node.id,
            retryPolicy,
            retries,
            failureDetails(workerOutcome.left),
            // Deliberately the *run's* signal, not this attempt's
            // `stageSignal`: that one still carries `AbortSignal.timeout`,
            // and a wait that outlives the turn it follows must not be read
            // as the user cancelling the run.
            request.signal,
          );
          if (waited !== undefined) {
            retries += 1;
            attempt += 1;
            continue;
          }
        }
        return yield* Effect.fail(workerOutcome.left);
      }
      const worker = workerOutcome.right;

      // Store a successful turn before validation. The repair turn must
      // reopen this exact actor session, never any upstream transcript.
      yield* recordActorState({
        turns: (actors.get(actorKey)?.turns ?? 0) + 1,
        harness: node.stage.harness,
        sessionId: worker.sessionId,
        transcriptPath: worker.transcriptPath,
        ...(worker.continuation === undefined ? {} : { continuation: worker.continuation }),
      }, attempt);
      // A completed turn is durable the moment it lands — acceptance is not
      // the save point. A sign-off *reject* means "keep working on this":
      // the workflow does not end, it reopens this same actor session with
      // the reviewer's feedback, and a validation repair does the same. A
      // later interrupt or failure in the rework must therefore never strand
      // a conversation the harness has already written: the state stream
      // carries it from here, and the accepted-stage write below stays the
      // final canonical state.

      if (validation === undefined) {
        const decision = yield* requestSignoff(worker, undefined);
        if (decision?.type === "retry") {
          signoffRetry = { ...(decision.note === undefined ? {} : { note: decision.note }) };
          attempt += 1;
          continue;
        }
        reviewNote = decision?.note;
        acceptedWorker = worker;
        yield* workflowTrajectory.observe({
          type: "stage_attempt_finished",
          context: trajectoryContext(attempt, worker),
          monotonicMs: performance.now(),
          outcome: "accepted",
        });
        break;
      }
      const validationResult = yield* validateStageResult(
        validation,
        resultPath!,
        runtimeInvocationId(invocation),
      ).pipe(Effect.either);
      // Unified harness rule: every check that can reject the worker's
      // output runs before acceptance, so a failure becomes a repair turn
      // carrying the error — the contract check above is one such check,
      // and the GPU-round promotion facts (declared candidate readable,
      // worker-declared candidate/resulting-best digests matching the bytes
      // read, KEEP requiring promoted=true) are others. The same inspection
      // runs again inside materializeGpuPromotion as the pre-write
      // consistency gate.
      let acceptCheck: Either.Either<ValidatedStagePayload, WorkflowExecutionError>;
      /** Distinguishes a contract-validation rejection from a post-validation
       * inspection failure (the GPU-round promotion facts). Only the former
       * degrades to a warning once the repair budget is spent; a promotion
       * failure is still a stage failure. */
      let contractValidationFailure: boolean;
      if (Either.isLeft(validationResult)) {
        acceptCheck = validationResult;
        contractValidationFailure = true;
      } else {
        const validated = validationResult.right;
        const promotionInspection = yield* inspectGpuRound(
          validated.value,
          validated.projections,
          validation,
          invocation.stageId,
          workspace,
          loaded.workflowPath,
          resultPath,
          request.runDir,
        ).pipe(Effect.either);
        acceptCheck = Either.isLeft(promotionInspection)
          ? Either.left(promotionInspection.left)
          : Either.right(validated);
        contractValidationFailure = false;
      }
      if (Either.isRight(acceptCheck)) {
        yield* stageLog.info("stage.validation.completed", {
          outcome: "success",
          data: { id: runtimeInvocationId(invocation), validate: validation.id, attempt, resultPath },
        });
        const decision = yield* requestSignoff(worker, resultPath);
        if (decision?.type === "retry") {
          signoffRetry = { ...(decision.note === undefined ? {} : { note: decision.note }) };
          attempt += 1;
          continue;
        }
        reviewNote = decision?.note;
        acceptedWorker = worker;
        acceptedPayload = acceptCheck.right.value;
        acceptedMetrics = acceptCheck.right.metrics;
        acceptedProjections = acceptCheck.right.projections;
        acceptedResultPath = resultPath;
        yield* workflowTrajectory.observe({
          type: "stage_attempt_finished",
          context: trajectoryContext(attempt, worker),
          monotonicMs: performance.now(),
          outcome: "accepted",
        });
        break;
      }
      yield* workflowTrajectory.observe({
        type: "stage_attempt_finished",
        context: trajectoryContext(attempt, worker),
        monotonicMs: performance.now(),
        outcome: "validation_failed",
      });
      // The validation message cites the attempt whose result went
      // missing. Passed through unedited it would contradict the current
      // attempt's path that the same repair prompt requires two sections
      // above it — run fe2248's r5 attempt-2 burned its context resolving
      // that contradiction (issue #51). Rewrite the stale citation to the
      // upcoming attempt's path; the actionable reason is preserved. The
      // callback form matters: run-directory names may legally contain
      // `$&`-style sequences, which a string replacement would expand
      // into the matched path.
      repairError = acceptCheck.left.message.replaceAll(
        resultPath!,
        () => invocationResultPath(request.runDir, ref, attempt + 1),
      );
      yield* stageLog.error("stage.validation.failed", {
        outcome: "failure",
        data: {
          id: runtimeInvocationId(invocation),
          validate: validation.id,
          attempt,
          resultPath,
          error: failureDetails(acceptCheck.left),
        },
      });
      if (repairAttempts >= VALIDATE_REPAIR_ATTEMPTS) {
        if (contractValidationFailure) {
          // One repair turn is the whole budget. A contract failure that
          // survives it is a warning, not a retry and not a failed stage: the
          // workflow continues and downstream consumers are told to verify.
          yield* acceptWithValidationWarning(
            validation,
            worker,
            acceptCheck.left.message,
            acceptCheck.left,
            attempt,
            resultPath,
          );
          break;
        }
        // A repair budget that is spent is not necessarily a dead end: a
        // stage with a retry policy starts the whole attempt over, with the
        // validation error retained as its opening feedback, rather than
        // giving up on a run that may have hours left to give.
        const waited = yield* scheduleStageRetry(
          node.id,
          retryPolicy,
          retries,
          acceptCheck.left.message,
          request.signal,
        );
        if (waited === undefined) {
          return yield* Effect.fail(acceptCheck.left);
        }
        retries += 1;
        repairAttempts = 0;
        attempt += 1;
        continue;
      }
      if (memoryEnabled && worker.continuation === undefined) {
        if (!contractValidationFailure) {
          return yield* Effect.fail(workflowError(
            "schedule",
            loaded.workflowPath,
            `actor "${actorKey}" cannot repair failed validation because its harness returned no continuation`,
          ));
        }
        // No continuation means the repair turn cannot reopen the same actor.
        // The budget is effectively spent, so the same warning path applies.
        yield* acceptWithValidationWarning(
          validation,
          worker,
          acceptCheck.left.message,
          acceptCheck.left,
          attempt,
          resultPath,
        );
        break;
      }
      yield* stageLog.info("stage.validation.retrying", {
        data: {
          id: runtimeInvocationId(invocation),
          validate: validation.id,
          nextAttempt: attempt + 1,
          priorResultPath: resultPath,
        },
      });
      repairAttempts += 1;
      attempt += 1;
    }
    if (acceptedWorker === undefined) {
      return yield* Effect.fail(workflowError("schedule", loaded.workflowPath, `stage "${node.id}" did not produce an accepted result`));
    }
    if (validation !== undefined && acceptedPayload !== undefined) {
      const materialized = yield* materializeGpuPromotion(
        acceptedPayload,
        acceptedMetrics,
        acceptedProjections,
        validation,
        invocation.stageId,
        workspace,
        loaded.workflowPath,
        acceptedResultPath,
        request.runDir,
      );
      acceptedPayload = materialized.value;
      acceptedMetrics = materialized.metrics;
      acceptedProjections = materialized.projections;
    }
    // The record keeps the published result path. The run-local contract copy
    // under `contracts/<worker>.json` is what a reader validates it against;
    // no content hash or trust marker is recorded.
    const requestedModel = request.model ?? stageModel;
    const requestedThinkingLevel = request.thinkingLevel ?? node.stage.thinkingLevel;
    const acceptance = yield* writeAcceptanceRecord(request.runDir, invocation, {
      ref,
      stage: node.stage.name,
      worker: node.stage.worker,
      text: acceptedWorker.text,
      sessionId: acceptedWorker.sessionId,
      transcriptPath: acceptedWorker.transcriptPath,
      attempt,
      actorKey,
      ...(requestedModel === undefined ? {} : { requestedModel }),
      ...(requestedThinkingLevel === undefined ? {} : { requestedThinkingLevel }),
      ...(acceptedWorker.model === undefined ? {} : { model: acceptedWorker.model }),
      ...(acceptedWorker.thinkingLevel === undefined ? {} : { thinkingLevel: acceptedWorker.thinkingLevel }),
      workspace,
      ...(acceptedResultPath === undefined ? {} : { resultPath: acceptedResultPath }),
      ...(acceptedPayload === undefined ? {} : { resultPayload: acceptedPayload }),
      ...(acceptedMetrics.length === 0 ? {} : { metrics: acceptedMetrics }),
      ...(acceptedProjections.length === 0 ? {} : { projections: acceptedProjections }),
      ...(acceptedValidationWarning === undefined ? {} : { validationWarning: acceptedValidationWarning }),
    });
    const result: InternalStageResult = {
      id: runtimeInvocationId(invocation),
      stageId: node.id,
      ...(runtimeInstanceId(frames) === undefined ? {} : { instanceId: runtimeInstanceId(frames) }),
      stage: node.stage.name,
      worker: node.stage.worker,
      text: acceptedWorker.text,
      sessionId: acceptedWorker.sessionId,
      transcriptPath: acceptedWorker.transcriptPath,
      ...(requestedModel === undefined ? {} : { requestedModel }),
      ...(requestedThinkingLevel === undefined ? {} : { requestedThinkingLevel }),
      ...(acceptedWorker.model === undefined ? {} : { model: acceptedWorker.model }),
      ...(acceptedWorker.thinkingLevel === undefined ? {} : { thinkingLevel: acceptedWorker.thinkingLevel }),
      attempts: attempt,
      workspace,
      ...(acceptedResultPath === undefined ? {} : { resultPath: acceptedResultPath }),
      ...(acceptedPayload === undefined ? {} : { resultPayload: acceptedPayload }),
      ...(acceptedMetrics.length === 0 ? {} : { metrics: acceptedMetrics }),
      ...(acceptedProjections.length === 0 ? {} : { projections: acceptedProjections }),
      acceptance,
      ...(reviewNote === undefined ? {} : { reviewNote }),
      ...(acceptedValidationWarning === undefined ? {} : { validationWarning: acceptedValidationWarning }),
    };
    const persistedProgress = yield* progressSemaphore.withPermits(1)(Effect.gen(function* () {
      // Keep the counter update and append under the same lock. Map slots
      // may finish concurrently; accepted counts must not
      // jump backwards or include an unappended sibling.
      counters.completedByStage.set(node.id, (counters.completedByStage.get(node.id) ?? 0) + 1);
      const progress = workflowProgressProjection(
        compiled,
        invocation,
        progressPlan,
        counters.completedByStage,
        knownLoopIterations,
      );
      const progressPath = yield* appendWorkflowProgress(request.runDir, {
        runId,
        invocationId: result.id,
        stageId: result.stageId,
        stage: result.stage,
        worker: result.worker,
        ...(result.instanceId === undefined ? {} : { instanceId: result.instanceId }),
        ...(() => {
          const loop = loopFrames(frames)[0];
          return loop === undefined ? {} : { iteration: loop.iteration };
        })(),
        attempt: result.attempts,
        progress,
      });
      // The actor table needs no second write here: this stage's turn already
      // appended its own `actor-turn` row, which is what a resume folds.
      return { progress, progressPath };
    }));
    const { progress, progressPath } = persistedProgress;
    const loopFrame = loopFrames(frames)[0];
    yield* stageLog.info("stage.progress.recorded", {
      outcome: "success",
      data: {
        id: result.id,
        iteration: loopFrame?.iteration,
        progressPath,
        ...(result.projections === undefined ? {} : { projections: result.projections }),
        ...(projectionString(result, "round.decision") === undefined
          ? {}
          : { decision: projectionString(result, "round.decision") }),
        ...(resultProjectionValue(result, "benchmark.evidence") === undefined
          ? {}
          : { benchmark: resultProjectionValue(result, "benchmark.evidence") }),
        progress,
      },
    });
    const persistedResult: InternalStageResult = { ...result };
    yield* workflowTrajectory.observe({
      type: "stage_accepted",
      context: trajectoryContext(result.attempts, result),
      metrics: result.metrics ?? [],
    });
    yield* stageLog.info("stage.completed", {
      outcome: "success",
      data: {
        id: result.id,
        actorKey,
        sessionId: result.sessionId,
        transcriptPath: result.transcriptPath,
        ...(result.requestedModel === undefined ? {} : { requestedModel: result.requestedModel }),
        ...(result.requestedThinkingLevel === undefined ? {} : { requestedThinkingLevel: result.requestedThinkingLevel }),
        ...(result.model === undefined ? {} : { model: result.model }),
        ...(result.thinkingLevel === undefined ? {} : { thinkingLevel: result.thinkingLevel }),
        workspace: result.workspace,
        attempts: result.attempts,
        progressPath,
        textLength: result.text.length,
      },
    });
    // The resolved epilogue runs last, once every artifact of this stage is
    // durable. It is spoken after the work, not a second attempt: the
    // author's words for what they want but do not grade, so it must not be
    // able to delay or disturb the accepted result, and its failure must
    // never fail a stage that already passed. An interrupt here leaves the
    // accepted stage exactly as written.
    if (epilogue !== undefined && acceptedWorker.continuation !== undefined) {
      const epilogueObservations: WorkflowObservation[] = [];
      const epilogueTimeoutSeconds = node.stage.timeout;
      const epilogueSignal = epilogueTimeoutSeconds === undefined
        ? request.signal
        : request.signal === undefined
          ? AbortSignal.timeout(epilogueTimeoutSeconds * 1000)
          : AbortSignal.any([request.signal, AbortSignal.timeout(epilogueTimeoutSeconds * 1000)]);
      yield* executeWorker({
        stage: runtimeInvocationId(invocation),
        worker: node.stage.worker,
        harness: node.stage.harness,
        prompt: epilogue,
        cwd: workspace.cwd,
        ...(epilogueSignal === undefined ? {} : { signal: epilogueSignal }),
        ...(resources.systemPromptPath === undefined ? {} : { systemPromptPath: resources.systemPromptPath }),
        contextFilePaths,
        skillPaths: resources.skillPaths,
        ...(node.stage.tools === undefined ? {} : { tools: node.stage.tools }),
        ...(request.model ?? stageModel ? { model: request.model ?? stageModel } : {}),
        ...((request.thinkingLevel ?? node.stage.thinkingLevel) === undefined
          ? {}
          : { thinkingLevel: request.thinkingLevel ?? node.stage.thinkingLevel }),
        sessionDir: actorSessionDirectory(request.runDir, invocation, node.stage.harness, node.stage.worker),
        ...(memoryEnabled ? { continuation: acceptedWorker.continuation } : {}),
        // The follow-up is still this actor's turn, so its output streams
        // under the same stage attribution as the accepted one.
        onEvent: collectObservation(epilogueObservations),
        ...(request.agentRunner === undefined ? {} : { agentRunner: request.agentRunner }),
      }, agentOptions).pipe(
        Effect.asVoid,
        Effect.tapError((error) => stageLog.warn("stage.epilogue.failed", {
          data: { id: runtimeInvocationId(invocation), error: failureDetails(error) },
        })),
        Effect.catchAll(() => Effect.void),
        Effect.ensuring(Effect.forEach(
          epilogueObservations,
          (observation) => workflowTrajectory.observe(attributeTrajectoryObservation(
            observation,
            acceptedWorker?.continuation ?? announcedContinuations.get(actorKey),
          )),
          { discard: true },
        )),
      );
    }
    return persistedResult;
  }).pipe(Effect.tapError((error) => {
    const cancelled = isCancellation(error);
    return (cancelled ? stageLog.info : stageLog.error)(cancelled ? "stage.cancelled" : "stage.failed", {
      outcome: cancelled ? "cancelled" : "failure",
      data: { error: failureDetails(error) },
    });
  }));
  return core.pipe(actorSemaphore.withPermits(1));
};
