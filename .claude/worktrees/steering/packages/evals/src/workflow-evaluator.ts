import { FileSystem } from "@effect/platform";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Effect } from "effect";
import {
  BenchmarkRecorder,
  DurationRecorder,
  SelectionRecorder,
  TokenUsageRecorder,
  ToolCallRecorder,
  TrajectoryEvaluationError,
  readTrajectoryIndex,
  trajectoryIndexPath,
  trajectoryIndexSchema,
  type BenchmarkScore,
  type DurationScore,
  type SelectionScore,
  type TokenUsageScore,
  type ToolCallScore,
  type TrajectoryEvaluator,
} from "@piano/trajectory";
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

function incompleteNativeEvaluation(runDir: string, issue?: string): WorkflowTrajectoryEvaluation {
  return {
    source: "native",
    complete: false,
    issues: [issue ?? `native trajectory evidence exists under ${join(runDir, "trajectories")} but trajectories/index.json is missing`],
    benchmarks: [],
    duration: { count: 0, totalMs: 0, maxMs: 0 },
    tokens: { count: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    tools: { count: 0, failures: 0, names: [], totalDurationMs: 0 },
  };
}

export class WorkflowEvaluator implements TrajectoryEvaluator<WorkflowEvaluationInput, WorkflowTrajectoryEvaluation> {
  evaluate(input: WorkflowEvaluationInput) {
    const path = trajectoryIndexPath(input.runDir);
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const indexResult = yield* readTrajectoryIndex(input.runDir, trajectoryIndexSchema).pipe(
        Effect.mapError((error) => new TrajectoryEvaluationError(path, error.message)),
        Effect.either,
      );
      if (indexResult._tag === "Left") {
        const trajectoriesDir = join(input.runDir, "trajectories");
        const directoryExists = yield* fileSystem.exists(trajectoriesDir).pipe(
          Effect.mapError((cause) => new TrajectoryEvaluationError(trajectoriesDir, String(cause))),
        );
        if (directoryExists) {
          return incompleteNativeEvaluation(input.runDir, `native trajectory index is malformed or unreadable: ${indexResult.left.message}`);
        }
        return yield* Effect.fail(indexResult.left);
      }
      const index = indexResult.right;
      if (index === undefined) {
        // A partially written native run must not be reinterpreted as an old
        // run merely because its index was the last atomic write to complete.
        const trajectoriesDir = join(input.runDir, "trajectories");
        const directoryExists = yield* fileSystem.exists(trajectoriesDir).pipe(
          Effect.mapError((cause) => new TrajectoryEvaluationError(trajectoriesDir, String(cause))),
        );
        if (directoryExists) {
          const entries = yield* fileSystem.readDirectory(trajectoriesDir).pipe(
            Effect.mapError((cause) => new TrajectoryEvaluationError(trajectoriesDir, String(cause))),
          );
          if (entries.some((entry) => entry !== "index.json")) {
            return incompleteNativeEvaluation(input.runDir);
          }
        }
        return evaluateLegacyRun(input.runDir);
      }

      const benchmarkRecorder = new BenchmarkRecorder(input.runDir);
      const durationRecorder = new DurationRecorder(input.runDir);
      const tokenRecorder = new TokenUsageRecorder(input.runDir);
      const toolRecorder = new ToolCallRecorder(input.runDir);
      const recorders = [benchmarkRecorder, durationRecorder, tokenRecorder, toolRecorder] as const;
      const issues: string[] = [];
      if (index.status !== "completed") issues.push(`trajectory index status is ${index.status}`);
      for (const stream of index.streams) {
        if (stream.status === "running") issues.push(`${stream.id}: stream is still running`);
        if (stream.status === "error") {
          issues.push(...(stream.errors.length === 0
            ? [`${stream.id}: stream failed without an error detail`]
            : stream.errors.map((error) => `${stream.id}: ${error}`)));
        }
      }
      for (const recorder of recorders) {
        const matches = index.streams.filter((stream) => stream.id === recorder.descriptor.id);
        if (matches.length === 0) {
          issues.push(`${recorder.descriptor.id}: stream is missing from trajectory index`);
          continue;
        }
        if (matches.length > 1) {
          issues.push(`${recorder.descriptor.id}: stream is declared more than once`);
          continue;
        }
        const stream = matches[0]!;
        if (stream.schema !== recorder.descriptor.schema || stream.path !== recorder.descriptor.path) {
          issues.push(
            `${recorder.descriptor.id}: expected ${recorder.descriptor.schema} at ${recorder.descriptor.path}, got ${stream.schema} at ${stream.path}`,
          );
        }
      }

      const benchmarkResult = yield* benchmarkRecorder.read(input.runDir).pipe(Effect.either);
      const durationResult = yield* durationRecorder.read(input.runDir).pipe(Effect.either);
      const tokenResult = yield* tokenRecorder.read(input.runDir).pipe(Effect.either);
      const toolResult = yield* toolRecorder.read(input.runDir).pipe(Effect.either);
      // The selection stream is tournament-only: its absence is normal, but a
      // declared stream that fails to read is an evidence issue like the rest.
      const selectionRecorder = new SelectionRecorder(input.runDir);
      const selectionResult = index.streams.some((stream) => stream.id === "selection")
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
        const mismatches = records.filter((record) => record.executionId !== index.executionId).length;
        if (mismatches > 0) issues.push(`${stream}: ${mismatches} record(s) belong to another execution`);
      }
      for (const digest of new Set(benchmarks.map((record) => record.contract.digest))) {
        const snapshotPath = join(input.runDir, "contracts", `${digest}.json`);
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
        complete: index.status === "completed" && issues.length === 0,
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
