import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowObservation } from "@piano/trajectory";
import type { LangfuseConfig } from "../src/config.js";
import { mapAcceptedScores, postLangfuseScores } from "../src/scores.js";

const metric = {
  protocol: "benchmark/v1" as const,
  name: "throughput",
  unit: "ops/s",
  direction: "higher" as const,
  samples: [10, 12],
  best: 12,
  median: 11,
  runs: 2,
  warmup: 1,
};

const accepted: Extract<WorkflowObservation, { type: "stage_accepted" }> = {
  type: "stage_accepted",
  context: {
    version: 1,
    timestamp: "2026-10-27T00:00:00.000Z",
    runId: "run-1",
    invocationId: "measure@loop/iter-1",
    stageId: "loop.measure",
    stage: "measure",
    worker: "benchmark-worker",
    attempt: 1,
    iteration: 1,
  },
  metrics: [{ pointer: "/throughput", value: metric }],
};

const config: LangfuseConfig = {
  baseUrl: "https://langfuse.internal",
  publicKey: "pk_test",
  secretKey: "sk_test",
  mask: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mapAcceptedScores", () => {
  it("turns each accepted metric into a numeric score keyed by the metric name", () => {
    expect(mapAcceptedScores(accepted, "trace-1")).toEqual([{
      traceId: "trace-1",
      name: "throughput",
      value: 12,
      dataType: "NUMERIC",
      comment: "best of 2 runs in ops/s (higher-better)",
      metadata: {
        pointer: "/throughput",
        unit: "ops/s",
        direction: "higher",
        median: 11,
        runs: 2,
        warmup: 1,
        invocationId: "measure@loop/iter-1",
        stageId: "loop.measure",
        attempt: 1,
        iteration: 1,
      },
    }]);
  });
});

describe("postLangfuseScores", () => {
  it("posts the batch to the public scores endpoint with basic auth", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const scores = mapAcceptedScores(accepted, "trace-1");
    await postLangfuseScores(config, scores);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const [url, init] = call;
    expect(url.toString()).toBe("https://langfuse.internal/api/public/scores");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("pk_test:sk_test").toString("base64")}`,
    );
    expect(JSON.parse(String(init.body))).toEqual(scores);
  });

  it("posts nothing when there are no scores", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await postLangfuseScores(config, []);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
