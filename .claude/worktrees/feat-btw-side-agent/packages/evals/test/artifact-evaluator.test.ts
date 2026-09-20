import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { evaluateArtifact } from "../src/artifact-evaluator.js";
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
