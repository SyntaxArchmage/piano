import { FileSystem } from "@effect/platform";
import { Duration, Effect, Either, Exit } from "effect";
import { createHash, randomUUID } from "node:crypto";
import {
  failureDetails,
  isCancellation,
  logger,
  TRACE,
  type Logging,
  type Source,
} from "@piano/logging";
import {
  abortableSleep,
  failedAttemptContinuation,
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
  type ContractMetric,
  validateContract,
  validateWorkerContract,
  validationGuidance,
  workerContractGuidance,
  projectContractProjections,
  ContractValidationError,
  WorkerContractValidationError,
  isUnsafeWorkspaceRelativePath,
  type ContractName,
  type ContractProjection,
} from "@piano/contract";
import {
  legacyContractProjectionDeclarations,
  projectLegacyContractProjections,
} from "./legacy-contract-projections.js";
import {
  gpuRoundMaterializationProtocol,
  replaceProjectedValue,
} from "./gpu-round-protocol.js";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import {
  WorkflowTrajectory,
  type TokenUsage,
  type TrajectoryRecordContext,
  type WorkflowObservation,
} from "@piano/trajectory";
import {
  compileWorkflow,
  scheduleWorkflow,
  stageModelForSlot,
  type CompiledWorkflow,
  type WorkflowHarness,
  type WorkflowRegionPlan,
  type WorkflowRetry,
} from "./workflow.js";
import {
  loadDefaultWorkflow,
  loadWorkflow,
  resolveWorkerResources,
  workerResourcesKey,
  type LoadedWorkflow,
} from "./workflow-file.js";
import { errorMessage, WorkflowError, workflowError } from "./errors.js";
import { installStagingFile, writeFileAtomic } from "./atomic-write.js";
import { pathWithin } from "./path-within.js";
import {
  formatBenchmarkIdentity,
  materializedMetricCompatibilityAliases,
  normalizeDurableMetricCompatibility,
  parseBenchmarkIdentity,
} from "./stage-metrics.js";
import type {
  ActorExecutionContext,
  ActorState,
  InternalStageResult,
  ResolvedStageValidation,
  SignoffRetry,
  StagePayloadValidationResult,
  StageReviewNote,
  ValidatedStagePayload,
  WorkflowStageExecutionResult,
} from "./execution-types.js";
export type { WorkflowStageExecutionResult } from "./execution-types.js";
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
  validationResultPath,
  workflowActorKey,
  type WorkflowRuntimeFrame,
  type WorkflowRuntimeInvocation,
  type WorkflowRuntimeNode,
} from "./workflow-runtime.js";
import {
  readHandoffRecord,
  writeHandoffContext,
  writeHandoffRecord,
  writeMapItemContext,
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
  appendWorkflowProgress,
  finalizeWorkflowProgress,
  initializeWorkflowProgress,
  markWorkflowStageStarted,
  workflowProgressPath,
  workflowProgressSnapshotPath,
  type WorkflowProgressPlan,
  type WorkflowProgressProjection,
  type WorkflowProgressStageCount,
} from "./progress.js";
import {
  snapshotWorkerContract,
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

/** One initial attempt and one resumed repair turn. A stage that declares
 * `retry` keeps its own budget on top of this, without changing handoff or
 * session semantics. */
export const VALIDATE_REPAIR_ATTEMPTS = 1;

/** Retry waits for a stage that opted in with `retry: {}`. Deliberately much
 * longer than the harness's own `AGENT_RETRY_DELAYS_MS` (5s, 20s): by the time
 * an error reaches this layer, the harness has already spent those retries and
 * the engine has already spent its repair turn, so what is left is the
 * persistent failure. The point of the wait is to outlast a provider incident,
 * not to paper over a blip. */
export const RETRY_DEFAULT_BACKOFF_SECONDS = 30;
export const RETRY_DEFAULT_BACKOFF_MAX_SECONDS = 900;
/** Bound on the exponential factor. Without it a long unattended run reaches
 * `Infinity` and the cap stops applying exactly when it matters most. */
const RETRY_MAX_EXPONENT = 16;

/** How long to wait before retry number `retries + 1`, or `undefined` when the
 * policy allows no further retry. `retries` counts retries already performed,
 * so the first one waits `backoff` seconds.
 *
 * Pure, so the schedule is testable without waiting for it — which matters
 * because the whole point of the policy is that it can outlast a person's
 * patience. */
export function retryBackoffSeconds(
  retry: WorkflowRetry | undefined,
  retries: number,
): number | undefined {
  if (retry === undefined) return undefined;
  const attempts = retry.attempts ?? "unbounded";
  if (attempts !== "unbounded" && retries >= attempts) return undefined;
  const base = retry.backoff ?? RETRY_DEFAULT_BACKOFF_SECONDS;
  const cap = retry.backoffMax ?? RETRY_DEFAULT_BACKOFF_MAX_SECONDS;
  return Math.min(base * 2 ** Math.min(retries, RETRY_MAX_EXPONENT), cap);
}

/** Announce and perform one retry wait, returning the waited milliseconds or
 * `undefined` when there is no retry to make — the caller then fails with the
 * error it already holds.
 *
 * A wait ends early when the run is cancelled, and an interrupted wait *is* the
 * cancellation: converting a user's Escape into "retryable failure" would
 * leave a run that cannot be stopped. */
function scheduleStageRetry(
  stageId: string,
  retry: WorkflowRetry | undefined,
  retries: number,
  reason: unknown,
  signal: AbortSignal | undefined,
): Effect.Effect<number | undefined, never, FileSystem.FileSystem | Logging> {
  const seconds = retryBackoffSeconds(retry, retries);
  if (seconds === undefined) return Effect.succeed(undefined);
  const declared = retry?.attempts;
  const delayMs = seconds * 1000;
  return Effect.gen(function* () {
    yield* WORKFLOW_LOG.warn("stage.retry.scheduled", {
      outcome: "failure",
      data: {
        id: stageId,
        retry: retries + 1,
        nextAttempt: retries + 2,
        delayMs,
        ...(declared === undefined || declared === "unbounded"
          ? { unbounded: true }
          : { remainingRetries: declared - retries - 1 }),
        reason,
      },
    }).pipe(Effect.catchAll(() => Effect.void));
    yield* abortableSleep<never>(delayMs, signal, () => Effect.interrupt);
    return delayMs;
  });
}

const LOAD_SOURCE: Source = {
  module: "orchestrator",
  file: "workflow-file.ts",
  function: "loadDefaultWorkflow",
};
const EXPLICIT_LOAD_SOURCE: Source = {
  ...LOAD_SOURCE,
  function: "loadWorkflow",
};
const COMPILE_SOURCE: Source = {
  module: "orchestrator",
  file: "workflow.ts",
  function: "compileWorkflow",
};
const SCHEDULE_SOURCE: Source = {
  module: "orchestrator",
  file: "workflow.ts",
  function: "scheduleWorkflow",
};
const WORKER_SOURCE: Source = {
  module: "workers",
  file: "worker.ts",
  function: "executeWorker",
};
const WORKFLOW_SOURCE: Source = {
  module: "orchestrator",
  file: "workflow-execution.ts",
  function: "executeWorkflow",
};
const VALIDATE_SOURCE: Source = {
  module: "orchestrator",
  file: "workflow-execution.ts",
  function: "validateStageResult",
};
const WORKFLOW_LOG = logger(WORKFLOW_SOURCE, { namespace: "workflow" });
const WORKER_LOG = logger(WORKER_SOURCE, { namespace: "workflow" });




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






/** One validation boundary shared by the initial worker result and every
 * orchestrator-materialized replacement. This prevents accepted evidence from
 * drifting away from the exact legacy or worker-owned contract that admitted
 * it in the first place. */
function validateStagePayload(
  validation: ResolvedStageValidation,
  payload: unknown,
): StagePayloadValidationResult {
  if (validation.kind === "legacy") {
    const result = validateContract(validation.id, payload);
    if (!result.success) return result;
    try {
      return {
        success: true,
        payload: {
          value: result.value,
          metrics: [],
          projections: projectLegacyContractProjections(validation.id, result.value),
        },
      };
    } catch (cause) {
      return {
        success: false,
        error: new ContractValidationError({
          contract: validation.id,
          message: errorMessage(cause),
        }),
      };
    }
  }
  const result = validateWorkerContract(validation.contract, payload);
  return result.success
    ? {
      success: true,
      payload: {
        value: result.value,
        metrics: result.metrics,
        projections: result.projections,
      },
    }
    : result;
}

function usageNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizedUsage(event: Extract<AgentEvent, { readonly type: "usage" }>): TokenUsage {
  const input = usageNumber(event.usage.input);
  const output = usageNumber(event.usage.output);
  const cacheRead = usageNumber(event.usage.cacheRead);
  const cacheWrite = usageNumber(event.usage.cacheWrite);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: event.usage.totalTokens === undefined
      ? input + output + cacheRead + cacheWrite
      : usageNumber(event.usage.totalTokens),
  };
}

function trajectoryAgentObservation(
  event: AgentEvent,
  context: TrajectoryRecordContext,
): WorkflowObservation | undefined {
  const monotonicMs = performance.now();
  if (event.type === "usage") {
    return { type: "token_usage", context, usage: normalizedUsage(event) };
  }
  if (event.type === "tool_execution_start") {
    return {
      type: "tool_call_started",
      context,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      monotonicMs,
    };
  }
  if (event.type === "tool_execution_end") {
    return {
      type: "tool_call_finished",
      context,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      isError: event.isError,
      monotonicMs,
    };
  }
  return undefined;
}

