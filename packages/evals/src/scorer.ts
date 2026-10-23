/**
 * Scorer (A6) — reducers, aggregators, and filters that fold the set of case
 * results into score groups and produce a complete eval report.
 *
 * Groups supported:
 *   - overall: normalized composite across all selected cases.
 *   - by tag (workflow/metric tag)
 *   - by group (workload group name)
 *
 * Report is text-only for now. A TUI is marked as future work.
 */

import type {
  CaseResult,
  EvalReport,
  EvalSummary,
  MetricScore,
  ScoreGroup,
  ScoreReducer,
} from "./types.js";
import { buildCaseScorecard, compareVariants, usableBenchmarkValue } from "./evidence.js";
import { hyperbolicScore } from "@piano/trajectory";

/** Normalize a raw metric value into a 0..1 score given the orientation.
 * The hyperbolic curve puts parity with the reference at 0.5 and keeps
 * rewarding speedup beyond it instead of saturating at the reference. */
export function normalizeMetric(
  value: number,
  direction: "higher" | "lower",
  reference: number,
): number {
  if (reference === 0) return 0;
  const ratio = value / reference;
  if (direction === "higher") {
    return hyperbolicScore(ratio);
  }
  // For "lower is better", the improvement ratio inverts; guard a zero value.
  return hyperbolicScore(1 / Math.max(ratio, 1e-6));
}

/**
 * A reducer returning a score group over a named subset of cases.
 *
 * The composite is a weighted average of two dimensions:
 *   - correctness (verified proportion)
 *   - efficiency (token cost vs the group's cheapest verified run, weight 0.5)
 */
export const reduceCaseGroup: ScoreReducer = (cases) => {
  const caseIds = cases.map((c) => c.caseId);
  if (cases.length === 0) return { key: "empty", caseIds, scores: [], composite: 0 };

  const verified = cases.filter((c) => c.artifact.verified).length;
  const correctness = verified / cases.length;

  const scores: MetricScore[] = [
    { name: "correctness", value: correctness, direction: "higher", weight: 1 },
  ];

  // Aggregate a token-efficiency proxy when artifact metrics carry a value.
  const withValue = cases.filter((c) => c.artifact.value !== undefined);
  if (withValue.length > 0) {
    const normalized = withValue.map((c) =>
      (() => {
        const baseline = c.baseline;
        const direction = c.metric?.direction ?? baseline?.direction ?? "higher";
        const comparable = withValue
          .filter((candidate) => (candidate.metric?.direction ?? candidate.baseline?.direction ?? "higher") === direction)
          .map((candidate) => candidate.artifact.value ?? 0);
        const reference = direction === "higher" ? Math.max(...comparable) : Math.min(...comparable);
        return normalizeMetric(
          c.artifact.value ?? 0,
          direction,
          usableBenchmarkValue(baseline) ?? reference,
        );
      })(),
    );
    const avgMetric = normalized.reduce((a, b) => a + b, 0) / normalized.length;
    scores.push({ name: "metric", value: avgMetric, direction: "higher", weight: 1 });
  }

  // Token efficiency: each qualifying case scored on the hyperbolic curve
  // against the group's cheapest verified run (parity = 0.5 at the cheapest).
  // The old verified/(tokens/1000) proxy was an unscaled rate that saturated
  // to ~0 for any real tuning task.
  const costTokens = cases.flatMap((c) =>
    c.artifact.verified && c.trace !== undefined && c.trace.tokens.total > 0 ? [c.trace.tokens.total] : []);
  const cheapest = costTokens.length === 0 ? 0 : Math.min(...costTokens);
  const efficiency = costTokens.length === 0 ? 0
    : costTokens.reduce((sum, tokens) => sum + normalizeMetric(tokens, "lower", cheapest), 0) / costTokens.length;
  scores.push({ name: "efficiency", value: efficiency, direction: "higher", weight: 0.5 });

  const weightSum = scores.reduce((a, s) => a + s.weight, 0);
  const composite = scores.reduce((a, s) => a + s.value * s.weight, 0) / weightSum;

  return { key: "group", caseIds, scores, composite } satisfies ScoreGroup;
};

/** Group cases by an arbitrary key selector. */
function groupBy<Key extends string>(
  cases: CaseResult[],
  selector: (c: CaseResult, index: number) => Key,
): { key: Key; cases: CaseResult[] }[] {
  const grouped = new Map<Key, CaseResult[]>();
  cases.forEach((c, index) => {
    const key = selector(c, index);
    const existing = grouped.get(key);
    if (existing === undefined) grouped.set(key, [c]);
    else existing.push(c);
  });
  return [...grouped.entries()].map(([key, list]) => ({ key, cases: list }));
}

