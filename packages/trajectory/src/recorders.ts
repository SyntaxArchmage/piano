import { Effect } from "effect";
import {
  benchmarkRecordReadSchema,
  benchmarkRecordSchema,
  durationRecordSchema,
  selectionRecordSchema,
  tokenUsageRecordSchema,
  toolCallRecordSchema,
} from "./schemas.js";
import { appendRecord, readRecords } from "./storage.js";
import type {
  AttemptSummary,
  BenchmarkRecord,
  BenchmarkScore,
  BenchmarkSeriesPoint,
  DurationRecord,
  DurationScore,
  SelectionRecord,
  SelectionScore,
  StageAttemptOutcome,
  TokenUsage,
  TokenUsageRecord,
  TokenUsageScore,
  ToolCallRecord,
  ToolCallScore,
  TrajectoryRecorder,
  TrajectoryStreamDescriptor,
  WorkflowObservation,
} from "./types.js";

function attemptKey(observation: { readonly context: { readonly runId: string; readonly invocationId: string; readonly attempt: number } }): string {
  const context = observation.context;
  return `${context.runId}\u0000${context.invocationId}\u0000${context.attempt}`;
}

function toolKey(observation: { readonly context: { readonly runId: string; readonly invocationId: string; readonly attempt: number }; readonly toolCallId: string }): string {
  return `${attemptKey(observation)}\u0000${observation.toolCallId}`;
}

const ZERO_USAGE: TokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
};

function subtractUsage(current: TokenUsage, previous: TokenUsage): { readonly delta: TokenUsage; readonly reset: boolean } {
  const reset = current.input < previous.input ||
    current.output < previous.output ||
    current.cacheRead < previous.cacheRead ||
    current.cacheWrite < previous.cacheWrite ||
    current.total < previous.total;
  if (reset) return { delta: current, reset: true };
  return {
    delta: {
      input: current.input - previous.input,
      output: current.output - previous.output,
      cacheRead: current.cacheRead - previous.cacheRead,
      cacheWrite: current.cacheWrite - previous.cacheWrite,
      total: current.total - previous.total,
    },
    reset: false,
  };
}

/** Translate a direction-adjusted improvement ratio into a bounded [0,1)
 * score on a parameter-free hyperbola: parity is exactly 0.5 and the score
 * keeps rewarding speedup instead of saturating at parity like `min(1, r)`.
 * Infinity (zero reference) maps to the 1 limit; NaN/non-positive maps to 0. */
export function hyperbolicScore(ratio: number): number {
  if (Number.isNaN(ratio) || ratio <= 0) return 0;
  if (!Number.isFinite(ratio)) return 1;
  return ratio / (1 + ratio);
}

/** Collapse finished-attempt rows into per-invocation attempt statistics.
 * An invocation is accepted when any of its attempts was accepted, and
 * first-pass when its earliest accepted attempt is attempt 1. Rows exist
 * only for attempts that reached a terminal outcome, so a crashed
 * invocation contributes nothing — the denominator is provably
 * crash-free, never silently optimistic about retries. */
export function summarizeAttempts(
  rows: readonly { readonly invocationId: string; readonly attempt: number; readonly outcome: StageAttemptOutcome }[],
): AttemptSummary | undefined {
  if (rows.length === 0) return undefined;
  const byInvocation = new Map<string, { accepted: boolean; firstAcceptedAttempt: number }>();
  for (const row of rows) {
    if (row.outcome !== "accepted") continue;
    const existing = byInvocation.get(row.invocationId);
    if (existing === undefined) {
      byInvocation.set(row.invocationId, { accepted: true, firstAcceptedAttempt: row.attempt });
    } else {
      existing.firstAcceptedAttempt = Math.min(existing.firstAcceptedAttempt, row.attempt);
    }
  }
  const invocations = new Set(rows.map((row) => row.invocationId));
  let accepted = 0;
  let firstPass = 0;
  for (const entry of byInvocation.values()) {
    accepted += 1;
    if (entry.firstAcceptedAttempt === 1) firstPass += 1;
  }
  return { total: invocations.size, accepted, firstPass };
}

/** Fraction of opened tool calls that did not fail; undefined when no call
 * was opened (nothing to rate) or the stream is absent (legacy run).
 * Abandoned opens are recorded as failures. */
export function toolSuccessRate(score: ToolCallScore | undefined): number | undefined {
  if (score === undefined || score.count === 0) return undefined;
  return 1 - score.failures / score.count;
}

