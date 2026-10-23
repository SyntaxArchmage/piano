import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  analyzeTranscriptText,
  assessCaseEvidence,
  buildCaseScorecard,
  compareBenchmark,
  compareVariants,
  evaluateJudges,
  summarizeTiming,
  validateTranscriptText,
} from "../src/evidence.js";
import type { CaseResult, RunTrace, TranscriptMetrics } from "../src/types.js";

const transcript: TranscriptMetrics = {
  messageCount: 2,
  userMessageCount: 1,
  assistantMessageCount: 1,
  toolResultCount: 1,
  toolCallCount: 1,
  toolNames: ["bash"],
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 15,
  finalText: "done",
  fullText: "done",
  valid: true,
  issues: [],
};

const trace: RunTrace = {
  complete: true,
  issues: [],
  messages: { count: 2, rounds: 1 },
  tokens: { count: 1, input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
  tools: { count: 1, failures: 0, names: ["bash"], totalDurationMs: 5 },
  duration: { count: 1, totalMs: 40, maxMs: 40 },
  benchmarks: [{
    name: "tflops",
    unit: "TFLOP/s",
    direction: "higher",
    value: 11,
    iteration: 0,
    invocationId: "tune@root/iter-0",
  }],
  stages: [{
    invocationId: "tune@root",
    stageId: "tune",
    worker: "optimizer",
    transcriptPath: "/tmp/run/stage.jsonl",
    transcript,
    tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
    toolCalls: { count: 1, failures: 0 },
    durationMs: 40,
  }],
};

function result(overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    caseId: "matmul",
    runSetId: "eval-1",
    trial: 1,
    group: "performance",
    tags: ["performance"],
    status: "completed",
    workspaceDir: "/tmp/matmul",
    runDir: "/tmp/run",
    trajectoryPath: "/tmp/run/trajectory.jsonl",
    evalMetricsDir: "/tmp/run/eval-metrics",
    logPath: "/tmp/run/log.jsonl",
    tracePath: "/tmp/run/trace.jsonl",
    transcriptPath: "/tmp/run/session.jsonl",
    metric: { name: "tflops", direction: "higher" },
    trace,
    baseline: { value: 10, metric: "tflops", direction: "higher", rawOutput: "TFLOPS: 10", passed: true },
    artifact: { verified: true, value: 12 },
    transcript,
    evidence: {
      taskPass: true,
      executionPass: true,
      evidencePass: true,
      accepted: true,
      issues: [],
      policy: {
        requireExecution: true,
        requireArtifact: true,
        requireEvidence: true,
        requireBaseline: false,
        requireImprovement: false,
      },
    },
    ...overrides,
  };
}

const allAvailable = { run: true, trajectory: true, evalMetrics: true, log: true, trace: true, transcript: true };

describe(" transcript evidence", () => {
  it("continues after malformed NDJSON and reports strict diagnostics", () => {
    const raw = [
      JSON.stringify({ type: "session", id: "s1" }),
      JSON.stringify({ type: "message", message: { role: "user", content: "task" } }),
      JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "first" }, { type: "toolCall", name: "bash" }], usage: { input: 2, output: 3, cacheRead: 4, cacheWrite: 3 } } }),
      JSON.stringify({ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "ok" }] } }),
      "{not-json}",
      JSON.stringify({ type: "message", message: { role: "assistant", content: "second", usage: { totalTokens: 12 } } }),
    ].join("\n");
    const validation = validateTranscriptText(raw);
    const metrics = analyzeTranscriptText("session.jsonl", raw);
    expect(validation.issues).toHaveLength(1);
    expect(metrics.valid).toBe(false);
    expect(metrics.userMessageCount).toBe(1);
    expect(metrics.assistantMessageCount).toBe(2);
    expect(metrics.toolResultCount).toBe(1);
    expect(metrics.toolNames).toEqual(["bash"]);
    expect(metrics.cacheWriteTokens).toBe(3);
    expect(metrics.totalTokens).toBe(12);
    expect(metrics.fullText).toContain("second");
  });

  it("ignores negative transcript usage counters when deriving totals", () => {
    const raw = JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: "done",
        usage: { input: -10, output: 5, cacheRead: -2, cacheWrite: 3 },
      },
    });

    expect(analyzeTranscriptText("session.jsonl", raw)).toMatchObject({
      inputTokens: 0,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 3,
      totalTokens: 8,
    });
  });
});

