import type { Effect as EffectType } from "effect/Effect";
import type { TurnOutcome } from "@piano/base";
import type { ObservationType } from "@piano/logging";
import type {
  BenchmarkScore,
  DurationScore,
  SelectionScore,
  StageAttemptOutcome,
  TokenUsage,
  TokenUsageScore,
  ToolCallScore,
} from "@piano/trajectory";

/**
 * Shared types for the Piano evals system.
 *
 * This is the single contract surface every evals module — the run pipeline,
 * case runner, evidence reader, scorer, and the `piano evals` CLI — imports
 * from. It defines the canonical shape (decision 0034/0037) and
 * targets the run artifacts produced by `/orchestrator`.
 *
 * Keep this file type-only where possible so no module accidentally pulls
 * runtime code into another.
 */

// ── Case config (case.yaml) ─────────────────────────────────────────────────

/**
 * Optional structured workload descriptor. Domain-specific cases may use this
 * to keep an operator, problem shape, and implementation language out of free
 * task text. It does not classify how the workflow executes.
 */
export interface WorkloadDescriptor {
  /** Operator type being tuned, e.g. "matmul", "gemv", "softmax". */
  operator: string;
  /** Problem shape in canonical order, e.g. "512x512x512 f32". */
  shape: string;
  /** Programming language the artifact is written in, e.g. "python" | "cuda". */
  language: string;
  /** Task description handed to the workflow. */
  description: string;
}

/**
 * Programmatic readout for the artifact evaluator: how to invoke the case's
 * workspace readout method and what signal it emits.
 */
export interface ArtifactReadout {
  /** Kind of verification the readout performs. */
  kind: "programmatic";
  /** Build command run before the benchmark/verify step (relative to copied workspace). */
  compileCommand: string;
  /** Verify command — asserts correctness (relative to copied workspace). */
  verifyCommand: string;
  /** Benchmark command — emits a metric line (relative to copied workspace). */
  benchmarkCommand?: string;
  /** Grader-owned clean-workspace baseline command, run before the agent.
   * Omit for a run-scoped measurement (the workflow-perf family): there is no
   * meaningful pre-run baseline, so none is recorded. */
  baselineCommand?: string;
  /** Regex to extract the numeric metric from benchmarking output. */
  metricPattern?: string;
  /** Numeric tolerance for a verifier that performs numeric comparison. */
  tolerance?: number;
}

/** Optional acceptance controls for one eval case. Undefined fields use the
 * eval driver's safe default. This belongs to eval material, not workflow
 * contract/schema compatibility. */
export interface AcceptancePolicy {
  /** Require the launch to exit successfully. Defaults to true. */
  requireExecution?: boolean;
  /** Require the artifact verifier to pass. Defaults to true. */
  requireArtifact?: boolean;
  /** Require complete durable evidence. Defaults to true. */
  requireEvidence?: boolean;
  /** Require a grader-owned baseline measurement. Defaults to false. */
  requireBaseline?: boolean;
  /** Require the final metric to improve over the baseline. Defaults to false. */
  requireImprovement?: boolean;
}

/** One grader tag with an optional weight (defaults to 1). */
export interface CaseGraderTag {
  /** Tag name, e.g. "tflops", "correctness", "efficiency". */
  tag: string;
  /** Relative weight for the aggregate score (default 1). */
  weight?: number;
}

export interface EvalMatrixDimensions {
  task: string;
  harness: string;
  model: string;
  effort: string;
}

/**
 * An immutable evals case (case.yaml). Declares the launch command, workspace
 * template, workflow file, grader tags/weights, and the metric to optimize.
 */
export interface EvalCase {
  /** Case id, e.g. "case-0-basic-write" / "matmul-512-f32". */
  id: string;
  /** "eval" workload group this case belongs to (used by `--group`). */
  group: string;
  /** Structured dimensions used by task-specific comparison reports. */
  dimensions?: EvalMatrixDimensions;
  /** The prompt handed to the worker. */
  prompt: string;
  /** Launch command template, e.g. "piano --workspace <workspace>". */
  command: string;
  /** Optional grader-owned workspace preparation run before timing and diff baselining. */
  prepareCommand?: string;
  /** Relative path (from the case dir) to the workspace template to copy. */
  workspace: string;
  /** Optional explicit workflow fixture. Omit to exercise Piano's default workflow. */
  workflow?: string;
  /** Artifact-family readout used by the artifact evaluator. */
  readout: ArtifactReadout;
  /** Grader tags + weights for the scorer. */
  tags: CaseGraderTag[];
  /** Metric + direction for cases with a complete performance readout. */
  metric?: { name: string; direction: "higher" | "lower" };
  /** Optional acceptance policy for this case. */
  acceptance?: AcceptancePolicy;
  /** Optional domain-specific workload metadata. */
  workload?: WorkloadDescriptor;
}

