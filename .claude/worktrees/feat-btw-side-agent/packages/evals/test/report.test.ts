import { describe, expect, it } from "vitest";
import { formatReport, formatRunSetComparison } from "../src/report.js";
import { buildReport } from "../src/scorer.js";
import type { CaseResult } from "../src/types.js";

function performanceResult(): CaseResult {
  return {
    caseId: "tuning-case",
    trial: 1,
    group: "performance",
    tags: ["tflops"],
    status: "completed",
    workspaceDir: "/tmp/workspace",
    baseline: {
      value: 10,
      metric: "tflops",
      direction: "higher",
      rawOutput: "TFLOPS: 10",
      passed: true,
      source: "baseline",
    },
    trajectory: {
      messageCount: 2,
      assistantMessageCount: 1,
      rounds: 1,
      toolCallCount: 1,
      toolNames: ["bash"],
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    },
    artifact: { verified: true, value: 12 },
    metric: { name: "tflops", direction: "higher" },
    runDir: "/tmp/run",
    trajectoryPath: "/tmp/run/trajectory.json",
    logPath: "/tmp/run/log.jsonl",
    tracePath: "/tmp/run/trace.jsonl",
    transcriptPath: "/tmp/run/transcript.jsonl",
    transcript: {
      messageCount: 2,
      userMessageCount: 1,
      assistantMessageCount: 1,
      toolResultCount: 1,
      toolCallCount: 1,
      toolNames: ["bash"],
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
      finalText: "done",
      valid: true,
      issues: [],
    },
    stageTrajectories: [{
      stageId: "tune",
      invocationId: "tune@root",
      worker: "worker",
      transcriptPath: "/tmp/run/stage.jsonl",
      transcriptValid: true,
      transcriptUserMessageCount: 1,
      transcriptToolResultCount: 1,
      messageCount: 2,
      assistantMessageCount: 1,
      rounds: 1,
      toolCallCount: 1,
      toolNames: ["bash"],
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2,
    }],
    progressPath: "/tmp/run/progress.jsonl",
    progress: [{ iteration: 0, resultPayload: { decision: "KEEP", benchmark: { best: 11 } } }],
  };
}

