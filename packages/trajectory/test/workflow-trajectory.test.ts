import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  BenchmarkRecorder,
  DurationRecorder,
  TokenUsageRecorder,
  ToolCallRecorder,
  TrajectoryRecordError,
  WorkflowTrajectory,
  type TrajectoryRecordContext,
  type WorkflowObservation,
  type WorkflowObservationExport,
  type WorkflowObservationRecorder,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function run<A>(effect: Effect.Effect<A, unknown, import("@effect/platform").FileSystem.FileSystem>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)));
}

function context(iteration: number, invocationId = `measure@loop/iter-${iteration}`): TrajectoryRecordContext {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    runId: "execution-1",
    invocationId,
    stageId: "loop.measure",
    stage: "measure",
    worker: "benchmark-worker",
    attempt: 1,
    iteration,
    actorKey: "execution-1/pi/loop.measure/root",
    sessionId: "session-1",
    transcriptPath: "/tmp/session-1.jsonl",
  };
}

function metric(
  name: string,
  unit: string,
  direction: "higher" | "lower",
  samples: readonly number[],
) {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return {
    protocol: "benchmark/v1" as const,
    name,
    unit,
    direction,
    samples,
    best: direction === "higher" ? Math.max(...samples) : Math.min(...samples),
    median,
    runs: samples.length,
    warmup: 1,
  };
}

