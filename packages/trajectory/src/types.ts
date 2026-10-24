import type { Effect } from "effect";
import type { BenchmarkMetricV1 } from "@piano/contract";

export interface TrajectoryContractReference {
  readonly id: string;
  readonly version: 1;
  readonly digest: string;
  readonly snapshotPath: string;
}

export interface TrajectoryRecordContext {
  readonly version: 1;
  readonly timestamp: string;
  readonly runId: string;
  readonly invocationId: string;
  readonly stageId: string;
  readonly stage: string;
  readonly worker: string;
  readonly attempt: number;
  readonly iteration?: number;
  readonly instanceId?: string;
  readonly mapSlot?: number;
  readonly actorKey?: string;
  readonly sessionId?: string;
  readonly transcriptPath?: string;
}

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
}

export type StageAttemptOutcome =
  | "accepted"
  | "validation_failed"
  | "signoff_rejected"
  | "failed"
  | "cancelled";

export type WorkflowObservation =
  | {
    readonly type: "stage_attempt_started";
    readonly context: TrajectoryRecordContext;
    readonly monotonicMs: number;
  }
  | {
    readonly type: "token_usage";
    readonly context: TrajectoryRecordContext;
    readonly usage: TokenUsage;
  }
  | {
    readonly type: "tool_call_started";
    readonly context: TrajectoryRecordContext;
    readonly toolCallId: string;
    readonly toolName: string;
    readonly monotonicMs: number;
  }
  | {
    readonly type: "tool_call_finished";
    readonly context: TrajectoryRecordContext;
    readonly toolCallId: string;
    readonly toolName: string;
    readonly isError: boolean;
    readonly monotonicMs: number;
  }
  | {
    readonly type: "stage_attempt_finished";
    readonly context: TrajectoryRecordContext;
    readonly monotonicMs: number;
    readonly outcome: StageAttemptOutcome;
  }
  | {
    readonly type: "stage_accepted";
    readonly context: TrajectoryRecordContext;
    readonly metrics: readonly {
      readonly pointer: string;
      readonly value: BenchmarkMetricV1;
    }[];
    readonly contract?: TrajectoryContractReference;
  }
  | {
    readonly type: "selection";
    readonly runId: string;
    readonly timestamp: string;
    /** The identity (referee) the winning branch was ranked by. */
    readonly referee?: { readonly name: string; readonly unit: string; readonly direction: "higher" | "lower" };
    readonly outcome: "merged" | "no-winner" | "metricless" | "carried";
    readonly winnerKey?: string;
    /** The applied winner's commit when a git fast-forward occurred. */
    readonly commit?: string;
    /** Human-readable reason when the winner could not be merged. */
    readonly skipped?: string;
    /** Provenance of how the winner reached the parent scope: a git-worktree
     * winner is merged (`git-merged`, the engine fast-forwards git) and a
     * store-worktree winner has its frozen delta applied (`delta-applied`).
     * `worker-consolidated` is the legacy value recorded before the carry
     * became deterministic; the schema keeps accepting it so old runs still
     * load. Every landed kind makes the `carried` outcome. */
    readonly carrying?: {
      readonly kind: "git-merged" | "delta-applied" | "worker-consolidated" | "admitted-not-carried" | "carry-failed";
      readonly commit?: string;
      readonly reason?: string;
      /** Legacy: consolidation source certainty recorded by the removed
       * worker-consolidation transaction. Optional for old selection records. */
      readonly sourceState?: "known" | "unknown";
      /** Legacy: preserved consolidation evidence for operator recovery.
       * Optional for old selection records. */
      readonly externalEvidenceRoot?: string;
    };
  };

export interface TrajectoryStreamDescriptor {
  readonly id: string;
  readonly schema: string;
  readonly path: string;
}

export interface WorkflowObservationRecorder {
  readonly descriptor: TrajectoryStreamDescriptor;
  initialize?(runDir: string): Effect.Effect<void, TrajectoryReadError, import("@effect/platform").FileSystem.FileSystem>;
  observe(observation: WorkflowObservation): Effect.Effect<void, TrajectoryRecordError, import("@effect/platform").FileSystem.FileSystem>;
}

export interface TrajectoryRecorder<TRecord, TScore> extends WorkflowObservationRecorder {
  read(runDir: string): Effect.Effect<readonly TRecord[], TrajectoryReadError, import("@effect/platform").FileSystem.FileSystem>;
  score(records: readonly TRecord[]): TScore;
}

