import { describe, expect, it } from "vitest";
import { formatDeltaTables, formatReport } from "../src/report.js";
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
      trace: {
        complete: true,
        issues: [],
        messages: { count: 0, rounds: 0 },
        stages: [],
        benchmarks: [{
          name: "tflops", unit: "TFLOP/s", direction: "higher", value: 14, samples: [14],
          iteration: 1, invocationId: "tune@root/iter-1", stageId: "tune.race.measure",
          worker: "store",
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
      trace: {
        complete: true,
        issues: [],
        messages: { count: 0, rounds: 0 },
        stages: [],
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
      codeChanges: { files: 3, additions: 12, deletions: 4, total: 16, testIntegrity: { cheating: false, addedFiles: 1, modifiedFiles: 0, deletedFiles: 0 } },
      artifact: {
        ...base.artifact,
        testSummary: { passed: 1264, failed: 3, skipped: 21, total: 1288, passRate: 1264 / 1267 },
      },
      trace: {
        complete: true,
        issues: [],
        messages: { count: 0, rounds: 0 },
        stages: [],
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
    expect(output).toContain("LOC");
    expect(output).toContain("case-a#1");
    expect(output).toContain("case-b#1");
    expect(output).toContain("+20.0%"); // vs-base, from baseline 10 → 12
    expect(output).toContain("88.9%"); // sel 8/9 applied winners
    expect(output).toContain("99.0%"); // tool-ok
    expect(output).toContain("95.2%"); // 1st-pass 40/42
    expect(output).toContain("2.13M"); // tokens
    expect(output).toContain("16"); // changed lines
    expect(output).toContain("303"); // tool calls
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
        trace: {
          complete: true,
          issues: [],
          messages: { count: 0, rounds: 0 },
          stages: [],
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

  it("picks columns from a group's family, not from the case's shape", () => {
    // A new measurement group joins the tuning family by name alone: a
    // `tuning-triton` case renders the tuning columns exactly like
    // `tuning-cuda`, even though it carries matrix dimensions — the group
    // decides the display, not the shape of the case.
    const triton: CaseResult = {
      ...performanceResult(),
      caseId: "matmul-512-triton",
      group: "tuning-triton",
      dimensions: { task: "matmul-512", harness: "triton", model: "dsv4f", effort: "max" },
    };
    const cuda: CaseResult = { ...performanceResult(), caseId: "matmul-512-cuda", group: "tuning-cuda" };
    // Each group holds one case here, so the default floor of two would hide
    // the very tables this asserts on.
    const output = formatReport(buildReport("run-11", "2026-08-25T00:00:00.000Z", [triton, cuda]), { minMatrixCases: 1 });
    expect(output).toContain("Matrix (tuning-triton)");
    expect(output).toContain("Matrix (tuning-cuda)");
    expect(output).toContain("vs-base"); // the tuning columns
    expect(output).toContain("tok-eff");
    expect(output).not.toContain("pass%"); // not the developer ones
    expect(output).not.toContain("Matrix (develop)");
  });

  it("renders a developer group whose cases carry no matrix dimensions", () => {
    // `develop` owns the whole group, so a case without dimensions still
    // renders — plain title, case-keyed row — instead of failing the columns
    // its family keys on.
    const withDimensions: CaseResult = {
      ...performanceResult(),
      caseId: "develop-with-dimensions",
      group: "develop",
      dimensions: { task: "task-a", harness: "pi", model: "dsv4f", effort: "max" },
    };
    const without: CaseResult = { ...performanceResult(), caseId: "develop-plain", group: "develop" };
    const output = formatReport(buildReport("run-12", "2026-08-25T00:00:00.000Z", [withDimensions, without]));
    const titles = output.split("\n").filter((line) => line.includes("Matrix (develop)"));
    expect(titles.some((line) => line.includes("· task-a / pi"))).toBe(true);
    expect(titles.some((line) => !line.includes("·"))).toBe(true);
    expect(output).toContain("pass%");
    expect(output).toContain("develop-plain#1");
    expect(output).not.toContain("vs-base");
  });

  it("renders capability probes with the agentic columns", () => {
    // A probe has no metric, no baseline, and no test suite: the tuning
    // columns (`final/best/base/vs-base/perf/traj/sel`) would be a wall of
    // dashes and the developer ones (`tests/pass%`) would be empty too. The
    // verdict and tool competence are the measurements.
    const probe = (overrides: Partial<CaseResult>): CaseResult => ({
      ...performanceResult(),
      group: "agentic",
      metric: undefined,
      baseline: undefined,
      baselineComparison: undefined,
      artifact: { verified: true },
      trace: {
        complete: true,
        issues: [],
        messages: { count: 0, rounds: 0 },
        stages: [],
        benchmarks: [],
        duration: { count: 1, totalMs: 15_000, maxMs: 15_000, attempts: { total: 1, accepted: 1, firstPass: 1 } },
        tokens: { count: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 6_463 },
        tools: { count: 2, failures: 0, names: ["read", "edit"], totalDurationMs: 1 },
      },
      ...overrides,
    });
    const passing = probe({ caseId: "edit-json", durationMs: 17_265 });
    const failing = probe({
      caseId: "create-file",
      durationMs: 6_089,
      status: "failed",
      artifact: { verified: false },
      trace: {
        ...probe({}).trace!,
        tools: { count: 4, failures: 1, names: ["bash"], totalDurationMs: 1 },
      },
    });
    const output = formatReport(buildReport("run-13", "2026-08-25T00:00:00.000Z", [passing, failing]));
    expect(output).toContain("Matrix (agentic)");
    expect(output).toContain("verified");
    expect(output).toContain("tool-ok");
    // The verdict reads as a verdict, colored by outcome.
    const passRow = output.split("\n").find((line) => line.startsWith("  edit-json#1"))!;
    const failRow = output.split("\n").find((line) => line.startsWith("  create-file#1"))!;
    /* eslint-disable no-control-regex -- ANSI color assertions */
    expect(passRow).toMatch(/\x1b\[32m\s+PASS/);
    expect(failRow).toMatch(/\x1b\[31m\s+FAIL/);
    /* eslint-enable no-control-regex */
    // Tool competence: 2 calls 0 failures vs 4 calls 1 failure.
    expect(passRow).toContain("100.0%");
    expect(failRow).toContain("75.0%");
    // None of the columns this group cannot fill.
    expect(output).not.toContain("vs-base");
    expect(output).not.toContain("best");
    expect(output).not.toContain("pass%");
    expect(output).not.toContain("traj");
  });

  it("falls back to the tuning columns for a group no family claims", () => {
    // The fallback exists so a new group still renders something before a
    // family is written for it. It is a fallback, not an endorsement: a probe
    // passing through here shows the dashes the agentic family exists to
    // avoid, which is why a new group belongs in a family.
    const unclaimed: CaseResult = {
      ...performanceResult(),
      caseId: "unclaimed-case",
      group: "some-new-group",
      metric: undefined,
      artifact: { verified: true },
    };
    const sibling: CaseResult = { ...unclaimed, caseId: "unclaimed-sibling" };
    const output = formatReport(buildReport("run-14", "2026-08-25T00:00:00.000Z", [unclaimed, sibling]));
    expect(output).toContain("Matrix (some-new-group)");
    expect(output).toContain("vs-base");
    expect(output).toContain("tok-eff");
    expect(output).not.toContain("verified");
  });

  it("shows a capability probe's verdict as a transition, not a subtraction", () => {
    // Same interface, specialized implementation: the agentic family replaces
    // the generic Δ board so a lost or regained capability is legible. The
    // generic board can only say how far `quality` moved, which reads as a
    // plain gain when a probe starts passing.
    const probe = (verified: boolean, quality: number): CaseResult => ({
      ...performanceResult(),
      caseId: "edit-json",
      group: "agentic",
      metric: undefined,
      baseline: undefined,
      baselineComparison: undefined,
      artifact: { verified },
      scorecard: { ...performanceResult().scorecard, quality } as CaseResult["scorecard"],
    });
    const output = formatDeltaTables([{
      current: probe(true, 1),
      previous: probe(false, 0),
      currentRunSet: "eval-20260102T000000.000",
      previousRunSet: "eval-20260101T000000.000",
    }]);
    expect(output).toContain("verified");
    // eslint-disable-next-line no-control-regex -- ANSI color assertion
    expect(output).toMatch(/\x1b\[32m\s+FAIL → PASS/);
    // A regression reads the other way.
    const regressed = formatDeltaTables([{
      current: probe(false, 0),
      previous: probe(true, 1),
      currentRunSet: "eval-20260102T000000.000",
      previousRunSet: "eval-20260101T000000.000",
    }]);
    // eslint-disable-next-line no-control-regex -- ANSI color assertion
    expect(regressed).toMatch(/\x1b\[31m\s+PASS → FAIL/);
    // An unchanged verdict stays dim rather than reading as a move.
    const held = formatDeltaTables([{
      current: probe(true, 1),
      previous: probe(true, 1),
      currentRunSet: "eval-20260102T000000.000",
      previousRunSet: "eval-20260101T000000.000",
    }]);
    // eslint-disable-next-line no-control-regex -- ANSI color assertion
    expect(held).toMatch(/\x1b\[2m\s+PASS → PASS/);
    // The transition occupies one slot per line, so the header still lines up.
    const header = held.split("\n").find((line) => line.includes("quality"))!;
    expect(header.indexOf("verified")).toBeLessThan(header.indexOf("quality"));
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
        accepted: false,
        issues: [{ code: "trajectory-missing", message: "no trajectory file" }],
        policy: { requireExecution: true, requireArtifact: true, requireEvidence: true, requireBaseline: false, requireImprovement: false },
      },
      trace: {
        complete: true,
        issues: ["minor"],
        messages: { count: 0, rounds: 0 },
        stages: [],
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

describe("delta board", () => {
  function comparable(overrides: Partial<CaseResult>): CaseResult {
    return { ...performanceResult(), ...overrides };
  }

  /** Visible width of a table, ignoring SGR bytes. */
  function width(text: string): number {
    // eslint-disable-next-line no-control-regex -- measuring visible columns only
    return Math.max(...text.split("\n").map((line) => line.replace(/\x1b\[[0-9;]*m/g, "").length));
  }

  it("pairs a Δvalue and a Δ% cell for every metric of the case's matrix", () => {
    const output = formatDeltaTables([{
      current: comparable({ durationMs: 60_000, baselineComparison: { relativeImprovement: 0.2 } as CaseResult["baselineComparison"] }),
      previous: comparable({ durationMs: 100_000, baselineComparison: { relativeImprovement: 0.1 } as CaseResult["baselineComparison"] }),
      currentRunSet: "eval-20260102T000000.000",
      previousRunSet: "eval-20260101T000000.000",
    }], { layout: "wide" });
    expect(output).toContain("Δ vs previous record (performance)");
    expect(output).toContain("eval-20260101T000000.000 → eval-20260102T000000.000 (tuning-case#1)");
    // The columns are the live matrix's own, in its own order.
    const header = output.split("\n")[2]!;
    for (const metric of ["final", "best", "base", "vs-base", "perf", "traj", "sel", "quality", "tool-ok", "tokens", "time"]) {
      expect(header).toContain(metric);
    }
    // The efficiency columns normalise against the section's own cheapest run,
    // so their two sides would have different references and no meaningful
    // difference: they stay in the live matrix and out of the Δ board.
    expect(header).not.toContain("tok-eff");
    expect(header).not.toContain("time-eff");
    expect(header.indexOf("final")).toBeLessThan(header.indexOf("quality"));
    expect(header.indexOf("quality")).toBeLessThan(header.indexOf("time"));
    // Row lookup skips the provenance line, which also names the case.
    const row = output.split("\n").find((line) => line.startsWith("  tuning-case#1"))!;
    /* eslint-disable no-control-regex -- ANSI color assertions */
    // vs-base 0.1 → 0.2: a +10.0pp move, green because higher is better.
    expect(row).toMatch(/\x1b\[32m\s+\+10\.0pp/);
    expect(row).toMatch(/\x1b\[32m\s+\+100\.0%/);
    // time 100s → 60s: lower-is-better, so the drop is the improvement.
    expect(row).toMatch(/\x1b\[32m\s+-40000/);
    expect(row).toMatch(/\x1b\[32m\s+-40\.0%/);
    // Unchanged readings stay dim rather than reading as a regression.
    expect(row).toMatch(/\x1b\[2m\s+\+0\.0000/);
    expect(row).toMatch(/\x1b\[2m\s+\+0\.0%/);
    /* eslint-enable no-control-regex */
  });

  it("renders a case's single record with every Δ cell missing", () => {
    const output = formatDeltaTables([{ current: comparable({}), currentRunSet: "eval-20260102T000000.000" }]);
    expect(output).toContain("n/a → eval-20260102T000000.000 (tuning-case#1)");
    // No invented zero and no invented reference: every cell is missing.
    expect(output).not.toContain("+0.0%");
    const row = output.split("\n").find((line) => line.startsWith("  tuning-case#1"))!;
    expect(row).toMatch(/—/);
    expect(row).not.toContain("+");
  });

  it("uses the case's own matrix columns and grouping for developer cases", () => {
    const develop = (overrides: Partial<CaseResult>): CaseResult => ({
      ...performanceResult(),
      caseId: "footer-column-width-pi-dsv4f",
      group: "develop",
      dimensions: { task: "footer-column-width", harness: "pi", model: "dsv4f", effort: "max" },
      metric: undefined,
      baseline: undefined,
      artifact: { verified: true, testSummary: { passed: 10, failed: 2, skipped: 0, total: 12, passRate: 10 / 12 } },
      ...overrides,
    });
    const changes = (files: number, additions: number, deletions: number) => ({
      files, additions, deletions, total: additions + deletions,
      testIntegrity: { cheating: false, addedFiles: 0, modifiedFiles: 0, deletedFiles: 0 },
    });
    const output = formatDeltaTables([{
      current: develop({ durationMs: 60_000, codeChanges: changes(3, 12, 4) }),
      previous: develop({ durationMs: 120_000, codeChanges: changes(1, 6, 2) }),
      currentRunSet: "eval-20260102T000000.000",
      previousRunSet: "eval-20260101T000000.000",
    }]);
    expect(output).toContain("Δ vs previous record (develop) · footer-column-width / pi");
    // Developer columns, and none of the tuning ones.
    expect(output).toContain("+LOC");
    expect(output).toContain("-LOC");
    expect(output).not.toContain("vs-base");
    expect(output).not.toContain("tok-eff");
    expect(output).not.toContain("perf");
    // Row identity stays model + effort#.
    expect(output).toContain("dsv4f");
    expect(output).toContain("max#1");
    // The composite live cell (+additions/-deletions) split into two Δ columns,
    // and the wall-time drop is a lower-is-better improvement.
    expect(output).toContain("+100.0%"); // additions 6 → 12
    expect(output).toContain("+200.0%"); // files 1 → 3
    expect(output).toContain("-60000");
    expect(output).toContain("-50.0%"); // 120s → 60s
  });

  it("stacks the Δvalue and Δ% cells on two lines when asked", () => {
    const record = {
      current: comparable({ durationMs: 60_000 }),
      previous: comparable({ durationMs: 100_000 }),
      currentRunSet: "eval-20260102T000000.000",
      previousRunSet: "eval-20260101T000000.000",
    };
    const lines = formatDeltaTables([record], { layout: "stacked" }).split("\n");
    const valueLine = lines.findIndex((line) => line.includes("Δval"));
    expect(valueLine).toBeGreaterThan(0);
    expect(lines[valueLine]).toContain("-40000");
    expect(lines[valueLine + 1]).toContain("Δ%");
    expect(lines[valueLine + 1]).toContain("-40.0%");
    // Half the metric slots per line, at the cost of a second line per case.
    expect(width(lines.join("\n"))).toBeLessThan(width(formatDeltaTables([record], { layout: "wide" })));
  });
});
