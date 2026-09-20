import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { evaluateArtifact, parseTestRunSummary } from "../src/artifact-evaluator.js";
import type { EvalCase } from "../src/types.js";

function performanceCase(overrides: Partial<EvalCase["readout"]> = {}): EvalCase {
  return {
    id: "artifact-evaluator",
    group: "performance",
    prompt: "benchmark",
    command: "true",
    workspace: ".",
    readout: {
      kind: "programmatic",
      compileCommand: "true",
      verifyCommand: "true",
      benchmarkCommand: "printf 'TFLOPS: 12\\n'",
      metricPattern: "TFLOPS: ([0-9.]+)",
      ...overrides,
    },
    tags: [],
    metric: { name: "tflops", direction: "higher" },
  };
}

describe("evaluateArtifact", () => {
  it("parses a per-case Vitest pass rate without counting skipped tests", () => {
    expect(parseTestRunSummary(" Tests  3 failed | 1264 passed | 21 skipped (1288)\n")).toEqual({
      passed: 1264,
      failed: 3,
      skipped: 21,
      total: 1288,
      passRate: 1264 / 1267,
    });
    expect(parseTestRunSummary("\u001b[32m Tests  29 passed (29)\u001b[39m\n")).toEqual({
      passed: 29,
      failed: 0,
      skipped: 0,
      total: 29,
      passRate: 1,
    });
    expect(parseTestRunSummary("VERIFY: PASS\n")).toBeUndefined();
  });

  it("does not expose a metric from a failed benchmark", async () => {
    const result = await Effect.runPromise(evaluateArtifact(performanceCase({ benchmarkCommand: "printf 'TFLOPS: 12\\n'; exit 1" }), process.cwd()));

    expect(result).toMatchObject({ verified: true, rawOutput: "TFLOPS: 12" });
    expect(result.value).toBeUndefined();
  });

  it("extracts a metric from a successful benchmark", async () => {
    const result = await Effect.runPromise(evaluateArtifact(performanceCase(), process.cwd()));

    expect(result).toMatchObject({ verified: true, value: 12, rawOutput: "TFLOPS: 12" });
  });
});