describe(" evidence and scorecard", () => {
  it("compares higher/lower metrics against the grader-owned baseline", () => {
    expect(compareBenchmark(10, 12, "higher").improved).toBe(true);
    expect(compareBenchmark(10, 8, "lower").improved).toBe(true);
    expect(compareBenchmark(10, 10, "higher").relativeDelta).toBe(0);
    expect(compareBenchmark(10, 8, "lower")).toMatchObject({ absoluteImprovement: 2, relativeImprovement: 0.2 });
  });

  it("separates task, execution, and durable evidence acceptance", () => {
    const complete = result();
    const accepted = assessCaseEvidence(complete, {
      availability: allAvailable,
      policy: { requireBaseline: true, requireImprovement: true },
    });
    expect(accepted).toMatchObject({ taskPass: true, executionPass: true, evidencePass: true, accepted: true });

    const cheated = assessCaseEvidence({
      ...complete,
      codeChanges: {
        files: 2,
        additions: 5,
        deletions: 1,
        total: 6,
        testIntegrity: { cheating: true, addedFiles: 0, modifiedFiles: 1, deletedFiles: 0 },
      },
    }, {
      availability: allAvailable,
    });
    expect(cheated).toMatchObject({ taskPass: false, evidencePass: false, accepted: false });
    expect(cheated.issues.map((issue) => issue.code)).toContain("test-cheating");

    const incomplete = assessCaseEvidence({ ...complete, transcript: { ...complete.transcript!, valid: false } }, {
      availability: allAvailable,
    });
    expect(incomplete.evidencePass).toBe(false);
    expect(incomplete.issues.map((issue) => issue.code)).toContain("transcript-invalid");

    const stage = complete.trace!.stages[0]!;
    const stageIncomplete = assessCaseEvidence({
      ...complete,
      trace: {
        ...complete.trace!,
        stages: [{ ...stage, transcript: { ...stage.transcript!, valid: false, issues: [{ kind: "syntax", line: 2, message: "bad json" }] } }],
      },
    }, {
      availability: allAvailable,
    });
    expect(stageIncomplete.issues.map((issue) => issue.code)).toContain("transcript-invalid");

    const unlinkedStage = assessCaseEvidence({
      ...complete,
      trace: {
        ...complete.trace!,
        stages: [{ ...stage, transcriptPath: undefined, transcript: undefined }],
      },
    }, {
      availability: allAvailable,
    });
    expect(unlinkedStage.issues.map((issue) => issue.code)).toContain("stage-transcript-missing");

    const unvalidatedStage = assessCaseEvidence({
      ...complete,
      trace: {
        ...complete.trace!,
        stages: [{ ...stage, transcript: undefined }],
      },
    }, {
      availability: allAvailable,
    });
    expect(unvalidatedStage.issues.map((issue) => issue.code)).toContain("transcript-invalid");
  });

  it("does not treat a parseable but failed baseline as replayable evidence", () => {
    const invalidBaseline = {
      ...result(),
      baseline: { ...result().baseline!, passed: false },
    };
    const assessment = assessCaseEvidence(invalidBaseline, {
      availability: allAvailable,
      policy: { requireBaseline: true },
    });
    expect(assessment.issues.map((issue) => issue.code)).toEqual(["baseline-invalid", "baseline-missing"]);
    expect(assessment.accepted).toBe(false);
  });

  it("does not report dry-run validation as durable evidence", () => {
    const assessment = assessCaseEvidence({
      ...result(),
      status: "skipped",
      runDir: undefined,
      trajectoryPath: undefined,
      logPath: undefined,
      tracePath: undefined,
      transcriptPath: undefined,
    });
    expect(assessment.evidencePass).toBe(false);
    expect(assessment.accepted).toBe(false);
  });

  it("reports a performance workflow with an empty measurement stream", () => {
    const incomplete = result({
      artifact: { verified: true, value: 12 },
      trace: { ...result().trace!, benchmarks: [] },
    });
    const assessment = assessCaseEvidence(incomplete, {
      availability: allAvailable,
    });
    expect(assessment.issues.filter((issue) => issue.code === "metric-measurement-missing")).toHaveLength(1);
    expect(assessment.accepted).toBe(false);
  });

  it("accepts a grader-measured metric when the case does not require evidence", () => {
    // The workflow-perf family measures runtime overhead with the grader's
    // benchmark command; the workflow itself has no metric contract to record.
    const graderMeasured = result({
      artifact: { verified: true, value: 45 },
      trace: { ...result().trace!, benchmarks: [] },
    });
    const assessment = assessCaseEvidence(graderMeasured, {
      availability: allAvailable,
      policy: { requireEvidence: false },
    });
    expect(assessment.issues.map((issue) => issue.code)).not.toContain("metric-measurement-missing");
    expect(assessment.evidencePass).toBe(true);
    expect(assessment.accepted).toBe(true);
  });

  it("rejects a workflow metric whose direction disagrees with the eval case", () => {
    const current = result();
    const mismatched = result({
      trace: {
        ...current.trace!,
        benchmarks: current.trace!.benchmarks.map((point) => ({ ...point, direction: "lower" as const })),
      },
    });
    const assessment = assessCaseEvidence(mismatched, {
      availability: allAvailable,
    });
    expect(assessment.issues.map((issue) => issue.code)).toContain("metric-measurement-missing");
    expect(assessment.accepted).toBe(false);
  });

  it("computes timing and scorecard quality without a provider dependency", () => {
    const current = result();
    const scorecard = buildCaseScorecard(current);
    expect(summarizeTiming(current)).toMatchObject({ wallClockMs: 0, stageTotalMs: 40, maxStageMs: 40, completedStageCount: 1 });
    // 12 vs baseline 10 = ratio 1.2; the hyperbolic curve maps it to
    // 1.2/2.2 instead of the old min(1, ratio) saturation at 1.
    expect(scorecard.performance).toBeCloseTo(1.2 / 2.2, 10);
    expect(scorecard.quality).toBeCloseTo((1 + 1 + 1 + 1.2 / 2.2) / 4, 10);
    expect(scorecard.judgeBacked).toBe(false);
  });

  it("does not penalize a workflow without the performance capability", () => {
    const scorecard = buildCaseScorecard(result({
      metric: undefined,
      baseline: undefined,
      artifact: { verified: true },
    }));

    expect(scorecard.performance).toBe(0);
    expect(scorecard.quality).toBe(1);
  });

  it("runs injected judges and preserves a failed judge as zero evidence", async () => {
    const grades = await Effect.runPromise(evaluateJudges(result(), [
      { name: "human-rubric", weight: 2, evaluate: () => Effect.succeed({ name: "ignored", score: 4, weight: 2 }) },
      { name: "broken", evaluate: () => Effect.fail(new Error("offline")) },
    ]));
    expect(grades).toEqual([
      { name: "human-rubric", score: 4, weight: 2 },
      { name: "broken", score: 0, weight: 1, rationale: "judge failed: offline" },
    ]);
  });

  it("aggregates named variants instead of using the best run as the reference", () => {
    const a = result({ variant: "a", runSetId: "run-a" });
    const b = result({ variant: "b", runSetId: "run-b", artifact: { verified: true, value: 11 } });
    const comparison = compareVariants([a, b]);
    expect(comparison).toHaveLength(1);
    expect(comparison[0]?.variants.map((variant) => variant.variant)).toEqual(["a", "b"]);
    expect(comparison[0]?.variants[0]?.baselineMetric).toBe(10);
  });
});