/**
 * Build the full eval report from a list of case results.
 *
 * Each group is produced by a named reducer applied to a filtered case subset.
 * The overall score is the mean composite across non-empty groups.
 */
export function buildReport(
  runSetId: string,
  createdAt: string,
  cases: CaseResult[],
): EvalReport {
  const scorecards = cases.map((kase) => kase.scorecard ?? buildCaseScorecard(kase));
  const casesWithScorecards = cases.map((kase, index) => {
    const scorecard = scorecards[index];
    return {
      ...kase,
      ...(kase.scorecard === undefined && scorecard === undefined ? {} : { scorecard: kase.scorecard ?? scorecard }),
      ...(kase.baselineComparison !== undefined || scorecard?.baseline === undefined
        ? {}
        : { baselineComparison: scorecard.baseline }),
    };
  });
  const groups: ScoreGroup[] = [];

  // overall
  groups.push(labelGroup("overall", reduceCaseGroup(casesWithScorecards)));

  // by tag — group cases by each configured tag (a case with N tags appears in N groups).
  for (const { key, cases: subset } of groupByTags(casesWithScorecards)) {
    groups.push(labelGroup(key, reduceCaseGroup(subset)));
  }

  // by group
  for (const { key, cases: subset } of groupBy(casesWithScorecards, (c) => `group:${c.group}`)) {
    groups.push(labelGroup(key, reduceCaseGroup(subset)));
  }

  const overall = groups.filter((g) => g.caseIds.length > 0).reduce((a, g) => a + g.composite, 0)
    / Math.max(1, groups.filter((g) => g.caseIds.length > 0).length);

  return {
    runSetId,
    createdAt,
    groups,
    cases: casesWithScorecards,
    overall,
    summary: summarize(casesWithScorecards),
    scorecards,
    variants: compareVariants(casesWithScorecards),
  };
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Aggregate independent trials while retaining process-cost metrics. */
function summarize(cases: CaseResult[]): EvalSummary {
  const byCase = new Map<string, CaseResult[]>();
  for (const kase of cases) byCase.set(kase.caseId, [...(byCase.get(kase.caseId) ?? []), kase]);
  const summaryCases = [...byCase.entries()].map(([caseId, trials]) => {
    const passed = trials.filter((trial) => trial.artifact.verified).length;
    return {
      caseId,
      trials: trials.length,
      passed,
      passRate: passed / trials.length,
      passAtK: passed > 0 ? 1 : 0,
      firstPass: trials.find((trial) => trial.trial === 1)?.artifact.verified ? 1 : 0,
      averageTokens: average(trials.map((trial) => trial.trace?.tokens.total ?? 0)),
      averageRounds: average(trials.map((trial) => trial.trace?.messages.rounds ?? 0)),
      averageToolCalls: average(trials.map((trial) => trial.trace?.tools.count ?? 0)),
      averageDurationMs: average(trials.map((trial) => trial.durationMs ?? 0)),
      accepted: trials.filter((trial) => trial.scorecard?.accepted === true).length,
      evidencePassRate: trials.filter((trial) => trial.evidence?.evidencePass === true).length / trials.length,
    };
  });
  const passed = cases.filter((kase) => kase.artifact.verified).length;
  return {
    trials: cases.length,
    passed,
    passRate: cases.length === 0 ? 0 : passed / cases.length,
    averageTokens: average(cases.map((kase) => kase.trace?.tokens.total ?? 0)),
    averageRounds: average(cases.map((kase) => kase.trace?.messages.rounds ?? 0)),
    averageToolCalls: average(cases.map((kase) => kase.trace?.tools.count ?? 0)),
    averageDurationMs: average(cases.map((kase) => kase.durationMs ?? 0)),
    accepted: cases.filter((kase) => kase.scorecard?.accepted === true).length,
    evidencePassRate: cases.length === 0 ? 0 : cases.filter((kase) => kase.evidence?.evidencePass === true).length / cases.length,
    cases: summaryCases,
  };
}

/** Group cases by each configured tag, producing one group per tag. */
function groupByTags(cases: CaseResult[]): { key: string; cases: CaseResult[] }[] {
  const grouped = new Map<string, CaseResult[]>();
  for (const kase of cases) {
    for (const tag of kase.tags) {
      const key = `tag:${tag}`;
      const existing = grouped.get(key);
      if (existing === undefined) grouped.set(key, [kase]);
      else existing.push(kase);
    }
  }
  return [...grouped.entries()].map(([key, list]) => ({ key, cases: list }));
}

/** Label a score group with a key prefix. */
function labelGroup(key: string, group: ScoreGroup): ScoreGroup {
  return { ...group, key };
}