export interface TrajectoryEvaluator<TInput, TResult> {
  evaluate(input: TInput): Effect.Effect<TResult, TrajectoryEvaluationError, import("@effect/platform").FileSystem.FileSystem>;
}

export class TrajectoryRecordError extends Error {
  readonly _tag = "TrajectoryRecordError" as const;

  constructor(readonly path: string, message: string) {
    super(message);
    this.name = "TrajectoryRecordError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TrajectoryReadError extends Error {
  readonly _tag = "TrajectoryReadError" as const;

  constructor(readonly path: string, message: string) {
    super(message);
    this.name = "TrajectoryReadError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TrajectoryEvaluationError extends Error {
  readonly _tag = "TrajectoryEvaluationError" as const;

  constructor(readonly path: string, message: string) {
    super(message);
    this.name = "TrajectoryEvaluationError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface BenchmarkRecord extends TrajectoryRecordContext {
  readonly kind: "benchmark";
  readonly metric: BenchmarkMetricV1;
  readonly pointer: string;
  readonly contract: TrajectoryContractReference;
}

export interface DurationRecord extends TrajectoryRecordContext {
  readonly kind: "duration";
  readonly outcome: StageAttemptOutcome;
  readonly durationMs: number;
}

export interface TokenUsageRecord extends TrajectoryRecordContext {
  readonly kind: "token_usage";
  readonly reported: TokenUsage;
  readonly delta: TokenUsage;
  readonly reset: boolean;
  readonly outcome: StageAttemptOutcome;
}

export interface ToolCallRecord extends TrajectoryRecordContext {
  readonly kind: "tool_call";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: "completed" | "failed";
  readonly durationMs?: number;
}

/** One iteration of a direction-aware collapsed benchmark trajectory. Same
 * loop iteration can hold several records (e.g. tournament lanes); they are
 * collapsed to the iteration's best before differencing, so slot-to-slot
 * jitter never registers as a regression. `delta` is improvement-positive:
 * for "lower is better" metrics it is prev - value. */
export interface BenchmarkSeriesPoint {
  readonly iteration: number;
  readonly value: number;
  readonly direction: "higher" | "lower";
  readonly prev?: number;
  readonly delta?: number;
  readonly relativeDelta?: number;
  readonly improved?: boolean;
  readonly bestSoFar: number;
  readonly speedupVsSeed?: number;
}

/** Additive fields: `series`/`score` appear only when the trajectory holds
 * at least two distinct iterations, so legacy single-point runs are unchanged. */
export interface BenchmarkScore {
  readonly trajectories: Readonly<Record<string, readonly BenchmarkRecord[]>>;
  readonly best: Readonly<Record<string, number>>;
  readonly last: Readonly<Record<string, number>>;
  readonly series?: Readonly<Record<string, readonly BenchmarkSeriesPoint[]>>;
  readonly score?: Readonly<Record<string, number>>;
}

/** Per-invocation attempt statistics over finished stage attempts. Only
 * attempts that reached a terminal outcome have records, so crashed
 * invocations are absent from every count (a provable-crash-free
 * denominator). Additive: absent when a stream holds no records. */
export interface AttemptSummary {
  readonly total: number;
  readonly accepted: number;
  /** Accepted invocations whose first finished attempt was already
   * accepted — the "did validation/signoff retries cost us" signal. */
  readonly firstPass: number;
}

export interface DurationScore {
  readonly count: number;
  readonly totalMs: number;
  readonly maxMs: number;
  readonly attempts?: AttemptSummary;
}

export interface TokenUsageScore extends TokenUsage {
  readonly count: number;
  /** Same rows as DurationScore.attempts (both recorders observe every
   * finished attempt); duplicated on purpose so each stream is readable
   * standalone. */
  readonly attempts?: AttemptSummary;
}

export interface ToolCallScore {
  readonly count: number;
  readonly failures: number;
  readonly names: readonly string[];
  readonly totalDurationMs: number;
}

/** A persisted region-level referee decision — the selection variant of the
 * observation stream, without the recorder-only framing. */
export type SelectionRecord = Extract<WorkflowObservation, { type: "selection" }>;

/** Whole-run outcome counts over referee decisions. `carried` is an applied
 * winner too (the engine applied the winning slot's delta into the parent
 * scope), so an apply rate counts merged + carried. */
export interface SelectionScore {
  readonly count: number;
  readonly merged: number;
  readonly carried: number;
  readonly noWinner: number;
  readonly metricless: number;
}