/** On-disk case manifest shape (one case.yaml per case dir). */
export interface CaseConfig extends EvalCase {
  /** Manifest version; bump on breaking shape changes. */
  version: 1;
}

// ── Run artifacts (assembled from a run directory) ──────────────────────────

/** Conversation counts folded from the per-stage transcript analyses. */
export interface MessageCounts {
  /** Total message events (user + assistant). */
  readonly count: number;
  /** Agent turns that produced an assistant reply (one per assistant message). */
  readonly rounds: number;
}

/** One recorder-backed benchmark point, attributed to its stage invocation. */
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
}

/** One trial's canonical evaluation result: the whole system's only metric
 * model, assembled by run-reader from the recorder streams, the invocation
 * stream, and transcript analyses. */
export interface RunTrace {
  readonly complete: boolean;
  readonly issues: readonly string[];
  /** Transcript analyses folded into one conversation summary. */
  readonly messages: MessageCounts;
  readonly tokens: TokenUsageScore;
  readonly tools: ToolCallScore;
  readonly duration: DurationScore;
  readonly benchmarks: readonly WorkflowBenchmarkPoint[];
  readonly benchmarkScore?: BenchmarkScore;
  /** Tournament referee decisions; only runs with a selection stream have one. */
  readonly selection?: SelectionScore;
  /** Per-invocation stage observations. */
  readonly stages: readonly StageObservation[];
  /** Span counts of the Langfuse-aligned observation stream, when the run
   * opted into `--langfuse`. Counts only: the full tree stays in
   * `system-log/observations.jsonl`, and a run's chat/tool facts can be
   * checked against the export without pinning every payload on the report. */
  readonly observationCounts?: Readonly<Record<ObservationType, number>>;
}

/** What one concrete stage invocation did, assembled from recorder records
 * (grouped by invocationId), the invocation accepted row, and its transcript.
 * Loop iterations keep their invocation id even when the same stage actor
 * resumes its session. */
export interface StageObservation {
  readonly invocationId: string;
  readonly stageId: string;
  readonly worker: string;
  readonly iteration?: number;
  readonly attempt?: number;
  readonly outcome?: StageAttemptOutcome;
  readonly transcriptPath?: string;
  /** Transcript validation and counts; the evidence stage loop and the report
   * stage rows read this object instead of flat fields. */
  readonly transcript?: StageTranscriptMetrics;
  /** Requested workflow configuration, before provider capability clamping. */
  readonly requestedModel?: string;
  readonly requestedThinkingLevel?: string;
  /** Effective values reported by the harness. */
  readonly model?: string;
  readonly thinkingLevel?: string;
  readonly workspaceCwd?: string;
  readonly tokens: TokenUsage;
  readonly toolCalls: { readonly count: number; readonly failures: number };
  readonly durationMs?: number;
}

/** The 3-field snapshot the report's per-case status label needs. Derived
 * from the run's state document; the full snapshot does not live on
 * CaseResult. */
export interface RunStatusSummary {
  readonly completedStages: number;
  readonly plannedStages: number;
  readonly currentStageId?: string;
}

/** A grader-owned or worker-produced benchmark measurement retained for
 * progress comparison. */
export interface BenchmarkMeasurement {
  value?: number;
  metric?: string;
  direction?: "higher" | "lower";
  rawOutput: string;
  passed: boolean;
}

export interface BenchmarkComparison {
  metric?: string;
  direction?: "higher" | "lower";
  baseline?: number;
  final?: number;
  delta?: number;
  relativeDelta?: number;
  /** Direction-normalized improvement: positive means better than baseline. */
  absoluteImprovement?: number;
  relativeImprovement?: number;
  improved?: boolean;
}

/** One per-case artifact readout result. */
export interface ArtifactMetrics {
  /** True when the configured verifier passed. */
  verified: boolean;
  /** Numeric metric extracted from benchmarking (e.g. TFLOPS, ms). */
  value?: number;
  /** Raw benchmarking output line(s) captured, for diagnosis. */
  rawOutput?: string;
  /** Test-run summary parsed from the verifier output when available. */
  testSummary?: TestRunSummary;
}

export interface TestRunSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  /** Passed tests divided by executed tests; skipped tests are excluded. */
  passRate: number;
}

