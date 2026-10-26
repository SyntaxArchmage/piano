/**
 * Run evidence → RunTrace: the run directory's recorder streams
 * (`eval-metrics/`), the invocation stream, and per-stage transcript analyses
 * folded into the one canonical metric model. A run is described exactly once,
 * here; nothing upstream chooses between evidence sources again.
 */
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { evalMetricsDir, io } from "@piano/base";
import {
  BenchmarkRecorder,
  DurationRecorder,
  SelectionRecorder,
  TokenUsageRecorder,
  ToolCallRecorder,
  streamPath,
} from "@piano/trajectory";
import {
  acceptedInvocations,
  iterationOfInvocationId,
  readInvocationRecords,
  readRunStatus,
} from "@piano/orchestrator";
import { analyzeTranscriptFile } from "./evidence.js";
import { DriverError } from "./errors.js";
import type {
  MessageCounts,
  RunStatusSummary,
  RunTrace,
  StageObservation,
  StageTranscriptMetrics,
  TranscriptMetrics,
  WorkflowBenchmarkPoint,
} from "./types.js";

/** Fold one conversation's counts: the per-path analyses already dedupe the
 * stages that resume the same session. */
function foldMessages(transcripts: Iterable<TranscriptMetrics>): MessageCounts {
  let count = 0;
  let rounds = 0;
  for (const transcript of transcripts) {
    count += transcript.messageCount;
    rounds += transcript.assistantMessageCount;
  }
  return { count, rounds };
}

/** Assemble the canonical trace of one run directory. Fails only when the
 * recorder metrics directory cannot be read; every stream-level anomaly is an
 * issue on the returned trace, never a lost run. */