describe(" eval report", () => {
  it("prints direction-normalized absolute and relative improvement", () => {
    const report = buildReport("run-1", "2026-08-25T00:00:00.000Z", [performanceResult()]);
    const output = formatReport(report);
    expect(output).toContain("baseline=10.0000");
    expect(output).toContain("metric=12.0000");
    expect(output).toContain("improvement=+2.0000 (+20.0%) improved");
  });

  it("renders the collapsed series with deltas and both score tracks", () => {
    const base = performanceResult();
    const seriesKey = `tflops${String.fromCharCode(0)}TFLOP/s`;
    const withSeries: CaseResult = {
      ...base,
      workflowTrajectory: {
        source: "native",
        complete: true,
        issues: [],
        benchmarks: [{
          name: "tflops", unit: "TFLOP/s", direction: "higher", value: 14, samples: [14],
          iteration: 1, invocationId: "tune@root/iter-1", stageId: "tune.race.measure",
          worker: "store", contractDigest: "0".repeat(64), accepted: true,
        }],
        duration: { count: 0, totalMs: 0, maxMs: 0 },
        tokens: { count: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        tools: { count: 0, failures: 0, names: [], totalDurationMs: 0 },
        benchmarkScore: {
          trajectories: {},
          best: { [seriesKey]: 14 },
          last: { [seriesKey]: 14 },
          series: {
            [seriesKey]: [
              { iteration: 0, value: 12, direction: "higher", bestSoFar: 12, speedupVsSeed: 1 },
              { iteration: 1, value: 14, direction: "higher", prev: 12, delta: 2, relativeDelta: 2 / 12, improved: true, bestSoFar: 14, speedupVsSeed: 14 / 12 },
            ],
          },
          score: { [seriesKey]: 7 / 13 },
        },
      },
    };
    const output = formatReport(buildReport("run-2", "2026-08-25T00:00:00.000Z", [withSeries]));
    expect(output).toContain("metrics: tflops TFLOP/s: iter0 12.0000 (seed)");
    expect(output).toContain("iter1 14.0000");
    expect(output).toContain("(+16.7%)");
    expect(output).toContain("trajectory=0.538(vs-iter0)");
    // perf track is the scorecard's baseline-relative performance (12 vs 10
    // on the hyperbola: 1.2/2.2 = 0.545).
    expect(output).toContain("perf=0.545(vs-baseline)");
    // The series replaces the raw measurement enumeration (no dup chain).
    expect(output.match(/iter\d+ /g)).toHaveLength(2);
  });

  it("renders whole-run cost scores for a native trajectory", () => {
    const base = performanceResult();
    const withCost: CaseResult = {
      ...base,
      workflowTrajectory: {
        source: "native",
        complete: true,
        issues: [],
        benchmarks: [],
        duration: { count: 43, totalMs: 4_000_000, maxMs: 500_000, attempts: { total: 42, accepted: 42, firstPass: 40 } },
        tokens: { count: 43, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 2_128_551 },
        tools: { count: 303, failures: 3, names: ["bash"], totalDurationMs: 1 },
      },
    };
    const output = formatReport(buildReport("run-3", "2026-08-25T00:00:00.000Z", [withCost]));
    // Colors split the line, so assert the fragments (same idiom as the
    // series-line test above).
    expect(output).toContain("cost: tokens=2.13M");
    expect(output).toContain("tool-ok=99.0%");
    expect(output).toContain("first-pass=95.2%");
    expect(output).toContain("(40/42)");
    // A legacy result without the native evaluation keeps no cost line at all.
    const legacyOutput = formatReport(buildReport("run-4", "2026-08-25T00:00:00.000Z", [base]));
    expect(legacyOutput).not.toContain("cost:");
  });

  it("renders a same-group matrix with per-dimension cells and dash for missing", () => {
    const base = performanceResult();
    const withTrajectory: CaseResult = {
      ...base,
      caseId: "case-a",
      durationMs: 90_000,
      workflowTrajectory: {
        source: "native",
        complete: true,
        issues: [],
        benchmarks: [],
        duration: { count: 43, totalMs: 4_000_000, maxMs: 500_000, attempts: { total: 42, accepted: 42, firstPass: 40 } },
        tokens: { count: 43, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 2_128_551 },
        tools: { count: 303, failures: 3, names: ["bash"], totalDurationMs: 1 },
        selection: { count: 9, merged: 8, carried: 0, noWinner: 1, metricless: 0 },
      },
    };
    const legacy: CaseResult = { ...base, caseId: "case-b", durationMs: 40_000 };
    // A coding-style row has no performance readout: the scorecard carries a
    // placeholder 0 for performance, but the matrix must show it as N/A.
    const noReadout: CaseResult = {
      ...base,
      caseId: "case-c",
      metric: undefined,
      baseline: undefined,
      baselineComparison: undefined,
      artifact: { verified: true },
    };
    const output = formatReport(buildReport("run-5", "2026-08-25T00:00:00.000Z", [legacy, withTrajectory, noReadout]));
    // Colors split cells, so assert fragments (same idiom as the cost test).
    expect(output).toContain("Matrix (performance)");
    // Detail precedes summary: the matrix and the per-case process print
    // before the aggregate rollups.
    expect(output.indexOf("Matrix (performance)")).toBeLessThan(output.indexOf("# Cases"));
    expect(output.indexOf("# Cases")).toBeLessThan(output.indexOf("Overall"));
    expect(output).toContain("vs-base");
    expect(output).toContain("tok-eff");
    expect(output).toContain("case-a#1");
    expect(output).toContain("case-b#1");
    expect(output).toContain("+20.0%"); // vs-base, from baseline 10 → 12
    expect(output).toContain("88.9%"); // sel 8/9 applied winners
    expect(output).toContain("99.0%"); // tool-ok
    expect(output).toContain("95.2%"); // 1st-pass 40/42
    expect(output).toContain("2.13M"); // tokens
    expect(output).toContain("1m"); // case-a wall time
    // Efficiencies reuse the composite's hyperbolic curve vs group cheapest:
    // cheapest parity is 0.500; 2.25× the fastest (90m vs 40m) is 0.308.
    expect(output).toContain("0.500");
    expect(output).toContain("0.308");
    // The legacy row has no native trajectory → its trajectory-only dims dash.
    expect(output).toContain("—");
    // The no-readout row shows N/A for perf instead of the placeholder zero.
    const caseCRow = output.split("\n").find((line) => line.includes("case-c#1"))!;
    expect(caseCRow).toContain("—");
    expect(caseCRow).not.toContain("0.000");
    // A group with a single case renders no matrix at all.
    const solo = formatReport(buildReport("run-6", "2026-08-25T00:00:00.000Z", [base]));
    expect(solo).not.toContain("Matrix (");
    // The assembled selection view lowers the bar to one case.
    expect(formatReport(buildReport("run-7", "2026-08-25T00:00:00.000Z", [base]), { minMatrixCases: 1 }))
      .toContain("Matrix (performance)");
  });

  it("renders the run best alongside final in the matrix", () => {
    const withBest = (best: number, final: number): CaseResult => {
      const kase = performanceResult();
      return {
        ...kase,
        artifact: { verified: true, value: final },
        workflowTrajectory: {
          source: "native",
          complete: true,
          issues: [],
          benchmarks: [],
          duration: { count: 1, totalMs: 1000, maxMs: 1000 },
          tokens: { count: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
          tools: { count: 1, failures: 0, names: ["bash"], totalDurationMs: 1 },
          benchmarkScore: {
            trajectories: {},
            best: { [`tflops${String.fromCharCode(0)}TFLOP/s`]: best },
            last: {},
          },
        },
      };
    };
    const legacy: CaseResult = { ...performanceResult(), caseId: "case-legacy" };
    const output = formatReport(buildReport("run-9", "2026-08-25T00:00:00.000Z", [
      // Delivered final (12) trails the run best (24): both numbers print, so
      // the gap is visible as protocol non-compliance (no scoring of it).
      withBest(24, 12),
      // Near-parity row, and a legacy row without any benchmark score.
      withBest(12.1, 12),
      legacy,
    ]));
    expect(output).toContain("best");
    expect(output).toContain("24.0000");
    expect(output).toContain("12.1000");
    // The legacy row keeps final (12.0000) and dashes the best column.
    const legacyRow = output.split("\n").find((line) => line.includes("case-legacy#1"))!;
    expect(legacyRow).toContain("12.0000");
    expect(legacyRow).toMatch(/12\.0000\s+—/);
  });

  it("drops the per-case detail block when details are off", () => {
    const base = performanceResult();
    const withTrajectory: CaseResult = {
      ...base,
      caseId: "case-a",
      evidence: {
        taskPass: true,
        executionPass: true,
        evidencePass: false,
        accepted: true,
        issues: [{ code: "trajectory-missing", message: "no trajectory file" }],
        policy: { requireExecution: true, requireArtifact: true, requireEvidence: true, requireBaseline: false, requireImprovement: false },
      },
      workflowTrajectory: {
        source: "native",
        complete: true,
        issues: ["minor"],
        benchmarks: [],
        duration: { count: 1, totalMs: 1000, maxMs: 1000 },
        tokens: { count: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
        tools: { count: 1, failures: 0, names: ["bash"], totalDurationMs: 1 },
      },
    };
    const report = buildReport("run-10", "2026-08-25T00:00:00.000Z", [base, withTrajectory]);
    const detailed = formatReport(report);
    expect(detailed).toContain("# Cases");
    expect(detailed).toContain("evidence issue=");
    // Compact keeps the matrix and the score summary and nothing else.
    const compact = formatReport(report, { details: false });
    expect(compact).toContain("Matrix (performance)");
    expect(compact).not.toContain("# Cases");
    expect(compact).not.toContain("evidence issue=");
    expect(compact).toContain("Overall");
    expect(compact).toContain("pass rate:");
  });

  it("prunes scorecard bars that restate the overall membership", () => {    const a: CaseResult = { ...performanceResult(), caseId: "case-a", tags: ["tflops"] };
    const b: CaseResult = { ...performanceResult(), caseId: "case-b", tags: ["tflops", "solo"] };
    const output = formatReport(buildReport("run-8", "2026-08-25T00:00:00.000Z", [a, b]));
    // The overall group plus the rollups covering exactly the same cases
    // (tag:tflops, group:performance) restate one number three ways.
    /* eslint-disable no-control-regex -- these assertions match ANSI escapes on purpose */
    expect(output).not.toMatch(/\x1b\[1moverall/);
    expect(output).not.toMatch(/\x1b\[1mtag:tflops/);
    expect(output).not.toMatch(/\x1b\[1mgroup:performance/);
    // tag:solo covers only case-b, so its bar carries real information.
    expect(output).toMatch(/\x1b\[1mtag:solo/);
    /* eslint-enable no-control-regex */
  });
});

describe("run set comparison", () => {
  function comparable(overrides: Partial<CaseResult>): CaseResult {
    return { ...performanceResult(), ...overrides };
  }

  it("renders per-dimension deltas with direction-aware coloring", () => {
    const previous = buildReport("eval-20260101T000000.000", "2026-08-25T00:00:00.000Z", [
      comparable({ durationMs: 100_000, baselineComparison: { relativeImprovement: 0.1 } as CaseResult["baselineComparison"] }),
    ]);
    const current = buildReport("eval-20260102T000000.000", "2026-08-26T00:00:00.000Z", [
      comparable({ durationMs: 60_000, baselineComparison: { relativeImprovement: 0.2 } as CaseResult["baselineComparison"] }),
    ]);
    const output = formatRunSetComparison(current, previous);
    expect(output).toContain("eval-20260101T000000.000 → eval-20260102T000000.000");
    // Columns run detail-first, summary-last: cost on the left, scores in the
    // middle, and the outcome (`final`) rightmost.
    const header = output.split("\n")[1]!;
    expect(header.indexOf("tokens")).toBeLessThan(header.indexOf("tool-ok"));
    expect(header.indexOf("time")).toBeLessThan(header.indexOf("tool-ok"));
    expect(header.indexOf("quality")).toBeLessThan(header.indexOf("traj"));
    expect(header.indexOf("base")).toBeLessThan(header.indexOf("final"));
    const row = output.split("\n").find((line) => line.includes("tuning-case#1"))!;
    // metric higher-better: 12 vs 12 → 0.0% (dim); tokens equal → 0.0%.
    expect(row).toContain("+0.0%");
    // vs-base: 0.1 → 0.2 = +10.0pp (improvement).
    expect(row).toContain("+10.0pp");
    // time lower-better: 100s → 60s = -40.0%, colored green (improved).
    // eslint-disable-next-line no-control-regex -- ANSI color assertion
    expect(row).toMatch(/\x1b\[32m +-40\.0%/);
  });

  it("flags degradation, status flips, and cases present on one side only", () => {
    const previous = buildReport("eval-20260101T000000.000", "2026-08-25T00:00:00.000Z", [
      comparable({ durationMs: 100_000 }),
      comparable({ caseId: "dropped-case" }),
    ]);
    const current = buildReport("eval-20260102T000000.000", "2026-08-26T00:00:00.000Z", [
      comparable({ durationMs: 200_000, artifact: { verified: false, value: 9 }, status: "failed" }),
      comparable({ caseId: "new-case" }),
    ]);
    const output = formatRunSetComparison(current, previous);
    expect(output).toContain("DROPPED");
    expect(output).toContain("NEW");
    // tokens 2→2 (+0.0% dim), time 100s→200s = +100.0% red (lower-better).
    const row = output.split("\n").find((line) => line.includes("tuning-case#1"))!;
    expect(row).toContain("+100.0%");
    /* eslint-disable no-control-regex -- ANSI color assertions */
    expect(row).toMatch(/\x1b\[31m \+100\.0%/);
    // final 12→9 = -25.0% red (higher-better metric).
    expect(row).toMatch(/\x1b\[31m.*?-25\.0%/);
    /* eslint-enable no-control-regex */
    expect(output).toContain(`\x1b[31m!\x1b[0m tuning-case#1: status completed → failed`);
    expect(output).toContain("tuning-case#1: verified yes → no");
  });
});