export class BenchmarkRecorder implements TrajectoryRecorder<BenchmarkRecord, BenchmarkScore> {
  readonly descriptor: TrajectoryStreamDescriptor = {
    id: "benchmark",
    schema: "piano.trajectory.benchmark/v1",
    path: "benchmark.jsonl",
  };

  constructor(private readonly runDir: string) {}

  observe(observation: WorkflowObservation) {
    if (observation.type !== "stage_accepted" || observation.metrics.length === 0) return Effect.void;
    return Effect.forEach(observation.metrics, (metric) => appendRecord(
      this.runDir,
      this.descriptor,
      benchmarkRecordSchema,
      {
        ...observation.context,
        kind: "benchmark" as const,
        metric: metric.value,
        pointer: metric.pointer,
      },
    ), { discard: true });
  }

  read(runDir: string) {
    return readRecords(runDir, this.descriptor, benchmarkRecordReadSchema);
  }

  score(records: readonly BenchmarkRecord[]): BenchmarkScore {
    const grouped = new Map<string, BenchmarkRecord[]>();
    for (const record of records) {
      const key = `${record.metric.name}\u0000${record.metric.unit}`;
      const values = grouped.get(key) ?? [];
      values.push(record);
      grouped.set(key, values);
    }
    const trajectories: Record<string, readonly BenchmarkRecord[]> = {};
    const best: Record<string, number> = {};
    const last: Record<string, number> = {};
    const series: Record<string, readonly BenchmarkSeriesPoint[]> = {};
    const score: Record<string, number> = {};
    for (const [key, values] of grouped) {
      values.sort((left, right) => (left.iteration ?? Number.MAX_SAFE_INTEGER) - (right.iteration ?? Number.MAX_SAFE_INTEGER));
      trajectories[key] = values;
      const direction = values[0]?.metric.direction ?? "higher";
      const points = values.map((record) => record.metric.best);
      if (points.length > 0) {
        best[key] = direction === "higher" ? Math.max(...points) : Math.min(...points);
        last[key] = points.at(-1)!;
      }
      // Collapse records that belong to the same loop iteration (tournament
      // lanes run within one iteration) into that iteration's best before any
      // differencing, so slot-to-slot jitter cannot masquerade as a
      // regression. Records without an iteration context keep their sorted
      // position as a synthetic index.
      const collapsed = new Map<number, number>();
      values.forEach((record, index) => {
        const iteration = record.iteration ?? index;
        const value = record.metric.best;
        const existing = collapsed.get(iteration);
        collapsed.set(iteration, existing === undefined ? value
          : direction === "higher" ? Math.max(existing, value) : Math.min(existing, value));
      });
      if (collapsed.size < 2) continue;
      const iterations = [...collapsed.keys()].sort((left, right) => left - right);
      const seed = collapsed.get(iterations[0] ?? 0)!;
      let envelope = seed;
      let previous: number | undefined;
      const seriesPoints: BenchmarkSeriesPoint[] = [];
      for (const iteration of iterations) {
        const value = collapsed.get(iteration)!;
        envelope = direction === "higher" ? Math.max(envelope, value) : Math.min(envelope, value);
        const delta = previous === undefined ? undefined
          : direction === "higher" ? value - previous : previous - value;
        const speedupVsSeed = seed === 0 ? undefined
          : direction === "higher" ? value / seed : seed / value;
        const relativeDelta = previous === undefined || previous === 0 || delta === undefined
          ? undefined : delta / previous;
        seriesPoints.push({
          iteration,
          value,
          direction,
          ...(previous === undefined ? {} : { prev: previous }),
          ...(delta === undefined ? {} : { delta }),
          ...(relativeDelta === undefined ? {} : { relativeDelta }),
          ...(delta === undefined ? {} : { improved: delta > 0 }),
          bestSoFar: envelope,
          ...(speedupVsSeed === undefined ? {} : { speedupVsSeed }),
        });
        previous = value;
      }
      series[key] = seriesPoints;
      const bestSpeedup = seed === 0 || best[key] === undefined ? undefined
        : direction === "higher" ? best[key] / seed : seed / best[key];
      if (bestSpeedup !== undefined) score[key] = hyperbolicScore(bestSpeedup);
    }
    return {
      trajectories,
      best,
      last,
      ...(Object.keys(series).length > 0 ? { series } : {}),
      ...(Object.keys(score).length > 0 ? { score } : {}),
    };
  }
}

