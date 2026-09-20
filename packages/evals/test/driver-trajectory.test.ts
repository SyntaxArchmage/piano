import { describe, expect, it } from "vitest";
import { aggregateStageTrajectories } from "../src/driver.js";
import type { StageTrajectoryMetrics } from "../src/types.js";

function stage(overrides: Partial<StageTrajectoryMetrics>): StageTrajectoryMetrics {
  return {
    stageId: "tune.measure",
    invocationId: "tune.measure@tune/iter-0",
    worker: "cuda-benchmark-store",
    messageCount: 2,
    assistantMessageCount: 1,
    rounds: 1,
    toolCallCount: 2,
    toolNames: ["read", "bash"],
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 10,
    totalTokens: 150,
    ...overrides,
  };
}

describe("eval stage trajectory aggregation", () => {
  it("sums resumed loop invocations even when they share one transcript", () => {
    const metrics = aggregateStageTrajectories([
      stage({ invocationId: "tune.measure@tune/iter-0", transcriptPath: "/tmp/measure.jsonl" }),
      stage({
        invocationId: "tune.measure@tune/iter-1",
        transcriptPath: "/tmp/measure.jsonl",
        inputTokens: 120,
        outputTokens: 25,
        cacheReadTokens: 40,
        cacheWriteTokens: 12,
        totalTokens: 185,
        toolNames: ["bash", "write"],
      }),
    ]);

    expect(metrics).toMatchObject({
      messageCount: 4,
      assistantMessageCount: 2,
      rounds: 2,
      toolCallCount: 4,
      inputTokens: 220,
      outputTokens: 45,
      cacheReadTokens: 70,
      cacheWriteTokens: 22,
      totalTokens: 335,
    });
    expect(metrics.toolNames).toEqual(["read", "bash", "write"]);
  });
});