export function readRunTrace(
  runDir: string,
): Effect.Effect<RunTrace, DriverError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const metricsDir = evalMetricsDir(runDir);
    const directoryExists = yield* fileSystem.exists(metricsDir).pipe(
      Effect.mapError((cause) => new DriverError({ message: String(cause), cause })),
    );
    if (!directoryExists) {
      return yield* Effect.fail(new DriverError({
        message: `recorder metrics directory is missing: ${metricsDir}`,
      }));
    }

    const status = yield* readRunStatus(runDir).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    const issues: string[] = [];
    if (status === undefined) {
      issues.push("run state document is missing or unreadable; completeness is unknown");
    } else if (status.status !== "completed") {
      issues.push(`run status is ${status.status}`);
    }

    const benchmarkRecorder = new BenchmarkRecorder(runDir);
    const durationRecorder = new DurationRecorder(runDir);
    const tokenRecorder = new TokenUsageRecorder(runDir);
    const toolRecorder = new ToolCallRecorder(runDir);
    const selectionRecorder = new SelectionRecorder(runDir);
    const benchmarkResult = yield* benchmarkRecorder.read(runDir).pipe(Effect.either);
    const durationResult = yield* durationRecorder.read(runDir).pipe(Effect.either);
    const tokenResult = yield* tokenRecorder.read(runDir).pipe(Effect.either);
    const toolResult = yield* toolRecorder.read(runDir).pipe(Effect.either);
    // The selection stream is tournament-only: its absence is normal, but a
    // declared stream that fails to read is an evidence issue like the rest.
    const selectionPath = streamPath(runDir, selectionRecorder.descriptor);
    const hasSelectionStream = yield* fileSystem.exists(selectionPath).pipe(
      Effect.mapError((cause) => new DriverError({ message: String(cause), cause })),
    );
    const selectionResult = hasSelectionStream
      ? yield* selectionRecorder.read(runDir).pipe(Effect.either)
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

    // Run attribution: a stream row that belongs to another execution is an
    // evidence issue, not this run's metrics.
    if (status !== undefined) {
      for (const [stream, records] of [
        ["benchmark", benchmarks],
        ["duration", durations],
        ["token-usage", tokens],
        ["tool-calls", tools],
        ["selection", selections],
      ] as const) {
        const mismatches = records.filter((record) => record.runId !== status.runId).length;
        if (mismatches > 0) issues.push(`${stream}: ${mismatches} record(s) belong to another execution`);
      }
    }

    // Per-invocation stage observations: recorder rows grouped by invocation,
    // completed from the accepted row's metadata and the stage transcript.
    const rows = new Map(
      acceptedInvocations(yield* readInvocationRecords(runDir)).map((row) => [row.invocationId, row]),
    );
    const invocationIds = [...new Set<string>([
      ...benchmarks.map((record) => record.invocationId),
      ...durations.map((record) => record.invocationId),
      ...tokens.map((record) => record.invocationId),
      ...tools.map((record) => record.invocationId),
      ...rows.keys(),
    ])];
    // Several invocations of one actor share a session transcript: resolve each
    // stage's effective path, then analyze every file once per run.
    const recordPathByInvocation = new Map<string, string>();
    for (const record of [...benchmarks, ...durations, ...tokens, ...tools]) {
      if (record.transcriptPath !== undefined && !recordPathByInvocation.has(record.invocationId)) {
        recordPathByInvocation.set(record.invocationId, record.transcriptPath);
      }
    }
    const transcriptPathByInvocation = new Map<string, string>();
    for (const invocationId of invocationIds) {
      const transcriptPath = rows.get(invocationId)?.transcriptPath ?? recordPathByInvocation.get(invocationId);
      if (transcriptPath !== undefined) transcriptPathByInvocation.set(invocationId, transcriptPath);
    }
    const transcripts = new Map<string, TranscriptMetrics>();
    yield* Effect.forEach(new Set(transcriptPathByInvocation.values()), (path) =>
      analyzeTranscriptFile(path).pipe(
        Effect.map((metrics) => {
          transcripts.set(path, metrics);
        }),
      ), { discard: true });
    const stageTranscript = (transcript: TranscriptMetrics): StageTranscriptMetrics => ({
      messageCount: transcript.messageCount,
      userMessageCount: transcript.userMessageCount,
      assistantMessageCount: transcript.assistantMessageCount,
      toolResultCount: transcript.toolResultCount,
      toolCallCount: transcript.toolCallCount,
      ...(transcript.valid === undefined ? {} : { valid: transcript.valid }),
      ...(transcript.issues === undefined ? {} : { issues: transcript.issues }),
    });
    const stages: StageObservation[] = invocationIds.map((invocationId) => {
      const benchmarkRows = benchmarks.filter((record) => record.invocationId === invocationId);
      const durationRows = durations.filter((record) => record.invocationId === invocationId);
      const tokenRows = tokens.filter((record) => record.invocationId === invocationId);
      const toolRows = tools.filter((record) => record.invocationId === invocationId);
      const row = rows.get(invocationId);
      const context = [...benchmarkRows, ...durationRows, ...tokenRows, ...toolRows][0];
      const transcriptPath = transcriptPathByInvocation.get(invocationId);
      const analyzed = transcriptPath === undefined ? undefined : transcripts.get(transcriptPath);
      const transcript = analyzed === undefined ? undefined : stageTranscript(analyzed);
      const outcome = durationRows.at(-1)?.outcome ?? tokenRows.at(-1)?.outcome;
      const attempt = context?.attempt ?? row?.attempt;
      const iteration = context?.iteration ?? iterationOfInvocationId(invocationId);
      const tokensUsed = tokenRows.reduce((usage, record) => ({
        input: usage.input + record.delta.input,
        output: usage.output + record.delta.output,
        cacheRead: usage.cacheRead + record.delta.cacheRead,
        cacheWrite: usage.cacheWrite + record.delta.cacheWrite,
        total: usage.total + record.delta.total,
      }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
      return {
        invocationId,
        stageId: context?.stageId ?? row?.stageId ?? "unknown",
        worker: context?.worker ?? row?.worker ?? "unknown",
        ...(iteration === undefined ? {} : { iteration }),
        ...(attempt === undefined ? {} : { attempt }),
        ...(outcome === undefined ? {} : { outcome }),
        ...(transcriptPath === undefined ? {} : { transcriptPath }),
        ...(transcript === undefined ? {} : { transcript }),
        ...(row?.requestedModel === undefined ? {} : { requestedModel: row.requestedModel }),
        ...(row?.requestedThinkingLevel === undefined ? {} : { requestedThinkingLevel: row.requestedThinkingLevel }),
        ...(row?.model === undefined ? {} : { model: row.model }),
        ...(row?.thinkingLevel === undefined ? {} : { thinkingLevel: row.thinkingLevel }),
        ...(row?.workspace?.cwd === undefined ? {} : { workspaceCwd: row.workspace.cwd }),
        tokens: tokensUsed,
        toolCalls: {
          count: toolRows.length,
          failures: toolRows.filter((record) => record.status === "failed").length,
        },
        ...(durationRows.length === 0
          ? {}
          : { durationMs: durationRows.reduce((sum, record) => sum + record.durationMs, 0) }),
      } satisfies StageObservation;
    });

    const benchmarkPoints: readonly WorkflowBenchmarkPoint[] = benchmarks.map((record) => ({
      name: record.metric.name,
      unit: record.metric.unit,
      direction: record.metric.direction,
      value: record.metric.best,
      samples: record.metric.samples,
      ...(record.iteration === undefined ? {} : { iteration: record.iteration }),
      invocationId: record.invocationId,
      stageId: record.stageId,
      worker: record.worker,
    }));

    return {
      complete: status?.status === "completed" && issues.length === 0,
      issues,
      messages: foldMessages(transcripts.values()),
      tokens: tokenRecorder.score(tokens),
      tools: toolRecorder.score(tools),
      duration: durationRecorder.score(durations),
      benchmarks: benchmarkPoints,
      benchmarkScore: benchmarkRecorder.score(benchmarks),
      ...(selectionResult === undefined || selectionResult._tag === "Left"
        ? {}
        : { selection: selectionRecorder.score(selections) }),
      stages,
    } satisfies RunTrace;
  });
}

/** The 3-field stage-progress snapshot the report's status label reads. */
export function readRunStatusSummary(
  runDir: string,
): Effect.Effect<RunStatusSummary, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const status = yield* readRunStatus(runDir).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    if (status === undefined) return { completedStages: 0, plannedStages: 0 };
    const currentStageId = status.current?.stageId;
    return {
      completedStages: status.completedStages,
      plannedStages: status.plannedStages,
      ...(currentStageId === undefined ? {} : { currentStageId }),
    };
  });
}

/** Whether a run directory holds recorder metrics (the eval-metrics dir). */
export function evalMetricsAvailable(runDir: string): Effect.Effect<boolean> {
  return io.existsSync(evalMetricsDir(runDir));
}
