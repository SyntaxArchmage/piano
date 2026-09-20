import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { SelectionRecorder, selectionApplyRate, type SelectionRecord } from "../src/index.js";

function decision(outcome: SelectionRecord["outcome"]): SelectionRecord {
  return { type: "selection", executionId: "run-1", timestamp: "2026-09-04T00:00:00.000Z", outcome };
}

function readRecords(recorder: SelectionRecorder, runDir: string) {
  return Effect.runPromise(
    recorder.read(runDir).pipe(Effect.provide(NodeFileSystem.layer)),
  );
}

describe("SelectionRecorder.score", () => {
  it("counts every referee outcome", () => {
    const score = new SelectionRecorder("/tmp/unused").score([
      decision("carried"),
      decision("merged"),
      decision("no-winner"),
      decision("metricless"),
      decision("merged"),
      decision("carried"),
    ]);
    expect(score).toEqual({ count: 6, merged: 2, carried: 2, noWinner: 1, metricless: 1 });
  });

  it("returns zero counts for an empty stream", () => {
    expect(new SelectionRecorder("/tmp/unused").score([])).toEqual({
      count: 0, merged: 0, carried: 0, noWinner: 0, metricless: 0,
    });
  });

  it("reads an empty list when the selection file was never written", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-selection-"));
    try {
      expect(await readRecords(new SelectionRecorder(runDir), runDir)).toEqual([]);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});

describe("selectionApplyRate", () => {
  it("counts merged and carried decisions as applied winners", () => {
    const score = new SelectionRecorder("/tmp/unused").score([
      decision("carried"), decision("merged"), decision("no-winner"), decision("metricless"),
    ]);
    expect(selectionApplyRate(score)).toBeCloseTo(0.5, 10);
  });

  it("is undefined for an absent or empty stream", () => {
    expect(selectionApplyRate(undefined)).toBeUndefined();
    expect(selectionApplyRate(new SelectionRecorder("/tmp/unused").score([]))).toBeUndefined();
  });
});