/** Parsed, non-reasoning transcript evidence retained for eval review. */
export interface TranscriptMetrics {
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolResultCount: number;
  toolCallCount: number;
  toolNames: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  /** The final assistant text; useful for human review and regex-based graders. */
  finalText: string;
  /** Full visible/thinking text for an injected judge or human review. */
  fullText?: string;
  /** Strict structural validity of the persisted transcript. */
  valid?: boolean;
  /** Non-fatal parser diagnostics retained as evidence. */
  issues?: readonly TranscriptValidationIssue[];
}

export interface TranscriptValidationIssue {
  kind: "syntax" | "structure";
  line: number;
  message: string;
}

export interface EvidenceIssue {
  code:
    | "run-missing"
    | "trajectory-missing"
    | "eval-metrics-missing"
    | "eval-metrics-incomplete"
    | "log-missing"
    | "trace-missing"
    | "transcript-missing"
    | "transcript-invalid"
    | "transcript-user-missing"
    | "transcript-assistant-missing"
    | "transcript-tool-result-missing"
    | "stage-evidence-missing"
    | "stage-transcript-missing"
    | "stage-metadata-missing"
    | "metric-measurement-missing"
    | "baseline-missing"
    | "baseline-invalid"
    | "final-metric-missing"
    | "test-cheating";
  message: string;
  path?: string;
}

export interface EvidenceAvailability {
  run: boolean;
  trajectory: boolean;
  evalMetrics: boolean;
  log: boolean;
  trace: boolean;
  transcript: boolean;
}

export interface EvidenceAssessment {
  taskPass: boolean;
  executionPass: boolean;
  evidencePass: boolean;
  accepted: boolean;
  issues: readonly EvidenceIssue[];
  policy: Required<AcceptancePolicy>;
}

export interface TimingSummary {
  wallClockMs: number;
  stageTotalMs: number;
  maxStageMs: number;
  completedStageCount: number;
}

export interface CodeChangeMetrics {
  files: number;
  additions: number;
  deletions: number;
  total: number;
  testIntegrity: TestIntegrityMetrics;
}

export interface TestIntegrityMetrics {
  cheating: boolean;
  addedFiles: number;
  modifiedFiles: number;
  deletedFiles: number;
}

export interface JudgeGrade {
  name: string;
  score: number;
  weight: number;
  rationale?: string;
}

export interface JudgeInput {
  result: CaseResult;
  evidence: EvidenceAssessment;
}

/** A judge is injected at the eval boundary; it does not select a provider or
 * couple a provider-specific judge to the generic orchestrator. */
export interface EvalJudge {
  name: string;
  weight?: number;
  evaluate: (input: JudgeInput) => EffectType<JudgeGrade, unknown, never>;
}

export interface CaseScorecard {
  caseId: string;
  correctness: number;
  execution: number;
  evidence: number;
  performance: number;
  quality: number;
  judgeBacked: boolean;
  judges: readonly JudgeGrade[];
  accepted: boolean;
  baseline?: BenchmarkComparison;
  timing: TimingSummary;
}

/** The stage slice of a transcript analysis: enough to validate the stage and
 * render its row, without copying the whole conversation into every stage. */
export interface StageTranscriptMetrics {
  readonly messageCount: number;
  readonly userMessageCount: number;
  readonly assistantMessageCount: number;
  readonly toolResultCount: number;
  readonly toolCallCount: number;
  /** Strict structural validity of the persisted transcript. */
  readonly valid?: boolean;
  /** Non-fatal parser diagnostics retained as evidence. */
  readonly issues?: readonly TranscriptValidationIssue[];
}

/** A complete single-case evaluation result. */
export interface CaseResult {
  caseId: string;
  /** One-based independent sample number within this case. */
  trial: number;
  runSetId?: string;
  group: string;
  dimensions?: EvalMatrixDimensions;
  /** Launch status for this case. */
  status: TurnOutcome | "skipped";
  /** Absolute path to the copied workspace mutated by the run. */
  workspaceDir: string;
  /** The real Piano run directory created by this trial. */
  runDir?: string;
  /** Primary grader tag(s) stamped from the case config (used by tag grouping). */
  tags: readonly string[];
  metric?: { name: string; direction: "higher" | "lower" };
  variant?: string;
  /** The run's canonical trace; absent when evidence could not be assembled. */
  trace?: RunTrace;
  traceError?: string;
  artifact: ArtifactMetrics;
  /** Absolute path to the session transcript, when present. */
  transcriptPath?: string;
  transcript?: TranscriptMetrics;
  /** 3-field snapshot of the run's stage progress (report status label),
   * derived from the state document. The full snapshot does not live on
   * CaseResult. */
  runStatus?: RunStatusSummary;
  baseline?: BenchmarkMeasurement;
  baselineComparison?: BenchmarkComparison;
  evidence?: EvidenceAssessment;
  timing?: TimingSummary;
  scorecard?: CaseScorecard;
  trajectoryPath?: string;
  /** The Langfuse-aligned op stream, when the run opted into `--langfuse`. */
  observationPath?: string;
  logPath?: string;
  tracePath?: string;
  /** The recorder-metrics directory (`runDir/eval-metrics`) produced by the run. */
  evalMetricsDir?: string;
  durationMs?: number;
  /** Grader-owned diff from the pristine copied workspace to the delivered artifact. */
  codeChanges?: CodeChangeMetrics;
  /** Error detail when status !== completed. */
  error?: string;
}

