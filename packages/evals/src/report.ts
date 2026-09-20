/**
 * Text report formatter for the Piano evals system.
 *
 * Renders an {@link EvalReport} as a readable plain-text report. A TUI
 * renderer is marked as future work.
 */

import { selectionApplyRate, toolSuccessRate, type BenchmarkSeriesPoint } from "@piano/trajectory";
import { normalizeMetric } from "./scorer.js";
import type { CaseResult, EvalReport, ScoreGroup } from "./types.js";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RST = "\x1b[0m";

function bar(value: number, width = 24): string {
  const clamped = Math.min(1, Math.max(0, value));
  const filled = Math.round(clamped * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function colorFor(value: number): string {
  if (value >= 0.7) return GREEN;
  if (value >= 0.4) return YELLOW;
  return RED;
}

const NUL = String.fromCharCode(0);

/** Metric name part of a recorder's `name<NUL>unit` series key. */
function seriesName(key: string): string {
  return key.split(NUL)[0] ?? key;
}

function seriesUnit(key: string): string {
  return key.split(NUL)[1] ?? "";
}

/** Collapsed per-iteration trajectory chain: each point is that iteration's
 * best with the vs-previous delta, then the two score tracks — the
 * trajectory's intrinsic score (vs its iter-0 seed) and the case's
 * baseline-relative performance (from the scorecard). */
function formatSeriesLine(
  key: string,
  points: readonly BenchmarkSeriesPoint[],
  trajectoryScore: number | undefined,
  baselineScore: number | undefined,
): string {
  const name = seriesName(key);
  const unit = seriesUnit(key);
  const chain = points.map((point, index) => {
    const head = `iter${point.iteration} ${point.value.toFixed(4)}`;
    if (index === 0) return `${head} (seed)`;
    if (point.relativeDelta === undefined) return head;
    const signed = `${point.relativeDelta >= 0 ? "+" : ""}${(point.relativeDelta * 100).toFixed(1)}%`;
    const color = point.relativeDelta > 0 ? GREEN : point.relativeDelta < 0 ? RED : "";
    return `${head} ${color}(${signed})${DIM}`;
  }).join(" → ");
  const scoreTrack = trajectoryScore === undefined ? "" : `  trajectory=${trajectoryScore.toFixed(3)}(vs-iter0)`;
  const perfTrack = baselineScore === undefined ? "" : `  perf=${baselineScore.toFixed(3)}(vs-baseline)`;
  return `metrics: ${name}${unit === "" ? "" : ` ${unit}`}: ${chain}${scoreTrack}${perfTrack}`;
}

function rateColor(rate: number): string {
  if (rate >= 0.9) return GREEN;
  if (rate >= 0.7) return YELLOW;
  return RED;
}

function formatCompactTokens(tokens: number): string {
  return tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(2)}M` : String(tokens);
}

function trajectoryTokens(kase: CaseResult): number {
  return kase.workflowTrajectory?.tokens.total ?? kase.trajectory.totalTokens;
}

function trajectoryToolCalls(kase: CaseResult): number {
  return kase.workflowTrajectory?.tools.count ?? kase.trajectory.toolCallCount;
}

/** Whole-run cost scores for a native trajectory. Both numbers are
 * intrinsic ratios needing no reference: tool-ok is the share of opened
 * calls that did not fail, first-pass the share of finished stage
 * invocations accepted on attempt 1. Renders only what the streams
 * provide; returns undefined (no line at all) for legacy runs. */
function formatCostLine(kase: CaseResult): string | undefined {
  const trajectory = kase.workflowTrajectory;
  if (trajectory === undefined) return undefined;
  const parts: string[] = [`tokens=${formatCompactTokens(trajectory.tokens.total)}`];
  const toolRate = toolSuccessRate(trajectory.tools);
  if (toolRate !== undefined) {
    parts.push(`${rateColor(toolRate)}tool-ok=${(toolRate * 100).toFixed(1)}%${DIM}`);
  }
  const attempts = trajectory.duration.attempts ?? trajectory.tokens.attempts;
  if (attempts !== undefined && attempts.total > 0) {
    const rate = attempts.firstPass / attempts.total;
    parts.push(`${rateColor(rate)}first-pass=${(rate * 100).toFixed(1)}%${DIM} (${attempts.firstPass}/${attempts.total})`);
  }
  return `cost: ${parts.join(" ")}`;
}

/** The intrinsic trajectory score for the case's metric (the benchmark
 * series matching `metric.name`, else the only/first series key). */
function trajectoryScore(kase: CaseResult): number | undefined {
  const scores = kase.workflowTrajectory?.benchmarkScore?.score;
  if (scores === undefined) return undefined;
  const keys = Object.keys(scores);
  if (keys.length === 0) return undefined;
  const wanted = kase.metric === undefined ? undefined : keys.find((key) => seriesName(key) === kase.metric!.name);
  return scores[wanted ?? keys[0]!];
}

/**
 * Cell text helpers return the *unpadded* reading, or undefined when the
 * stream carried none. The matrix renderer pads and colors them, so a missing
 * reading renders as the same dash in every column and a column never has to
 * know how wide it is.
 */
function rateText(rate: number | undefined): string | undefined {
  return rate === undefined ? undefined : `${(rate * 100).toFixed(1)}%`;
}

function percentText(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function scoreText(value: number | undefined): string | undefined {
  return value === undefined ? undefined : value.toFixed(3);
}

function numberText(value: number | undefined, digits: number): string | undefined {
  return value === undefined ? undefined : value.toFixed(digits);
}

function testCountText(kase: CaseResult): string | undefined {
  const summary = kase.artifact.testSummary;
  return summary === undefined ? undefined : `${summary.passed}/${summary.passed + summary.failed}`;
}

function testIntegrityText(kase: CaseResult): string | undefined {
  const integrity = kase.codeChanges?.testIntegrity;
  return integrity === undefined ? undefined : integrity.cheating ? "CHEAT" : "OK";
}

function testIntegrityColor(kase: CaseResult): string | undefined {
  const integrity = kase.codeChanges?.testIntegrity;
  return integrity === undefined ? undefined : integrity.cheating ? RED : GREEN;
}

/** The best metric value measured during the run, from the trajectory's
 * benchmark score for the case's own metric. Undefined when the run recorded
 * no benchmark (legacy or non-performance cases). A visible gap against
 * `final` means the delivered artifact does not hold the run's best result
 * (e.g. tuning-protocol deviations); the report only shows both numbers. */
function runBest(kase: CaseResult): number | undefined {
  const name = kase.metric?.name;
  const best = name === undefined ? undefined : kase.workflowTrajectory?.benchmarkScore?.best;
  if (best === undefined) return undefined;
  const match = Object.entries(best).find(([key]) => key.split(String.fromCharCode(0))[0] === name);
  const value = match?.[1];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatDurationMs(durationMs: number | undefined): string {
  if (durationMs === undefined) return "—";
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

/** Coding cases compare implementation outcomes and costs directly. */
function codingPassText(kase: CaseResult): string | undefined {
  const summary = kase.artifact.testSummary;
  if (summary !== undefined) return `${(summary.passRate * 100).toFixed(1)}%`;
  return kase.status === "skipped" ? "SKIP" : "ERROR";
}

function codingPassColor(kase: CaseResult): string {
  const summary = kase.artifact.testSummary;
  if (summary === undefined) return kase.status === "skipped" ? DIM : RED;
  return kase.artifact.verified ? rateColor(summary.passRate) : RED;
}

/** Verification verdict of a capability probe. A probe has no metric to
 * compare against a baseline, so the grader's own verdict — did the verifier
 * accept the artifact — *is* the outcome. A case that never ran reads SKIP
 * (dim) rather than FAIL, because an unrun probe proves nothing. */
function verifiedText(kase: CaseResult): string {
  if (kase.status === "skipped") return "SKIP";
  return kase.artifact.verified ? "PASS" : "FAIL";
}

function verifiedColor(kase: CaseResult): string {
  if (kase.status === "skipped") return DIM;
  return kase.artifact.verified ? GREEN : RED;
}

/** Case-key column width for the matrix and comparison tables: the
 * historical 34, widened to the longest key plus one trailing space, so a
 * long case id cannot run into the first numeric column. */
function caseColumnWidth(keys: readonly string[]): number {
  return Math.max(34, ...keys.map((key) => key.length + 1));
}

/**
 * The matrices are data: a list of columns, one measurement each. The live
 * matrix and the Δ view render from that same list, so a metric can neither
 * drift between the two nor silently vanish from one.
 *
 * A column declares its live cell (`text`/`color`) and its Δ source
 * (`delta`); declaring only one side keeps it out of the other view. That is
 * how a composite live cell (`+128/-64` LOC) splits into two plain Δ
 * columns, and how a non-numeric live cell (test OK/CHEAT) drops out of the
 * Δ view instead of pretending to have a magnitude.
 */

/** How a metric's two records compare. `value` compares raw magnitudes: the
 * Δvalue cell is arithmetic and the Δ% cell is the relative change. `points`
 * compares 0..1 scores and rates, whose Δvalue cell reads as percentage
 * points while the Δ% cell is still the relative change of the score. */
type DeltaScale = "value" | "points";

interface DeltaRule {
  /** Numeric reading of one case, in this column's unit. */
  readonly of: (kase: CaseResult) => number | undefined;
  readonly scale: DeltaScale;
  /** Which sign is an improvement — a function when it follows the case's own
   * metric direction. */
  readonly better: "higher" | "lower" | ((current: CaseResult, previous: CaseResult) => "higher" | "lower");
  /** Decimal places of the Δvalue cell (scale `value` only). */
  readonly digits?: number;
}

/** Section inputs for columns measured relative to their peers: token and
 * time efficiency normalise against the section's cheapest run. */
interface MatrixContext {
  readonly cheapestTokens: number | undefined;
  readonly fastestMs: number | undefined;
}

/** One rendered table: the scope after the view name, the cases it covers,
 * and an optional refinement of that scope. A family that renders one table
 * per group labels it with that group's name; the developer family keeps the
 * group as the scope and appends the task/harness block it is showing. */
interface MatrixSection {
  /** Scope in parentheses after the view name, e.g. `tuning-cuda`. */
  readonly label: string;
  /** Appended after the scope, e.g. ` · task / harness`. */
  readonly detail?: string;
  readonly cases: readonly CaseResult[];
}

interface MatrixColumn {
  readonly header: string;
  /** Fixed width, or a function of the section's row keys (the key column
   * widens to its longest id). A column that only feeds the Δ view needs
   * none. */
  readonly width?: number | ((keys: readonly string[]) => number);
  /** Spaces printed before the column. The matrices use it instead of a
   * uniform join to keep related columns visually grouped. */
  readonly pad?: number;
  readonly align?: "left" | "right";
  /** Row identity: printed by both views. A non-key column with no `delta` is
   * live-matrix only. */
  readonly key?: boolean;
  readonly text?: (kase: CaseResult, context: MatrixContext) => string | undefined;
  readonly color?: (kase: CaseResult, context: MatrixContext) => string | undefined;
  readonly delta?: DeltaRule;
}

/**
 * A state-valued column in a Δ table. A verdict or a status is not a
 * magnitude: what changed is a transition (`PASS → FAIL`), not a subtraction,
 * so it takes one cell instead of a `Δvalue`/`Δ%` pair. A family declares
 * these through its own {@link MatrixFamily.delta} rather than through a
 * column, because a transition has no place in the live matrix's arithmetic.
 */
interface DeltaTransition {
  readonly header: string;
  /** The transition and its color, or undefined when neither side has a
   * reading. */
  readonly of: (current: CaseResult, previous: CaseResult) => { readonly text: string; readonly tone: string } | undefined;
}

/**
 * How one family of case groups is measured.
 *
 * A case's `group` says what it measures (`tuning-cuda`, `tuning`, `develop`,
 * …), and a family answers two questions about those groups: which ones does
 * it render, and what columns do they get. Selection and display are separate
 * on purpose — `--group <keyword>` is a *selection* that decides which cases
 * enter the board, while a case's own group decides how that case is drawn.
 * A selection keyword is not a group name, so it must never stand in for one:
 * a case re-keyed to a keyword would lose the only thing that says how to
 * show it.
 */
interface MatrixFamily {
  readonly id: string;
  /** True for every group this family renders, matched by name prefix so a
   * new measurement group joins its family by name alone. */
  readonly ownsGroup: (group: string) => boolean;
  /** Stable row identity: the key column's text, the row sort key, and the
   * width source. */
  readonly rowKey: (kase: CaseResult) => string;
  readonly columns: readonly MatrixColumn[];
  /** Split a group's cases into independently rendered tables. */
  readonly sections: (group: string, cases: readonly CaseResult[]) => readonly MatrixSection[];
  /** Render this family's Δ table. Every family goes through the same
   * interface, and the generic column-driven board — a `Δvalue`/`Δ%` pair per
   * metric column — is the default; a family whose measurements are not all
   * magnitudes can supply its own implementation instead of contorting the
   * generic one. */
  readonly delta?: (
    section: MatrixSection,
    records: readonly DeltaRecord[],
    layout: DeltaLayout,
  ) => string[];
  /** Extra line printed under a row (the developer family's thinking-level
   * mismatch warning). */
  readonly note?: (kase: CaseResult) => string | undefined;
}

/** Whether `group` is one of `names`, or a sub-group of one. One family holds
 * a whole measurement kind: `tuning`, `tuning-cuda`, and a future
 * `tuning-triton` all render the tuning columns, so a group that only splits
 * by backend never needs its own display. */
function groupFamily(group: string, ...names: readonly string[]): boolean {
  return names.some((name) => group === name || group.startsWith(`${name}-`));
}

/** The case's own metric decides which way a value column moves, with
 * `higher` as the fallback for runs that recorded no metric. */
const metricDirection = (current: CaseResult, previous: CaseResult): "higher" | "lower" =>
  (current.metric ?? previous.metric)?.direction ?? "higher";

/** Token efficiency against the section's cheapest verified run. */
function tokenEfficiency(kase: CaseResult, context: MatrixContext): number | undefined {
  return context.cheapestTokens === undefined
    ? undefined
    : normalizeMetric(trajectoryTokens(kase), "lower", context.cheapestTokens);
}

/** Wall-time efficiency against the section's fastest run. */
function timeEfficiency(kase: CaseResult, context: MatrixContext): number | undefined {
  if (context.fastestMs === undefined || kase.durationMs === undefined || kase.durationMs <= 0) return undefined;
  return normalizeMetric(kase.durationMs, "lower", context.fastestMs);
}

/** The tuning family's columns: what a measured run achieved and what it cost
 * — outcome values first (`final/best/base/vs-base`), then the dimension
 * scores, then cost and code shape. Efficiencies reuse the composite's
 * normalizeMetric curve, so the cheapest case reads 0.5 (parity) and the
 * group-mean of a column equals that group's scored dimension. Also the
 * fallback for a group that belongs to no family of its own. */
const TUNING_MATRIX_FAMILY: MatrixFamily = {
  id: "tuning",
  ownsGroup: (group) => groupFamily(group, "tuning"),
  rowKey: (kase) => `${kase.caseId}#${kase.trial}`,
  columns: [
    {
      header: "case",
      width: (keys) => caseColumnWidth(keys),
      align: "left",
      key: true,
      text: (kase) => `${kase.caseId}#${kase.trial}`,
    },
    {
      header: "final",
      width: 8,
      text: (kase) => numberText(kase.artifact.value, 4),
      delta: { of: (kase) => kase.artifact.value, scale: "value", digits: 4, better: metricDirection },
    },
    {
      header: "best",
      width: 8,
      text: (kase) => numberText(runBest(kase), 4),
      delta: { of: (kase) => runBest(kase), scale: "value", digits: 4, better: metricDirection },
    },
    {
      header: "base",
      width: 8,
      text: (kase) => numberText((kase.artifact.baseline ?? kase.baseline)?.value, 4),
      delta: {
        of: (kase) => (kase.artifact.baseline ?? kase.baseline)?.value,
        scale: "value",
        digits: 4,
        better: metricDirection,
      },
    },
    {
      header: "vs-base",
      width: 9,
      text: (kase) => percentText(kase.baselineComparison?.relativeImprovement),
      color: (kase) => {
        const value = kase.baselineComparison?.relativeImprovement;
        return value === undefined ? undefined : value >= 0 ? GREEN : RED;
      },
      delta: { of: (kase) => kase.baselineComparison?.relativeImprovement, scale: "points", better: "higher" },
    },
    {
      // A case without a performance readout has no metric; the scorecard's 0
      // there means N/A (same signal as quality excluding the dimension).
      header: "perf",
      pad: 2,
      width: 6,
      text: (kase) => scoreText(kase.metric === undefined ? undefined : kase.scorecard?.performance),
      color: (kase) => (kase.scorecard === undefined ? undefined : colorFor(kase.scorecard.performance)),
      delta: {
        of: (kase) => (kase.metric === undefined ? undefined : kase.scorecard?.performance),
        scale: "points",
        better: "higher",
      },
    },
    {
      header: "traj",
      pad: 2,
      width: 6,
      text: (kase) => scoreText(trajectoryScore(kase)),
      color: (kase) => {
        const value = trajectoryScore(kase);
        return value === undefined ? undefined : colorFor(value);
      },
      delta: { of: (kase) => trajectoryScore(kase), scale: "points", better: "higher" },
    },
    {
      header: "sel",
      pad: 2,
      width: 6,
      text: (kase) => rateText(selectionApplyRate(kase.workflowTrajectory?.selection)),
      color: (kase) => {
        const rate = selectionApplyRate(kase.workflowTrajectory?.selection);
        return rate === undefined ? undefined : rateColor(rate);
      },
      delta: { of: (kase) => selectionApplyRate(kase.workflowTrajectory?.selection), scale: "points", better: "higher" },
    },
    {
      header: "quality",
      pad: 2,
      width: 7,
      text: (kase) => scoreText(kase.scorecard?.quality),
      color: (kase) => {
        const value = kase.scorecard?.quality;
        return value === undefined ? undefined : colorFor(value);
      },
      delta: { of: (kase) => kase.scorecard?.quality, scale: "points", better: "higher" },
    },
    {
      header: "tool-ok",
      pad: 2,
      width: 7,
      text: (kase) => rateText(toolSuccessRate(kase.workflowTrajectory?.tools)),
      color: (kase) => {
        const rate = toolSuccessRate(kase.workflowTrajectory?.tools);
        return rate === undefined ? undefined : rateColor(rate);
      },
      delta: { of: (kase) => toolSuccessRate(kase.workflowTrajectory?.tools), scale: "points", better: "higher" },
    },
    {
      header: "1st-pass",
      width: 9,
      text: (kase) => rateText(firstPassRate(kase)),
      color: (kase) => {
        const rate = firstPassRate(kase);
        return rate === undefined ? undefined : rateColor(rate);
      },
      delta: { of: (kase) => firstPassRate(kase), scale: "points", better: "higher" },
    },
    {
      // No Δ cell: this reading normalises against the section's own cheapest
      // run, so the two sides of a comparison would be measured against
      // different references and their difference would mean nothing.
      header: "tok-eff",
      pad: 2,
      width: 7,
      text: (kase, context) => scoreText(tokenEfficiency(kase, context)),
      color: (kase, context) => {
        const value = tokenEfficiency(kase, context);
        return value === undefined ? undefined : colorFor(value);
      },
    },
    {
      header: "time-eff",
      width: 9,
      text: (kase, context) => scoreText(timeEfficiency(kase, context)),
      color: (kase, context) => {
        const value = timeEfficiency(kase, context);
        return value === undefined ? undefined : colorFor(value);
      },
    },
    {
      header: "LOC",
      pad: 2,
      width: 7,
      text: (kase) => numberText(kase.codeChanges?.total, 0),
      delta: { of: (kase) => kase.codeChanges?.total, scale: "value", digits: 0, better: "lower" },
    },
    {
      header: "files",
      width: 7,
      text: (kase) => numberText(kase.codeChanges?.files, 0),
      delta: { of: (kase) => kase.codeChanges?.files, scale: "value", digits: 0, better: "lower" },
    },
    {
      header: "test",
      width: 7,
      text: testIntegrityText,
      color: testIntegrityColor,
      // OK/CHEAT is not a magnitude, so it has no Δ cell.
    },
    {
      header: "tools",
      width: 7,
      text: (kase) => numberText(trajectoryToolCalls(kase), 0),
      delta: { of: (kase) => trajectoryToolCalls(kase), scale: "value", digits: 0, better: "lower" },
    },
    {
      header: "tokens",
      width: 8,
      text: (kase) => formatCompactTokens(trajectoryTokens(kase)),
      delta: { of: (kase) => trajectoryTokens(kase), scale: "value", digits: 0, better: "lower" },
    },
    {
      header: "time",
      pad: 2,
      width: 6,
      text: (kase) => `${Math.round((kase.durationMs ?? 0) / 60_000)}m`,
      delta: { of: (kase) => kase.durationMs, scale: "value", digits: 0, better: "lower" },
    },
  ],
  sections: (group, cases) => [{ label: group, cases }],
};

/** Placeholder for a developer case whose matrix dimensions are missing. */
const UNKNOWN_DIMENSION = "—";

/** Model + effort + trial: a developer case is identified by what ran, not by
 * its workflow file name. Falls back to the case key for a developer case
 * that carries no dimensions. */
function developRowKey(kase: CaseResult): string {
  const dimensions = kase.dimensions;
  return dimensions === undefined
    ? `${kase.caseId}#${kase.trial}`
    : `${dimensions.model}#${dimensions.effort}#${kase.trial}`;
}

/** The developer family's columns: coding cases compare implementation
 * outcomes and costs directly. They carry no tuning metrics, baselines, or
 * selection trajectories, so those columns would only add a wall of dashes.
 * Rows are grouped by task and harness so a model's runs sit next to their
 * peers. */
const DEVELOP_MATRIX_FAMILY: MatrixFamily = {
  id: "develop",
  ownsGroup: (group) => groupFamily(group, "develop"),
  rowKey: developRowKey,
  columns: [
    {
      header: "model",
      width: 18,
      align: "left",
      key: true,
      text: (kase) => kase.dimensions?.model,
    },
    {
      header: "effort#",
      width: 8,
      pad: 1,
      align: "left",
      key: true,
      text: (kase) => (kase.dimensions === undefined ? undefined : `${kase.dimensions.effort}#${kase.trial}`),
    },
    {
      header: "tests",
      width: 9,
      pad: 1,
      text: testCountText,
    },
    {
      header: "pass%",
      width: 6,
      pad: 1,
      text: codingPassText,
      color: codingPassColor,
      delta: { of: (kase) => kase.artifact.testSummary?.passRate, scale: "points", better: "higher" },
    },
    {
      header: "skip",
      width: 4,
      pad: 1,
      text: (kase) => numberText(kase.artifact.testSummary?.skipped, 0),
      delta: { of: (kase) => kase.artifact.testSummary?.skipped, scale: "value", digits: 0, better: "lower" },
    },
    {
      header: "test",
      width: 5,
      pad: 1,
      text: testIntegrityText,
      color: testIntegrityColor,
    },
    {
      header: "files",
      width: 5,
      pad: 1,
      text: (kase) => numberText(kase.codeChanges?.files, 0),
      delta: { of: (kase) => kase.codeChanges?.files, scale: "value", digits: 0, better: "lower" },
    },
    {
      // The live cell is composite, so it cannot carry a Δ; the Δ view splits
      // it into the two plain magnitudes below.
      header: "+/-LOC",
      width: 9,
      pad: 1,
      text: (kase) => (kase.codeChanges === undefined
        ? undefined
        : `+${kase.codeChanges.additions}/-${kase.codeChanges.deletions}`),
    },
    {
      header: "+LOC",
      delta: { of: (kase) => kase.codeChanges?.additions, scale: "value", digits: 0, better: "lower" },
    },
    {
      header: "-LOC",
      delta: { of: (kase) => kase.codeChanges?.deletions, scale: "value", digits: 0, better: "lower" },
    },
    {
      header: "tool",
      width: 4,
      pad: 1,
      text: (kase) => numberText(trajectoryToolCalls(kase), 0),
      delta: { of: (kase) => trajectoryToolCalls(kase), scale: "value", digits: 0, better: "lower" },
    },
    {
      header: "token",
      width: 6,
      pad: 1,
      text: (kase) => formatCompactTokens(trajectoryTokens(kase)),
      delta: { of: (kase) => trajectoryTokens(kase), scale: "value", digits: 0, better: "lower" },
    },
    {
      header: "time",
      width: 6,
      pad: 1,
      text: (kase) => formatDurationMs(kase.durationMs),
      delta: { of: (kase) => kase.durationMs, scale: "value", digits: 0, better: "lower" },
    },
  ],
  sections: (group, cases) => {
    const sections: MatrixSection[] = [];
    for (const [task, taskCases] of groupSorted(cases, (kase) => kase.dimensions?.task ?? UNKNOWN_DIMENSION)) {
      for (const [harness, harnessCases] of groupSorted(taskCases, (kase) => kase.dimensions?.harness ?? UNKNOWN_DIMENSION)) {
        // A case without dimensions has nothing to refine the scope with, so
        // the table keeps the plain `Matrix (<group>)` title.
        const detail = task === UNKNOWN_DIMENSION && harness === UNKNOWN_DIMENSION
          ? undefined
          : ` · ${task} / ${harness}`;
        sections.push({ label: group, ...(detail === undefined ? {} : { detail }), cases: harnessCases });
      }
    }
    return sections;
  },
  note: (kase) => {
    const dimensions = kase.dimensions;
    if (dimensions === undefined) return undefined;
    const effective = kase.stageTrajectories?.find((stage) => stage.thinkingLevel !== undefined)?.thinkingLevel;
    if (effective === undefined || effective === dimensions.effort) return undefined;
    return `${YELLOW}  ! thinking: ${dimensions.model} ${dimensions.effort}#${kase.trial}`
      + ` requested=${dimensions.effort} effective=${effective}${RST}`;
  },
};

/** The agentic family: basic-capability probes, one small task each (create a
 * file, edit JSON, move files around, write a script). A probe has no metric
 * and no baseline, and usually no test suite — it asks whether the agent can
 * drive its tools well enough to finish the job at all. So the columns are
 * the verdict (`verified`, `quality`), tool competence (`tool-ok`,
 * `1st-pass`), what it actually touched (`files`, `LOC`, `test`), and cost —
 * the tuning columns (`final/best/base/vs-base/perf/traj/sel`) would be a wall
 * of dashes. */

/** Verdicts ranked so a transition can be explained: passing is the outcome a
 * probe wants, failing is a lost capability, and an unrun probe sits between
 * them because it proves nothing either way. */
const VERDICT_RANK: Readonly<Record<string, number>> = { FAIL: 0, SKIP: 1, PASS: 2 };

/** The verdict as a transition. A probe's outcome is a state, so the Δ board
 * shows `FAIL → PASS` rather than a number that only says how much `quality`
 * moved. */
const VERDICT_TRANSITION: DeltaTransition = {
  header: "verified",
  of: (current, previous) => {
    const from = verifiedText(previous);
    const to = verifiedText(current);
    const before = VERDICT_RANK[from] ?? 0;
    const after = VERDICT_RANK[to] ?? 0;
    return {
      text: `${from} → ${to}`,
      tone: after > before ? GREEN : after < before ? RED : DIM,
    };
  },
};

const AGENTIC_MATRIX_FAMILY: MatrixFamily = {
  id: "agentic",
  ownsGroup: (group) => groupFamily(group, "agentic"),
  rowKey: (kase) => `${kase.caseId}#${kase.trial}`,
  columns: [
    {
      header: "case",
      width: (keys) => caseColumnWidth(keys),
      align: "left",
      key: true,
      text: (kase) => `${kase.caseId}#${kase.trial}`,
    },
    {
      // The verdict, not a magnitude: no Δ cell.
      header: "verified",
      width: 8,
      text: verifiedText,
      color: verifiedColor,
    },
    {
      header: "quality",
      width: 7,
      pad: 2,
      text: (kase) => scoreText(kase.scorecard?.quality),
      color: (kase) => {
        const value = kase.scorecard?.quality;
        return value === undefined ? undefined : colorFor(value);
      },
      delta: { of: (kase) => kase.scorecard?.quality, scale: "points", better: "higher" },
    },
    {
      header: "tool-ok",
      width: 7,
      pad: 2,
      text: (kase) => rateText(toolSuccessRate(kase.workflowTrajectory?.tools)),
      color: (kase) => {
        const rate = toolSuccessRate(kase.workflowTrajectory?.tools);
        return rate === undefined ? undefined : rateColor(rate);
      },
      delta: { of: (kase) => toolSuccessRate(kase.workflowTrajectory?.tools), scale: "points", better: "higher" },
    },
    {
      header: "1st-pass",
      width: 8,
      pad: 1,
      text: (kase) => rateText(firstPassRate(kase)),
      color: (kase) => {
        const rate = firstPassRate(kase);
        return rate === undefined ? undefined : rateColor(rate);
      },
      delta: { of: (kase) => firstPassRate(kase), scale: "points", better: "higher" },
    },
    {
      // No Δ cell, for the same reason as the tuning family's: the reading is
      // relative to the section's own cheapest run.
      header: "tok-eff",
      width: 7,
      pad: 2,
      text: (kase, context) => scoreText(tokenEfficiency(kase, context)),
      color: (kase, context) => {
        const value = tokenEfficiency(kase, context);
        return value === undefined ? undefined : colorFor(value);
      },
    },
    {
      header: "time-eff",
      width: 8,
      pad: 2,
      text: (kase, context) => scoreText(timeEfficiency(kase, context)),
      color: (kase, context) => {
        const value = timeEfficiency(kase, context);
        return value === undefined ? undefined : colorFor(value);
      },
    },
    {
      header: "files",
      width: 5,
      pad: 1,
      text: (kase) => numberText(kase.codeChanges?.files, 0),
      delta: { of: (kase) => kase.codeChanges?.files, scale: "value", digits: 0, better: "lower" },
    },
    {
      header: "LOC",
      width: 6,
      pad: 1,
      text: (kase) => numberText(kase.codeChanges?.total, 0),
      delta: { of: (kase) => kase.codeChanges?.total, scale: "value", digits: 0, better: "lower" },
    },
    {
      header: "test",
      width: 5,
      pad: 1,
      text: testIntegrityText,
      color: testIntegrityColor,
    },
    {
      header: "tools",
      width: 5,
      pad: 1,
      text: (kase) => numberText(trajectoryToolCalls(kase), 0),
      delta: { of: (kase) => trajectoryToolCalls(kase), scale: "value", digits: 0, better: "lower" },
    },
    {
      header: "tokens",
      width: 7,
      pad: 1,
      text: (kase) => formatCompactTokens(trajectoryTokens(kase)),
      delta: { of: (kase) => trajectoryTokens(kase), scale: "value", digits: 0, better: "lower" },
    },
    {
      header: "time",
      width: 6,
      pad: 1,
      text: (kase) => formatDurationMs(kase.durationMs),
      delta: { of: (kase) => kase.durationMs, scale: "value", digits: 0, better: "lower" },
    },
  ],
  sections: (group, cases) => [{ label: group, cases }],
  // The generic board subtracts numbers, and a probe's first question is not
  // how far a number moved but whether a capability survived. `quality`
  // collapsing does show a failure as -100.0pp, but the reverse — a probe that
  // went from failing to passing — reads there as a plain gain, with no sign
  // that the capability had been missing. So this family renders its own board
  // and puts the verdict transition ahead of the metrics.
  delta: (section, records, layout) =>
    formatDeltaSection(section, AGENTIC_MATRIX_FAMILY, records, layout, [VERDICT_TRANSITION]),
};

/** The families that claim a group, in match order. Each family owns disjoint
 * groups (`develop` / `agentic` / `tuning*`), so the order is not a precedence
 * rule, only a list. */
const MATRIX_FAMILIES: readonly MatrixFamily[] = [
  DEVELOP_MATRIX_FAMILY,
  AGENTIC_MATRIX_FAMILY,
  TUNING_MATRIX_FAMILY,
];

/** The columns a group is displayed with. A group that belongs to no family
 * yet falls back to the tuning columns rather than to a blank table. */
function matrixFamilyFor(group: string): MatrixFamily {
  return MATRIX_FAMILIES.find((family) => family.ownsGroup(group)) ?? TUNING_MATRIX_FAMILY;
}

/** Cases bucketed by a key, in key order, so both views render the same
 * groups in the same order. */
function groupSorted<T>(items: readonly T[], key: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

/** The independently rendered tables of one group's cases: the group's own
 * family decides the columns, and how it splits its rows into tables. */
function groupSections<S>(
  group: string,
  items: readonly S[],
  kase: (item: S) => CaseResult,
): readonly (MatrixSection & { readonly family: MatrixFamily; readonly items: readonly S[] })[] {
  const family = matrixFamilyFor(group);
  return family.sections(group, items.map(kase)).map((section) => {
    const members = new Set(section.cases.map((member) => `${member.caseId}#${member.trial}`));
    return {
      ...section,
      family,
      items: items.filter((item) => members.has(`${kase(item).caseId}#${kase(item).trial}`)),
    };
  });
}

/** Per-section inputs for the columns that measure against their peers. */
function matrixContext(cases: readonly CaseResult[]): MatrixContext {
  const tokenPool = cases.filter((kase) => kase.artifact.verified && trajectoryTokens(kase) > 0);
  const timePool = cases.map((kase) => kase.durationMs).filter((ms): ms is number => ms !== undefined && ms > 0);
  return {
    cheapestTokens: tokenPool.length === 0 ? undefined : Math.min(...tokenPool.map((kase) => trajectoryTokens(kase))),
    fastestMs: timePool.length === 0 ? undefined : Math.min(...timePool),
  };
}

function columnWidth(column: MatrixColumn, keys: readonly string[]): number {
  if (typeof column.width === "function") return column.width(keys);
  return column.width ?? column.header.length;
}

/** One cell. A column only colors a cell it actually has a reading for, so a
 * missing reading is the same plain dash in every column. */
function matrixCell(column: MatrixColumn, kase: CaseResult, context: MatrixContext, width: number): string {
  const text = column.text?.(kase, context);
  if (text === undefined) return "—".padStart(width);
  const padded = column.align === "left" ? text.padEnd(width) : text.padStart(width);
  const color = column.color?.(kase, context);
  return color === undefined ? padded : `${color}${padded}${DIM}`;
}

function rowGap(column: MatrixColumn): string {
  return " ".repeat(column.pad ?? 0);
}

function sectionRows(family: MatrixFamily, cases: readonly CaseResult[]): CaseResult[] {
  return [...cases].sort((left, right) => family.rowKey(left).localeCompare(family.rowKey(right)));
}

/** One live matrix table: a header row and one row per case. */
function formatMatrixSection(section: MatrixSection, family: MatrixFamily): string[] {
  const rows = sectionRows(family, section.cases);
  const columns = family.columns.filter((column) => column.text !== undefined);
  const context = matrixContext(rows);
  const widths = columns.map((column) => columnWidth(column, rows.map(family.rowKey)));
  const header = columns.map((column, index) => `${rowGap(column)}`
    + (column.align === "left"
      ? column.header.padEnd(widths[index]!)
      : column.header.padStart(widths[index]!))).join("");
  const lines = [
    `${BOLD}Matrix (${section.label})${section.detail ?? ""}${RST}  ${DIM}[${rows.length} case(s)]${RST}`,
    `  ${DIM}${header}${RST}`,
  ];
  for (const kase of rows) {
    lines.push(`  ${columns.map((column, index) => `${rowGap(column)}${matrixCell(column, kase, context, widths[index]!)}`).join("")}`);
    const note = family.note?.(kase);
    if (note !== undefined) lines.push(note);
  }
  lines.push("");
  return lines;
}

/** One table per group (and, for the developer family, per task/harness):
 * same-group runs compared dim by dim — outcome, scores, and cost. A group
 * under `minCases` renders nothing, so a stored run set never shows a
 * single-case matrix while an assembled selection view passes 1 to force it.
 * Missing dimensions render as — (legacy runs). */
function formatMatrixTables(cases: readonly CaseResult[], minCases = 2): string[] {
  const lines: string[] = [];
  for (const [group, groupCases] of groupSorted(cases, (kase) => kase.group)) {
    if (groupCases.length < minCases) continue;
    for (const section of groupSections(group, groupCases, (kase) => kase)) {
      lines.push(...formatMatrixSection(section, section.family));
    }
  }
  return lines;
}

function formatGroup(group: ScoreGroup): string {
  const lines: string[] = [];
  lines.push(`${BOLD}${group.key}${RST}  ${DIM}[${group.caseIds.length} case(s)]${RST}`);
  for (const score of group.scores) {
    const color = colorFor(score.value);
    lines.push(
      `  ${score.name.padEnd(14)} ${color}${bar(score.value)}${RST} ${score.value.toFixed(3)}  ${DIM}(${score.direction})${RST}`,
    );
  }
  lines.push(`  ${"composite".padEnd(14)} ${colorFor(group.composite)}${bar(group.composite)}${RST} ${group.composite.toFixed(3)}`);
  return lines.join("\n");
}

/** Render a full eval report as text. Detail precedes summary: the same-group
 * matrix (rows are cases, columns are the key metrics) and each case's run
 * process print first, and the aggregate rollups (overall, group scorecards,
 * independent-trial summary, variants) print last. `minMatrixCases: 1` forces
 * the matrix even for single-case groups (assembled selection views).
 * `details: false` drops the per-case process print (status/stage/series
 * lines): offline analysis primarily reads the matrix plus the score
 * summary, so the wall of detail lines becomes opt-in. */
export function formatReport(
  report: EvalReport,
  options?: { readonly minMatrixCases?: number; readonly details?: boolean },
): string {
  const lines: string[] = [];
  lines.push(`${BOLD}Workflow evals report${RST}`);
  lines.push(`${DIM}run set: ${report.runSetId}  recorded: ${report.createdAt}  cases: ${report.cases.length}${RST}`);
  lines.push("");
  // Same-group cross-case matrix: variant cases (different workflow ids)
  // never share a # Variants table, so this is where harness/model variants
  // become comparable dim by dim. Groups under the minimum case count render
  // nothing.
  const matrixLines = formatMatrixTables(report.cases, options?.minMatrixCases);
  if (matrixLines.length > 0) {
    lines.push(...matrixLines);
  }
  if (options?.details !== false) {
  lines.push(`${DIM}# Cases${RST}`);
  for (const kase of report.cases) {
    const status = kase.status === "completed"
      ? `${GREEN}ok${RST}`
      : kase.status === "skipped"
        ? `${YELLOW}${kase.status}${RST}`
        : `${RED}${kase.status}${RST}`;
    const metric = kase.artifact.value !== undefined
      ? ` metric=${kase.artifact.value.toFixed(4)}`
      : kase.metric === undefined ? "" : " metric=n/a";
    const verified = kase.artifact.verified ? "" : ` ${RED}(unverified)${RST}`;
    const stageCount = kase.stageTrajectories?.length ?? 0;
    const progressCount = kase.progress?.length ?? 0;
    const snapshot = kase.progressSnapshot;
    const completedStages = typeof snapshot?.completedStages === "number" ? snapshot.completedStages : undefined;
    const plannedStages = typeof snapshot?.plannedStages === "number" ? snapshot.plannedStages : undefined;
    const current = typeof snapshot?.current === "object" && snapshot.current !== null
      ? snapshot.current as Record<string, unknown>
      : undefined;
    const currentLabel = typeof current?.stageId === "string"
      ? ` current=${current.stageId}${typeof current.invocationId === "string" ? `@${current.invocationId.split("@")[1] ?? "root"}` : ""}`
      : "";
    const plannedLabel = completedStages === undefined || plannedStages === undefined
      ? ""
      : ` completed=${completedStages}/${plannedStages}`;
    const baselineMeasurement = kase.artifact.baseline ?? kase.baseline;
    const baseline = baselineMeasurement?.value === undefined
      ? kase.metric === undefined ? "" : " baseline=n/a"
      : ` baseline=${baselineMeasurement.value.toFixed(4)}`;
    const comparison = kase.baselineComparison;
    const improvement = comparison?.absoluteImprovement === undefined
      ? kase.metric === undefined ? "" : " improvement=n/a"
      : ` improvement=${comparison.absoluteImprovement >= 0 ? "+" : ""}${comparison.absoluteImprovement.toFixed(4)}${comparison.relativeImprovement === undefined ? "" : ` (${comparison.relativeImprovement >= 0 ? "+" : ""}${(comparison.relativeImprovement * 100).toFixed(1)}%)`} ${comparison.improved ? "improved" : "not-improved"}`;
    const scorecard = kase.scorecard;
    const quality = scorecard === undefined ? "" : ` quality=${scorecard.quality.toFixed(3)} accepted=${scorecard.accepted ? "yes" : "no"}`;
    const evidenceState = kase.evidence === undefined ? "unknown" : kase.evidence.evidencePass ? "pass" : "fail";
    const tests = kase.artifact.testSummary;
    const testState = tests === undefined
      ? " tests=n/a"
      : ` tests=${tests.passed}/${tests.passed + tests.failed} pass=${(tests.passRate * 100).toFixed(1)}% failed=${tests.failed} skipped=${tests.skipped}`;
    lines.push(
      `  ${`${kase.caseId}#${kase.trial}`.padEnd(24)} ${status}${metric}${verified}${baseline}${improvement}${quality} evidence=${evidenceState}${testState} loc=${kase.codeChanges?.total ?? "n/a"} (+${kase.codeChanges?.additions ?? 0}/-${kase.codeChanges?.deletions ?? 0}) files=${kase.codeChanges?.files ?? "n/a"} test=${kase.codeChanges === undefined ? "n/a" : kase.codeChanges.testIntegrity.cheating ? "CHEAT" : "OK"} tokens=${trajectoryTokens(kase)} rounds=${kase.trajectory.rounds} messages=${kase.trajectory.messageCount} tools=${trajectoryToolCalls(kase)} stages=${stageCount} progress=${progressCount}${plannedLabel}${currentLabel} time=${kase.durationMs ?? 0}ms`,
    );
    const costLine = formatCostLine(kase);
    if (costLine !== undefined) {
      lines.push(`    ${DIM}${costLine}${RST}`);
    }
    const measurements = kase.artifact.measurements ?? [];
    // A native multi-iteration trajectory renders the collapsed per-iteration
    // series (iteration best, vs-previous delta) with both score tracks;
    // everything else keeps the raw measurement chain line exactly as before.
    const benchmarkScore = kase.workflowTrajectory?.benchmarkScore;
    const seriesEntries = Object.entries(benchmarkScore?.series ?? {})
      .filter(([, points]) => points.length >= 2)
      .filter(([key]) => kase.metric === undefined || seriesName(key) === kase.metric.name);
    if (seriesEntries.length > 0) {
      for (const [key, points] of seriesEntries) {
        lines.push(`    ${DIM}${formatSeriesLine(key, points, benchmarkScore?.score?.[key], kase.scorecard?.performance)}${RST}`);
      }
    } else if (measurements.length > 0) {
      lines.push(`    ${DIM}metrics: ${measurements.map((measurement) => `iter${measurement.iteration ?? "?"} ${measurement.metric ?? "metric"}=${measurement.value ?? "?"}${measurement.unit === undefined ? "" : ` ${measurement.unit}`}`).join(" → ")}${RST}`);
    } else if (kase.metric !== undefined) {
      lines.push(`    ${RED}progress: no recognized benchmark measurements${RST}`);
    }
    for (const issue of kase.evidence?.issues ?? []) {
      lines.push(`    ${RED}evidence issue=${issue.code}: ${issue.message}${issue.path === undefined ? "" : ` [${issue.path}]`}${RST}`);
    }
    for (const stage of kase.stageTrajectories ?? []) {
      const model = stage.model ?? "configured";
      const thinking = stage.thinkingLevel ?? "configured";
      const requestedModel = stage.requestedModel ?? "default";
      const requestedThinking = stage.requestedThinkingLevel ?? "default";
      const requestedTools = stage.requestedTools?.join(",") ?? "default";
      const transcript = stage.transcriptPath ?? "n/a";
      const workspace = stage.workspaceCwd ?? "n/a";
      lines.push(
        `    ${DIM}stage ${stage.stageId}#${stage.invocationId} iter=${stage.iteration ?? "-"} rounds=${stage.rounds} tools=${stage.toolCallCount} tokens=${stage.totalTokens} time=${stage.durationMs ?? 0}ms model=${model} requestedModel=${requestedModel} thinking=${thinking} requestedThinking=${requestedThinking} requestedTools=${requestedTools} cwd=${workspace} transcript=${transcript}${RST}`,
      );
    }
    const progressRecords = kase.progress ?? [];
    for (const record of progressRecords) {
      lines.push(
        `    ${DIM}progress ${String(record.stageId ?? record.stage ?? "stage")} invocation=${String(record.invocationId ?? "n/a")} iter=${record.iteration ?? "-"} transcript=${String(record.transcriptPath ?? "n/a")}${RST}`,
      );
    }
  }
  }
  lines.push("");
  // Summary block: aggregates print after all case detail. The "overall"
  // group and any tag/group rollup whose case set is identical to overall's
  // restate the same numbers under a different label, so they are pruned;
  // only scorecards over a different membership add information.
  lines.push(`${BOLD}Overall${RST}  ${colorFor(report.overall)}${bar(report.overall)}${RST} ${report.overall.toFixed(3)}`);
  lines.push(`${DIM}pass rate: ${(report.summary.passRate * 100).toFixed(1)}%  accepted: ${report.summary.accepted}/${report.summary.trials}  evidence: ${(report.summary.evidencePassRate * 100).toFixed(1)}%  avg tokens: ${report.summary.averageTokens.toFixed(0)}  avg rounds: ${report.summary.averageRounds.toFixed(1)}  avg tools: ${report.summary.averageToolCalls.toFixed(1)}  avg time: ${report.summary.averageDurationMs.toFixed(0)}ms${RST}`);
  const overall = report.groups.find((group) => group.key === "overall");
  const overallMembership = overall === undefined ? undefined : [...overall.caseIds].sort().join(",");
  for (const group of report.groups) {
    if (group.key === "overall") continue;
    if (overallMembership !== undefined && [...group.caseIds].sort().join(",") === overallMembership) continue;
    lines.push("");
    lines.push(formatGroup(group));
  }
  lines.push("");
  lines.push(`${DIM}# Independent-trial summary${RST}`);
  for (const kase of report.summary.cases) {
    lines.push(`  ${kase.caseId.padEnd(24)} pass=${kase.passed}/${kase.trials} accepted=${kase.accepted}/${kase.trials} evidence=${(kase.evidencePassRate * 100).toFixed(1)}% pass@${kase.trials}=${kase.passAtK} first-pass=${kase.firstPass} avgTokens=${kase.averageTokens.toFixed(0)} avgRounds=${kase.averageRounds.toFixed(1)} avgTools=${kase.averageToolCalls.toFixed(1)} avgTime=${kase.averageDurationMs.toFixed(0)}ms`);
  }
  for (const comparison of report.variants) {
    lines.push("");
    lines.push(`${DIM}# Variants (${comparison.caseId})${RST}`);
    for (const variant of comparison.variants) {
      lines.push(`  ${variant.variant.padEnd(20)} quality=${variant.quality.toFixed(3)} accepted=${(variant.acceptedRate * 100).toFixed(1)}%${variant.finalMetric === undefined ? "" : ` final=${variant.finalMetric}`}${variant.baselineMetric === undefined ? "" : ` baseline=${variant.baselineMetric}`}`);
    }
  }
  lines.push("");
  lines.push(`${DIM}evidence is strict: task, execution, and durable evidence are reported separately${RST}`);
  return lines.join("\n");
}

/** First-pass acceptance rate for a case's native trajectory, if recorded. */
function firstPassRate(kase: CaseResult): number | undefined {
  const attempts = kase.workflowTrajectory?.duration.attempts ?? kase.workflowTrajectory?.tokens.attempts;
  return attempts !== undefined && attempts.total > 0 ? attempts.firstPass / attempts.total : undefined;
}

/**
 * Δ view over a selection: for every selected case, how each metric of its own
 * matrix moved from that case's previous stored record to its latest one.
 *
 * The columns come from the same family the live matrix renders, so a Δ board
 * can never cover a different set of metrics than the matrix above it. Every
 * metric contributes a `Δvalue` cell (arithmetic for raw magnitudes,
 * percentage points for 0..1 scores and rates) and a `Δ%` cell (the relative
 * change), both signed and colored by which way is an improvement. A case
 * whose previous record is missing keeps a row marked NEW, and a metric with
 * no reading on either side renders — rather than a misleading zero.
 */

/** One case's latest record paired with its previous one. The two sides can
 * come from different run sets: a selection takes each case's newest
 * occurrence wherever it lives, and this case's own previous occurrence is its
 * predecessor — not the run set that happens to precede the newest one. */
export interface DeltaRecord {
  readonly current: CaseResult;
  /** Previous stored record of the same case; absent on a first run. */
  readonly previous?: CaseResult;
  readonly currentRunSet: string;
  readonly previousRunSet?: string;
}

/** Side-by-side metric slots (`Δvalue` then `Δ%`), or the two stacked inside
 * one slot, which halves the width of a 17-metric table at the cost of a
 * second line per case. */
type DeltaLayout = "wide" | "stacked";

const DELTA_VALUE_WIDTH = 11;
const DELTA_PERCENT_WIDTH = 9;
const DELTA_TAG_WIDTH = 6;

/** A Δ that rounds to nothing on screen must not read as a regression. */
function belowDisplayResolution(rule: DeltaRule, delta: number): boolean {
  const step = rule.scale === "points" ? 0.0005 : 0.5 * 10 ** -(rule.digits ?? 2);
  return Math.abs(delta) < step;
}

/** Green when the move is an improvement, red when it is not, dim when it is
 * too small to read. */
function deltaTone(rule: DeltaRule, current: CaseResult, previous: CaseResult, delta: number): string {
  if (belowDisplayResolution(rule, delta)) return DIM;
  const better = typeof rule.better === "function" ? rule.better(current, previous) : rule.better;
  return (better === "lower" ? delta < 0 : delta > 0) ? GREEN : RED;
}

/** The two Δ cells of one metric. Both sides need a reading, and the percent
 * cell also needs a non-zero reference — without them the change is unknown,
 * which is not the same as zero. */
function deltaCells(
  column: MatrixColumn,
  current: CaseResult,
  previous: CaseResult,
  valueWidth: number,
  percentWidth: number,
): readonly [string, string] {
  const rule = column.delta!;
  const dashValue = "—".padStart(valueWidth);
  const dashPercent = "—".padStart(percentWidth);
  const cur = rule.of(current);
  const prev = rule.of(previous);
  if (cur === undefined || prev === undefined) return [dashValue, dashPercent];
  const delta = cur - prev;
  const tone = deltaTone(rule, current, previous, delta);
  const valueText = rule.scale === "points"
    ? `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp`
    : `${delta >= 0 ? "+" : ""}${delta.toFixed(rule.digits ?? 2)}`;
  const value = `${tone}${valueText.padStart(valueWidth)}${RST}`;
  if (prev === 0 || !Number.isFinite(prev)) return [value, dashPercent];
  const relative = (cur - prev) / Math.abs(prev);
  const percentText = `${relative >= 0 ? "+" : ""}${(relative * 100).toFixed(1)}%`;
  const percentTone = Math.abs(relative) < 0.0005 ? DIM : tone;
  return [value, `${percentTone}${percentText.padStart(percentWidth)}${RST}`];
}

/** Where each row's two records came from. One table can mix run-set pairs,
 * because every case is taken from its own newest occurrence — so a pair
 * covering few rows names them one per line, while a pair covering many just
 * counts. A shared pair stays a single line; a table of 20 different pairs
 * becomes 20 short ones instead of one unreadable run-on. */
function deltaProvenance(family: MatrixFamily, records: readonly DeltaRecord[]): string[] {
  const byPair = new Map<string, string[]>();
  for (const record of records) {
    const pair = `${record.previousRunSet ?? "no previous record"} → ${record.currentRunSet}`;
    byPair.set(pair, [...(byPair.get(pair) ?? []), family.rowKey(record.current)]);
  }
  const lines: string[] = [];
  for (const [pair, keys] of byPair) {
    if (keys.length > 4) {
      lines.push(`  ${DIM}records: ${pair} (${keys.length} case(s))${RST}`);
      continue;
    }
    for (const key of keys) {
      lines.push(`  ${DIM}records: ${pair} (${key})${RST}`);
    }
  }
  return lines;
}

function centerText(text: string, width: number): string {
  if (text.length >= width) return text;
  const left = Math.floor((width - text.length) / 2);
  return `${" ".repeat(left)}${text}${" ".repeat(width - text.length - left)}`;
}

/** One Δ table: every metric of the section's own family, one `Δvalue`/`Δ%`
 * cell pair each, in the same order and grouping as the live matrix. A family
 * may pass `transitions` for measurements whose change is a state rather than
 * a magnitude; each takes one slot, ahead of the metrics. */
function formatDeltaSection(
  section: MatrixSection,
  family: MatrixFamily,
  items: readonly DeltaRecord[],
  layout: DeltaLayout,
  transitions: readonly DeltaTransition[] = [],
): string[] {
  const records = [...items].sort((left, right) =>
    family.rowKey(left.current).localeCompare(family.rowKey(right.current)));
  const currentRows = records.map((record) => record.current);
  const keyContext = matrixContext(currentRows);
  const keyColumns = family.columns.filter((column) => column.key === true && column.text !== undefined);
  const metrics = family.columns.filter((column) => column.delta !== undefined);
  const keyWidths = keyColumns.map((column) => columnWidth(column, currentRows.map(family.rowKey)));
  const keyBlank = keyColumns.map((column, index) => `${rowGap(column)}${" ".repeat(keyWidths[index]!)}`).join("");
  const keyTextOf = (record: DeltaRecord) => keyColumns
    .map((column, index) => `${rowGap(column)}${matrixCell(column, record.current, keyContext, keyWidths[index]!)}`)
    .join("");
  const lines = [
    `${BOLD}Δ vs previous record (${section.label})${section.detail ?? ""}${RST}  ${DIM}[${records.length} case(s)]${RST}`,
    ...deltaProvenance(family, records),
  ];
  const stacked = layout === "stacked";
  const percentWidth = stacked ? DELTA_VALUE_WIDTH : DELTA_PERCENT_WIDTH;
  // A transition takes one slot — the same width a metric's Δvalue cell uses —
  // so both kinds of column line up under their headers. Its text is a label
  // that fills the slot, unlike a right-aligned number, so it needs a gap to
  // keep it off the `Δval` tag.
  const slotWidth = DELTA_VALUE_WIDTH + (stacked ? 0 : DELTA_PERCENT_WIDTH);
  const transitionPad = 2;
  const transitionHeaders = transitions
    .map((transition) => `${" ".repeat(transitionPad)}${centerText(transition.header, slotWidth)}`)
    .join("");
  const transitionBlanks = " ".repeat((slotWidth + transitionPad) * transitions.length);
  const transitionCells = (record: DeltaRecord) => transitions.map((transition) => {
    const state = transition.of(record.current, record.previous!);
    const padding = " ".repeat(transitionPad);
    return state === undefined
      ? " ".repeat(slotWidth + transitionPad)
      : `${state.tone}${padding}${centerText(state.text, slotWidth)}${RST}`;
  }).join("");
  const tag = (label: string) => `${DIM}${label.padStart(DELTA_TAG_WIDTH)}${RST}`;
  const tagBlank = " ".repeat(DELTA_TAG_WIDTH);
  if (stacked) {
    lines.push(`  ${DIM}${keyBlank}${tagBlank}${transitionHeaders}${metrics.map((column) => centerText(column.header, DELTA_VALUE_WIDTH)).join("")}${RST}`);
  } else {
    lines.push(`  ${DIM}${keyBlank}${transitionHeaders}${metrics.map((column) => centerText(column.header, slotWidth)).join("")}${RST}`);
    lines.push(`  ${DIM}${keyBlank}${transitionBlanks}${metrics.map(() => `${"Δval".padStart(DELTA_VALUE_WIDTH)}${"Δ%".padStart(DELTA_PERCENT_WIDTH)}`).join("")}${RST}`);
  }
  for (const record of records) {
    const previous = record.previous;
    if (previous === undefined) {
      lines.push(`  ${keyTextOf(record)}${DIM}NEW${RST}`);
      continue;
    }
    const cells = metrics.map((column) => deltaCells(
      column, record.current, previous, DELTA_VALUE_WIDTH, percentWidth,
    ));
    if (stacked) {
      lines.push(`  ${keyTextOf(record)}${tag("Δval")}${transitionCells(record)}${cells.map(([value]) => value).join("")}`);
      lines.push(`  ${keyBlank}${tag("Δ%")}${transitionBlanks}${cells.map(([, percent]) => percent).join("")}`);
    } else {
      lines.push(`  ${keyTextOf(record)}${transitionCells(record)}${cells.map(([value, percent]) => `${value}${percent}`).join("")}`);
    }
  }
  return lines;
}

/** Δ board over a selection, grouped and columned exactly like the live
 * matrices it accompanies. */
export function formatDeltaTables(
  records: readonly DeltaRecord[],
  options?: { readonly minCases?: number; readonly layout?: DeltaLayout },
): string {
  const minCases = options?.minCases ?? 1;
  // The default matrix has 17 metrics: side by side, their two Δ cells alone
  // would run past 1800 columns, so the stacked form is the readable default
  // and `wide` is there for callers that want one line per case.
  const layout = options?.layout ?? "stacked";
  const lines: string[] = [];
  for (const [group, groupRecords] of groupSorted(records, (record) => record.current.group)) {
    if (groupRecords.length < minCases) continue;
    for (const section of groupSections(group, groupRecords, (record) => record.current)) {
      // Same interface, specialized implementation: a family may replace the
      // generic board, and every family that does not gets it by default.
      lines.push(...(section.family.delta === undefined
        ? formatDeltaSection(section, section.family, section.items, layout)
        : section.family.delta(section, section.items, layout)));
    }
  }
  return lines.join("\n");
}
