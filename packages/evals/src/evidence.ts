import { Effect } from "effect";
import { hyperbolicScore } from "@piano/trajectory";
import type {
  AcceptancePolicy,
  BenchmarkMeasurement,
  BenchmarkComparison,
  CaseResult,
  CaseScorecard,
  EvidenceAssessment,
  EvidenceAvailability,
  EvidenceIssue,
  EvalJudge,
  EvalHistoryEntry,
  JudgeGrade,
  TimingSummary,
  TranscriptMetrics,
  TranscriptValidationIssue,
  VariantComparison,
  VariantResult,
} from "./types.js";

export interface TranscriptRange {
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface TranscriptValidationResult {
  readonly issues: readonly TranscriptValidationIssue[];
  readonly messageCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestampInRange(value: unknown, range: TranscriptRange): boolean {
  if (typeof value !== "string") return true;
  return (range.startedAt === undefined || value >= range.startedAt) &&
    (range.completedAt === undefined || value <= range.completedAt);
}

/** Validate the minimum NDJSON transcript structure needed for strict evidence.
 * The parser remains line-oriented so one malformed event cannot hide later
 * valid evidence. */
export function validateTranscriptText(raw: string): TranscriptValidationResult {
  const issues: TranscriptValidationIssue[] = [];
  let messageCount = 0;
  for (const [index, line] of raw.split("\n").entries()) {
    const lineNumber = index + 1;
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (cause) {
      issues.push({
        kind: "syntax",
        line: lineNumber,
        message: cause instanceof Error ? cause.message : String(cause),
      });
      continue;
    }
    if (!isRecord(value)) {
      issues.push({ kind: "structure", line: lineNumber, message: "record must be a JSON object" });
      continue;
    }
    if (typeof value.type !== "string" || value.type.length === 0) {
      issues.push({ kind: "structure", line: lineNumber, message: "record type must be a non-empty string" });
      continue;
    }
    if (value.type !== "message") continue;
    messageCount += 1;
    if (!isRecord(value.message)) {
      issues.push({ kind: "structure", line: lineNumber, message: "message record must contain an object message" });
      continue;
    }
    if (typeof value.message.role !== "string" || value.message.role.length === 0) {
      issues.push({ kind: "structure", line: lineNumber, message: "message role must be a non-empty string" });
    }
    if (typeof value.message.content !== "string" && !Array.isArray(value.message.content)) {
      issues.push({ kind: "structure", line: lineNumber, message: "message content must be a string or array" });
    }
  }
  if (messageCount === 0) {
    issues.push({ kind: "structure", line: 0, message: "transcript contains no message records" });
  }
  return { issues, messageCount };
}

function contentText(content: unknown): { text: string; toolNames: string[]; toolResultCount: number } {
  if (typeof content === "string") return { text: content, toolNames: [], toolResultCount: 0 };
  if (!Array.isArray(content)) return { text: "", toolNames: [], toolResultCount: 0 };
  const text: string[] = [];
  const toolNames: string[] = [];
  let toolResultCount = 0;
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") text.push(part.text);
    if (part.type === "thinking" && typeof part.thinking === "string") text.push(part.thinking);
    if (part.type === "toolCall" && typeof part.name === "string") toolNames.push(part.name);
    if (part.type === "toolResult" || part.type === "tool_result") toolResultCount += 1;
  }
  return { text: text.join("\n"), toolNames, toolResultCount };
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Analyze already-loaded transcript text without performing I/O. */
export function analyzeTranscriptText(
  path: string,
  raw: string,
  range: TranscriptRange = {},
): TranscriptMetrics {
  void path;
  const validation = validateTranscriptText(raw);
  const toolNames = new Set<string>();
  let messageCount = 0;
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolResultCount = 0;
  let toolCallCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalTokens = 0;
  let finalText = "";
  let fullText = "";

  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let record: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(line);
      if (!isRecord(value)) continue;
      record = value;
    } catch {
      continue;
    }
    if (record.type !== "message" || !isRecord(record.message) || !timestampInRange(record.timestamp, range)) continue;
    const message = record.message;
    messageCount += 1;
    const role = typeof message.role === "string" ? message.role : "";
    const content = contentText(message.content);
    if (role === "user") userMessageCount += 1;
    if (role === "assistant") {
      assistantMessageCount += 1;
      if (isRecord(message.usage)) {
        inputTokens = Math.max(inputTokens, numberValue(message.usage.input));
        outputTokens = Math.max(outputTokens, numberValue(message.usage.output));
        cacheReadTokens = Math.max(cacheReadTokens, numberValue(message.usage.cacheRead));
        cacheWriteTokens = Math.max(cacheWriteTokens, numberValue(message.usage.cacheWrite));
        const declaredTotal = message.usage.totalTokens;
        const total = declaredTotal === undefined
          ? numberValue(message.usage.input) + numberValue(message.usage.output) +
            numberValue(message.usage.cacheRead) + numberValue(message.usage.cacheWrite)
          : numberValue(declaredTotal);
        totalTokens = Math.max(totalTokens, total);
      }
      for (const name of content.toolNames) {
        toolCallCount += 1;
        toolNames.add(name);
      }
    }
    if (role === "tool" || role === "toolResult" || role === "tool_result") toolResultCount += 1;
    toolResultCount += content.toolResultCount;
    if (content.text !== "") {
      fullText = fullText === "" ? content.text : `${fullText}\n${content.text}`;
      if (role === "assistant") finalText = content.text;
    }
  }