export class DurationRecorder implements TrajectoryRecorder<DurationRecord, DurationScore> {
  readonly descriptor: TrajectoryStreamDescriptor = {
    id: "duration",
    schema: "piano.trajectory.duration/v1",
    path: "duration.jsonl",
  };
  private readonly started = new Map<string, number>();

  constructor(private readonly runDir: string) {}

  observe(observation: WorkflowObservation) {
    if (observation.type === "stage_attempt_started") {
      this.started.set(attemptKey(observation), observation.monotonicMs);
      return Effect.void;
    }
    if (observation.type !== "stage_attempt_finished") return Effect.void;
    const key = attemptKey(observation);
    const started = this.started.get(key);
    this.started.delete(key);
    const durationMs = Math.max(0, observation.monotonicMs - (started ?? observation.monotonicMs));
    return appendRecord(this.runDir, this.descriptor, durationRecordSchema, {
      ...observation.context,
      kind: "duration" as const,
      outcome: observation.outcome,
      durationMs,
    });
  }

  read(runDir: string) {
    return readRecords(runDir, this.descriptor, durationRecordSchema);
  }

  score(records: readonly DurationRecord[]): DurationScore {
    const durations = records.map((record) => record.durationMs);
    const attempts = summarizeAttempts(records);
    return {
      count: records.length,
      totalMs: durations.reduce((sum, value) => sum + value, 0),
      maxMs: durations.length === 0 ? 0 : Math.max(...durations),
      ...(attempts === undefined ? {} : { attempts }),
    };
  }
}

export class TokenUsageRecorder implements TrajectoryRecorder<TokenUsageRecord, TokenUsageScore> {
  readonly descriptor: TrajectoryStreamDescriptor = {
    id: "token-usage",
    schema: "piano.trajectory.token-usage/v1",
    path: "token-usage.jsonl",
  };
  private readonly latestByAttempt = new Map<string, TokenUsage>();
  private readonly previousByActor = new Map<string, TokenUsage>();

  constructor(private readonly runDir: string) {}

  initialize(runDir: string) {
    return this.read(runDir).pipe(Effect.map((records) => {
      for (const record of records) {
        const actor = record.actorKey ?? record.invocationId;
        this.previousByActor.set(actor, record.reported);
      }
    }));
  }

  observe(observation: WorkflowObservation) {
    if (observation.type === "token_usage") {
      // One attempt reports at most one snapshot, read from its transcript when
      // the turn ends. A second observation for the same attempt is a second
      // reading of the same file, so the latest is also the most complete.
      this.latestByAttempt.set(attemptKey(observation), observation.usage);
      return Effect.void;
    }
    if (observation.type !== "stage_attempt_finished") return Effect.void;
    const key = attemptKey(observation);
    const actor = observation.context.actorKey ?? observation.context.invocationId;
    // Some harness failures produce no usage event. Retain the actor's latest
    // cumulative snapshot in that case so a later resumed turn cannot count
    // all prior tokens again after an artificial reset to zero.
    const reported = this.latestByAttempt.get(key) ?? this.previousByActor.get(actor) ?? ZERO_USAGE;
    this.latestByAttempt.delete(key);
    const previous = this.previousByActor.get(actor) ?? ZERO_USAGE;
    const { delta, reset } = subtractUsage(reported, previous);
    this.previousByActor.set(actor, reported);
    return appendRecord(this.runDir, this.descriptor, tokenUsageRecordSchema, {
      ...observation.context,
      kind: "token_usage" as const,
      reported,
      delta,
      reset,
      outcome: observation.outcome,
    });
  }

  read(runDir: string) {
    return readRecords(runDir, this.descriptor, tokenUsageRecordSchema);
  }

  score(records: readonly TokenUsageRecord[]): TokenUsageScore {
    const attempts = summarizeAttempts(records);
    return {
      ...records.reduce<TokenUsageScore>((total, record) => ({
        count: total.count + 1,
        input: total.input + record.delta.input,
        output: total.output + record.delta.output,
        cacheRead: total.cacheRead + record.delta.cacheRead,
        cacheWrite: total.cacheWrite + record.delta.cacheWrite,
        total: total.total + record.delta.total,
      }), { count: 0, ...ZERO_USAGE }),
      ...(attempts === undefined ? {} : { attempts }),
    };
  }
}

/** Selection observations record a whole-run/metric referee decision and - when
 * a git fast-forward applied - the winner commit. They are emitted once per
 * tournament region finalization and carry their own region-level context. */
