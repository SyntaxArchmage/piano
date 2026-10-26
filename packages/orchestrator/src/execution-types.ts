// The shapes shared across the workflow executor: what one stage invocation
// produces (and what the scope walker consumes), and the internal state a
// running execution keeps about its actors.
//
// Type-only module: extracted verbatim from workflow-execution.ts so the
// eventual stage-runner and scope-walker extractions import one substrate
// instead of each other.

import type { AgentContinuation, ThinkingLevel } from "@piano/harness";
import type {
  CompiledWorkerContract,
  ContractMetric,
  ContractProjection,
  ContractProjectionDeclaration,
  WorkerContractValidationError,
} from "@piano/contract";
import type { AcceptedInvocation, StageValidationWarning } from "./acceptance.js";
import type { WorkflowHarness, WorkflowStage } from "./workflow.js";
import type { WorkerResources } from "./workflow-file.js";
import type { WorkflowRuntimeInvocation } from "./workflow-runtime.js";
import type { WorkflowWorkspaceBinding } from "./workspace.js";

export interface WorkflowStageExecutionResult {
  /** Concrete runtime invocation id, e.g. `tune.implement@tune/iter-1`. */
  readonly id: string;
  /** Static dotted stage identity from the compiled workflow. */
  readonly stageId: string;
  readonly instanceId?: string;
  readonly stage: string;
  readonly worker: string;
  readonly text: string;
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly requestedModel?: string;
  readonly requestedThinkingLevel?: ThinkingLevel;
  readonly model?: string;
  readonly thinkingLevel?: ThinkingLevel;
  readonly attempts: number;
  /** The concrete workspace used by this invocation. Map-slot paths are
   * preserved so downstream input consumers can locate candidate artifacts. */
  readonly workspace: WorkflowWorkspaceBinding;
  readonly resultPath?: string;
  readonly resultPayload?: unknown;
  /** Piano-normalized outputs projected from a worker-owned contract. */
  readonly metrics?: readonly ContractMetric[];
  /** Contract-declared values available to downstream workflow consumers. */
  readonly projections?: readonly ContractProjection[];
  /** Set when the worker's result failed its contract even after the one
   * repair turn. The stage is still accepted: the worker's text and session
   * stand, but consumers are told the result could not be validated. */
  readonly validationWarning?: StageValidationWarning;
}

export interface InternalStageResult extends WorkflowStageExecutionResult {
  readonly acceptance: AcceptedInvocation;
  /** The note the reviewer left when they continued past this stage, if any.
   *
   * Deliberately **not** part of `WorkflowStageExecutionResult`, and
   * deliberately not written into the acceptance record: the acceptance is the
   * worker's immutable evidence, and `stagePrompt` tells every consumer that
   * upstream evidence files are immutable. A human's instruction is
   * an input to the next prompt, not a finding to be cited as evidence, so it
   * rides the internal result the same way `acceptance` does and reaches
   * exactly one place: the prompt of the stages that consume this one. */
  readonly reviewNote?: string;
}

/** One upstream result that reached this stage with a validation warning,
 * attributed so the prompt can say which stage and worker produced it. */
export interface UpstreamValidationWarning {
  readonly stageId: string;
  readonly worker: string;
  readonly contractPath?: string;
  readonly message: string;
}

/** A reviewer note that reached this stage from one of its direct upstream
 * stages, kept attributed so the prompt can say which stage it was written
 * about. */
export interface StageReviewNote {
  readonly stageId: string;
  readonly note: string;
}

/** Set when an attempt is a human sign-off retry rather than the stage's first
 * run. The presence of the object is what tells the worker it is being asked
 * again; `note` carries the reviewer's own words when there are any. */
export interface SignoffRetry {
  readonly note?: string;
}

export interface ActorState {
  readonly turns: number;
  readonly continuation?: AgentContinuation;
  readonly harness?: string;
  readonly sessionId?: string;
  readonly transcriptPath?: string;
}

export interface ActorExecutionContext {
  readonly actorKey: string;
  readonly invocation: WorkflowRuntimeInvocation;
  readonly worker: string;
  readonly harness: WorkflowHarness;
  readonly workspaceKey: string;
  readonly memory: boolean;
  readonly resources: WorkerResources;
  readonly contextFilePaths: readonly string[];
  readonly tools?: WorkflowStage["tools"];
  readonly model?: string;
  readonly thinkingLevel?: ThinkingLevel;
  readonly timeout?: number;
}

export interface ResolvedStageValidation {
  readonly id: string;
  readonly guidance: string;
  readonly projectionDeclarations: readonly ContractProjectionDeclaration[];
  readonly contract: CompiledWorkerContract;
  /** The run-local copy injected as worker context. */
  readonly snapshotPath: string;
}

export interface ValidatedStagePayload {
  readonly value: unknown;
  readonly metrics: readonly ContractMetric[];
  readonly projections: readonly ContractProjection[];
}

export type StagePayloadValidationResult =
  | { readonly success: true; readonly payload: ValidatedStagePayload }
  | {
    readonly success: false;
    readonly error: WorkerContractValidationError;
  };
