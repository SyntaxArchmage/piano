/**
 * Pure, Effect-free decision core for a `tournament`/`map` region: given the
 * fan-out branch results that reached the region's exit stage, pick the branch
 * whose exit metric wins according to the referee's declared direction, tie-
 * breaking deterministically on the branch's fan index.
 *
 * This module owns ONLY decision math and admission/rejection reasons. It never
 * reads files nor drives execution (PRD §5.5 / §11). The runtime feeds it the
 * per-branch, already normalized exit metrics and merges the chosen winner.
 */

/** The base metric projection a branch exposes at territory exit. */
export interface SelectionBranchMetric {
  readonly name: string;
  readonly unit: string;
  readonly direction: "higher" | "lower";
  /** The representative value; use `best` for benchmark/v1. */
  readonly best: number;
}

/** The identity and ordering the exit contract declares (its single metric). */
export interface SelectionReferee {
  readonly name: string;
  readonly unit: string;
  readonly direction: "higher" | "lower";
}

/** One fan-out lane that terminated at the region exit. */
export interface SelectionBranch {
  /** The map-slot key (stable across the run), used to locate its workspace. */
  readonly key: string;
  /** The branch's fan index (0-based). Deterministic tie-break input. */
  readonly index: number;
  /** The branch's terminal exit metric projection, if one is present. */
  readonly metric?: SelectionBranchMetric;
  /** Optional deterministic secondary ranking data from the validated result. */
  readonly tieBreak?: { readonly changedFiles: number; readonly changedLoc: number };
  /** True if the branch's exit stage reached a validated accepted state. */
  readonly accepted: boolean;
}

export type SelectionRejection =
  | { readonly reason: "no-matching-metric"; readonly detail: string }
  | { readonly reason: "not-accepted"; readonly detail: string };

export type SelectionOutcome =
  | {
    readonly kind: "selected";
    readonly winnerKey: string;
    readonly runnerUpKeys: readonly string[];
  }
  | {
    readonly kind: "no-winner";
    readonly rejection: SelectionRejection;
  };

export interface SelectionIncumbent {
  readonly key: string;
  readonly metric: SelectionBranchMetric;
}

export type SelectionAdmission =
  | { readonly kind: "admitted"; readonly winner: SelectionIncumbent }
  | {
    readonly kind: "rejected";
    readonly reason: "metric-identity-changed";
    readonly winner: SelectionIncumbent;
    readonly incumbent: SelectionIncumbent;
    readonly detail: string;
  }
  | {
    readonly kind: "regressed";
    readonly winner: SelectionIncumbent;
    readonly incumbent: SelectionIncumbent;
    readonly detail: string;
  };

/** True when a candidate's metric carries the referee's identity. */
function matchesReferee(metric: SelectionBranchMetric, referee: SelectionReferee): boolean {
  return metric.name === referee.name &&
    metric.unit === referee.unit &&
    metric.direction === referee.direction;
}

/** Is `left` strictly better than `right` by the given direction? */
export function betterByDirection(
  left: number,
  right: number,
  direction: "higher" | "lower",
): boolean {
  return direction === "higher" ? left > right : left < right;
}

/** Narrow to accepted branches that expose the referee's exact metric. */
function contenders(
  branches: readonly SelectionBranch[],
  referee: SelectionReferee,
): Array<SelectionBranch & { metric: SelectionBranchMetric; index: number }> {
  const result: Array<SelectionBranch & { metric: SelectionBranchMetric; index: number }> = [];
  for (const branch of branches) {
    if (branch.accepted && branch.metric !== undefined && matchesReferee(branch.metric, referee)) {
      // The interface marks metric optional; this branch satisfies the guard.
      result.push(branch as SelectionBranch & { metric: SelectionBranchMetric; index: number });
    }
  }
  // Deterministic: fan index order.
  return result.sort((a, b) => a.index - b.index);
}

/**
 * Rank the accepted branches that present the referee's metric and select the
 * best (per the referee's direction), breaking `best` ties on the lowest fan
 * index. Returns no-winner when no accepted branch carries a *matching* usable
 * metric (a metric-less branch is never silently promoted).
 */
export function selectWinner(
  branches: readonly SelectionBranch[],
  referee: SelectionReferee,
): SelectionOutcome {
  const ranked = contenders(branches, referee);
  if (ranked.length === 0) {
    const sawOtherMetric = branches.some((b) => b.accepted && b.metric !== undefined);
    return {
      kind: "no-winner",
      rejection: sawOtherMetric
        ? { reason: "no-matching-metric", detail: `no accepted branch reported the referee metric ${referee.name}/${referee.unit}/${referee.direction}` }
        : { reason: "not-accepted", detail: "no branch reached an accepted exit that carries a metric" },
    };
  }
  let bestIndex = 0;
  for (let index = 1; index < ranked.length; index += 1) {
    const current = ranked[index]!;
    const incumbent = ranked[bestIndex]!;
    if (betterByDirection(current.metric.best, incumbent.metric.best, referee.direction)) {
      bestIndex = index;
      continue;
    }
    if (current.metric.best === incumbent.metric.best) {
      const currentTie = current.tieBreak;
      const incumbentTie = incumbent.tieBreak;
      if (currentTie !== undefined && incumbentTie !== undefined &&
        (currentTie.changedFiles < incumbentTie.changedFiles ||
          (currentTie.changedFiles === incumbentTie.changedFiles && currentTie.changedLoc < incumbentTie.changedLoc))) {
        bestIndex = index;
      }
    }
    // Remaining ties keep the earlier (lower fan index) incumbent.
  }
  const best = ranked[bestIndex]!;
  return {
    kind: "selected",
    winnerKey: best.key,
    runnerUpKeys: ranked
      .filter((c) => c !== best)
      .map((c) => c.key),
  };
}

/** Apply the cross-repetition guard after ranking one tournament invocation.
 * The first repetition has no incumbent and is admitted. Later repetitions
 * must strictly improve the same metric identity; ties remain on the already
 * materialized incumbent. */
export function admitWinner(
  outcome: SelectionOutcome,
  branches: readonly SelectionBranch[],
  referee: SelectionReferee,
  incumbent?: SelectionIncumbent,
): SelectionAdmission | undefined {
  if (outcome.kind !== "selected") return undefined;
  const branch = branches.find((candidate) => candidate.key === outcome.winnerKey);
  if (branch?.metric === undefined || !matchesReferee(branch.metric, referee)) return undefined;
  const winner: SelectionIncumbent = { key: branch.key, metric: branch.metric };
  if (incumbent !== undefined && !matchesReferee(incumbent.metric, referee)) {
    return {
      kind: "rejected",
      reason: "metric-identity-changed",
      winner,
      incumbent,
      detail: `candidate referee ${winner.metric.name}/${winner.metric.unit}/${winner.metric.direction} does not match incumbent ${incumbent.metric.name}/${incumbent.metric.unit}/${incumbent.metric.direction}`,
    };
  }
  if (incumbent === undefined || betterByDirection(winner.metric.best, incumbent.metric.best, referee.direction)) {
    return { kind: "admitted", winner };
  }
  return {
    kind: "regressed",
    winner,
    incumbent,
    detail: `candidate ${winner.metric.best} did not improve incumbent ${incumbent.metric.best} (${referee.direction} is better)`,
  };
}
