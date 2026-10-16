import { describe, expect, it } from "vitest";
import {
  DurationRecorder,
  summarizeAttempts,
  toolSuccessRate,
  type DurationRecord,
  type StageAttemptOutcome,
  type ToolCallScore,
} from "../src/index.js";

function attempt(invocationId: string, attempt: number, outcome: StageAttemptOutcome) {
  return { invocationId, attempt, outcome };
}

describe("summarizeAttempts", () => {
  it("counts an invocation as first-pass when attempt 1 was accepted", () => {
    const summary = summarizeAttempts([attempt("setup@root", 1, "accepted")]);
    expect(summary).toEqual({ total: 1, accepted: 1, firstPass: 1 });
  });

  it("treats a retry-then-accept as not first-pass", () => {
    const summary = summarizeAttempts([
      attempt("tune.implement@tune/iter-1", 1, "validation_failed"),
      attempt("tune.implement@tune/iter-1", 2, "accepted"),
    ]);
    expect(summary).toEqual({ total: 1, accepted: 1, firstPass: 0 });
  });

  it("keeps an unaccepted invocation in the denominator but out of the numerators", () => {
    const summary = summarizeAttempts([
      attempt("a", 1, "accepted"),
      attempt("b", 1, "validation_failed"),
      attempt("b", 2, "signoff_rejected"),
      attempt("c", 1, "cancelled"),
    ]);
    expect(summary).toEqual({ total: 3, accepted: 1, firstPass: 1 });
  });

  it("uses the earliest accepted attempt, whatever the row order", () => {
    const summary = summarizeAttempts([
      attempt("a", 2, "accepted"),
      attempt("a", 1, "accepted"),
    ]);
    expect(summary).toEqual({ total: 1, accepted: 1, firstPass: 1 });
  });

  it("is undefined for an empty stream (degenerate, no fake rate)", () => {
    expect(summarizeAttempts([])).toBeUndefined();
  });
});

describe("toolSuccessRate", () => {
  function tools(count: number, failures: number): ToolCallScore {
    return { count, failures, names: [], totalDurationMs: 0 };
  }

  it("is the non-failure share of opened calls", () => {
    expect(toolSuccessRate(tools(303, 3))).toBeCloseTo(1 - 3 / 303, 10);
  });

  it("is undefined when nothing was opened", () => {
    expect(toolSuccessRate(tools(0, 0))).toBeUndefined();
  });
});

describe("DurationRecorder attempts wiring", () => {
  function record(invocationId: string, attempt: number, outcome: StageAttemptOutcome): DurationRecord {
    return {
      version: 1,
      timestamp: "2026-09-04T00:00:00.000Z",
      runId: "e",
      invocationId,
      stageId: invocationId,
      stage: "s",
      worker: "w",
      attempt,
      kind: "duration",
      outcome,
      durationMs: 1,
    };
  }

  it("attaches attempts to the score and omits it when there are no records", () => {
    const recorder = new DurationRecorder("");
    const withRows = recorder.score([
      record("a", 1, "validation_failed"),
      record("a", 2, "accepted"),
      record("b", 1, "accepted"),
    ]);
    expect(withRows.attempts).toEqual({ total: 2, accepted: 2, firstPass: 1 });
    expect(recorder.score([]).attempts).toBeUndefined();
  });
});