  return {
    messageCount,
    userMessageCount,
    assistantMessageCount,
    toolResultCount,
    toolCallCount,
    toolNames: [...toolNames].sort(),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    finalText,
    fullText,
    valid: validation.issues.length === 0,
    issues: validation.issues,
  };
}

const DEFAULT_ACCEPTANCE_POLICY: Required<AcceptancePolicy> = {
  requireExecution: true,
  requireArtifact: true,
  requireEvidence: true,
  requireBaseline: false,
  requireImprovement: false,
};

export function resolveAcceptancePolicy(policy?: AcceptancePolicy): Required<AcceptancePolicy> {
  return { ...DEFAULT_ACCEPTANCE_POLICY, ...policy };
}

export function compareBenchmark(
  baseline: number | undefined,
  final: number | undefined,
  direction: "higher" | "lower" | undefined,
  metric?: string,
): BenchmarkComparison {
  const comparison: BenchmarkComparison = {
    ...(metric === undefined ? {} : { metric }),
    ...(direction === undefined ? {} : { direction }),
    ...(baseline === undefined ? {} : { baseline }),
    ...(final === undefined ? {} : { final }),
  };
  if (baseline === undefined || final === undefined || direction === undefined) return comparison;
  const delta = final - baseline;
  const relativeDelta = baseline === 0 ? undefined : delta / Math.abs(baseline);
  const absoluteImprovement = direction === "higher" ? delta : -delta;
  const relativeImprovement = baseline === 0 ? undefined : absoluteImprovement / Math.abs(baseline);
  return {
    ...comparison,
    delta,
    ...(relativeDelta === undefined ? {} : { relativeDelta }),
    absoluteImprovement,
    ...(relativeImprovement === undefined ? {} : { relativeImprovement }),
    improved: absoluteImprovement > 0,
  };
}

/** Return a measurement value only when the grader-owned measurement completed
 * successfully. A command can print a parseable number and still exit non-zero;
 * that number must not become a replayable baseline or an improvement proof. */
export function usableBenchmarkValue(measurement: BenchmarkMeasurement | undefined): number | undefined {
  return measurement?.passed === true &&
    measurement.value !== undefined &&
    Number.isFinite(measurement.value)
    ? measurement.value
    : undefined;
}

export function summarizeTiming(
  result: Pick<CaseResult, "durationMs" | "stageTrajectories" | "workflowTrajectory">,
): TimingSummary {
  const durations = (result.stageTrajectories ?? [])
    .map((stage) => stage.durationMs)
    .filter((duration): duration is number => duration !== undefined && Number.isFinite(duration) && duration >= 0);
  const recorded = result.workflowTrajectory?.duration;
  return {
    wallClockMs: result.durationMs ?? 0,
    stageTotalMs: recorded !== undefined && recorded.count > 0
      ? recorded.totalMs
      : durations.reduce((sum, duration) => sum + duration, 0),
    maxStageMs: recorded !== undefined && recorded.count > 0
      ? recorded.maxMs
      : durations.length === 0 ? 0 : Math.max(...durations),
    completedStageCount: recorded !== undefined && recorded.count > 0 ? recorded.count : durations.length,
  };
}

