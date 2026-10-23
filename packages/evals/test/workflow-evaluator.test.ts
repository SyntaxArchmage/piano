import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowTrajectory, type TrajectoryRecordContext } from "@piano/trajectory";
import { WorkflowEvaluator } from "../src/workflow-evaluator.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function run<A, E>(effect: Effect.Effect<A, E, import("@effect/platform").FileSystem.FileSystem>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)));
}

const context: TrajectoryRecordContext = {
  version: 1,
  timestamp: "2026-09-02T00:00:00.000Z",
  runId: "eval-run",
  invocationId: "measure@loop/iter-0",
  stageId: "loop.measure",
  stage: "measure",
  worker: "measure-worker",
  attempt: 1,
  iteration: 0,
};

describe("WorkflowEvaluator", () => {
  it("uses recorder scoring for a native workflow trajectory", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-evaluator-"));
    await mkdir(join(runDir, "system-log"), { recursive: true });
    roots.push(runDir);
    await writeFile(join(runDir, "status.json"), JSON.stringify({ runId: "eval-run", status: "completed", updatedAt: "2026-09-02T00:00:00.000Z" }));
    const snapshot = '{"version":1,"id":"metric"}\n';
    const digest = createHash("sha256").update(snapshot).digest("hex");
    await mkdir(join(runDir, "contracts"), { recursive: true });
    await writeFile(join(runDir, "contracts", `${digest}.json`), snapshot);
    const trajectory = await run(WorkflowTrajectory.open(runDir, "eval-run"));
    await run(trajectory.observe({ type: "stage_attempt_started", context, monotonicMs: 10 }));
    await run(trajectory.observe({ type: "token_usage", context, usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, total: 10 } }));
    await run(trajectory.observe({
      type: "stage_accepted",
      context,
      contract: { id: "metric", version: 1, digest, snapshotPath: join(runDir, "contracts", `${digest}.json`) },
      metrics: [{
        pointer: "/benchmark",
        value: {
          protocol: "benchmark/v1",
          name: "throughput",
          unit: "items/s",
          direction: "higher",
          samples: [10, 12],
          best: 12,
          median: 11,
          runs: 2,
          warmup: 1,
        },
      }],
    }));
    await run(trajectory.observe({ type: "stage_attempt_finished", context, monotonicMs: 20, outcome: "accepted" }));
    await run(trajectory.close("completed"));

    const result = await run(new WorkflowEvaluator().evaluate({ runDir }));
    expect(result).toMatchObject({
      source: "native",
      complete: true,
      benchmarks: [{ name: "throughput", value: 12, accepted: true }],
      duration: { count: 1, totalMs: 10, maxMs: 10 },
      tokens: { count: 1, input: 7, output: 3, total: 10 },
    });
    expect(Object.values(result.benchmarkScore?.best ?? {})).toEqual([12]);
    // One iteration gives every point the same reference; a series would be
    // a fake progress signal, so it stays absent.
    expect(result.benchmarkScore?.series).toBeUndefined();
    expect(result.benchmarkScore?.score).toBeUndefined();
  });

  it("surfaces per-iteration series and hyperbolic score for a multi-iteration native trajectory", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-evaluator-series-"));
    await mkdir(join(runDir, "system-log"), { recursive: true });
    roots.push(runDir);
    await writeFile(join(runDir, "status.json"), JSON.stringify({ runId: "eval-run", status: "completed", updatedAt: "2026-09-02T00:00:00.000Z" }));
    const snapshot = '{"version":1,"id":"metric"}\n';
    const digest = createHash("sha256").update(snapshot).digest("hex");
    await mkdir(join(runDir, "contracts"), { recursive: true });
    await writeFile(join(runDir, "contracts", `${digest}.json`), snapshot);
    const trajectory = await run(WorkflowTrajectory.open(runDir, "eval-run"));
    for (const [iteration, best] of [[0, 12], [1, 14]] as const) {
      await run(trajectory.observe({
        type: "stage_accepted",
        context: { ...context, iteration, invocationId: `measure@loop/iter-${iteration}` },
        contract: { id: "metric", version: 1, digest, snapshotPath: join(runDir, "contracts", `${digest}.json`) },
        metrics: [{
          pointer: "/benchmark",
          value: {
            protocol: "benchmark/v1" as const,
            name: "throughput",
            unit: "items/s",
            direction: "higher" as const,
            samples: [best],
            best,
            median: best,
            runs: 1,
            warmup: 0,
          },
        }],
      }));
    }
    await run(trajectory.close("completed"));

    const result = await run(new WorkflowEvaluator().evaluate({ runDir }));
    expect(result.complete).toBe(true);
    const key = `throughput${String.fromCharCode(0)}items/s`;
    expect(result.benchmarkScore?.series?.[key]?.map((point) => point.value)).toEqual([12, 14]);
    expect(result.benchmarkScore?.series?.[key]?.[1]).toMatchObject({ prev: 12, delta: 2, improved: true, bestSoFar: 14 });
    expect(result.benchmarkScore?.score?.[key]).toBeCloseTo(7 / 13, 10);
  });

  it("scores the selection stream of a tournament run", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-evaluator-selection-"));
    await mkdir(join(runDir, "system-log"), { recursive: true });
    roots.push(runDir);
    await writeFile(join(runDir, "status.json"), JSON.stringify({ runId: "eval-run", status: "completed", updatedAt: "2026-09-02T00:00:00.000Z" }));
    const trajectory = await run(WorkflowTrajectory.open(runDir, "eval-run"));
    await run(trajectory.observe({
      type: "selection",
      runId: "eval-run",
      timestamp: "2026-09-02T00:00:00.000Z",
      referee: { name: "throughput", unit: "items/s", direction: "higher" },
      outcome: "carried",
      winnerKey: "tune/iter-0/tune.race/slot-0",
      carrying: { kind: "worker-consolidated" },
    }));
    await run(trajectory.observe({
      type: "selection",
      runId: "eval-run",
      timestamp: "2026-09-02T00:01:00.000Z",
      outcome: "no-winner",
    }));
    await run(trajectory.close("completed"));

    const result = await run(new WorkflowEvaluator().evaluate({ runDir }));
    expect(result.complete).toBe(true);
    expect(result.selection).toEqual({ count: 2, merged: 0, carried: 1, noWinner: 1, metricless: 0 });
  });

  it("isolates historical payload knowledge in the legacy adapter", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-legacy-"));
    roots.push(runDir);
    await writeFile(join(runDir, "trajectory.jsonl"), `${JSON.stringify({
      version: 1,
      runId: "legacy-run",
      timestamp: "2026-09-02T00:00:00.000Z",
      events: [
        { type: "usage", usage: { input: 8, output: 2, totalTokens: 10 } },
        { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: {} },
        { type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: "bad", isError: true },
      ],
    })}\n`);
    await writeFile(join(runDir, "progress.jsonl"), `${JSON.stringify({
      iteration: 2,
      invocationId: "measure@loop/iter-2",
      resultPayload: {
        decision: "KEEP",
        benchmark: { metric: "throughput", unit: "items/s", direction: "higher", best: 13, samples: [12, 13] },
      },
    })}\n`);
    await writeFile(join(runDir, "log.jsonl"), [
      { timestamp: "2026-09-02T00:00:00.000Z", event: "stage.started", attributes: { id: "measure@loop/iter-2" } },
      { timestamp: "2026-09-02T00:00:00.025Z", event: "stage.completed", attributes: { id: "measure@loop/iter-2" } },
    ].map((record) => JSON.stringify(record)).join("\n"));

    const result = await run(new WorkflowEvaluator().evaluate({ runDir }));
    expect(result).toMatchObject({
      source: "legacy",
      complete: false,
      benchmarks: [{ name: "throughput", value: 13, iteration: 2, accepted: true }],
      duration: { count: 1, totalMs: 25, maxMs: 25 },
      tokens: { input: 8, output: 2, total: 10 },
      tools: { count: 1, failures: 1, names: ["bash"] },
    });
  });

  it("keeps a standalone root benchmark-evidence result in legacy progress", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-legacy-root-benchmark-"));
    roots.push(runDir);
    await writeFile(join(runDir, "progress.jsonl"), [
      JSON.stringify({
        iteration: 3,
        invocationId: "measure@loop/iter-3",
        resultPayload: {
          metric: "throughput",
          direction: "higher",
          samples: [14, 15],
          best: 15,
          median: 14.5,
          runs: 2,
          warmup: 1,
        },
      }),
      JSON.stringify({
        invocationId: "unrelated@root",
        resultPayload: { best: 999, summary: "not benchmark evidence" },
      }),
      JSON.stringify({
        invocationId: "empty-samples@root",
        resultPayload: {
          metric: "throughput",
          direction: "higher",
          samples: [],
          best: 999,
          median: 999,
          runs: 1,
          warmup: 0,
        },
      }),
    ].join("\n") + "\n");

    const result = await run(new WorkflowEvaluator().evaluate({ runDir }));
    expect(result.benchmarks).toEqual([
      {
        name: "throughput",
        direction: "higher",
        value: 15,
        samples: [14, 15],
        iteration: 3,
        invocationId: "measure@loop/iter-3",
        accepted: true,
      },
      {
        name: "throughput",
        direction: "higher",
        value: 999,
        samples: [],
        invocationId: "empty-samples@root",
        accepted: true,
      },
    ]);
  });

  it("preserves permissive nested benchmark scoring for historical runs", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-legacy-minimal-benchmark-"));
    roots.push(runDir);
    await writeFile(join(runDir, "progress.jsonl"), `${JSON.stringify({
      iteration: 4,
      invocationId: "measure@loop/iter-4",
      resultPayload: {
        decision: "KEEP",
        benchmark: { best: 21 },
      },
    })}\n`);

    const result = await run(new WorkflowEvaluator().evaluate({ runDir }));
    expect(result.benchmarks).toEqual([{
      name: "benchmark",
      direction: "higher",
      value: 21,
      iteration: 4,
      invocationId: "measure@loop/iter-4",
      accepted: true,
    }]);
  });

  it("reads recorder streams as native evidence and reports an unreadable stream", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-native-no-index-"));
    await mkdir(join(runDir, "system-log"), { recursive: true });
    roots.push(runDir);
    await mkdir(join(runDir, "eval-metrics"), { recursive: true });
    await writeFile(join(runDir, "eval-metrics", "benchmark.jsonl"), "partial native evidence\n");
    await writeFile(join(runDir, "progress.jsonl"), JSON.stringify({
      resultPayload: {
        benchmark: { metric: "legacy", direction: "higher", best: 1, samples: [1] },
      },
    }) + "\n");

    const result = await run(new WorkflowEvaluator().evaluate({ runDir }));
    expect(result.source).toBe("native");
    expect(result.complete).toBe(false);
    expect(result.benchmarks).toEqual([]);
    expect(result.issues.join("\n")).toContain("run state document is missing");
    expect(result.issues.join("\n")).toContain("is not JSON");
  });

  it("treats an empty eval-metrics directory as native evidence with no records", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-empty-trajectories-"));
    await mkdir(join(runDir, "system-log"), { recursive: true });
    roots.push(runDir);
    await mkdir(join(runDir, "eval-metrics"), { recursive: true });

    const result = await run(new WorkflowEvaluator().evaluate({ runDir }));
    expect(result.source).toBe("native");
    expect(result.complete).toBe(false);
    expect(result.benchmarks).toEqual([]);
  });

  it("keeps valid legacy evidence while reporting malformed progress and trajectory entries", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-legacy-malformed-"));
    roots.push(runDir);
    await writeFile(join(runDir, "trajectory.jsonl"), `${JSON.stringify({
      version: 1,
      runId: "legacy-run",
      timestamp: "2026-09-02T00:00:00.000Z",
      events: [
        { type: "usage", usage: { input: 8, output: 2, totalTokens: 10 } },
        null,
        { type: 42 },
        { type: "message_end" },
      ],
    })}\n`);
    await writeFile(join(runDir, "progress.jsonl"), [
      JSON.stringify({
        iteration: 1,
        resultPayload: {
          benchmark: { metric: "throughput", direction: "higher", best: 17, samples: [16, 17] },
        },
      }),
      "{not-json}",
    ].join("\n") + "\n");

    const result = await run(new WorkflowEvaluator().evaluate({ runDir }));
    expect(result.benchmarks).toEqual([{
      name: "throughput",
      direction: "higher",
      value: 17,
      samples: [16, 17],
      iteration: 1,
      accepted: true,
    }]);
    expect(result.tokens).toMatchObject({ input: 8, output: 2, total: 10 });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining("progress.jsonl line 2 is not JSON"),
      "trajectory.jsonl event 2 is not an object",
      "trajectory.jsonl event 3 must have a string type",
      "trajectory.jsonl event 4 message_end has no object message",
    ]));
  });

  it("reports malformed legacy benchmark and duration evidence without dropping valid points", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-legacy-evidence-issues-"));
    roots.push(runDir);
    await writeFile(join(runDir, "progress.jsonl"), [
      JSON.stringify({ resultPayload: { benchmark: { best: 21 } } }),
      JSON.stringify({ resultPayload: { metric: "throughput", direction: "higher", samples: ["bad"], best: 22 } }),
    ].join("\n") + "\n");
    await writeFile(join(runDir, "log.jsonl"), [
      "{not-json}",
      JSON.stringify({ timestamp: "2026-09-02T00:00:00.000Z", event: "stage.started", attributes: { id: "stage-1" } }),
      JSON.stringify({ timestamp: "2026-09-02T00:00:00.010Z", event: "stage.completed", attributes: { id: "stage-1" } }),
    ].join("\n") + "\n");

    const result = await run(new WorkflowEvaluator().evaluate({ runDir }));
    expect(result.benchmarks).toEqual([expect.objectContaining({ value: 21 })]);
    expect(result.duration).toMatchObject({ count: 1, totalMs: 10 });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.stringContaining("progress resultPayload is malformed benchmark evidence"),
      expect.stringContaining("log.jsonl line 1 is not JSON"),
    ]));
  });

  it("reports a malformed declared stream as incomplete evidence", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-malformed-"));
    await mkdir(join(runDir, "system-log"), { recursive: true });
    roots.push(runDir);
    const trajectory = await run(WorkflowTrajectory.open(runDir, "eval-run"));
    await run(trajectory.close("completed"));
    await mkdir(join(runDir, "eval-metrics"), { recursive: true });
    await writeFile(join(runDir, "eval-metrics", "benchmark.jsonl"), "{not-json}\n");

    const result = await run(new WorkflowEvaluator().evaluate({ runDir }));
    expect(result.source).toBe("native");
    expect(result.complete).toBe(false);
    expect(result.issues.join("\n")).toContain("line 1 is not JSON");
  });

  it("fails closed when native records lose their contract snapshot lineage", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-lineage-"));
    await mkdir(join(runDir, "system-log"), { recursive: true });
    roots.push(runDir);
    const trajectory = await run(WorkflowTrajectory.open(runDir, "eval-run"));
    await run(trajectory.observe({
      type: "stage_accepted",
      context,
      contract: { id: "metric", version: 1, digest: "2".repeat(64), snapshotPath: "/stale/location.json" },
      metrics: [{
        pointer: "/benchmark",
        value: {
          protocol: "benchmark/v1",
          name: "throughput",
          unit: "items/s",
          direction: "higher",
          samples: [12],
          best: 12,
          median: 12,
          runs: 1,
          warmup: 0,
        },
      }],
    }));
    await run(trajectory.close("completed"));

    const result = await run(new WorkflowEvaluator().evaluate({ runDir }));
    expect(result.complete).toBe(false);
    expect(result.issues).toContain(`benchmark: contract snapshot ${"2".repeat(64)} is missing or unreadable`);
  });
});
