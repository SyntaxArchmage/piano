import { hyperbolicScore } from "./recorders.js";
import type { BenchmarkSeriesPoint } from "./types.js";

/** One aligned step of a two-trajectory comparison. Positions align the
 * k-th iteration of each run (same compute budget per step), not raw
 * iteration ids, so runs with different loop offsets still compare. `delta`
 * and `envelopeDelta` are improvement-positive for the metric direction. */
export interface BenchmarkSeriesComparisonPoint {
  readonly position: number;
  readonly candidate: number;
  readonly reference: number;
  readonly delta: number;
  readonly relativeDelta?: number;
  readonly improved: boolean;
  readonly candidateBestSoFar: number;
  readonly referenceBestSoFar: number;
  readonly envelopeDelta: number;
}

/**
 * Direction-aware, point-by-point comparison of two collapsed benchmark
 * trajectories (e.g. tournament vs non-tournament runs of the same case).
 * A candidate "purely improves" the reference when its best-so-far envelope
 * is never behind at any aligned step and strictly ahead somewhere
 * (`dominant`), which is stronger than a final-value win.
 */
export interface BenchmarkSeriesComparison {
  readonly direction: "higher" | "lower";
  readonly points: readonly BenchmarkSeriesComparisonPoint[];
  readonly candidateIterations: number;
  readonly referenceIterations: number;
  /** True when the candidate envelope is >= the reference envelope at every
   * aligned step. */
  readonly neverBehind: boolean;
  readonly strictlyAheadCount: number;
  /** neverBehind with at least one strictly-ahead step: a pure improvement. */
  readonly dominant: boolean;
  /** Hyperbolic speedup of each series' final envelope over its own seed. */
  readonly candidateScore: number;
  readonly referenceScore: number;
  readonly scoreDelta: number;
  /** Direction-aware relative edge of the candidate's best over the
   * reference's best (e.g. 0.25 = candidate ends 25% better). */
  readonly finalRelativeEdge?: number;
}

function seriesScore(points: readonly BenchmarkSeriesPoint[]): number {
  const seed = points[0]!.value;
  const final = points.at(-1)!.bestSoFar;
  if (seed === 0) return 0;
  const speedup = points[0]!.direction === "higher" ? final / seed : seed / final;
  return hyperbolicScore(speedup);
}

/** Returns undefined when a side has no points or the two series measure
 * different directions — there is nothing honest to compare. */
export function compareBenchmarkSeries(
  candidate: readonly BenchmarkSeriesPoint[],
  reference: readonly BenchmarkSeriesPoint[],
): BenchmarkSeriesComparison | undefined {
  if (candidate.length === 0 || reference.length === 0) return undefined;
  const direction = candidate[0]!.direction;
  if (reference[0]!.direction !== direction) return undefined;
  const aligned = Math.min(candidate.length, reference.length);
  const points: BenchmarkSeriesComparisonPoint[] = [];
  let neverBehind = true;
  let strictlyAheadCount = 0;
  for (let position = 0; position < aligned; position += 1) {
    const cand = candidate[position]!;
    const ref = reference[position]!;
    const delta = direction === "higher" ? cand.value - ref.value : ref.value - cand.value;
    const envelopeDelta = direction === "higher"
      ? cand.bestSoFar - ref.bestSoFar
      : ref.bestSoFar - cand.bestSoFar;
    if (envelopeDelta < 0) neverBehind = false;
    if (envelopeDelta > 0) strictlyAheadCount += 1;
    points.push({
      position,
      candidate: cand.value,
      reference: ref.value,
      delta,
      ...(ref.value === 0 ? {} : { relativeDelta: delta / Math.abs(ref.value) }),
      improved: delta > 0,
      candidateBestSoFar: cand.bestSoFar,
      referenceBestSoFar: ref.bestSoFar,
      envelopeDelta,
    });
  }
  const candidateBest = direction === "higher"
    ? Math.max(...candidate.map((point) => point.bestSoFar))
    : Math.min(...candidate.map((point) => point.bestSoFar));
  const referenceBest = direction === "higher"
    ? Math.max(...reference.map((point) => point.bestSoFar))
    : Math.min(...reference.map((point) => point.bestSoFar));
  const candidateScore = seriesScore(candidate);
  const referenceScore = seriesScore(reference);
  const finalEdge = referenceBest === 0 ? undefined
    : direction === "higher"
      ? candidateBest / referenceBest - 1
      : referenceBest / candidateBest - 1;
  return {
    direction,
    points,
    candidateIterations: candidate.length,
    referenceIterations: reference.length,
    neverBehind,
    strictlyAheadCount,
    dominant: neverBehind && strictlyAheadCount > 0,
    candidateScore,
    referenceScore,
    scoreDelta: candidateScore - referenceScore,
    ...(finalEdge === undefined ? {} : { finalRelativeEdge: finalEdge }),
  };
}

/** Whole-run cost totals for a two-run comparison (tokens spent, wall-clock
 * milliseconds). Deliberately free of tool-call/attempt detail: cost is what
 * the tuning loop burns, quality is judged by the benchmark comparison. */
export interface RunCost {
  readonly tokens: number;
  readonly durationMs: number;
}

/**
 * Sibling of `compareBenchmarkSeries` for the cost side: each stream is
 * lower-is-better, so every score is `hyperbolicScore(reference / candidate)`
 * — parity (equal cost) is 0.5, a cheaper candidate scores higher, a more
 * expensive one lower. The ratios are reported alongside so a reader can
 * pair them with the benchmark comparison (e.g. did the extra cost pay off)
 * without this operator inventing a combined "value" number.
 */
export interface RunCostComparison {
  readonly candidate: RunCost;
  readonly reference: RunCost;
  /** candidate/reference cost ratio; > 1 means the candidate is more expensive. */
  readonly tokenRatio: number;
  readonly durationRatio: number;
  readonly tokenScore: number;
  readonly durationScore: number;
}

/** Returns undefined when the reference side has no cost to divide by or
 * any input is not a finite number — there is nothing honest to compare. */
export function compareRunCosts(
  candidate: RunCost,
  reference: RunCost,
): RunCostComparison | undefined {
  if (!Number.isFinite(candidate.tokens) || !Number.isFinite(candidate.durationMs)) return undefined;
  if (!Number.isFinite(reference.tokens) || !Number.isFinite(reference.durationMs)) return undefined;
  if (reference.tokens <= 0 || reference.durationMs <= 0) return undefined;
  const tokenRatio = candidate.tokens / reference.tokens;
  const durationRatio = candidate.durationMs / reference.durationMs;
  return {
    candidate,
    reference,
    tokenRatio,
    durationRatio,
    tokenScore: hyperbolicScore(1 / tokenRatio),
    durationScore: hyperbolicScore(1 / durationRatio),
  };
}
