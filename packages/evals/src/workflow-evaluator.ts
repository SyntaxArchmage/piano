import { FileSystem } from "@effect/platform";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { contractSnapshotPath, evalMetricsDir, evalMetricsPath } from "@piano/base";
import {
  BenchmarkRecorder,
  DurationRecorder,
  SelectionRecorder,
  TokenUsageRecorder,
  ToolCallRecorder,
  TrajectoryEvaluationError,
  type BenchmarkScore,
  type DurationScore,
  type SelectionScore,
  type TokenUsageScore,
  type ToolCallScore,
  type TrajectoryEvaluator,
} from "@piano/trajectory";
import { readRunStatus } from "@piano/orchestrator";
import { evaluateLegacyRun } from "./legacy-run-adapter.js";

export interface WorkflowEvaluationInput {
  readonly runDir: string;
}

export interface WorkflowBenchmarkPoint {
  readonly name: string;
  readonly unit?: string;
  readonly direction: "higher" | "lower";
  readonly value: number;
  readonly samples?: readonly number[];
  readonly iteration?: number;
  readonly invocationId?: string;
  readonly stageId?: string;
  readonly worker?: string;
  readonly contractDigest?: string;
  /** Native points are accepted by construction. Legacy points retain whether
   * the historical payload represented a completed measurement. */
  readonly accepted: boolean;
}

export interface WorkflowTrajectoryEvaluation {
  readonly source: "native" | "legacy";
  readonly complete: boolean;
  readonly issues: readonly string[];
  readonly benchmarks: readonly WorkflowBenchmarkPoint[];
  /** Present for native streams, where the recorder's own scoring semantics
   * can be applied without inventing legacy contract lineage. */
  readonly benchmarkScore?: BenchmarkScore;
  readonly duration: DurationScore;
  readonly tokens: TokenUsageScore;
  readonly tools: ToolCallScore;
  /** Tournament referee decisions. The index declares the selection stream for
   * every native run, so a plain pipeline yields a zero-count score; the field
   * is absent only for legacy runs (no index). */
  readonly selection?: SelectionScore;
}

export class WorkflowEvaluator implements TrajectoryEvaluator<WorkflowEvaluationInput, WorkflowTrajectoryEvaluation> {
  evaluate(input: WorkflowEvaluationInput) {
    const metricsDir = evalMetricsDir(input.runDir);
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      // The recorder streams are the evidence. A run that never opened the
      // recorders has no directory and is read through the legacy adapter;
      // everything else is native, with completeness taken from the run's
      // state document rather than from a second index record.
      const directoryExists = yield* fileSystem.exists(metricsDir).pipe(
        Effect.mapError((cause) => new TrajectoryEvaluationError(metricsDir, String(cause))),
      );
      if (!directoryExists) return evaluateLegacyRun(input.runDir);

      const status = yield* readRunStatus(input.runDir).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      const issues: string[] = [];
      if (status === undefined) {
        issues.push("run state document is missing or unreadable; completeness is unknown");
      } else if (status.status !== "completed") {
        issues.push(`run status is ${status.status}`);
      }

      const benchmarkRecorder = new BenchmarkRecorder(input.runDir);
      const durationRecorder = new DurationRecorder(input.runDir);
      const tokenRecorder = new TokenUsageRecorder(input.runDir);
      const toolRecorder = new ToolCallRecorder(input.runDir);
      const recorders = [benchmarkRecorder, durationRecorder, tokenRecorder, toolRecorder] as const;
      for (const recorder of recorders) void recorder;
      const benchmarkResult = yield* benchmarkRecorder.read(input.runDir).pipe(Effect.either);
      const durationResult = yield* durationRecorder.read(input.runDir).pipe(Effect.either);
      const tokenResult = yield* tokenRecorder.read(input.runDir).pipe(Effect.either);
      const toolResult = yield* toolRecorder.read(input.runDir).pipe(Effect.either);
      // The selection stream is tournament-only: its absence is normal, but a
      // declared stream that fails to read is an evidence issue like the rest.
      const selectionRecorder = new SelectionRecorder(input.runDir);
      const selectionPath = evalMetricsPath(input.runDir, "selection.jsonl");
      const hasSelectionStream = yield* fileSystem.exists(selectionPath).pipe(
        Effect.mapError((cause) => new TrajectoryEvaluationError(selectionPath, String(cause))),
      );
      const selectionResult = hasSelectionStream
        ? yield* selectionRecorder.read(input.runDir).pipe(Effect.either)
        : undefined;
      if (benchmarkResult._tag === "Left") issues.push(benchmarkResult.left.message);
      if (durationResult._tag === "Left") issues.push(durationResult.left.message);
      if (tokenResult._tag === "Left") issues.push(tokenResult.left.message);
      if (toolResult._tag === "Left") issues.push(toolResult.left.message);
      if (selectionResult !== undefined && selectionResult._tag === "Left") issues.push(selectionResult.left.message);

      const benchmarks = benchmarkResult._tag === "Right" ? benchmarkResult.right : [];
      const durations = durationResult._tag === "Right" ? durationResult.right : [];
      const tokens = tokenResult._tag === "Right" ? tokenResult.right : [];
      const tools = toolResult._tag === "Right" ? toolResult.right : [];
      const selections = selectionResult !== undefined && selectionResult._tag === "Right" ? selectionResult.right : [];
      for (const [stream, records] of [
        ["benchmark", benchmarks],
        ["duration", durations],
        ["token-usage", tokens],
        ["tool-calls", tools],
        ["selection", selections],
      ] as const) {
        if (status === undefined) continue;
        const mismatches = records.filter((record) => record.runId !== status.runId).length;
        if (mismatches > 0) issues.push(`${stream}: ${mismatches} record(s) belong to another execution`);
      }
      for (const digest of new Set(benchmarks.map((record) => record.contract.digest))) {
        const snapshotPath = contractSnapshotPath(input.runDir, digest);
        const snapshot = yield* fileSystem.readFileString(snapshotPath).pipe(Effect.either);
        if (snapshot._tag === "Left") {
          issues.push(`benchmark: contract snapshot ${digest} is missing or unreadable`);
          continue;
        }
        const actualDigest = createHash("sha256").update(snapshot.right).digest("hex");
        if (actualDigest !== digest) {
          issues.push(`benchmark: contract snapshot ${digest} failed digest verification`);
        }
      }
      return {
        source: "native" as const,
        complete: status?.status === "completed" && issues.length === 0,
        issues,
        benchmarks: benchmarks.map((record) => ({
          name: record.metric.name,
          unit: record.metric.unit,
          direction: record.metric.direction,
          value: record.metric.best,
          samples: record.metric.samples,
          ...(record.iteration === undefined ? {} : { iteration: record.iteration }),
          invocationId: record.invocationId,
          stageId: record.stageId,
          worker: record.worker,
          contractDigest: record.contract.digest,
          accepted: true,
        })),
        benchmarkScore: benchmarkRecorder.score(benchmarks),
        duration: durationRecorder.score(durations),
        tokens: tokenRecorder.score(tokens),
        tools: toolRecorder.score(tools),
        ...(selectionResult === undefined || selectionResult._tag === "Left" ? {} : { selection: selectionRecorder.score(selections) }),
      } satisfies WorkflowTrajectoryEvaluation;
    });
  }
}

export const workflowEvaluator: TrajectoryEvaluator<WorkflowEvaluationInput, WorkflowTrajectoryEvaluation> =
  new WorkflowEvaluator();