export interface LaunchEvidence {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// ── Scorer / aggregation ────────────────────────────────────────────────────

/** A single metric score with its orientation. */
export interface MetricScore {
  name: string;
  value: number;
  direction: "higher" | "lower";
  weight: number;
}

/** Aggregate report for one grouping key (overall / by tag / by model / worker...). */
export interface ScoreGroup {
  /** Grouping key label, e.g. "overall", "tag:tflops", "model:deepseek-v4-flash". */
  key: string;
  /** Cases contributing to this group. */
  caseIds: string[];
  /** Aggregate metric scores. */
  scores: MetricScore[];
  /** Overall composite score 0..1 for this group. */
  composite: number;
}

/** End-to-end eval report (text output for now; TUI marked future). */
export interface EvalReport {
  /** Run set id (timestamp-scoped). */
  runSetId: string;
  createdAt: string;
  groups: ScoreGroup[];
  /** Per-case raw results backing the aggregates. */
  cases: CaseResult[];
  /** Normalized overall score across all selected cases. */
  overall: number;
  summary: EvalSummary;
  scorecards: readonly CaseScorecard[];
  variants: readonly VariantComparison[];
}

export interface EvalCaseSummary {
  caseId: string;
  trials: number;
  passed: number;
  passRate: number;
  /** Whether at least one of this case's independent trials passed. */
  passAtK: number;
  firstPass: number;
  averageTokens: number;
  averageRounds: number;
  averageToolCalls: number;
  averageDurationMs: number;
  accepted: number;
  evidencePassRate: number;
}

export interface EvalSummary {
  trials: number;
  passed: number;
  passRate: number;
  averageTokens: number;
  averageRounds: number;
  averageToolCalls: number;
  averageDurationMs: number;
  accepted: number;
  evidencePassRate: number;
  cases: EvalCaseSummary[];
}

/** The pinned baseline a `--replay-baseline` run starts from, kept beside the
 * case's report. A run set's report records what a run measured; this records
 * what the next one must be compared against, and which run pinned it. */
export interface PinnedBaseline {
  kind: "baseline";
  caseId: string;
  runSetId: string;
  trial: number;
  recordedAt: string;
  variant?: string;
  baseline: BenchmarkMeasurement;
}

export interface VariantResult {
  variant: string;
  runSetIds: readonly string[];
  quality: number;
  acceptedRate: number;
  finalMetric?: number;
  baselineMetric?: number;
}

export interface VariantComparison {
  caseId: string;
  variants: readonly VariantResult[];
}

/** Options controlling a full evals run. */
export interface EvalRunOptions {
  /** Where workspace templates get copied and executed. The pipeline passes
   * its output root, so a run's sandboxes sit beside its report. */
  workspaceRoot: string;
  /** Parent run-set id used to isolate every copied workspace. */
  runSetId: string;
  /** One-based independent sample number. */
  trial: number;
  /** Use a previously pinned baseline instead of executing the baseline command. */
  baseline?: BenchmarkMeasurement;
  /** Optional label used by history and variant comparison. */
  variant?: string;
  /** Limits execution to dry-run (no agent spawn — validates config). */
  dryRun?: boolean;
  /** External launch timeout. Performance-readout cases get a longer safe default. */
  timeoutMs?: number;
  /** CLI-only live progress sink: one short line per notable event (case
   * start, periodic run-state tick). The TUI never wires this; the final
   * formatted report remains the only machine-consumed output. */
  onProgress?: (line: string) => void;
}

/** A reducer that folds a set of case results into a score group. */
export type ScoreReducer = (cases: CaseResult[]) => ScoreGroup;