export class SelectionRecorder implements TrajectoryRecorder<SelectionRecord, SelectionScore> {
  readonly descriptor: TrajectoryStreamDescriptor = {
    id: "selection",
    schema: "piano.trajectory.selection/v1",
    path: "selection.jsonl",
  };

  constructor(private readonly runDir: string) {}

  observe(observation: WorkflowObservation) {
    // Only drain the self-contained selection variant; other recorders ignore
    // stage-level observations and this one ignores everything but selection.
    if (observation.type !== "selection") return Effect.void;
    const { type, runId, timestamp, referee, outcome, winnerKey, commit, skipped, carrying } = observation;
    return appendRecord(this.runDir, this.descriptor, selectionRecordSchema, {
      type,
      runId,
      timestamp,
      outcome,
      ...(referee === undefined ? {} : { referee }),
      ...(winnerKey === undefined ? {} : { winnerKey }),
      ...(commit === undefined ? {} : { commit }),
      ...(skipped === undefined ? {} : { skipped }),
      ...(carrying === undefined ? {} : { carrying }),
    });
  }

  read(runDir: string) {
    return readRecords(runDir, this.descriptor, selectionRecordSchema);
  }

  score(records: readonly SelectionRecord[]): SelectionScore {
    return {
      count: records.length,
      merged: records.filter((record) => record.outcome === "merged").length,
      carried: records.filter((record) => record.outcome === "carried").length,
      noWinner: records.filter((record) => record.outcome === "no-winner").length,
      metricless: records.filter((record) => record.outcome === "metricless").length,
    };
  }
}

/** Fraction of referee decisions whose winner reached the parent scope
 * (merged or delta-applied); undefined when no decision was recorded
 * (non-tournament run, or a tournament region that never finalized). */
export function selectionApplyRate(score: SelectionScore | undefined): number | undefined {
  if (score === undefined || score.count === 0) return undefined;
  return (score.merged + score.carried) / score.count;
}

export class ToolCallRecorder implements TrajectoryRecorder<ToolCallRecord, ToolCallScore> {
  readonly descriptor: TrajectoryStreamDescriptor = {
    id: "tool-calls",
    schema: "piano.trajectory.tool-call/v1",
    path: "tool-calls.jsonl",
  };
  // Only the fields the close/abandon rows need: an in-flight call must not
  // pin its whole observation (and the tool's args) until it finishes.
  private readonly open = new Map<string, { readonly startedAt: number; readonly toolCallId: string; readonly toolName: string }>();

  constructor(private readonly runDir: string) {}

  observe(observation: WorkflowObservation) {
    if (observation.type === "tool_call_started") {
      this.open.set(toolKey(observation), {
        startedAt: observation.monotonicMs,
        toolCallId: observation.toolCallId,
        toolName: observation.toolName,
      });
      return Effect.void;
    }
    if (observation.type === "tool_call_finished") {
      const key = toolKey(observation);
      const started = this.open.get(key);
      this.open.delete(key);
      return appendRecord(this.runDir, this.descriptor, toolCallRecordSchema, {
        ...observation.context,
        kind: "tool_call" as const,
        toolCallId: observation.toolCallId,
        toolName: observation.toolName,
        status: observation.isError ? "failed" as const : "completed" as const,
        ...(started === undefined ? {} : { durationMs: Math.max(0, observation.monotonicMs - started.startedAt) }),
      });
    }
    if (observation.type !== "stage_attempt_finished") return Effect.void;
    const prefix = `${attemptKey(observation)}\u0000`;
    const abandoned = [...this.open.entries()].filter(([key]) => key.startsWith(prefix));
    for (const [key] of abandoned) this.open.delete(key);
    return Effect.forEach(abandoned, ([, call]) => appendRecord(this.runDir, this.descriptor, toolCallRecordSchema, {
      ...observation.context,
      kind: "tool_call" as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      status: "failed" as const,
      durationMs: Math.max(0, observation.monotonicMs - call.startedAt),
    }), { discard: true });
  }

  read(runDir: string) {
    return readRecords(runDir, this.descriptor, toolCallRecordSchema);
  }

  score(records: readonly ToolCallRecord[]): ToolCallScore {
    return {
      count: records.length,
      failures: records.filter((record) => record.status === "failed").length,
      names: [...new Set(records.map((record) => record.toolName))],
      totalDurationMs: records.reduce((sum, record) => sum + (record.durationMs ?? 0), 0),
    };
  }
}
