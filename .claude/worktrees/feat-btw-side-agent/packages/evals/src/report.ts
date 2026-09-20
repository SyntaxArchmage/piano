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

function rateCell(rate: number | undefined, width: number): string {
  if (rate === undefined) return "—".padStart(width);
  const text = `${(rate * 100).toFixed(1)}%`;
  return `${rateColor(rate)}${text.padStart(width)}${DIM}`;
}

function signedPct(value: number | undefined, width: number): string {
  if (value === undefined) return "—".padStart(width);
  const text = `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
  return `${value >= 0 ? GREEN : RED}${text.padStart(width)}${DIM}`;
}

function scoredCell(value: number | undefined, width: number): string {
  if (value === undefined) return "—".padStart(width);
  return `${colorFor(value)}${value.toFixed(3).padStart(width)}${DIM}`;
}

function numberCell(value: number | undefined, width: number, digits: number): string {
  return value === undefined ? "—".padStart(width) : value.toFixed(digits).padStart(width);
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

/** Case-key column width for the matrix and comparison tables: the
 * historical 34, widened to the longest key plus one trailing space, so a
 * long case id cannot run into the first numeric column. */
function caseColumnWidth(keys: readonly string[]): number {
  return Math.max(34, ...keys.map((key) => key.length + 1));
}

/** One table per group with at least two cases: same-group runs compared
 * dim by dim — outcome (final/best/baseline/improvement), scores (perf,
 * trajectory-intrinsic, selection apply rate, quality), and cost (tool-ok,
 * first-pass, token/time efficiency vs the group's cheapest runs, raw
 * tokens, wall time). Efficiencies reuse the composite's normalizeMetric
 * curve, so the cheapest case reads 0.5 (parity) and the group-mean of a
 * column equals that group's scored dimension. Missing dimensions render
 * as — (legacy runs). */
function formatMatrixTables(cases: readonly CaseResult[], minCases = 2): string[] {
  const byGroup = new Map<string, CaseResult[]>();
  for (const kase of cases) {
    byGroup.set(kase.group, [...(byGroup.get(kase.group) ?? []), kase]);
  }
  const lines: string[] = [];
  for (const [group, groupCases] of [...byGroup.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    if (groupCases.length < minCases) continue;
    const tokenPool = groupCases.filter((kase) => kase.artifact.verified && kase.trajectory.totalTokens > 0);
    const cheapestTokens = tokenPool.length === 0 ? undefined : Math.min(...tokenPool.map((kase) => kase.trajectory.totalTokens));
    const timePool = groupCases.map((kase) => kase.durationMs).filter((ms): ms is number => ms !== undefined && ms > 0);
    const fastestMs = timePool.length === 0 ? undefined : Math.min(...timePool);
    lines.push(`${BOLD}Matrix (${group})${RST}  ${DIM}[${groupCases.length} case(s)]${RST}`);
    const caseWidth = caseColumnWidth(groupCases.map((kase) => `${kase.caseId}#${kase.trial}`));
    lines.push(`  ${DIM}${"case".padEnd(caseWidth)}${"final".padStart(8)}${"best".padStart(8)}${"base".padStart(8)}${"vs-base".padStart(9)}  ${"perf".padStart(6)}  ${"traj".padStart(6)}  ${"sel".padStart(6)}  ${"quality".padStart(7)}  ${"tool-ok".padStart(7)}${"1st-pass".padStart(9)}  ${"tok-eff".padStart(7)}${"time-eff".padStart(9)}  ${"tokens".padStart(7)}  ${"time".padStart(6)}${RST}`);
    for (const kase of [...groupCases].sort((left, right) => `${left.caseId}#${left.trial}`.localeCompare(`${right.caseId}#${right.trial}`))) {
      const attempts = kase.workflowTrajectory?.duration.attempts ?? kase.workflowTrajectory?.tokens.attempts;
      const firstPass = attempts !== undefined && attempts.total > 0 ? attempts.firstPass / attempts.total : undefined;
      const baseline = kase.artifact.baseline ?? kase.baseline;
      const tokens = formatCompactTokens(kase.trajectory.totalTokens);
      const time = `${Math.round((kase.durationMs ?? 0) / 60_000)}m`;
      const tokenEff = cheapestTokens === undefined ? undefined : normalizeMetric(kase.trajectory.totalTokens, "lower", cheapestTokens);
      const timeEff = fastestMs === undefined || kase.durationMs === undefined || kase.durationMs <= 0
        ? undefined
        : normalizeMetric(kase.durationMs, "lower", fastestMs);
      lines.push(
        `  ${`${kase.caseId}#${kase.trial}`.padEnd(caseWidth)}`
        + `${numberCell(kase.artifact.value, 8, 4)}${numberCell(runBest(kase), 8, 4)}${numberCell(baseline?.value, 8, 4)}`
        + `${signedPct(kase.baselineComparison?.relativeImprovement, 9)}`
        // Cases without a performance readout have no metric; the scorecard's
        // 0 there means N/A (same signal as quality excluding the dimension).
        + `  ${scoredCell(kase.metric === undefined ? undefined : kase.scorecard?.performance, 6)}  ${scoredCell(trajectoryScore(kase), 6)}  ${rateCell(selectionApplyRate(kase.workflowTrajectory?.selection), 6)}  ${scoredCell(kase.scorecard?.quality, 7)}`
        + `  ${rateCell(toolSuccessRate(kase.workflowTrajectory?.tools), 7)}${rateCell(firstPass, 9)}`
        + `  ${scoredCell(tokenEff, 7)}${scoredCell(timeEff, 9)}`
        + `  ${tokens.padStart(7)}  ${time.padStart(6)}`,
      );
    }
    lines.push("");
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
    lines.push(
      `  ${`${kase.caseId}#${kase.trial}`.padEnd(24)} ${status}${metric}${verified}${baseline}${improvement}${quality} evidence=${evidenceState}  tokens=${kase.trajectory.totalTokens} rounds=${kase.trajectory.rounds} messages=${kase.trajectory.messageCount} tools=${kase.trajectory.toolCallCount} stages=${stageCount} progress=${progressCount}${plannedLabel}${currentLabel} time=${kase.durationMs ?? 0}ms`,
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

/** Relative change cell (`cur` against `prev`), colored by which direction is
 * an improvement. Zero change stays dim; a missing side renders —. */
function relativeCell(cur: number | undefined, prev: number | undefined, lowerBetter: boolean, width: number): string {
  if (cur === undefined || prev === undefined || !Number.isFinite(prev) || prev === 0) {
    return "—".padStart(width);
  }
  const rel = (cur - prev) / Math.abs(prev);
  const text = `${rel >= 0 ? "+" : ""}${(rel * 100).toFixed(1)}%`;
  // Below display resolution (rounds to ±0.0%) a real jitter must not read
  // as a regression.
  if (Math.abs(rel) < 0.0005) return `${DIM}${text.padStart(width)}${RST}`;
  const improved = lowerBetter ? rel < 0 : rel > 0;
  return `${improved ? GREEN : RED}${text.padStart(width)}${RST}`;
}

/** Percentage-point change cell for 0..1 scores and rates. */
function pointsCell(cur: number | undefined, prev: number | undefined, width: number): string {
  if (cur === undefined || prev === undefined) return "—".padStart(width);
  const delta = (cur - prev) * 100;
  const text = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}pp`;
  if (Math.abs(delta) < 0.05) return `${DIM}${text.padStart(width)}${RST}`;
  return `${delta > 0 ? GREEN : RED}${text.padStart(width)}${RST}`;
}

/**
 * Per-case regression table between two run sets: how every measured
 * dimension moved from `previous` to `current`. No composite score — the
 * point is spotting a dimension that got worse, so each cell carries its own
 * sign and color (green improved, red degraded). `final` uses the case's
 * metric direction; cost columns (tokens, time) are lower-is-better; score
 * and rate columns are percentage-point differences. Cases present in only
 * one side keep a row so a dropped case cannot vanish silently.
 */
export function formatRunSetComparison(current: EvalReport, previous: EvalReport): string {
  const currentByKey = new Map(current.cases.map((kase) => [`${kase.caseId}#${kase.trial}`, kase]));
  const previousByKey = new Map(previous.cases.map((kase) => [`${kase.caseId}#${kase.trial}`, kase]));
  const keys = [...new Set([...currentByKey.keys(), ...previousByKey.keys()])]
    .sort((left, right) => left.localeCompare(right));
  const lines: string[] = [];
  lines.push(`${BOLD}Δ vs previous run set${RST}  ${DIM}${previous.runSetId} → ${current.runSetId}  [${keys.length} case(s)]${RST}`);
  // Column order runs from raw detail to the summary: cost and operational
  // rates on the left, dimension scores in the middle, and the outcome
  // (`final`) rightmost — the most summarised, most important column sits at
  // the fixed edge where the eye lands.
  const caseWidth = caseColumnWidth(keys);
  lines.push(
    `  ${DIM}${"case".padEnd(caseWidth)}${"tokens".padStart(8)}${"time".padStart(8)}`
    + `${"tool-ok".padStart(8)}${"1st-pass".padStart(9)}${"quality".padStart(8)}${"traj".padStart(8)}${"perf".padStart(8)}${"base".padStart(8)}${"final".padStart(8)}${RST}`,
  );
  const notes: string[] = [];
  for (const key of keys) {
    const cur = currentByKey.get(key);
    const prev = previousByKey.get(key);
    if (cur === undefined || prev === undefined) {
      const missing = cur === undefined ? "dropped" : "new";
      lines.push(`  ${key.padEnd(caseWidth)}${DIM}${missing.toUpperCase().padStart(8 + 8 + 8 + 9 + 8 + 8 + 8 + 8 + 8)}${RST}`);
      continue;
    }
    if (cur.status !== prev.status) notes.push(`  ${RED}!${RST} ${key}: status ${prev.status} → ${cur.status}`);
    const curVerified = cur.artifact.verified;
    const prevVerified = prev.artifact.verified;
    if (curVerified !== prevVerified) notes.push(`  ${RED}!${RST} ${key}: verified ${prevVerified ? "yes" : "no"} → ${curVerified ? "yes" : "no"}`);
    const direction = (cur.metric ?? prev.metric)?.direction ?? "higher";
    const curBase = cur.baselineComparison?.relativeImprovement;
    const prevBase = prev.baselineComparison?.relativeImprovement;
    lines.push(
      `  ${key.padEnd(caseWidth)}`
      + `${relativeCell(cur.trajectory.totalTokens, prev.trajectory.totalTokens, true, 8)}`
      + `${relativeCell(cur.durationMs, prev.durationMs, true, 8)}`
      + `${pointsCell(toolSuccessRate(cur.workflowTrajectory?.tools), toolSuccessRate(prev.workflowTrajectory?.tools), 8)}`
      + `${pointsCell(firstPassRate(cur), firstPassRate(prev), 9)}`
      + `${pointsCell(cur.scorecard?.quality, prev.scorecard?.quality, 8)}`
      + `${pointsCell(trajectoryScore(cur), trajectoryScore(prev), 8)}`
      + `${pointsCell(cur.metric === undefined ? undefined : cur.scorecard?.performance, prev.metric === undefined ? undefined : prev.scorecard?.performance, 8)}`
      + `${pointsCell(curBase, prevBase, 8)}`
      + `${relativeCell(cur.artifact.value, prev.artifact.value, direction === "lower", 8)}`,
    );
  }
  if (notes.length > 0) {
    lines.push(...notes);
  }
  return lines.join("\n");
}