export function assessCaseEvidence(
  result: Pick<CaseResult, "status" | "artifact" | "runDir" | "trajectoryPath" | "workflowTrajectoryPath" | "workflowTrajectory" | "workflowTrajectoryError" | "logPath" | "tracePath" | "transcriptPath" | "transcript" | "stageTrajectories" | "progressPath" | "runStatusPath" | "baseline" | "metric" | "codeChanges">,
  options: {
    readonly policy?: AcceptancePolicy;
    readonly availability?: EvidenceAvailability;
  } = {},
): EvidenceAssessment {
  const policy = resolveAcceptancePolicy(options.policy);
  const availability = options.availability ?? {
    run: result.runDir !== undefined,
    trajectory: result.trajectoryPath !== undefined,
    workflowTrajectory: result.workflowTrajectory !== undefined,
    log: result.logPath !== undefined,
    trace: result.tracePath !== undefined,
    transcript: result.transcriptPath !== undefined,
    progress: result.progressPath !== undefined || result.runStatusPath !== undefined,
  };
  const issues: EvidenceIssue[] = [];
  if (result.status !== "skipped") {
    if (!availability.run) issues.push({ code: "run-missing", message: "run directory is not linked to this eval result" });
    if (!availability.trajectory) issues.push({ code: "trajectory-missing", message: "trajectory evidence is missing", path: result.trajectoryPath });
    if (!availability.workflowTrajectory) {
      issues.push({
        code: "workflow-trajectory-missing",
        message: result.workflowTrajectoryError ?? "recorder-backed workflow trajectory evidence is missing",
        path: result.workflowTrajectoryPath,
      });
    } else if (result.workflowTrajectory?.complete !== true) {
      issues.push({
        code: "workflow-trajectory-incomplete",
        message: result.workflowTrajectory?.issues.join("; ") || "workflow trajectory is incomplete",
        path: result.workflowTrajectoryPath,
      });
    }
    if (!availability.log) issues.push({ code: "log-missing", message: "log evidence is missing", path: result.logPath });
    if (!availability.trace) issues.push({ code: "trace-missing", message: "trace evidence is missing", path: result.tracePath });
    if (!availability.transcript) issues.push({ code: "transcript-missing", message: "transcript evidence is missing", path: result.transcriptPath });
    if (availability.transcript && result.transcript === undefined) {
      issues.push({ code: "transcript-invalid", message: "transcript path is present but transcript analysis is missing", path: result.transcriptPath });
    } else if (result.transcript !== undefined && (result.transcript.valid !== true || (result.transcript.issues?.length ?? 0) > 0)) {
      issues.push({ code: "transcript-invalid", message: "transcript contains invalid or malformed records", path: result.transcriptPath });
    }
    if (result.transcript !== undefined) {
      if (result.transcript.userMessageCount === 0) {
        issues.push({ code: "transcript-user-missing", message: "transcript contains no user task message", path: result.transcriptPath });
      }
      if (result.transcript.assistantMessageCount === 0) {
        issues.push({ code: "transcript-assistant-missing", message: "transcript contains no assistant response", path: result.transcriptPath });
      }
      if (result.transcript.toolCallCount > 0 && result.transcript.toolResultCount === 0) {
        issues.push({ code: "transcript-tool-result-missing", message: "transcript contains tool calls without tool results", path: result.transcriptPath });
      }
    }
    for (const stage of result.stageTrajectories ?? []) {
      if (stage.transcriptPath === undefined) {
        issues.push({ code: "stage-transcript-missing", message: `stage transcript for ${stage.invocationId} is not linked` });
      }
      if (stage.stageId === "unknown" || stage.worker === "unknown") {
        issues.push({ code: "stage-metadata-missing", message: `stage metadata for ${stage.invocationId} is incomplete` });
      }
      if (stage.transcriptPath !== undefined && (stage.transcriptValid !== true || (stage.transcriptIssues?.length ?? 0) > 0)) {
        issues.push({
          code: "transcript-invalid",
          message: stage.transcriptValid === undefined
            ? `stage transcript for ${stage.invocationId} was not validated`
            : `stage transcript for ${stage.invocationId} contains invalid or malformed records`,
          path: stage.transcriptPath,
        });
      }
      if (stage.transcriptPath !== undefined && stage.transcriptValid === true) {
        if ((stage.transcriptUserMessageCount ?? 0) === 0) {
          issues.push({ code: "transcript-user-missing", message: `stage transcript for ${stage.invocationId} contains no user task message`, path: stage.transcriptPath });
        }
        if (stage.assistantMessageCount === 0) {
          issues.push({ code: "transcript-assistant-missing", message: `stage transcript for ${stage.invocationId} contains no assistant response`, path: stage.transcriptPath });
        }
        if (stage.toolCallCount > 0 && (stage.transcriptToolResultCount ?? 0) === 0) {
          issues.push({ code: "transcript-tool-result-missing", message: `stage transcript for ${stage.invocationId} contains tool calls without tool results`, path: stage.transcriptPath });
        }
      }
    }
    if ((result.stageTrajectories?.length ?? 0) === 0) {
      issues.push({ code: "stage-evidence-missing", message: "no stage-level trajectory evidence was linked" });
    }
    if (result.metric !== undefined) {
      if (!availability.progress) {
        issues.push({ code: "progress-missing", message: "workflow progress evidence is missing", path: result.progressPath });
      }
      const measurements = (result.workflowTrajectory?.benchmarks ?? [])
        .filter((measurement) => measurement.accepted &&
          measurement.name === result.metric?.name &&
          measurement.direction === result.metric.direction);
      if (measurements.length === 0) {
        issues.push({
          code: "progress-measurement-missing",
          message: `workflow trajectory contains no accepted ${result.metric.direction}-is-better ${result.metric.name} measurement`,
          path: result.workflowTrajectoryPath,
        });
      }
    }
  }
  const baselineValue = usableBenchmarkValue(result.baseline);
  if (result.baseline !== undefined && baselineValue === undefined) {
    issues.push({ code: "baseline-invalid", message: "baseline measurement did not complete successfully" });
  }
  if (policy.requireBaseline && baselineValue === undefined) {
    issues.push({ code: "baseline-missing", message: "acceptance requires a parsed baseline measurement" });
  }
  if (result.metric !== undefined && result.artifact.verified && result.artifact.value === undefined) {
    issues.push({ code: "final-metric-missing", message: "performance artifact passed verification but has no final metric" });
  }
  if (result.codeChanges?.testIntegrity.cheating === true) {
    issues.push({
      code: "test-cheating",
      message: "an existing test file was modified or deleted; only newly added test files are allowed",
    });
  }

  const taskPass = result.artifact.verified && result.codeChanges?.testIntegrity.cheating !== true &&
    !(result.metric !== undefined && result.artifact.value === undefined);
  const executionPass = result.status === "completed";
  const evidencePass = result.status !== "skipped" && issues.length === 0;
  const baselineComparison = compareBenchmark(
    baselineValue,
    result.artifact.value,
    result.metric?.direction ?? result.baseline?.direction,
    result.metric?.name ?? result.baseline?.metric,
  );
  const accepted =
    (!policy.requireExecution || executionPass) &&
    (!policy.requireArtifact || taskPass) &&
    (!policy.requireEvidence || evidencePass) &&
    (!policy.requireBaseline || baselineComparison.baseline !== undefined) &&
    (!policy.requireImprovement || baselineComparison.improved === true);
  return { taskPass, executionPass, evidencePass, accepted, issues, policy };
}