describe("WorkflowTrajectory", () => {
  it("drives one recorder per stream across loop iterations", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-trajectory-"));
    roots.push(runDir);
    const trajectory = await run(WorkflowTrajectory.open(runDir, "execution-1"));

    await run(trajectory.observe({ type: "stage_attempt_started", context: context(0), monotonicMs: 10 }));
    await run(trajectory.observe({
      type: "token_usage",
      context: context(0),
      usage: { input: 60, output: 40, cacheRead: 0, cacheWrite: 0, total: 100 },
    }));
    await run(trajectory.observe({
      type: "tool_call_started",
      context: context(0),
      toolCallId: "call-1",
      toolName: "bash",
      monotonicMs: 12,
    }));
    await run(trajectory.observe({
      type: "tool_call_finished",
      context: context(0),
      toolCallId: "call-1",
      toolName: "bash",
      isError: false,
      monotonicMs: 15,
    }));
    await run(trajectory.observe({ type: "stage_attempt_finished", context: context(0), monotonicMs: 20, outcome: "accepted" }));
    await run(trajectory.observe({
      type: "stage_accepted",
      context: context(0),
      metrics: [
        { pointer: "/throughput", value: metric("throughput", "items/s", "higher", [10, 12]) },
        { pointer: "/latency", value: metric("latency", "ms", "lower", [6, 5]) },
      ],
    }));

    await run(trajectory.observe({ type: "stage_attempt_started", context: context(1), monotonicMs: 30 }));
    await run(trajectory.observe({
      type: "token_usage",
      context: context(1),
      usage: { input: 90, output: 60, cacheRead: 0, cacheWrite: 0, total: 150 },
    }));
    await run(trajectory.observe({ type: "stage_attempt_finished", context: context(1), monotonicMs: 45, outcome: "accepted" }));
    await run(trajectory.observe({
      type: "stage_accepted",
      context: context(1),
      metrics: [
        { pointer: "/throughput", value: metric("throughput", "items/s", "higher", [13, 14]) },
        { pointer: "/latency", value: metric("latency", "ms", "lower", [4, 4.5]) },
      ],
    }));
    await run(trajectory.close("completed"));

    const benchmark = new BenchmarkRecorder(runDir);
    const duration = new DurationRecorder(runDir);
    const tokens = new TokenUsageRecorder(runDir);
    const tools = new ToolCallRecorder(runDir);
    const [benchmarkRecords, durationRecords, tokenRecords, toolRecords] = await Promise.all([
      run(benchmark.read(runDir)),
      run(duration.read(runDir)),
      run(tokens.read(runDir)),
      run(tools.read(runDir)),
    ]);

    expect(benchmarkRecords).toHaveLength(4);
    const scored = benchmark.score(benchmarkRecords);
    expect(Object.values(scored.best).sort((a, b) => a - b)).toEqual([4, 14]);
    // Collapsed per-iteration series with direction-aware deltas: throughput
    // hyper(14/12) = 7/13; latency (lower-better) hyper(5/4) = 5/9.
    const seriesKey = (name: string, unit: string) => `${name}${String.fromCharCode(0)}${unit}`;
    expect(scored.series?.[seriesKey("throughput", "items/s")]).toEqual([
      { iteration: 0, value: 12, direction: "higher", bestSoFar: 12, speedupVsSeed: 1 },
      { iteration: 1, value: 14, direction: "higher", prev: 12, delta: 2, relativeDelta: 2 / 12, improved: true, bestSoFar: 14, speedupVsSeed: 14 / 12 },
    ]);
    expect(scored.series?.[seriesKey("latency", "ms")]).toEqual([
      { iteration: 0, value: 5, direction: "lower", bestSoFar: 5, speedupVsSeed: 1 },
      { iteration: 1, value: 4, direction: "lower", prev: 5, delta: 1, relativeDelta: 1 / 5, improved: true, bestSoFar: 4, speedupVsSeed: 5 / 4 },
    ]);
    expect(scored.score?.[seriesKey("throughput", "items/s")]).toBeCloseTo(7 / 13, 10);
    expect(scored.score?.[seriesKey("latency", "ms")]).toBeCloseTo(5 / 9, 10);
    // The two loop attempts finish as accepted-attempt-1 each, so the
    // additive attempts block is a perfect first-pass summary.
    expect(duration.score(durationRecords)).toEqual({ count: 2, totalMs: 25, maxMs: 15, attempts: { total: 2, accepted: 2, firstPass: 2 } });
    expect(tokens.score(tokenRecords)).toMatchObject({ count: 2, input: 90, output: 60, total: 150 });
    expect(toolRecords[0]).toMatchObject({ toolName: "bash", status: "completed", durationMs: 3 });
    expect(tools.score(toolRecords)).toMatchObject({ count: 1, failures: 0, names: ["bash"], totalDurationMs: 3 });
  });

  it("reads legacy benchmark rows and drops the retired contract reference", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-trajectory-legacy-"));
    roots.push(runDir);
    await mkdir(join(runDir, "eval-metrics"), { recursive: true });
    await writeFile(join(runDir, "eval-metrics", "benchmark.jsonl"), `${JSON.stringify({
      ...context(0),
      kind: "benchmark",
      metric: metric("throughput", "items/s", "higher", [12]),
      pointer: "/benchmark",
      contract: { id: "legacy", version: 1, digest: "0".repeat(64), snapshotPath: "/legacy/contracts/metric.json" },
    })}\n`);

    const records = await run(new BenchmarkRecorder(runDir).read(runDir));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: "benchmark",
      pointer: "/benchmark",
      metric: { name: "throughput", best: 12 },
    });
    expect(records[0]).not.toHaveProperty("contract");
  });

  it("hydrates cumulative token state on resume and does not reset when usage is absent", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-trajectory-resume-"));
    roots.push(runDir);
    const first = await run(WorkflowTrajectory.open(runDir, "execution-1"));
    await run(first.observe({ type: "stage_attempt_started", context: context(0), monotonicMs: 0 }));
    await run(first.observe({ type: "token_usage", context: context(0), usage: { input: 6, output: 4, cacheRead: 0, cacheWrite: 0, total: 10 } }));
    await run(first.observe({ type: "stage_attempt_finished", context: context(0), monotonicMs: 1, outcome: "accepted" }));
    await run(first.close("completed"));

    const resumed = await run(WorkflowTrajectory.open(runDir, "execution-1"));
    await run(resumed.observe({ type: "stage_attempt_started", context: context(1), monotonicMs: 2 }));
    await run(resumed.observe({ type: "stage_attempt_finished", context: context(1), monotonicMs: 3, outcome: "failed" }));
    await run(resumed.observe({ type: "stage_attempt_started", context: context(2), monotonicMs: 4 }));
    await run(resumed.observe({ type: "token_usage", context: context(2), usage: { input: 9, output: 6, cacheRead: 0, cacheWrite: 0, total: 15 } }));
    await run(resumed.observe({ type: "stage_attempt_finished", context: context(2), monotonicMs: 5, outcome: "accepted" }));
    await run(resumed.close("completed"));

    const recorder = new TokenUsageRecorder(runDir);
    const records = await run(recorder.read(runDir));
    expect(records.map((record) => record.delta.total)).toEqual([10, 0, 5]);
    expect(recorder.score(records).total).toBe(15);
  });

  it("takes the attempt's last usage snapshot as its total", async () => {
    // One attempt reports one transcript-derived snapshot; a second reading of
    // the same file supersedes the first rather than being merged into it.
    const runDir = await mkdtemp(join(tmpdir(), "piano-trajectory-usage-"));
    roots.push(runDir);
    const trajectory = await run(WorkflowTrajectory.open(runDir, "execution-1"));
    await run(trajectory.observe({ type: "stage_attempt_started", context: context(0), monotonicMs: 0 }));
    await run(trajectory.observe({ type: "token_usage", context: context(0), usage: { input: 120, output: 30, cacheRead: 0, cacheWrite: 0, total: 150 } }));
    await run(trajectory.observe({ type: "token_usage", context: context(0), usage: { input: 121, output: 31, cacheRead: 0, cacheWrite: 0, total: 152 } }));
    await run(trajectory.observe({ type: "stage_attempt_finished", context: context(0), monotonicMs: 1, outcome: "accepted" }));
    await run(trajectory.close("completed"));

    const recorder = new TokenUsageRecorder(runDir);
    const records = await run(recorder.read(runDir));
    expect(records).toHaveLength(1);
    expect(records[0]?.reported).toEqual({ input: 121, output: 31, cacheRead: 0, cacheWrite: 0, total: 152 });
  });

  it("isolates a recorder failure and marks its stream incomplete", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-trajectory-error-"));
    roots.push(runDir);
    const broken: WorkflowObservationRecorder = {
      descriptor: { id: "broken", schema: "test/broken", path: "broken.jsonl" },
      observe: () => Effect.fail(new TrajectoryRecordError("broken.jsonl", "disk unavailable")),
    };
    const trajectory = await run(WorkflowTrajectory.open(runDir, "execution-1", [broken]));
    await run(trajectory.observe({ type: "stage_attempt_started", context: context(0), monotonicMs: 1 }));
    await run(trajectory.close("completed"));

    expect(trajectory.snapshot()).toMatchObject({
      status: "completed",
      streams: [{ id: "broken", status: "error", errors: ["disk unavailable"] }],
    });

  });

  it("drops an export sink failure without marking local streams incomplete", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-trajectory-export-"));
    roots.push(runDir);
    const exported: WorkflowObservation[] = [];
    const failing: WorkflowObservationExport = {
      id: "failing",
      export: () => Effect.die("langfuse unreachable"),
    };
    const recording: WorkflowObservationExport = {
      id: "recording",
      export: (observation) => Effect.sync(() => {
        exported.push(observation);
      }),
    };
    const duration = new DurationRecorder(runDir);
    const trajectory = await run(
      WorkflowTrajectory.open(runDir, "execution-1", [duration], [failing, recording]),
    );
    await run(trajectory.observe({ type: "stage_attempt_started", context: context(0), monotonicMs: 0 }));
    await run(trajectory.observe({ type: "stage_attempt_finished", context: context(0), monotonicMs: 5, outcome: "accepted" }));
    await run(trajectory.close("completed"));

    expect(exported).toHaveLength(2);
    expect(trajectory.snapshot().streams.every((stream) => stream.status === "completed")).toBe(true);
    expect(await run(duration.read(runDir))).toHaveLength(1);
  });
});
