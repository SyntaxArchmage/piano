import { describe, expect, it } from "vitest";
import { BenchmarkRecorder, hyperbolicScore, type BenchmarkRecord } from "../src/index.js";

const contract = { id: "metric", version: 1 as const, digest: "0".repeat(64), snapshotPath: "/contracts/x.json" };

function record(iteration: number | undefined, best: number, invocationId: string): BenchmarkRecord {
  return {
    version: 1,
    timestamp: "2026-09-02T00:00:00.000Z",
    executionId: "e",
    invocationId,
    stageId: "loop.measure",
    stage: "measure",
    worker: "w",
    attempt: 1,
    ...(iteration === undefined ? {} : { iteration }),
    kind: "benchmark",
    metric: {
      protocol: "benchmark/v1",
      name: "throughput",
      unit: "items/s",
      direction: "higher",
      samples: [best],
      best,
      median: best,
      runs: 1,
      warmup: 0,
    },
    pointer: "/benchmark",
    contract,
  };
}

const key = `throughput${String.fromCharCode(0)}items/s`;

describe("hyperbolicScore", () => {
  it("is bounded, parity-centered, and never saturates at parity", () => {
    expect(hyperbolicScore(1)).toBe(0.5);
    expect(hyperbolicScore(1.01)).toBeCloseTo(1.01 / 2.01, 10);
    expect(hyperbolicScore(4.8685)).toBeCloseTo(4.8685 / 5.8685, 10);
    expect(hyperbolicScore(1.01)).not.toBe(hyperbolicScore(4.8685));
  });

  it("degrades safely at and beyond the edges", () => {
    expect(hyperbolicScore(0)).toBe(0);
    expect(hyperbolicScore(-3)).toBe(0);
    expect(hyperbolicScore(Number.NaN)).toBe(0);
    expect(hyperbolicScore(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("BenchmarkRecorder series/score", () => {
  const recorder = new BenchmarkRecorder("");

  it("collapses same-iteration lanes to the iteration best before differencing", () => {
    // A tournament iteration runs three lanes; the middle-drawn lane (9) is
    // not a trajectory regression against iteration 0 (12).
    const score = recorder.score([
      record(0, 12, "measure@iter-0"),
      record(1, 9, "measure@iter-1/slot-0"),
      record(1, 13, "measure@iter-1/slot-1"),
      record(1, 11, "measure@iter-1/slot-2"),
    ]);
    const series = score.series?.[key] ?? [];
    expect(series.map((point) => point.value)).toEqual([12, 13]);
    expect(series[1]).toMatchObject({ prev: 12, delta: 1, improved: true, bestSoFar: 13 });
    expect(series.every((point) => point.delta === undefined || point.delta >= 0)).toBe(true);
  });

  it("falls back to sorted position when records carry no iteration", () => {
    const score = recorder.score([record(undefined, 10, "a"), record(undefined, 12, "b")]);
    expect(score.series?.[key]?.map((point) => [point.iteration, point.value])).toEqual([[0, 10], [1, 12]]);
  });

  it("keeps series and score absent for degenerate trajectories", () => {
    const score = recorder.score([record(0, 12, "measure@iter-0")]);
    expect(score.series).toBeUndefined();
    expect(score.score).toBeUndefined();
  });

  it("scores the envelope against the first iteration", () => {
    const score = recorder.score([
      record(0, 12, "a"),
      record(1, 14, "b"),
      record(2, 13, "c"),
    ]);
    expect(score.series?.[key]?.map((point) => point.bestSoFar)).toEqual([12, 14, 14]);
    expect(score.series?.[key]?.[2]).toMatchObject({ delta: -1, improved: false });
    expect(score.score?.[key]).toBeCloseTo(7 / 13, 10);
  });
});
