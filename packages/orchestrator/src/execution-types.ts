// The shapes shared across the workflow executor: what one stage invocation
// produces (and what the scope walker and consolidation consume), and the
// internal state a running execution keeps about its actors.
//
// Type-only module: extracted verbatim from workflow-execution.ts so the
// eventual stage-runner and scope-walker extractions import one substrate
// instead of each other.

import type { AgentContinuation, ThinkingLevel } from "@piano/harness";
import type {
  CompiledWorkerContract,
  ContractMetric,
  ContractName,
  ContractProjection,
  ContractProjectionDeclaration,
  ContractValidationError,
  WorkerContractValidationError,
} from "@piano/contract";
import type { HandoffProducer } from "./handoff.js";
import type { WorkerContractReference } from "./contract-snapshot.js";
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
   * preserved so downstream handoff consumers can locate candidate artifacts. */
  readonly workspace: WorkflowWorkspaceBinding;
  readonly resultPath?: string;
  readonly resultPayload?: unknown;
  /** Piano-normalized outputs projected from a worker-owned contract. */
  readonly metrics?: readonly ContractMetric[];
  /** Contract-declared values available to downstream workflow consumers. */
  readonly projections?: readonly ContractProjection[];
  readonly contract?: WorkerContractReference;
  readonly handoffRecordPath: string;
  readonly progressRecordPath?: string;
}

export interface InternalStageResult extends WorkflowStageExecutionResult {
  readonly handoff: HandoffProducer;
  /** The note the reviewer left when they continued past this stage, if any.
   *
   * Deliberately **not** part of `WorkflowStageExecutionResult`, and
   * deliberately not written into the handoff record: the handoff is the
   * worker's immutable evidence, and `stagePrompt` tells every consumer that
   * "handoff files are immutable upstream evidence". A human's instruction is
   * an input to the next prompt, not a finding to be cited as evidence, so it
   * rides the internal result the same way `handoff` does and reaches exactly
   * one place: the prompt of the stages that consume this one. */
  readonly reviewNote?: string;
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

export type ResolvedStageValidation =
  | {
    readonly kind: "legacy";
    readonly id: ContractName;
    readonly guidance: string;
    readonly projectionDeclarations: readonly ContractProjectionDeclaration[];
  }
  | {
    readonly kind: "worker";
    readonly id: string;
    readonly guidance: string;
    readonly projectionDeclarations: readonly ContractProjectionDeclaration[];
    readonly contract: CompiledWorkerContract;
    readonly reference: WorkerContractReference;
  };

export interface ValidatedStagePayload {
  readonly value: unknown;
  readonly metrics: readonly ContractMetric[];
  readonly projections: readonly ContractProjection[];
}

export type StagePayloadValidationResult =
  | { readonly success: true; readonly payload: ValidatedStagePayload }
  | {
    readonly success: false;
    readonly error: ContractValidationError | WorkerContractValidationError;
  };
