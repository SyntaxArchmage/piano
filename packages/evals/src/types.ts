import type { Effect as EffectType } from "effect/Effect";
import type { TurnOutcome } from "@piano/base";
import type { WorkflowTrajectoryEvaluation } from "./workflow-evaluator.js";

/**
 * Shared types for the Piano evals system.
 *
 * This is the single contract surface every evals module — the runner/driver,
 * trajectory evaluator, artifact evaluator, scorer, and the `piano evals` CLI —
 * imports from. It defines the canonical shape (decision 0034/0037) and
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
  /** Grader-owned clean-workspace baseline command, run before the agent. */
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

// ── Run artifacts (produced by the driver) ──────────────────────────────────

/** Structured transcript analysis derived from a run's transcript/trace. */
export interface TrajectoryMetrics {
  /** Total message events (user + assistant). */
  messageCount: number;
  /** Assistant message count (one per agent turn). */
  assistantMessageCount: number;
  /** Number of rounds (agent turns that produced an assistant reply). */
  rounds: number;
  /** Tool invocations observed (count + names). */
  toolCallCount: number;
  toolNames: string[];
  /** Summed token counts from usage events (0 when absent). */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

/** Metrics for one concrete workflow stage invocation. Loop iterations keep
 * their invocation id even when the same stage actor resumes its session. */
export interface StageTrajectoryMetrics extends TrajectoryMetrics {
  stageId: string;
  invocationId: string;
  worker: string;
  transcriptPath?: string;
  /** Strict validation result for this invocation's transcript, when linked. */
  transcriptValid?: boolean;
  transcriptIssues?: readonly TranscriptValidationIssue[];
  /** Message roles and tool-result linkage observed in the persisted transcript. */
  transcriptUserMessageCount?: number;
  transcriptToolResultCount?: number;
  /** Requested workflow configuration, before provider capability clamping. */
  requestedModel?: string;
  requestedThinkingLevel?: string;
  requestedTools?: readonly string[];
  /** Effective values reported by the harness. */
  model?: string;
  thinkingLevel?: string;
  workspaceCwd?: string;
  iteration?: number;
  /** Wall-clock duration of this invocation from orchestrator log events. */
  durationMs?: number;
}

/** A grader-owned or worker-produced benchmark measurement retained for
 * progress comparison. */
export interface BenchmarkMeasurement {
  value?: number;
  metric?: string;
  unit?: string;
  direction?: "higher" | "lower";
  rawOutput: string;
  passed: boolean;
  source: "baseline" | "trajectory" | "progress" | "final";
  iteration?: number;
  invocationId?: string;
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
  baseline?: BenchmarkMeasurement;
  measurements?: readonly BenchmarkMeasurement[];
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
    | "workflow-trajectory-missing"
    | "workflow-trajectory-incomplete"
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
    | "progress-missing"
    | "progress-measurement-missing"
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
  workflowTrajectory: boolean;
  log: boolean;
  trace: boolean;
  transcript: boolean;
  progress: boolean;
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

/** Heat-map scale for rendering a numeric scorecard cell. */
export interface HeatScale {
  readonly min: number;
  readonly max: number;
  readonly good: "high" | "low" | number;
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
  trajectory: TrajectoryMetrics;
  /** Recorder-backed workflow trajectory evaluation. This is separate from
   * the retained legacy agent-event trajectory above. */
  workflowTrajectory?: WorkflowTrajectoryEvaluation;
  workflowTrajectoryPath?: string;
  workflowTrajectoryError?: string;
  artifact: ArtifactMetrics;
  /** Absolute path to the session transcript, when present. */
  transcriptPath?: string;
  transcript?: TranscriptMetrics;
  /** All stage-level trajectories, not only the terminal worker transcript. */
  stageTrajectories?: readonly StageTrajectoryMetrics[];
  /** Legacy accepted-stage progress stream, present only for runs that
   * predate `runStatusPath`. */
  progressPath?: string;
  progress?: readonly Record<string, unknown>[];
  /** The run's single state document. It replaced the progress snapshot
   * (progress.json), the progress stream and the trajectory/resume documents. */
  runStatusPath?: string;
  runStatus?: Record<string, unknown>;
  baseline?: BenchmarkMeasurement;
  baselineComparison?: BenchmarkComparison;
  evidence?: EvidenceAssessment;
  timing?: TimingSummary;
  scorecard?: CaseScorecard;
  trajectoryPath?: string;
  logPath?: string;
  tracePath?: string;
  durationMs?: number;
  /** Grader-owned diff from the pristine copied workspace to the delivered artifact. */
  codeChanges?: CodeChangeMetrics;
  /** Error detail when status !== completed. */
  error?: string;
  /** Exit code and captured process output for the declared case launch. */
  launch?: LaunchEvidence;
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

export interface EvalHistoryEntry {
  kind: "baseline" | "run";
  caseId: string;
  runSetId: string;
  trial: number;
  recordedAt: string;
  variant?: string;
  status: CaseResult["status"];
  baseline?: BenchmarkMeasurement;
  comparison?: BenchmarkComparison;
  scorecard?: CaseScorecard;
  evidence?: EvidenceAssessment;
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
  /** Only evaluate cases in this group. */
  group?: string;
  /** Root dir holding read-only evals material (defaults to the package's own source `workloads/`). */
  root?: string;
  /** Where workspace templates get copied and executed (defaults to ~/.piano/evals). */
  workspaceRoot?: string;
  /** Parent run-set id used to isolate every copied workspace. */
  runSetId?: string;
  /** One-based independent sample number. */
  trial?: number;
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

/** A filter that selects cases (e.g. by tag, by model, by worker). */
export type CaseFilter = (cases: CaseResult[]) => CaseResult[];