function attributeTrajectoryObservation(
  observation: WorkflowObservation,
  worker: { readonly sessionId: string; readonly transcriptPath: string } | undefined,
): WorkflowObservation {
  if (worker === undefined || !("context" in observation)) return observation;
  return { ...observation, context: { ...observation.context, sessionId: worker.sessionId, transcriptPath: worker.transcriptPath } };
}

function wholeWorkflowTask(userPrompt: string): readonly string[] {
  return ["## User task (whole workflow)", userPrompt, ""];
}

function stagePrompt(
  userPrompt: string,
  invocation: WorkflowRuntimeInvocation,
  workspace: WorkflowWorkspaceBinding,
  contextFilePaths: readonly string[],
  validation: ResolvedStageValidation | undefined,
  resultPath: string | undefined,
  repairError: string | undefined,
  signoffRetry: SignoffRetry | undefined,
  reviewNotes: readonly StageReviewNote[],
  model: string | undefined,
  thinkingLevel: ThinkingLevel | undefined,
  prologue: string | undefined,
): string {
  const lines = [
    ...wholeWorkflowTask(userPrompt),
    "## Workflow stage context",
    "The user task above is the complete task for the whole workflow. Use this stage only to advance that task.",
    "Do not replace, broaden, or reinterpret it as a repository review, an autonomous development loop, or duration-based work session unless the user explicitly asks for that.",
    "Repository instruction files constrain how you execute the task; they do not replace or broaden it.",
    `You are executing workflow stage \`${invocation.stageId}\` (${runtimeInvocationId(invocation)}).`,
    `Your current workspace is \`${workspace.cwd}\`.`,
    "Treat that directory as the only mutable task workspace. Do not edit the Piano source tree or run evidence outside it.",
    "The orchestrator injected the following context files; read them before acting:",
    ...(contextFilePaths.length === 0 ? ["(none)"] : contextFilePaths.map((path) => `- ${path}`)),
    "Handoff files are immutable upstream evidence; write new artifacts only in the current workspace or the requested result path.",
  ];
  // Guidance a human wrote when they let an upstream stage continue. It sits
  // after the guard rails above on purpose: it is authority from the same human
  // who owns the task, but it refines the task rather than replacing it, and
  // the wording says so instead of leaving each worker to guess.
  if (reviewNotes.length > 0) {
    lines.push(
      "",
      "## Reviewer guidance",
      "A human reviewer reviewed the stage(s) below before letting the workflow continue, and left this guidance for the work that follows.",
      "Treat it as part of the task above. It never replaces, broadens or reinterprets that task.",
      ...reviewNotes.map((review) => `- after \`${review.stageId}\`: ${review.note}`),
    );
  }
  if (model !== undefined || thinkingLevel !== undefined) {
    lines.push(
      "",
      "## Agent configuration",
      ...(model === undefined ? [] : [`Model: \`${model}\``]),
      ...(thinkingLevel === undefined ? [] : [`Thinking level: \`${thinkingLevel}\``]),
    );
  }
  if (validation !== undefined && resultPath !== undefined) {
    lines.push(
      "",
      "## Required validation result",
      `Before finishing, write valid JSON for contract \`${validation.id}\` to:`,
      resultPath,
      "Use this accepted JSON shape (replace example values with real evidence):",
      validation.guidance,
      "Create parent directories if needed. This is a stage result artifact, not a handoff file.",
    );
  }
  if (repairError !== undefined) {
    lines.push(
      "",
      "## Validation repair required",
      "Your previous turn exited, but the orchestrator rejected its result.",
      `Reason: ${repairError}`,
      "Fix the work and write the required result at the path above. Do not start a different task.",
    );
  }
  if (signoffRetry !== undefined) {
    lines.push(
      "",
      "## Sign-off retry",
      "A human reviewer looked at your finished result for this stage and sent it back for another attempt instead of accepting it.",
      ...(signoffRetry.note === undefined
        ? ["No further detail was given: re-examine your previous work critically and improve it."]
        : [`Reviewer note: ${signoffRetry.note}`]),
      "Address that in this turn. If a required result path is listed above, rewrite it there; this is still the same task, not a new one.",
    );
  }
  // The resolved prologue is appended last so it is the final instruction the
  // worker reads before it starts. It is plain prompt text from the workflow
  // (or the worker plugin's default): the author's words, not the worker's
  // work, so it grants no authority and every guard above still applies to it.
  if (prologue !== undefined) {
    lines.push("", "## Prologue", prologue);
  }
  return lines.join("\n");
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

/** Read and validate one attempt's result payload. The validator is a named
 * schema-level success criterion; domain outcomes inside a valid report remain
 * explicit data for downstream stages rather than hidden orchestration rules. */
function validateStageResult(
  validation: ResolvedStageValidation,
  resultPath: string,
  invocationId: string,
): Effect.Effect<ValidatedStagePayload, ContractValidationError | WorkerContractValidationError, FileSystem.FileSystem | Logging> {
  return TRACE(VALIDATE_SOURCE, Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem.readFileString(resultPath).pipe(
      Effect.mapError(() => new ContractValidationError({
        contract: validation.id,
        message: `validation result missing: expected "${resultPath}"`,
      })),
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return yield* Effect.fail(new ContractValidationError({
        contract: validation.id,
        message: `validation result is not valid JSON: ${errorMessage(error)}`,
      }));
    }
    const result = validateStagePayload(validation, parsed);
    if (!result.success) return yield* Effect.fail(result.error);
    return result.payload;
  }), { validate: validation.id, resultPath, invocationId });
}

function ensureResultDirectory(
  resultPath: string,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(dirname(resultPath), { recursive: true }).pipe(
      Effect.mapError((cause) => workflowError("schedule", resultPath, String(cause))),
    );
  });
}

function workspaceArtifactPath(
  workspace: WorkflowWorkspaceBinding,
  value: unknown,
  label: string,
  sourcePath: string,
): Effect.Effect<string, WorkflowError> {
  if (typeof value !== "string" || value.trim() === "") {
    return Effect.fail(workflowError("schedule", sourcePath, `${label} must be a non-empty artifact path`));
  }
  // Artifact references are a portable protocol, even when the current host
  // is POSIX. Do not let Windows-looking separators or drive prefixes become
  // ordinary POSIX filenames here; generic workspace filenames retain their
  // native platform semantics elsewhere.
  if (value.includes("\\") || /^[A-Za-z]:/u.test(value)) {
    return Effect.fail(workflowError(
      "schedule",
      sourcePath,
      `${label} must be a safe workspace-relative artifact path`,
    ));
  }
  if (isUnsafeWorkspaceRelativePath(value)) {
    return Effect.fail(workflowError(
      "schedule",
      sourcePath,
      `${label} must be a safe workspace-relative artifact path`,
    ));
  }
  const candidate = resolve(workspace.cwd, value);
  const rel = relative(resolve(workspace.cwd), candidate);
  if (rel === "" || rel === "." || rel.startsWith("..") || isAbsolute(rel)) {
    return Effect.fail(workflowError("schedule", sourcePath, `${label} must stay inside workspace ${workspace.cwd}`));
  }
  return Effect.succeed(candidate);
}

interface PreflightPath {
  readonly path: string;
  /** Canonical identity used for alias rejection. For an absent target this
   * is the canonicalized nearest-existing-parent plus the remaining suffix. */
  readonly identity: string;
  readonly relativeRef: string;
}

function isNotFoundFileSystemError(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null &&
    (((cause as { readonly reason?: unknown }).reason === "NotFound") ||
      ((cause as { readonly code?: unknown }).code === "ENOENT"));
}

function isNotLinkFileSystemError(cause: unknown): boolean {
  return isNotFoundFileSystemError(cause) ||
    (typeof cause === "object" && cause !== null &&
      ((cause as { readonly description?: unknown }).description === "EINVAL" ||
        String((cause as { readonly message?: unknown }).message ?? "").includes("EINVAL")));
}

/** Validate a write target against a real filesystem boundary. This checks
 * every existing path component without following symlinks, then checks the
 * realpath of either the target or its nearest existing ancestor. */