function performanceScore(comparison: BenchmarkComparison | undefined): number {
  if (comparison?.baseline === undefined || comparison.final === undefined || comparison.direction === undefined) return 0;
  if (comparison.baseline === 0) {
    return comparison.direction === "higher"
      ? comparison.final > 0 ? 1 : comparison.final === 0 ? 1 : 0
      : comparison.final < 0 ? 1 : comparison.final === 0 ? 1 : 0;
  }
  const ratio = comparison.direction === "higher"
    ? comparison.final / comparison.baseline
    : comparison.baseline / comparison.final;
  // A hyperbola keeps a 4.86x win distinguishable from a 1.01x win; the old
  // min(1, ratio) clamped both to 1.0 the moment the run beat the baseline.
  return hyperbolicScore(ratio);
}

export function buildCaseScorecard(
  result: CaseResult,
  judges: readonly JudgeGrade[] = [],
): CaseScorecard {
  const evidence = result.evidence ?? assessCaseEvidence(result);
  const comparison = result.baselineComparison ?? compareBenchmark(
    usableBenchmarkValue(result.baseline),
    result.artifact.value,
    result.metric?.direction ?? result.baseline?.direction,
    result.metric?.name ?? result.baseline?.metric,
  );
  const correctness = evidence.taskPass ? 1 : 0;
  const execution = evidence.executionPass ? 1 : 0;
  const evidenceScore = evidence.evidencePass ? 1 : 0;
  const performance = performanceScore(comparison);
  const judgeBacked = judges.length > 0;
  const automaticDimensions = result.metric === undefined
    ? [correctness, execution, evidenceScore]
    : [correctness, execution, evidenceScore, performance];
  const quality = judgeBacked
    ? judges.reduce((sum, judge) => sum + Math.min(5, Math.max(0, judge.score)) * Math.max(0, judge.weight), 0) /
      Math.max(1, judges.reduce((sum, judge) => sum + Math.max(0, judge.weight), 0)) / 5
    : automaticDimensions.reduce((sum, dimension) => sum + dimension, 0) / automaticDimensions.length;
  return {
    caseId: result.caseId,
    correctness,
    execution,
    evidence: evidenceScore,
    performance,
    quality,
    judgeBacked,
    judges,
    accepted: evidence.accepted,
    ...(comparison.baseline === undefined && comparison.final === undefined ? {} : { baseline: comparison }),
    timing: result.timing ?? summarizeTiming(result),
  };
}

