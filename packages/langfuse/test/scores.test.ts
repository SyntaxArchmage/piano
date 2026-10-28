import { afterEach, describe, expect, it, vi } from "vitest";
import type { LangfuseConfig } from "../src/config.js";
import {
  mapAcceptedScoresFromMetrics,
  postLangfuseScores,
  scoreIdentity,
  stageAcceptedFacts,
} from "../src/scores.js";

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

const identity = scoreIdentity({
  invocationId: "measure@loop/iter-1",
  stageId: "loop.measure",
  attempt: 1,
  iteration: 1,
});

const config: LangfuseConfig = {
  baseUrl: "https://langfuse.internal",
  publicKey: "pk_test",
  secretKey: "sk_test",
  mask: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mapAcceptedScoresFromMetrics", () => {
  it("turns each accepted metric into a numeric score keyed by the metric name", () => {
    expect(mapAcceptedScoresFromMetrics([{ pointer: "/throughput", value: metric }], "trace-1", identity)).toEqual([{
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

  it("skips a metric that does not decode instead of throwing on it", () => {
    // A `stage.accepted` op is evidence; one malformed entry must not cost
    // the valid metrics beside it, or the export would drop the whole batch.
    expect(mapAcceptedScoresFromMetrics(
      [null, 7, { pointer: "/throughput" }, { pointer: "/throughput", value: metric }, "nope"],
      "trace-1",
    )).toHaveLength(1);
  });
});

describe("stageAcceptedFacts", () => {
  it("reads the metrics and the join-back identity from one op", () => {
    expect(stageAcceptedFacts({
      version: 1,
      timestamp: "2026-10-27T00:00:00.000Z",
      handle: "accepted:a:1",
      op: "emit",
      type: "event",
      name: "stage.accepted",
      metadata: {
        metrics: [{ pointer: "/throughput", value: metric }],
        invocationId: "measure@loop/iter-1",
        stageId: "loop.measure",
        attempt: 1,
        iteration: 1,
      },
    })).toEqual({
      metrics: [{ pointer: "/throughput", value: metric }],
      identity: {
        invocationId: "measure@loop/iter-1",
        stageId: "loop.measure",
        attempt: 1,
        iteration: 1,
      },
    });
  });

  it("yields no metrics and no identity when the op carries neither", () => {
    expect(stageAcceptedFacts({
      version: 1,
      timestamp: "2026-10-27T00:00:00.000Z",
      handle: "accepted:a:1",
      op: "emit",
      type: "event",
      name: "stage.accepted",
    })).toEqual({ metrics: [], identity: {} });
  });
});

describe("postLangfuseScores", () => {
  it("posts the batch to the public scores endpoint with basic auth", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const scores = mapAcceptedScoresFromMetrics([{ pointer: "/throughput", value: metric }], "trace-1", identity);
    await postLangfuseScores(config, scores);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const [url, init] = call;
    expect(url.toString()).toBe("https://langfuse.internal/api/public/scores");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from("pk_test:sk_test").toString("base64")}`,
    });
    expect(JSON.parse(String(init.body))).toEqual(scores);
  });

  it("posts nothing when there are no scores", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await postLangfuseScores(config, []);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