function preflightWritePath(
  fileSystem: FileSystem.FileSystem,
  root: string,
  target: string,
  label: string,
): Effect.Effect<PreflightPath, WorkflowError> {
  return Effect.gen(function* () {
    const rootPath = resolve(root);
    const targetPath = resolve(target);
    if (!pathWithin(rootPath, targetPath, false)) {
      return yield* Effect.fail(workflowError("schedule", targetPath, `${label} must stay inside ${rootPath}`));
    }
    const rootRealPath = yield* fileSystem.realPath(rootPath).pipe(
      Effect.mapError((cause) => workflowError("schedule", rootPath, `${label} boundary is not readable: ${errorMessage(cause)}`)),
    );
    let component = rootPath;
    const components = relative(rootPath, targetPath).split(sep).filter(Boolean);
    for (const part of components) {
      component = join(component, part);
      const link = yield* Effect.either(fileSystem.readLink(component));
      if (Either.isRight(link)) {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} may not use a symbolic-link component: ${component}`));
      }
      if (!isNotLinkFileSystemError(link.left)) {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} path inspection failed at ${component}: ${errorMessage(link.left)}`));
      }
      const componentStat = yield* Effect.either(fileSystem.stat(component));
      if (Either.isLeft(componentStat) && !isNotFoundFileSystemError(componentStat.left)) {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} path inspection failed at ${component}: ${errorMessage(componentStat.left)}`));
      }
      if (Either.isRight(componentStat) && componentStat.right.type === "SymbolicLink") {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} may not target a symbolic link: ${component}`));
      }
    }

    const targetStat = yield* Effect.either(fileSystem.stat(targetPath));
    let identity: string;
    if (Either.isRight(targetStat)) {
      if (targetStat.right.type !== "File") {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} must be a regular file, got ${targetStat.right.type}`));
      }
      const targetRealPath = yield* fileSystem.realPath(targetPath).pipe(
        Effect.mapError((cause) => workflowError("schedule", targetPath, `${label} realpath check failed: ${errorMessage(cause)}`)),
      );
      if (!pathWithin(rootRealPath, targetRealPath, false)) {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} resolves outside ${rootRealPath}`));
      }
      identity = targetRealPath;
    } else {
      if (!isNotFoundFileSystemError(targetStat.left)) {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} target inspection failed: ${errorMessage(targetStat.left)}`));
      }
      let ancestor = dirname(targetPath);
      let ancestorRealPath: string | undefined;
      while (pathWithin(rootPath, ancestor, false) || resolve(ancestor) === rootPath) {
        const ancestorStat = yield* Effect.either(fileSystem.stat(ancestor));
        if (Either.isRight(ancestorStat)) {
          if (ancestorStat.right.type !== "Directory") {
            return yield* Effect.fail(workflowError("schedule", targetPath, `${label} parent ${ancestor} is not a directory`));
          }
          ancestorRealPath = yield* fileSystem.realPath(ancestor).pipe(
            Effect.mapError((cause) => workflowError("schedule", ancestor, `${label} ancestor realpath check failed: ${errorMessage(cause)}`)),
          );
          break;
        }
        if (!isNotFoundFileSystemError(ancestorStat.left)) {
          return yield* Effect.fail(workflowError("schedule", targetPath, `${label} ancestor inspection failed at ${ancestor}: ${errorMessage(ancestorStat.left)}`));
        }
        const parent = dirname(ancestor);
        if (parent === ancestor) break;
        ancestor = parent;
      }
      if (ancestorRealPath === undefined || !pathWithin(rootRealPath, ancestorRealPath, false) && resolve(ancestorRealPath) !== resolve(rootRealPath)) {
        return yield* Effect.fail(workflowError("schedule", targetPath, `${label} nearest existing ancestor escapes ${rootRealPath}`));
      }
      identity = resolve(ancestorRealPath ?? rootRealPath, relative(ancestor, targetPath));
    }
    return {
      path: targetPath,
      identity,
      relativeRef: relative(rootPath, targetPath),
    };
  });
}

function rejectPathAliases(
  paths: readonly { readonly label: string; readonly value: PreflightPath }[],
  sourcePath: string,
): Effect.Effect<void, WorkflowError> {
  for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
      const left = paths[leftIndex]!;
      const right = paths[rightIndex]!;
      const leftIdentity = resolve(left.value.identity);
      const rightIdentity = resolve(right.value.identity);
      const identitiesOverlap = leftIdentity === rightIdentity ||
        pathWithin(leftIdentity, rightIdentity, false) ||
        pathWithin(rightIdentity, leftIdentity, false);
      if (identitiesOverlap) {
        return Effect.fail(workflowError(
          "schedule",
          sourcePath,
          `GPU materialization rejects aliased paths: ${left.label} and ${right.label}`,
        ));
      }
    }
  }
  return Effect.succeed(undefined);
}

function sha256Bytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function writeJsonAtomicWorkflow(
  path: string,
  value: unknown,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, {
    // A random, exclusive sibling avoids following a pre-created predictable
    // temp symlink. The preflight checks below still cannot close an OS-level
    // same-UID concurrent replacement race; use an OS sandbox/openat boundary
    // or a different UID when that threat model matters.
    temporaryPath: () => join(dirname(path), `.${basename(path)}.piano-${randomUUID()}.tmp`),
    mapError: (cause) => workflowError("schedule", path, errorMessage(cause)),
    exclusiveStaging: true,
    installWithBackup: true,
  });
}

function writeBytesAtomicWorkflow(
  path: string,
  value: Uint8Array,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return writeFileAtomic(path, value, {
    temporaryPath: () => join(dirname(path), `.${basename(path)}.piano-${randomUUID()}.tmp`),
    mapError: (cause) => workflowError("schedule", path, errorMessage(cause)),
    exclusiveStaging: true,
    installWithBackup: true,
  });
}

interface FileSnapshot {
  readonly path: string;
  readonly existed: boolean;
  readonly type?: FileSystem.File.Type;
  readonly mode?: number;
  readonly bytes?: Uint8Array;
}

function snapshotMaterializationFile(
  fileSystem: FileSystem.FileSystem,
  path: string,
): Effect.Effect<FileSnapshot, WorkflowError> {
  return Effect.gen(function* () {
    const link = yield* Effect.either(fileSystem.readLink(path));
    if (Either.isRight(link)) {
      return yield* Effect.fail(workflowError("schedule", path, "materialization snapshot refuses a symbolic link"));
    }
    if (!isNotLinkFileSystemError(link.left)) {
      return yield* Effect.fail(workflowError("schedule", path, `materialization snapshot link check failed: ${errorMessage(link.left)}`));
    }
    const stat = yield* Effect.either(fileSystem.stat(path));
    if (Either.isLeft(stat)) {
      if (isNotFoundFileSystemError(stat.left)) return { path, existed: false };
      return yield* Effect.fail(workflowError("schedule", path, `materialization snapshot failed: ${errorMessage(stat.left)}`));
    }
    if (stat.right.type !== "File") {
      return yield* Effect.fail(workflowError("schedule", path, `materialization snapshot requires a regular file, got ${stat.right.type}`));
    }
    const bytes = yield* fileSystem.readFile(path).pipe(
      Effect.mapError((cause) => workflowError("schedule", path, `materialization snapshot read failed: ${errorMessage(cause)}`)),
    );
    return {
      path,
      existed: true,
      type: stat.right.type,
      mode: stat.right.mode,
      bytes: new Uint8Array(bytes),
    };
  });
}

function restoreMaterializationFile(
  fileSystem: FileSystem.FileSystem,
  snapshot: FileSnapshot,
): Effect.Effect<void, WorkflowError> {
  return Effect.gen(function* () {
    if (!snapshot.existed) {
      const link = yield* Effect.either(fileSystem.readLink(snapshot.path));
      if (Either.isRight(link)) {
        yield* fileSystem.remove(snapshot.path).pipe(
          Effect.mapError((cause) => workflowError("schedule", snapshot.path, `materialization rollback remove failed: ${errorMessage(cause)}`)),
        );
      } else {
        if (!isNotLinkFileSystemError(link.left)) {
          return yield* Effect.fail(workflowError("schedule", snapshot.path, `materialization rollback link check failed: ${errorMessage(link.left)}`));
        }
        const stat = yield* Effect.either(fileSystem.stat(snapshot.path));
        if (Either.isLeft(stat) && !isNotFoundFileSystemError(stat.left)) {
          return yield* Effect.fail(workflowError("schedule", snapshot.path, `materialization rollback existence check failed: ${errorMessage(stat.left)}`));
        }
        if (Either.isRight(stat)) {
          yield* fileSystem.remove(snapshot.path).pipe(
            Effect.mapError((cause) => workflowError("schedule", snapshot.path, `materialization rollback remove failed: ${errorMessage(cause)}`)),
          );
        }
      }
      return;
    }
    if (snapshot.type !== "File" || snapshot.bytes === undefined || snapshot.mode === undefined) {
      return yield* Effect.fail(workflowError("schedule", snapshot.path, "materialization rollback has an incomplete file snapshot"));
    }
    const snapshotBytes = snapshot.bytes;
    const snapshotMode = snapshot.mode;
    // Never write through the destination during rollback: another actor may
    // have replaced it with a symlink. A same-directory rename replaces the
    // directory entry itself. As above, this is not a complete defense from a
    // malicious same-UID concurrent writer without OS-level openat/sandboxing.
    const temporary = join(dirname(snapshot.path), `.${basename(snapshot.path)}.piano-rollback-${randomUUID()}.tmp`);
    yield* Effect.gen(function* () {
      yield* fileSystem.writeFile(temporary, snapshotBytes, { flag: "wx" }).pipe(
        Effect.mapError((cause) => workflowError("schedule", snapshot.path, `materialization rollback write failed: ${errorMessage(cause)}`)),
      );
      yield* fileSystem.chmod(temporary, snapshotMode).pipe(
        Effect.mapError((cause) => workflowError("schedule", snapshot.path, `materialization rollback chmod failed: ${errorMessage(cause)}`)),
      );
      yield* installStagingFile(fileSystem, temporary, snapshot.path, (cause) => workflowError("schedule", snapshot.path, errorMessage(cause))).pipe(
        Effect.mapError((cause) => workflowError("schedule", snapshot.path, `materialization rollback replace failed: ${errorMessage(cause)}`)),
      );
    }).pipe(Effect.ensuring(fileSystem.remove(temporary).pipe(Effect.ignore)));
  });
}

function materializationTransaction(
  writes: readonly { readonly path: string; readonly write: Effect.Effect<void, WorkflowError, FileSystem.FileSystem> }[],
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const uniquePaths = [...new Set(writes.map(({ path }) => path))];
    const snapshots = yield* Effect.all(uniquePaths.map((path) => snapshotMaterializationFile(fileSystem, path)));
    const attempt = yield* Effect.either(Effect.gen(function* () {
      for (const { write } of writes) yield* write;
    }));
    if (Either.isRight(attempt)) return;

    const rollback = yield* Effect.all(snapshots.map((snapshot) => Effect.either(restoreMaterializationFile(fileSystem, snapshot))));
    const rollbackErrors = rollback.flatMap((result) => Either.isLeft(result) ? [result.left.message] : []);
    const rollbackStatus = rollbackErrors.length === 0
      ? "rollback completed"
      : `rollback incomplete: ${rollbackErrors.join("; ")}`;
    return yield* Effect.fail(workflowError(
      "schedule",
      uniquePaths.join(","),
      `GPU materialization transaction failed: ${attempt.left.message}; ${rollbackStatus}`,
    ));
  });
}

interface MaterializedStagePayload {
  readonly value: unknown;
  readonly metrics: readonly ContractMetric[];
  readonly projections: readonly ContractProjection[];
  readonly applied: boolean;
}

/** The read-only half of GPU-round materialization: every check that can
 * reject the worker's output, plus the exact write batch that application
 * will commit. Built before any mutation so it can run pre-acceptance (repair
 * feedback) and again post-acceptance (crash consistency) from one source. */
interface GpuRoundInspection {
  readonly payload: unknown;
  readonly metrics: readonly ContractMetric[];
  readonly projections: readonly ContractProjection[];
  readonly writes: readonly { readonly path: string; readonly write: Effect.Effect<void, WorkflowError, FileSystem.FileSystem> }[];
}


/** Apply an already-inspected GPU round. Every rejection of worker output
 * happens inside `inspectGpuRound` — before the first write — so the attempt
 * loop can surface those errors to the worker as repair feedback instead of
 * aborting the run mid-materialization. */
function materializeGpuPromotion(
  payload: unknown,
  metrics: readonly ContractMetric[],
  projections: readonly ContractProjection[],
  validation: ResolvedStageValidation,
  stageIdentity: string,
  workspace: WorkflowWorkspaceBinding,
  sourcePath: string,
  acceptedResultPath: string | undefined,
  resultRoot: string,
): Effect.Effect<MaterializedStagePayload, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const inspection = yield* inspectGpuRound(
      payload, projections, validation, stageIdentity, workspace, sourcePath, acceptedResultPath, resultRoot,
    );
    if (inspection === undefined) return { value: payload, metrics, projections, applied: false };
    yield* materializationTransaction(inspection.writes);
    return { value: inspection.payload, metrics: inspection.metrics, projections: inspection.projections, applied: true };
  });
}

/** Materialize an explicitly declared GPU-round protocol before downstream
 * stages run. Contract projections bind semantic fields to payload pointers;
 * this core neither knows the worker nor assumes a payload layout. Returns
 * undefined when the validation declares no GPU round protocol. */
function inspectGpuRound(
  payload: unknown,
  projections: readonly ContractProjection[],
  validation: ResolvedStageValidation,
  stageIdentity: string,
  workspace: WorkflowWorkspaceBinding,
  sourcePath: string,
  acceptedResultPath: string | undefined,
  resultRoot: string,
): Effect.Effect<GpuRoundInspection | undefined, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const declarations = validation.projectionDeclarations;
    const protocol = yield* Effect.try({
      try: () => gpuRoundMaterializationProtocol(declarations, projections),
      catch: (cause) => workflowError("schedule", sourcePath, errorMessage(cause)),
    });
    if (protocol === undefined) return undefined;

    const {
      benchmark,
      candidate,
      currentBest,
      decision,
      iteration,
      promotion,
      records,
    } = protocol;
    const resultingBest = promotion.resulting_best;
    const candidatePath = yield* workspaceArtifactPath(workspace, candidate.path, "candidate.path", sourcePath);
    const workerCurrentBestPath = yield* workspaceArtifactPath(workspace, currentBest.path, "current_best.path", sourcePath);
    const workerResultingBestPath = yield* workspaceArtifactPath(workspace, resultingBest.path, "promotion.resulting_best.path", sourcePath);
    const statePath = yield* workspaceArtifactPath(workspace, records.state_path, "records.state_path", sourcePath);
    const roundPath = yield* workspaceArtifactPath(workspace, records.round_path, "records.round_path", sourcePath);
    const fileSystem = yield* FileSystem.FileSystem;
    const candidatePreflight = yield* preflightWritePath(fileSystem, workspace.cwd, candidatePath, "candidate.path");
    yield* preflightWritePath(fileSystem, workspace.cwd, workerCurrentBestPath, "current_best.path");
    yield* preflightWritePath(fileSystem, workspace.cwd, workerResultingBestPath, "promotion.resulting_best.path");
    const statePreflight = yield* preflightWritePath(fileSystem, workspace.cwd, statePath, "records.state_path");
    const roundPreflight = yield* preflightWritePath(fileSystem, workspace.cwd, roundPath, "records.round_path");
    const acceptedResultPreflight = acceptedResultPath === undefined
      ? undefined
      : yield* preflightWritePath(fileSystem, resultRoot, acceptedResultPath, "acceptedResultPath");
    // Worker current_best/resulting_best paths are validated evidence and may
    // legitimately echo the durable best. Only write destinations participate
    // in alias rejection; an alias among those destinations would make the
    // compensating transaction unable to restore independent records.
    yield* rejectPathAliases([
      { label: "candidate.path", value: candidatePreflight },
      { label: "records.state_path", value: statePreflight },
      { label: "records.round_path", value: roundPreflight },
      ...(acceptedResultPreflight === undefined ? [] : [{ label: "acceptedResultPath", value: acceptedResultPreflight }]),
    ], sourcePath);
    // The worker's current_best/resulting_best paths are evidence, not
    // authority for the promoted-source location. Read the durable state
    // before materializing the round so an agent that reports the candidate
    // path for KEEP cannot silently move the canonical source (profile stages
    // consume state.current_best.path on the next iteration).
    const stateRaw = yield* fileSystem.readFileString(statePath).pipe(
      Effect.mapError((cause) => workflowError("schedule", statePath, `round state is not readable: ${errorMessage(cause)}`)),
    );
    let state: Record<string, unknown>;
    try {
      const parsed = JSON.parse(stateRaw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("state must be an object");
      state = parsed as Record<string, unknown>;
    } catch (cause) {
      return yield* Effect.fail(workflowError("schedule", statePath, `round state is not valid JSON: ${errorMessage(cause)}`));
    }
    const durableBest = typeof state.current_best === "object" && state.current_best !== null && !Array.isArray(state.current_best)
      ? state.current_best as Record<string, unknown>
      : undefined;
    if (durableBest === undefined || typeof durableBest.path !== "string" || durableBest.path.trim() === "") {
      return yield* Effect.fail(workflowError(
        "schedule",
        statePath,
        "round state must contain a non-empty current_best.path; worker current_best.path is not a fallback",
      ));
    }
    const canonicalBestPath = yield* workspaceArtifactPath(workspace, durableBest.path, "state.current_best.path", sourcePath);
    const canonicalBestPreflight = yield* preflightWritePath(fileSystem, workspace.cwd, canonicalBestPath, "state.current_best.path");
    const canonicalBestRefPath = canonicalBestPreflight.relativeRef;
    yield* rejectPathAliases([
      { label: "candidate.path", value: candidatePreflight },
      { label: "records.state_path", value: statePreflight },
      { label: "records.round_path", value: roundPreflight },
      { label: "state.current_best.path", value: canonicalBestPreflight },
      ...(acceptedResultPreflight === undefined ? [] : [{ label: "acceptedResultPath", value: acceptedResultPreflight }]),
    ], sourcePath);
    // Tuning is non-monotonic: a candidate that does not beat the durable best
    // is a regression, not an error. The worker reports its decision, but the
    // orchestrator owns truth — a KEEP whose measured metric is worse than the
    // current best is demoted to a non-fatal DISCARD (current-best unchanged,
    // the round record preserved). Never turn a regression into a hard failure.
    const benchmarkIdentity = benchmark === undefined
      ? undefined
      : yield* Effect.try({
        try: () => parseBenchmarkIdentity(benchmark, "round benchmark"),
        catch: (cause) => workflowError("schedule", sourcePath, errorMessage(cause)),
      });
    const metricName = benchmarkIdentity?.name;
    const metricBest = typeof benchmark?.best === "number" && Number.isFinite(benchmark.best) ? benchmark.best : undefined;
    const existingBestMetric =
      typeof state.current_best === "object" && state.current_best !== null && !Array.isArray(state.current_best)
        ? state.current_best as Record<string, unknown>
        : {};
    const metricCompatibility = yield* Effect.try({
      try: () => normalizeDurableMetricCompatibility(existingBestMetric, benchmarkIdentity),
      catch: (cause) => workflowError("schedule", statePath, errorMessage(cause)),
    });
    const durableBenchmark = metricCompatibility.benchmark;
    const durableBenchmarkIdentity = durableBenchmark?.identity;
    const legacyStateUpgrade = benchmarkIdentity !== undefined && durableBenchmarkIdentity !== undefined &&
      durableBenchmarkIdentity.legacy && !benchmarkIdentity.legacy &&
      durableBenchmarkIdentity.name === benchmarkIdentity.name &&
      durableBenchmarkIdentity.direction === benchmarkIdentity.direction;
    if (benchmarkIdentity !== undefined && durableBenchmarkIdentity !== undefined &&
        !legacyStateUpgrade &&
        (benchmarkIdentity.legacy !== durableBenchmarkIdentity.legacy ||
          benchmarkIdentity.name !== durableBenchmarkIdentity.name ||
          benchmarkIdentity.unit !== durableBenchmarkIdentity.unit ||
          benchmarkIdentity.direction !== durableBenchmarkIdentity.direction)) {
      return yield* Effect.fail(workflowError(
        "schedule",
        statePath,
        `benchmark identity mismatch: round=${formatBenchmarkIdentity(benchmarkIdentity)}, durable=${formatBenchmarkIdentity(durableBenchmarkIdentity)}`,
      ));
    }
    // A legacy durable metric has no unit to compare. A modern result with the
    // same name/direction performs an explicit one-way migration and writes
    // the full identity below; it is not treated as a unit-less modern match.
    const previousMetric = metricName === undefined
      ? undefined
      : metricCompatibility.previousBest;
    const direction = benchmarkIdentity?.direction ?? "higher";
    const isRegression = metricBest !== undefined && previousMetric !== undefined &&
      (direction === "higher" ? metricBest < previousMetric : metricBest > previousMetric);
    let effectiveDecision = decision;
    if (decision === "KEEP" && isRegression) {
      effectiveDecision = "DISCARD";
    }
    const bestPath = canonicalBestPath;
    let bestDigest: string;
    let candidateDigest: string | undefined;
    let artifactWrite: { readonly path: string; readonly source: Uint8Array } | undefined;
    let materializedResultingBest: Record<string, unknown> = { path: canonicalBestRefPath };

    if (effectiveDecision === "KEEP") {
      if (promotion.promoted !== true) {
        return yield* Effect.fail(workflowError(
          "schedule",
          sourcePath,
          "round.decision KEEP requires round.promotion.promoted=true",
        ));
      }
      const candidateSource = yield* fileSystem.readFile(candidatePath).pipe(
        Effect.mapError((cause) => workflowError("schedule", candidatePath, `KEEP candidate is not readable: ${errorMessage(cause)}`)),
      );
      bestDigest = sha256Bytes(candidateSource);
      candidateDigest = bestDigest;
      if (typeof candidate.digest === "string" && candidate.digest !== bestDigest) {
        return yield* Effect.fail(workflowError(
          "schedule",
          candidatePath,
          `KEEP candidate digest mismatch: payload=${candidate.digest}, actual=${bestDigest}`,
        ));
      }
      if (typeof resultingBest.digest === "string" && resultingBest.digest !== bestDigest) {
        return yield* Effect.fail(workflowError(
          "schedule",
          bestPath,
          `KEEP resulting-best digest mismatch: payload=${resultingBest.digest}, actual=${bestDigest}`,
        ));
      }
      if (candidatePath !== canonicalBestPath) {
        artifactWrite = { path: bestPath, source: candidateSource };
      }
      materializedResultingBest = { path: canonicalBestRefPath, digest: bestDigest };
    } else {
      const currentBestSource = yield* fileSystem.readFile(canonicalBestPath).pipe(
        Effect.mapError((cause) => workflowError("schedule", canonicalBestPath, `current-best is not readable: ${errorMessage(cause)}`)),
      );
      bestDigest = sha256Bytes(currentBestSource);
      // A compile/verify failure may not leave a candidate file. When a
      // candidate exists, capture its digest before restoring it so the round
      // record remains truthful about what was discarded; current-best itself
      // is always required and authoritative.
      const candidateExists = yield* fileSystem.exists(candidatePath).pipe(
        Effect.mapError((cause) => workflowError("schedule", candidatePath, `candidate existence check failed: ${errorMessage(cause)}`)),
      );
      if (candidateExists) {
        const candidateSource = yield* fileSystem.readFile(candidatePath).pipe(
          Effect.mapError((cause) => workflowError("schedule", candidatePath, `candidate is not readable: ${errorMessage(cause)}`)),
        );
        candidateDigest = sha256Bytes(candidateSource);
        if (typeof candidate.digest === "string" && candidate.digest !== candidateDigest) {
          return yield* Effect.fail(workflowError(
            "schedule",
            candidatePath,
            `candidate digest mismatch: payload=${candidate.digest}, actual=${candidateDigest}`,
          ));
        }
      }
      if (candidatePath !== canonicalBestPath && candidateExists) {
        artifactWrite = { path: candidatePath, source: currentBestSource };
      }
      materializedResultingBest = { path: canonicalBestRefPath, digest: bestDigest };
    }

    const promotedAt = new Date().toISOString();
    const materializedCurrentBest = effectiveDecision === "KEEP"
      ? {
        ...existingBestMetric,
        path: canonicalBestRefPath,
        digest: bestDigest,
        sha256: bestDigest,
        verified: true,
        source: candidatePreflight.relativeRef,
        // The protocol has already enforced the finite, non-negative integer
        // domain shared by the legacy and canonical validators. Preserve that
        // accepted value instead of silently narrowing only durable state.
        iteration,
        promoted_at: promotedAt,
        ...(metricName === undefined || metricBest === undefined || benchmarkIdentity === undefined ? {} : {
          metric: {
            name: metricName,
            ...(benchmarkIdentity.unit === undefined ? {} : { unit: benchmarkIdentity.unit }),
            best: metricBest,
            median: benchmark?.median,
            direction: benchmarkIdentity.direction,
          },
          ...materializedMetricCompatibilityAliases(metricCompatibility, benchmarkIdentity, metricBest),
        }),
      }
      : {
        ...existingBestMetric,
        path: canonicalBestRefPath,
        digest: bestDigest,
        sha256: bestDigest,
      };
    if (state.history !== undefined && !Array.isArray(state.history)) {
      return yield* Effect.fail(workflowError(
        "schedule",
        statePath,
        "round state history must be an array when present",
      ));
    }
    const history = state.history === undefined ? [] : state.history;
    const materializedState = {
      ...state,
      current_best: materializedCurrentBest,
      history: [
        ...history,
        {
          stage: stageIdentity,
          action: effectiveDecision === "KEEP" ? "promote" : "record",
          candidate: candidatePreflight.relativeRef,
          current_best: canonicalBestRefPath,
          digest: bestDigest,
          decision: effectiveDecision,
          ...(decision !== effectiveDecision ? { demoted_from_keep: true } : {}),
          ...(candidateDigest === undefined ? {} : { candidate_digest: candidateDigest }),
          ...(metricName === undefined || metricBest === undefined || benchmarkIdentity === undefined ? {} : {
            metric: metricName,
            ...(benchmarkIdentity.unit === undefined ? {} : { unit: benchmarkIdentity.unit }),
            direction: benchmarkIdentity.direction,
            value: metricBest,
          }),
        },
      ],
    };

    const materializedCandidate = {
      path: candidatePreflight.relativeRef,
      ...(candidateDigest === undefined ? {} : { digest: candidateDigest }),
    };
    const acceptedCurrentBest = {
      path: canonicalBestRefPath,
      digest: bestDigest,
    };
    const materializedPromotion = {
      ...promotion,
      promoted: effectiveDecision === "KEEP",
      resulting_best: materializedResultingBest,
    };
    let materializedPayload = payload;
    if (decision !== effectiveDecision) {
      materializedPayload = replaceProjectedValue(materializedPayload, protocol.marker, {
        ...(protocol.marker.value as Record<string, unknown>),
        demoted_from_keep: true,
      });
    }
    materializedPayload = replaceProjectedValue(materializedPayload, protocol.decisionProjection, effectiveDecision);
    materializedPayload = replaceProjectedValue(materializedPayload, protocol.candidateProjection, materializedCandidate);
    materializedPayload = replaceProjectedValue(materializedPayload, protocol.currentBestProjection, acceptedCurrentBest);
    materializedPayload = replaceProjectedValue(materializedPayload, protocol.promotionProjection, materializedPromotion);

    const revalidated = validateStagePayload(validation, materializedPayload);
    if (!revalidated.success) {
      return yield* Effect.fail(workflowError(
        "schedule",
        sourcePath,
        `materialized result failed validator "${validation.id}": ${revalidated.error.message}`,
      ));
    }
    // Canonical contracts may normalize (notably strip) values during
    // validation, so their normalized output is the only accepted payload.
    // Deprecated named validators strip unknown object keys with Zod. Keep
    // their orchestrator-owned demotion audit marker during migration; the
    // original worker payload had already passed through that validator, so
    // this compatibility branch cannot reintroduce worker-owned unknowns.
    const acceptedMaterializedPayload = validation.kind === "legacy" && decision !== effectiveDecision
      ? materializedPayload
      : revalidated.payload.value;
    const materializedProjections = projectContractProjections(
      validation.id,
      declarations,
      acceptedMaterializedPayload,
    );
    if (materializedProjections instanceof WorkerContractValidationError) {
      return yield* Effect.fail(workflowError("schedule", sourcePath, materializedProjections.message));
    }
    const refreshedProtocol = yield* Effect.try({
      try: () => gpuRoundMaterializationProtocol(declarations, materializedProjections),
      catch: (cause) => workflowError("schedule", sourcePath, errorMessage(cause)),
    });
    if (refreshedProtocol === undefined || refreshedProtocol.decision !== effectiveDecision ||
        refreshedProtocol.currentBest.path !== canonicalBestRefPath ||
        refreshedProtocol.promotion.promoted !== (effectiveDecision === "KEEP")) {
      return yield* Effect.fail(workflowError(
        "schedule",
        sourcePath,
        "materialized GPU round projections do not match the effective result",
      ));
    }

    // All contract/projection/path checks happen before the first write. The
    // artifact, durable state, round record, and accepted result are one
    // compensating transaction so a later failure cannot leave mixed truth.
    const transactionWrites: Array<{ readonly path: string; readonly write: Effect.Effect<void, WorkflowError, FileSystem.FileSystem> }> = [];
    if (artifactWrite !== undefined) {
      transactionWrites.push({ path: artifactWrite.path, write: writeBytesAtomicWorkflow(artifactWrite.path, artifactWrite.source) });
    }
    transactionWrites.push({ path: statePath, write: writeJsonAtomicWorkflow(statePath, materializedState) });
    transactionWrites.push({ path: roundPath, write: writeJsonAtomicWorkflow(roundPath, acceptedMaterializedPayload) });
    if (acceptedResultPath !== undefined) {
      transactionWrites.push({ path: acceptedResultPath, write: writeJsonAtomicWorkflow(acceptedResultPath, acceptedMaterializedPayload) });
    }
    return {
      payload: acceptedMaterializedPayload,
      metrics: revalidated.payload.metrics,
      projections: materializedProjections,
      writes: transactionWrites,
    };
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
function resultProjectionValue(result: InternalStageResult, id: string): unknown {
  return result.projections?.find((projection) => projection.id === id)?.value;
}

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

/** Expand the statically compiled leaf table into a worker-neutral work plan.
 * Loop/map controls are part of the DSL, so a monitor can know the denominator
 * before the first model turn without inspecting a worker payload. */
function workflowProgressPlan(
  compiled: CompiledWorkflow,
  /** Effective iteration count for loops whose runtime bound is now known.
   * Duration loops grow this count from frames; a contract-requested stop
   * shrinks a fixed loop to the number of iterations actually completed. */
  loopIterations: ReadonlyMap<string, number> = new Map(),
): WorkflowProgressPlan {
  const regionsById = new Map(compiled.regions.map((region) => [region.id, region]));
  const stageCounts: Record<string, WorkflowProgressStageCount> = {};
  for (const stage of compiled.stages) {
    let planned = 1;
    for (let index = 0; index < stage.regionPath.length; index += 1) {
      const regionId = stage.regionPath.slice(0, index + 1).join(".");
      const region = regionsById.get(regionId);
      if (region === undefined) continue;
      if (region.kind === "loop") {
        const effectiveIterations = loopIterations.get(regionId);
        if (effectiveIterations !== undefined || region.duration !== undefined) {
          // `Math.max(1, …)` rather than the raw count: the current iteration is
          // the furthest one that can already hold accepted stages, so the
          // denominator stays ahead of the numerator and the snapshot validator's
          // `completed <= planned` invariant holds while the loop is open.
          planned *= Math.max(1, effectiveIterations ?? 1);
          continue;
        }
        planned *= region.iterations ?? 1;
        continue;
      }
      planned *= region.count ?? 1;
    }
    stageCounts[stage.id] = { planned, completed: 0 };
  }
  return {
    plannedStages: Object.values(stageCounts).reduce((sum, count) => sum + count.planned, 0),
    stageCounts,
  };
}

/** Build a worker-neutral progress label from the compiled graph and runtime
 * frames. Domain payloads remain untouched; monitors can use this projection
 * without knowing whether the worker is CUDA, Triton, basic, or a plugin. */
function workflowProgressProjection(
  compiled: CompiledWorkflow,
  invocation: WorkflowRuntimeInvocation,
  acceptedStages: number,
  plan: WorkflowProgressPlan,
  completedByStage: ReadonlyMap<string, number>,
  knownLoopIterations: ReadonlyMap<string, number> = new Map(),
): WorkflowProgressProjection {
  const loopFrame = invocation.frames
    .filter((frame): frame is Extract<WorkflowRuntimeFrame, { kind: "loop" }> => frame.kind === "loop")
    .at(-1);
  const mapFrame = invocation.frames
    .filter((frame): frame is Extract<WorkflowRuntimeFrame, { kind: "map" }> => frame.kind === "map")
    .at(-1);
  const innermostFrame = invocation.frames.at(-1);
  // A duration-bound loop's denominator is only knowable from the run itself,
  // so the plan is re-derived whenever this invocation sits inside one. The
  // frames carry exactly the missing input: which iteration is running now.
  const effectiveLoopIterations = new Map(knownLoopIterations);
  for (const frame of invocation.frames) {
    if (frame.kind !== "loop") continue;
    const frameRegion = compiled.regions.find((candidate) => candidate.id === frame.regionId);
    if (frameRegion?.duration !== undefined) {
      effectiveLoopIterations.set(
        frame.regionId,
        Math.max(effectiveLoopIterations.get(frame.regionId) ?? 1, frame.iteration + 1),
      );
    }
  }
  const effectivePlan = effectiveLoopIterations.size === 0
    ? plan
    : workflowProgressPlan(compiled, effectiveLoopIterations);
  const innermostRegion = innermostFrame === undefined
    ? undefined
    : compiled.regions.find((candidate) => candidate.id === innermostFrame.regionId);
  const stageIds = innermostRegion === undefined
    ? compiled.stages
      .filter((stage) => stage.regionPath.length === 0)
      .map((stage) => stage.id)
    : compiled.stages
      // Only direct leaves belong to this scope. Nested regions report their
      // own stage ordinal when they become the innermost frame.
      .filter((stage) => stage.regionPath.join(".") === innermostRegion.id)
      .map((stage) => stage.id);
  const stageIndex = stageIds.indexOf(invocation.stageId) + 1;
  const stageCount = stageIds.length;
  const stageCounts: Readonly<Record<string, WorkflowProgressStageCount>> = Object.fromEntries(
    Object.entries(effectivePlan.stageCounts).map(([stageId, count]) => [stageId, {
      planned: count.planned,
      completed: completedByStage.get(stageId) ?? 0,
    }]),
  );
  const base = {
    status: "accepted" as const,
    acceptedStages,
    completedStages: acceptedStages,
    plannedStages: effectivePlan.plannedStages,
    remainingStages: Math.max(0, effectivePlan.plannedStages - acceptedStages),
    stageCounts,
    ...(stageIndex > 0 ? { stageIndex } : {}),
    ...(stageCount > 0 ? { stageCount } : {}),
  };
  if (innermostFrame?.kind === "loop" && loopFrame !== undefined) {
    const region = compiled.regions.find((candidate) => candidate.id === loopFrame.regionId);
    const outerMap = mapFrame === undefined
      ? undefined
      : compiled.regions.find((candidate) => candidate.id === mapFrame.regionId);
    const stageIndex = stageIds.indexOf(invocation.stageId) + 1;
    const stageCount = stageIds.length;
    const iterationLabel = region?.iterations === undefined
      ? `iter-${loopFrame.iteration + 1}`
      : `iter-${loopFrame.iteration + 1}/${region.iterations}`;
    const stageLabel = stageIndex > 0 && stageCount > 0
      ? `${invocation.stageName} ${stageIndex}/${stageCount}`
      : invocation.stageName;
    return {
      ...base,
      ...(stageIndex > 0 ? { stageIndex } : {}),
      ...(stageCount > 0 ? { stageCount } : {}),
      iteration: loopFrame.iteration,
      ...(region?.iterations === undefined ? {} : { iterations: region.iterations }),
      ...(mapFrame === undefined ? {} : { mapSlot: mapFrame.slot }),
      ...(outerMap?.count === undefined ? {} : { mapSlots: outerMap.count }),
      scope: region?.name ?? loopFrame.regionId,
      hint: `${iterationLabel} · ${stageLabel} · ${acceptedStages}/${effectivePlan.plannedStages} stages completed`,
    };
  }
  if (innermostFrame?.kind === "map" && mapFrame !== undefined) {
    const region = compiled.regions.find((candidate) => candidate.id === mapFrame.regionId);
    const loopRegion = loopFrame === undefined
      ? undefined
      : compiled.regions.find((candidate) => candidate.id === loopFrame.regionId);
    const regionName = region?.name ?? mapFrame.regionId;
    const slots = region?.count;
    const stageLabel = stageIndex > 0 && stageCount > 0
      ? `${invocation.stageName} ${stageIndex}/${stageCount}`
      : invocation.stageName;
    return {
      ...base,
      mapSlot: mapFrame.slot,
      ...(slots === undefined ? {} : { mapSlots: slots }),
      ...(loopFrame === undefined ? {} : { iteration: loopFrame.iteration }),
      ...(loopRegion?.iterations === undefined ? {} : { iterations: loopRegion.iterations }),
      scope: regionName,
      hint: slots === undefined
        ? `${regionName}/slot-${mapFrame.slot + 1} · ${stageLabel} · ${acceptedStages}/${effectivePlan.plannedStages} stages completed`
        : `${regionName}/slot-${mapFrame.slot + 1}/${slots} · ${stageLabel} · ${acceptedStages}/${effectivePlan.plannedStages} stages completed`,
    };
  }
  const stageLabel = stageIndex > 0 && stageCount > 0
    ? `${invocation.stageName} ${stageIndex}/${stageCount}`
    : invocation.stageName;
  return {
    ...base,
    hint: `${stageLabel} · ${acceptedStages}/${effectivePlan.plannedStages} stages completed`,
  };
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
    let acceptedStageCount = 0;
    const completedByStage = new Map<string, number>();
    // A continue's snapshot starts where the job left off: the invocations
    // accepted in earlier spans are not re-run, so nothing would count them
    // again and the run's counts would restart from the continue instead.
    if (request.continueJob !== undefined) {
      for (const invocationId of request.continueJob.accepted) {
        acceptedStageCount += 1;
        const stageId = invocationId.split("@", 1)[0] ?? invocationId;
        completedByStage.set(stageId, (completedByStage.get(stageId) ?? 0) + 1);
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

    /** Rebuild an already-accepted invocation's result from the evidence it
     * left, so a continue can skip its worker turn. `undefined` means the
     * producer record is gone or unreadable — the caller falls through to
     * re-running the invocation, which is slower but answers in the same
     * shape. */
    const rebuildAcceptedStage = (
      runDir: string,
      invocation: WorkflowRuntimeInvocation,
      cursor: NonNullable<WorkflowExecutionRequest["continueJob"]>,
    ): Effect.Effect<InternalStageResult | undefined, WorkflowError, FileSystem.FileSystem | Logging> =>
      Effect.gen(function* () {
        const producer = yield* readHandoffRecord(runDir, invocation);
        const invocationId = runtimeInvocationId(invocation);
        if (producer === undefined) {
          yield* WORKFLOW_LOG.warn("stage.continue.evidence-missing", {
            data: { invocationId, executionId: invocation.executionId },
          }).pipe(Effect.catchAll(() => Effect.void));
          return undefined;
        }
        return {
          id: invocationId,
          stageId: invocation.stageId,
          ...(producer.instanceId === undefined ? {} : { instanceId: producer.instanceId }),
          stage: producer.stage,
          worker: producer.worker,
          text: producer.text,
          sessionId: producer.sessionId,
          transcriptPath: producer.transcriptPath,
          ...(producer.requestedModel === undefined ? {} : { requestedModel: producer.requestedModel }),
          ...(producer.requestedThinkingLevel === undefined
            ? {}
            : { requestedThinkingLevel: producer.requestedThinkingLevel as ThinkingLevel }),
          ...(producer.model === undefined ? {} : { model: producer.model }),
          ...(producer.thinkingLevel === undefined ? {} : { thinkingLevel: producer.thinkingLevel as ThinkingLevel }),
          attempts: producer.attempt ?? cursor.attempts.get(invocationId) ?? 1,
          workspace: producer.workspace,
          ...(producer.resultPath === undefined ? {} : { resultPath: producer.resultPath }),
          ...(producer.resultPayload === undefined ? {} : { resultPayload: producer.resultPayload }),
          ...(producer.metrics === undefined ? {} : { metrics: producer.metrics }),
          ...(producer.projections === undefined ? {} : { projections: producer.projections }),
          ...(producer.contract === undefined ? {} : { contract: producer.contract }),
          handoffRecordPath: producer.recordPath,
          handoff: producer,
        };
      });

    const executeStage = (
      node: Extract<WorkflowRuntimeNode, { kind: "stage" }>,
      frames: readonly WorkflowRuntimeFrame[],
      inputs: readonly InternalStageResult[],
      mapItem: HandoffMapItem | undefined,
      workspace: WorkflowWorkspaceBinding,
    ): Effect.Effect<InternalStageResult, WorkflowExecutionError, FileSystem.FileSystem | Logging> => {
      const invocation: WorkflowRuntimeInvocation = {
        executionId,
        promptIndex,
        stageId: node.id,
        stageName: node.stage.name,
        frames,
      };
      // A per-lane model list resolves to this lane's entry. The lane is the
      // innermost fan-out frame, which is the same region compile validated the
      // list against, so the index is always in range.
      const laneSlot = frames
        .filter((frame): frame is Extract<WorkflowRuntimeFrame, { kind: "map" }> => frame.kind === "map")
        .at(-1)?.slot;
      const stageModel = stageModelForSlot(node.stage.model, laneSlot);
      const actorKey = workflowActorKey(invocation, node.stage.harness, node.stage.worker);
      const memoryEnabled = node.stage.memory !== false;
      const actorSemaphore = semaphoreForActor(actorKey);
      const stageLog = WORKER_LOG.with({ stage: node.id, agent: node.stage.worker });
      const trajectoryContext = (
        attempt: number,
        worker?: { readonly sessionId: string; readonly transcriptPath: string },
      ): TrajectoryRecordContext => {
        const loopFrame = frames
          .filter((frame): frame is Extract<WorkflowRuntimeFrame, { kind: "loop" }> => frame.kind === "loop")
          .at(-1);
        const mapFrame = frames
          .filter((frame): frame is Extract<WorkflowRuntimeFrame, { kind: "map" }> => frame.kind === "map")
          .at(-1);
        return {
          version: 1,
          timestamp: new Date().toISOString(),
          executionId,
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
      const core = Effect.gen(function* () {
        const invocationId = runtimeInvocationId(invocation);
        // A continue rebuilds an already-accepted invocation from the evidence
        // it left instead of running it again — the worker turn, its
        // validation, its sign-off, and its epilogue all already happened in
        // an earlier span of this job.
        if (request.continueJob !== undefined && request.continueJob.accepted.has(invocationId)) {
          const rebuilt = yield* rebuildAcceptedStage(request.runDir, invocation, request.continueJob);
          if (rebuilt !== undefined) return rebuilt;
        }
        const previous = actors.get(actorKey);
        if (memoryEnabled && previous !== undefined && previous.turns > 0 && previous.continuation === undefined) {
          return yield* Effect.fail(workflowError(
            "schedule",
            loaded.workflowPath,
            `actor "${actorKey}" has no continuation after an earlier turn and cannot resume safely`,
          ));
        }
        const resources = loaded.workerResources?.get(workerResourcesKey(node.stage.worker, node.stage.harness)) ??
          (yield* resolveWorkerResources(
            node.stage.worker,
            loaded.recipeRepositoryRoot,
            loaded.workflowPath,
            node.stage.harness,
            { loadContract: node.stage.validate === true },
          ));
        const validation: ResolvedStageValidation | undefined = node.stage.validate === undefined
          ? undefined
          : node.stage.validate === true
            ? resources.contract === undefined
              ? yield* Effect.fail(workflowError(
                "load",
                loaded.workflowPath,
                `stage "${node.stage.name}" uses validate: true but worker "${node.stage.worker}" has no contract.json`,
              ))
              : {
                kind: "worker",
                id: resources.contract.manifest.id,
                guidance: workerContractGuidance(resources.contract),
                projectionDeclarations: resources.contract.manifest.outputs.projections,
                contract: resources.contract,
                reference: yield* snapshotWorkerContract(request.runDir, resources.contract),
              }
            : {
              kind: "legacy",
              id: node.stage.validate as ContractName,
              guidance: validationGuidance(node.stage.validate as ContractName),
              projectionDeclarations: legacyContractProjectionDeclarations(node.stage.validate),
            };
        if (validation?.kind === "legacy") {
          yield* stageLog.warn("stage.validation.legacy", {
            data: {
              id: runtimeInvocationId(invocation),
              validate: validation.id,
              message: "named validators are deprecated; use validate: true with recipes/<worker>/contract.json",
            },
          });
        }
        const handoffPath = node.stage.handoff === undefined
          ? undefined
          : yield* writeHandoffContext(
            request.runDir,
            invocation,
            node.stage.handoff,
            inputs.map((input) => input.handoff),
            workspace,
            loaded.workflowPath,
          );
        const mapItemPath = mapItem === undefined
          ? undefined
          : yield* writeMapItemContext(request.runDir, invocation, mapItem, workspace);
        const contextFilePaths = [
          ...resources.contextFilePaths,
          ...(validation?.kind === "worker" ? [validation.reference.snapshotPath] : []),
          ...(handoffPath === undefined ? [] : [handoffPath]),
          ...(mapItemPath === undefined ? [] : [mapItemPath]),
        ];
        actorContexts.set(actorKey, {
          actorKey,
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
            ...(handoffPath === undefined ? {} : { handoffPath }),
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
            ...(handoffPath === undefined ? {} : { handoffPath }),
          },
        });

        // A continue's re-run follows the attempts this job already recorded;
        // starting from one again would overwrite attempts/<n>/result.json.
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
        while (true) {
          const attemptObservations: WorkflowObservation[] = [];
          const loopFrame = frames
            .filter((frame): frame is Extract<WorkflowRuntimeFrame, { kind: "loop" }> => frame.kind === "loop")
            .at(-1);
          const mapFrame = frames
            .filter((frame): frame is Extract<WorkflowRuntimeFrame, { kind: "map" }> => frame.kind === "map")
            .at(-1);
          const mapRegion = mapFrame === undefined
            ? undefined
            : compiled.regions.find((region) => region.id === mapFrame.regionId);
          const currentScope = frames.at(-1)?.regionId;
          const instanceId = runtimeInstanceId(frames);
          // This snapshot is a convenience monitor view. A filesystem issue
          // must not hide a real worker result; the canonical stage evidence
          // and validation path remain authoritative.
          yield* progressSemaphore.withPermits(1)(markWorkflowStageStarted(request.runDir, executionId, {
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
            ...(mapFrame === undefined ? {} : { mapSlot: mapFrame.slot }),
            ...(mapRegion?.count === undefined ? {} : { mapSlots: mapRegion.count }),
            ...(currentScope === undefined ? {} : { scope: currentScope }),
            ...(repairError === undefined ? {} : { error: repairError }),
          })).pipe(Effect.catchAll(() => Effect.void));
          const resultPath = validation === undefined
            ? undefined
            : validationResultPath(request.runDir, invocation, attempt);
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
            onEvent: (event: AgentEvent) => {
              const decorated = decorateEvent(event);
              const observation = trajectoryAgentObservation(decorated, trajectoryContext(attempt));
              if (observation !== undefined) attemptObservations.push(observation);
              request.onEvent?.(decorated);
            },
            ...(request.agentRunner === undefined ? {} : { agentRunner: request.agentRunner }),
            ...(node.stage.discuss !== true || request.discuss === undefined ? {} : {
              discuss: async (question: string) => {
                const answer = (await Effect.runPromise(request.discuss!({
                  stageId: node.id,
                  invocationId: runtimeInvocationId(invocation),
                  stage: node.stage.name,
                  worker: node.stage.worker,
                  harness: node.stage.harness,
                  round: attempt,
                  transcriptPath: actors.get(actorKey)?.transcriptPath ?? "",
                  question,
                }))).answer;
                return answer;
              },
            }),
          }, workflowAgentOptions).pipe(Effect.tapError((error) => {
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
            actors.set(actorKey, {
              // The interrupted turn was not accepted: `turns` is unchanged, so
              // the resumed conversation picks up where it was paused.
              turns: actors.get(actorKey)?.turns ?? 0,
              harness: node.stage.harness,
              sessionId: announced.sessionId,
              transcriptPath: announced.transcriptPath,
              continuation: announced,
            });
            // Same serialization as the accepted-stage write; a failed state
            // write must never mask the cancellation the user triggered.
            return progressSemaphore.withPermits(1)(Effect.suspend(() => persistActors()))
              .pipe(Effect.catchAll(() => Effect.void));
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
          yield* Effect.forEach(
            attemptObservations,
            (observation) => workflowTrajectory.observe(attributeTrajectoryObservation(
              observation,
              Either.isRight(workerOutcome) ? workerOutcome.right : undefined,
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
              actors.set(actorKey, {
                // Live count: an earlier turn that completed inside this same
                // prompt (rejected or awaiting repair) already counted itself
                // durable; the stale pre-attempt `previous` must not rewind it.
                turns: actors.get(actorKey)?.turns ?? 0,
                harness: node.stage.harness,
                sessionId: resumable.sessionId,
                transcriptPath: resumable.transcriptPath,
                continuation: resumable,
              });
              // Same serialization as the accepted-stage write; a failed state
              // write must never mask the cancellation the user triggered.
              yield* progressSemaphore.withPermits(1)(Effect.suspend(() => persistActors()))
                .pipe(Effect.catchAll(() => Effect.void));
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
          actors.set(actorKey, {
            turns: (actors.get(actorKey)?.turns ?? 0) + 1,
            harness: node.stage.harness,
            sessionId: worker.sessionId,
            transcriptPath: worker.transcriptPath,
            ...(worker.continuation === undefined ? {} : { continuation: worker.continuation }),
          });
          // A completed turn is durable the moment it lands — acceptance is not
          // the save point. A sign-off *reject* means "keep working on this":
          // the workflow does not end, it reopens this same actor session with
          // the reviewer's feedback, and a validation repair does the same. A
          // later interrupt or failure in the rework must therefore never strand
          // a conversation the harness has already written: the state stream
          // carries it from here, and the accepted-stage write below stays the
          // final canonical state. A failed intermediate write never fails the
          // stage.
          yield* progressSemaphore.withPermits(1)(Effect.suspend(() => persistActors()))
            .pipe(Effect.catchAll(() => Effect.void));

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
          // digests truthful, KEEP requiring promoted=true) are others. The
          // same inspection runs again inside materializeGpuPromotion as the
          // pre-write consistency gate.
          let acceptCheck: Either.Either<ValidatedStagePayload, WorkflowExecutionError>;
          if (Either.isLeft(validationResult)) {
            acceptCheck = validationResult;
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
            () => validationResultPath(request.runDir, invocation, attempt + 1),
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
            return yield* Effect.fail(workflowError(
              "schedule",
              loaded.workflowPath,
              `actor "${actorKey}" cannot repair failed validation because its harness returned no continuation`,
            ));
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
        const requestedModel = request.model ?? stageModel;
        const requestedThinkingLevel = request.thinkingLevel ?? node.stage.thinkingLevel;
        const handoff = yield* writeHandoffRecord(request.runDir, invocation, {
          stage: node.stage.name,
          worker: node.stage.worker,
          text: acceptedWorker.text,
          sessionId: acceptedWorker.sessionId,
          transcriptPath: acceptedWorker.transcriptPath,
          attempt,
          ...(requestedModel === undefined ? {} : { requestedModel }),
          ...(requestedThinkingLevel === undefined ? {} : { requestedThinkingLevel }),
          ...(acceptedWorker.model === undefined ? {} : { model: acceptedWorker.model }),
          ...(acceptedWorker.thinkingLevel === undefined ? {} : { thinkingLevel: acceptedWorker.thinkingLevel }),
          workspace,
          ...(acceptedResultPath === undefined ? {} : { resultPath: acceptedResultPath }),
          ...(acceptedPayload === undefined ? {} : { resultPayload: acceptedPayload }),
          ...(acceptedMetrics.length === 0 ? {} : { metrics: acceptedMetrics }),
          ...(acceptedProjections.length === 0 ? {} : { projections: acceptedProjections }),
          ...(validation?.kind === "worker" ? { contract: validation.reference } : {}),
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
          ...(validation?.kind === "worker" ? { contract: validation.reference } : {}),
          handoffRecordPath: handoff.recordPath,
          handoff,
          ...(reviewNote === undefined ? {} : { reviewNote }),
        };
        const persistedProgress = yield* progressSemaphore.withPermits(1)(Effect.gen(function* () {
          // Keep the counter update and append under the same lock. Map slots
          // may finish concurrently; JSONL order and snapshot counts must not
          // jump backwards or include an unappended sibling.
          acceptedStageCount += 1;
          completedByStage.set(node.id, (completedByStage.get(node.id) ?? 0) + 1);
          const progress = workflowProgressProjection(
            compiled,
            invocation,
            acceptedStageCount,
            progressPlan,
            completedByStage,
            knownLoopIterations,
          );
          const progressPath = yield* appendWorkflowProgress(request.runDir, {
            executionId,
            invocationId: result.id,
            stageId: result.stageId,
            stage: result.stage,
            worker: result.worker,
            ...(result.instanceId === undefined ? {} : { instanceId: result.instanceId }),
            ...(() => {
              const loop = frames.find((frame): frame is Extract<WorkflowRuntimeFrame, { kind: "loop" }> => frame.kind === "loop");
              return loop === undefined ? {} : { iteration: loop.iteration };
            })(),
            attempt: result.attempts,
            workspace: result.workspace,
            actorKey,
            harness: node.stage.harness,
            sessionId: result.sessionId,
            transcriptPath: result.transcriptPath,
            ...(result.resultPath === undefined ? {} : { resultPath: result.resultPath }),
            handoffRecordPath: result.handoffRecordPath,
            ...(result.requestedModel === undefined ? {} : { requestedModel: result.requestedModel }),
            ...(result.requestedThinkingLevel === undefined ? {} : { requestedThinkingLevel: result.requestedThinkingLevel }),
            ...(result.model === undefined ? {} : { model: result.model }),
            ...(result.thinkingLevel === undefined ? {} : { thinkingLevel: result.thinkingLevel }),
            progress,
            ...(result.resultPayload === undefined ? {} : { resultPayload: result.resultPayload }),
            ...(result.projections === undefined ? {} : { projections: result.projections }),
            ...(result.contract === undefined ? {} : { contract: result.contract }),
          });
          // Write the canonical resume state file so the next prompt can
          // restore the exact actor table without scanning progress.jsonl.
          yield* persistActors();
          return { progress, progressPath };
        }));
        const { progress, progressPath } = persistedProgress;
        const loopFrame = frames.find((frame): frame is Extract<WorkflowRuntimeFrame, { kind: "loop" }> => frame.kind === "loop");
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
            ...(projectionValue(result, "benchmark.evidence") === undefined
              ? {}
              : { benchmark: projectionValue(result, "benchmark.evidence") }),
            progress,
          },
        });
        const persistedResult: InternalStageResult = { ...result, progressRecordPath: progressPath };
        yield* workflowTrajectory.observe({
          type: "stage_accepted",
          context: trajectoryContext(result.attempts, result),
          metrics: result.metrics ?? [],
          ...(result.contract === undefined ? {} : { contract: result.contract }),
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
            handoffRecordPath: result.handoffRecordPath,
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
            onEvent: (event: AgentEvent) => request.onEvent?.(decorateEvent(event)),
            ...(request.agentRunner === undefined ? {} : { agentRunner: request.agentRunner }),
          }, workflowAgentOptions).pipe(
            Effect.asVoid,
            Effect.tapError((error) => stageLog.warn("stage.epilogue.failed", {
              data: { id: runtimeInvocationId(invocation), error: failureDetails(error) },
            })),
            Effect.catchAll(() => Effect.void),
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

    function projectionValue(result: InternalStageResult, id: string): unknown {
      return resultProjectionValue(result, id);
    }

    function projectionString(result: InternalStageResult, id: string): string | undefined {
      const value = projectionValue(result, id);
      return typeof value === "string" && value !== "" ? value : undefined;
    }

    function projectionNumber(result: InternalStageResult, id: string): number | undefined {
      const value = projectionValue(result, id);
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    }

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
