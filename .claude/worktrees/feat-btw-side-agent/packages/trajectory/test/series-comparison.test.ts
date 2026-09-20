import { describe, expect, it } from "vitest";
import { compareBenchmarkSeries, compareRunCosts, type BenchmarkSeriesPoint } from "../src/index.js";

function series(values: number[], direction: "higher" | "lower" = "higher"): BenchmarkSeriesPoint[] {
  let envelope = direction === "higher" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  return values.map((value, index) => {
    envelope = direction === "higher" ? Math.max(envelope, value) : Math.min(envelope, value);
    return { iteration: index, value, direction, bestSoFar: envelope };
  });
}

describe("compareBenchmarkSeries", () => {
  it("detects a pure improvement by envelope dominance", () => {
    const comparison = compareBenchmarkSeries(series([2, 3, 4]), series([1, 2, 3]));
    expect(comparison).toBeDefined();
    expect(comparison?.neverBehind).toBe(true);
    expect(comparison?.strictlyAheadCount).toBe(3);
    expect(comparison?.dominant).toBe(true);
    expect(comparison?.points.map((point) => point.envelopeDelta)).toEqual([1, 1, 1]);
    expect(comparison?.points.map((point) => point.delta)).toEqual([1, 1, 1]);
    // Final-value edge and each run's intrinsic score are reported apart.
    expect(comparison?.finalRelativeEdge).toBeCloseTo(4 / 3 - 1, 10);
    expect(comparison?.candidateScore).toBeCloseTo(2 / 3, 10);
    expect(comparison?.referenceScore).toBeCloseTo(0.75, 10);
  });

  it("rejects a candidate that finishes behind despite an early lead", () => {
    const comparison = compareBenchmarkSeries(series([4, 3]), series([1, 5]));
    expect(comparison?.neverBehind).toBe(false);
    expect(comparison?.dominant).toBe(false);
  });

  it("is direction-aware for lower-is-better metrics", () => {
    const comparison = compareBenchmarkSeries(series([9, 7], "lower"), series([10, 8], "lower"));
    expect(comparison?.dominant).toBe(true);
    expect(comparison?.points.map((point) => point.delta)).toEqual([1, 1]);
  });

  it("aligns by position and survives uneven lengths", () => {
    const comparison = compareBenchmarkSeries(series([1, 2, 3]), series([1, 2]));
    expect(comparison?.points).toHaveLength(2);
    expect(comparison?.candidateIterations).toBe(3);
    expect(comparison?.referenceIterations).toBe(2);
  });

  it("guards a zero reference value and refuses incomparable inputs", () => {
    const zeroRef = compareBenchmarkSeries(series([1, 1]), series([0, 1]));
    expect(zeroRef?.points[0]?.relativeDelta).toBeUndefined();
    expect(zeroRef?.points[0]?.delta).toBe(1);
    expect(compareBenchmarkSeries([], series([1, 2]))).toBeUndefined();
    expect(compareBenchmarkSeries(series([1, 2], "higher"), series([1, 2], "lower"))).toBeUndefined();
  });
});

describe("compareRunCosts", () => {
  it("scores parity at 0.5 and rewards the cheaper candidate on the hyperbola", () => {
    const parity = compareRunCosts({ tokens: 100, durationMs: 10 }, { tokens: 100, durationMs: 10 });
    expect(parity?.tokenScore).toBe(0.5);
    expect(parity?.durationScore).toBe(0.5);
    expect(parity?.tokenRatio).toBe(1);
    // Candidate burns half the tokens: hyper(1/0.5) = 2/3.
    const cheaper = compareRunCosts({ tokens: 50, durationMs: 10 }, { tokens: 100, durationMs: 10 });
    expect(cheaper?.tokenScore).toBeCloseTo(2 / 3, 10);
    // Twice the cost scores below parity.
    const pricier = compareRunCosts({ tokens: 200, durationMs: 10 }, { tokens: 100, durationMs: 10 });
    expect(pricier?.tokenScore).toBeCloseTo(1 / 3, 10);
    expect(pricier?.tokenRatio).toBe(2);
  });

  it("maps a zero-cost candidate to the limit 1 and refuses missing references", () => {
    expect(compareRunCosts({ tokens: 0, durationMs: 0 }, { tokens: 100, durationMs: 10 })?.tokenScore).toBe(1);
    expect(compareRunCosts({ tokens: 10, durationMs: 1 }, { tokens: 0, durationMs: 10 })).toBeUndefined();
    expect(compareRunCosts({ tokens: Number.NaN, durationMs: 1 }, { tokens: 10, durationMs: 10 })).toBeUndefined();
  });
});