/** Execute injected judges without coupling evals to a model/provider. A failed
 * judge is retained as a zero score so it cannot silently disappear. */
export function evaluateJudges(
  result: CaseResult,
  judges: readonly EvalJudge[],
): Effect.Effect<readonly JudgeGrade[], never> {
  const evidence = result.evidence ?? assessCaseEvidence(result);
  return Effect.forEach(judges, (judge) => judge.evaluate({ result, evidence }).pipe(
    Effect.map((grade) => ({
      ...grade,
      name: judge.name,
      weight: grade.weight > 0 ? grade.weight : judge.weight ?? 1,
      score: Math.min(5, Math.max(0, grade.score)),
    })),
    Effect.catchAll((error) => Effect.succeed({
      name: judge.name,
      score: 0,
      weight: judge.weight ?? 1,
      rationale: `judge failed: ${error instanceof Error ? error.message : String(error)}`,
    })),
  ));
}

export function compareVariants(results: readonly CaseResult[]): readonly VariantComparison[] {
  const byCase = new Map<string, CaseResult[]>();
  for (const result of results) {
    if (result.variant === undefined || result.variant.trim() === "") continue;
    const list = byCase.get(result.caseId) ?? [];
    list.push(result);
    byCase.set(result.caseId, list);
  }
  return [...byCase.entries()].map(([caseId, cases]) => {
    const byVariant = new Map<string, CaseResult[]>();
    for (const result of cases) {
      const list = byVariant.get(result.variant!) ?? [];
      list.push(result);
      byVariant.set(result.variant!, list);
    }
    const variants: VariantResult[] = [...byVariant.entries()].map(([variant, variantCases]) => {
      const scorecards = variantCases.map((result) => result.scorecard ?? buildCaseScorecard(result));
      const values = variantCases.map((result) => result.artifact.value).filter((value): value is number => value !== undefined);
      const baselines = variantCases
        .map((result) => usableBenchmarkValue(result.baseline))
        .filter((value): value is number => value !== undefined);
      return {
        variant,
        runSetIds: [...new Set(variantCases.map((result) => result.runSetId ?? ""))].filter(Boolean),
        quality: scorecards.reduce((sum, scorecard) => sum + scorecard.quality, 0) / Math.max(1, scorecards.length),
        acceptedRate: scorecards.filter((scorecard) => scorecard.accepted).length / Math.max(1, scorecards.length),
        ...(values.length === 0 ? {} : { finalMetric: values.reduce((sum, value) => sum + value, 0) / values.length }),
        ...(baselines.length === 0 ? {} : { baselineMetric: baselines.reduce((sum, value) => sum + value, 0) / baselines.length }),
      };
    });
    return { caseId, variants };
  });
}

export function historyEntryFromResult(
  result: CaseResult,
  runSetId: string,
  recordedAt = new Date().toISOString(),
): EvalHistoryEntry {
  return {
    kind: "run",
    caseId: result.caseId,
    runSetId,
    trial: result.trial,
    recordedAt,
    ...(result.variant === undefined ? {} : { variant: result.variant }),
    status: result.status,
    ...(result.baseline === undefined ? {} : { baseline: result.baseline }),
    ...(result.baselineComparison === undefined ? {} : { comparison: result.baselineComparison }),
    ...(result.scorecard === undefined ? {} : { scorecard: result.scorecard }),
    ...(result.evidence === undefined ? {} : { evidence: result.evidence }),
  };
}
