import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { parseCaseConfig } from "../src/case-config.js";
import { reduceCaseGroup, buildReport, normalizeMetric } from "../src/scorer.js";
import type { CaseResult } from "../src/types.js";

const MINIMAL_CASE = `version: 1
id: case-0-basic-write
group: agentic
prompt: Create a file named hello.py containing a function greet() returning "hi".
command: piano -p <prompt>
workspace: workspace
readout:
  kind: programmatic
  compileCommand: "true"
  verifyCommand: 'python -c "import hello; assert hello.greet() == ''hi''"'
tags:
  - tag: correctness
    weight: 2
`;

describe("parseCaseConfig", () => {
  it("parses a minimal workflow case", () => {
    const result = Effect.runSyncExit(parseCaseConfig(MINIMAL_CASE, "case.yaml"));
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result)) {
      const config = result.value;
      expect(config.id).toBe("case-0-basic-write");
      expect(config.group).toBe("agentic");
      expect(config.tags[0]).toEqual({ tag: "correctness", weight: 2 });
      expect(config.workload).toBeUndefined();
    }
  });

  it("rejects an unknown field", () => {
    const bad = MINIMAL_CASE.replace("tags:", "bogus:\n  x: 1\ntags:");
    const result = Effect.runSyncExit(parseCaseConfig(bad, "case.yaml"));
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("rejects a wrong version", () => {
    const bad = MINIMAL_CASE.replace("version: 1", "version: 2");
    const result = Effect.runSyncExit(parseCaseConfig(bad, "case.yaml"));
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("rejects case ids that can escape the eval workspace", () => {
    const bad = MINIMAL_CASE.replace("id: case-0-basic-write", "id: ../../outside");
    const result = Effect.runSyncExit(parseCaseConfig(bad, "case.yaml"));
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("parses an optional grader-owned prepare command", () => {
    const source = MINIMAL_CASE.replace(
      "workspace: workspace",
      "prepareCommand: npm install --ignore-scripts\nworkspace: workspace",
    );
    const result = Effect.runSyncExit(parseCaseConfig(source, "case.yaml"));
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isSuccess(result)) expect(result.value.prepareCommand).toBe("npm install --ignore-scripts");
  });

  it("preserves an explicit workflow and grader-owned baseline command", () => {
    const tuning = MINIMAL_CASE
      .replace("workspace: workspace", "workspace: workspace\nworkflow: ../../../recipes/workflows/gpu-cuda-tuning.yml")
      .replace("  verifyCommand:", "  benchmarkCommand: python verify.py\n  metricPattern: 'TFLOPS: ([0-9.]+)'\n  verifyCommand:")
      .replace("  verifyCommand:", "  baselineCommand: python verify.py\n  verifyCommand:")
      .replace("tags:", "metric:\n  name: tflops\n  direction: higher\ntags:");
    const result = Effect.runSyncExit(parseCaseConfig(tuning, "case.yaml"));
    expect(Exit.isSuccess(result)).toBe(true);
    if (!Exit.isSuccess(result)) return;
    expect(result.value.workflow).toBe("../../../recipes/workflows/gpu-cuda-tuning.yml");
    expect(result.value.readout.baselineCommand).toBe("python verify.py");
  });

  it("rejects a partial performance readout", () => {
    const partial = MINIMAL_CASE.replace("tags:", "metric:\n  name: tflops\n  direction: higher\ntags:");
    const result = Effect.runSyncExit(parseCaseConfig(partial, "case.yaml"));
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("parses a run-scoped performance readout without a baseline command", () => {
    // The workflow-perf family measures the run itself; there is no clean
    // pre-run baseline to take, so the baseline stays optional.
    const runScoped = MINIMAL_CASE
      .replace("  verifyCommand:", "  benchmarkCommand: node metric.mjs\n  metricPattern: 'overhead: ([0-9.]+)'\n  verifyCommand:")
      .replace("tags:", "metric:\n  name: overhead\n  direction: lower\ntags:");
    const result = Effect.runSyncExit(parseCaseConfig(runScoped, "case.yaml"));
    expect(Exit.isSuccess(result)).toBe(true);
    if (!Exit.isSuccess(result)) return;
    expect(result.value.readout.baselineCommand).toBeUndefined();
    expect(result.value.metric).toEqual({ name: "overhead", direction: "lower" });
  });

  it("rejects an invalid metric pattern before execution", () => {
    const invalid = MINIMAL_CASE.replace("  verifyCommand:", "  metricPattern: '[unclosed'\n  verifyCommand:");
    const result = Effect.runSyncExit(parseCaseConfig(invalid, "case.yaml"));
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("parses an explicit acceptance policy without changing workflow contracts", () => {
    const source = MINIMAL_CASE.replace(
      "tags:",
      "acceptance:\n  requireEvidence: true\n  requireBaseline: false\ntags:",
    );
    const result = Effect.runSyncExit(parseCaseConfig(source, "case.yaml"));
    expect(Exit.isSuccess(result)).toBe(true);
    if (!Exit.isSuccess(result)) return;
    expect(result.value.acceptance).toEqual({ requireEvidence: true, requireBaseline: false });
  });
});

function makeResult(overrides: Partial<CaseResult> & { caseId: string }): CaseResult {
  return {
    group: "agentic",
    trial: 1,
    tags: ["correctness"],
    status: "completed",
    workspaceDir: "/tmp/ws",
    trace: {
      complete: true,
      issues: [],
      messages: { count: 0, rounds: 0 },
      tokens: { count: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      tools: { count: 0, failures: 0, names: [], totalDurationMs: 0 },
      duration: { count: 0, totalMs: 0, maxMs: 0 },
      benchmarks: [],
      stages: [],
    },
    artifact: { verified: false },
    ...overrides,
  };
}

describe("scorer", () => {
  it("normalizes on the hyperbolic curve: parity 0.5, no saturation beyond the reference", () => {
    expect(normalizeMetric(10, "higher", 10)).toBe(0.5);
    expect(normalizeMetric(20, "higher", 10)).toBeCloseTo(2 / 3, 10);
    expect(normalizeMetric(5, "higher", 10)).toBeCloseTo(1 / 3, 10);
    expect(normalizeMetric(5, "lower", 10)).toBeCloseTo(2 / 3, 10);
    expect(normalizeMetric(20, "lower", 10)).toBeCloseTo(1 / 3, 10);
    expect(normalizeMetric(10, "higher", 0)).toBe(0);
    // The old min(1, ratio) curve made 4.86x and 1.01x identical; the
    // hyperbola keeps them apart.
    expect(normalizeMetric(4.8685, "higher", 1)).not.toBe(normalizeMetric(1.01, "higher", 1));
  });

  it("reduces a group into a composite with correctness 1.0 for fully-verified", () => {
    const cases = [
      makeResult({ caseId: "a", artifact: { verified: true, value: 10 } }),
      makeResult({ caseId: "b", artifact: { verified: true, value: 20 } }),
    ];
    const group = reduceCaseGroup(cases);
    const correctness = group.scores.find((s) => s.name === "correctness");
    expect(correctness?.value).toBe(1);
    expect(group.composite).toBeGreaterThan(0);
  });

  it("builds a report with overall + by-group groups", () => {
    const cases = [
      makeResult({ caseId: "a", group: "agentic", artifact: { verified: true } }),
      makeResult({ caseId: "b", group: "performance", artifact: { verified: true, value: 1 } }),
    ];
    const report = buildReport("run-1", "2026-08-22", cases);
    expect(report.cases.length).toBe(2);
    expect(report.groups.map((g) => g.key)).toContain("overall");
    expect(report.groups.map((g) => g.key)).toContain("group:agentic");
    expect(report.overall).toBeGreaterThanOrEqual(0);
    expect(report.overall).toBeLessThanOrEqual(1);
  });

  it("normalizes lower-is-better metrics against the minimum", () => {
    const group = reduceCaseGroup([
      makeResult({ caseId: "fast", metric: { name: "latency", direction: "lower" }, artifact: { verified: true, value: 10 } }),
      makeResult({ caseId: "slow", metric: { name: "latency", direction: "lower" }, artifact: { verified: true, value: 20 } }),
    ]);
    // Hyperbolic curve: the group reference (minimum latency) sits at parity
    // 0.5 and a 2x-slower case at hyper(0.5)=1/3; the lower-is-better ordering
    // this test guards is unchanged.
    expect(group.scores.find((score) => score.name === "metric")?.value).toBeCloseTo(0.41666667, 7);
  });

  it("scores efficiency against the group's cheapest verified run", () => {
    const withTokens = (total: number): NonNullable<CaseResult["trace"]> => ({
      complete: true,
      issues: [],
      messages: { count: 0, rounds: 0 },
      tokens: { count: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
      tools: { count: 0, failures: 0, names: [], totalDurationMs: 0 },
      duration: { count: 0, totalMs: 0, maxMs: 0 },
      benchmarks: [],
      stages: [],
    });
    const group = reduceCaseGroup([
      makeResult({ caseId: "cheap", artifact: { verified: true }, trace: withTokens(100) }),
      makeResult({ caseId: "costly", artifact: { verified: true }, trace: withTokens(200) }),
    ]);
    // Cheapest sits at parity 0.5, the 2x-cost case at hyper(1/2)=1/3; the
    // old verified/(tokens/1000) formula collapsed both toward 0.
    expect(group.scores.find((score) => score.name === "efficiency")?.value).toBeCloseTo(5 / 12, 10);
    const unqualified = reduceCaseGroup([makeResult({ caseId: "a", artifact: { verified: false } })]);
    expect(unqualified.scores.find((score) => score.name === "efficiency")?.value).toBe(0);
  });
});
