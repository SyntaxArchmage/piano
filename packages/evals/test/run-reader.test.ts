import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowTrajectory, type TrajectoryRecordContext } from "@piano/trajectory";
import { readRunStatusSummary, readRunTrace } from "../src/run-reader.js";

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

async function baseRunDir(prefix: string): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(runDir, "system-log"), { recursive: true });
  roots.push(runDir);
  await writeFile(join(runDir, "status.json"), JSON.stringify({ version: 1, runId: "eval-run", status: "completed", updatedAt: "2026-09-02T00:00:00.000Z" }));
  return runDir;
}

async function pinContract(runDir: string): Promise<string> {
  const snapshot = '{"version":1,"id":"metric"}\n';
  const digest = createHash("sha256").update(snapshot).digest("hex");
  await mkdir(join(runDir, "contracts"), { recursive: true });
  await writeFile(join(runDir, "contracts", `${digest}.json`), snapshot);
  return digest;
}

describe("run-reader", () => {
  it("assembles the canonical trace from the recorder streams", async () => {
    const runDir = await baseRunDir("piano-run-reader-");
    const digest = await pinContract(runDir);
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

    const result = await run(readRunTrace(runDir));
    expect(result).toMatchObject({
      complete: true,
      issues: [],
      messages: { count: 0, rounds: 0 },
      benchmarks: [{ name: "throughput", value: 12 }],
      duration: { count: 1, totalMs: 10, maxMs: 10 },
      tokens: { count: 1, input: 7, output: 3, total: 10 },
    });
    expect(Object.values(result.benchmarkScore?.best ?? {})).toEqual([12]);
    // One iteration gives every point the same reference; a series would be
    // a fake progress signal, so it stays absent.
    expect(result.benchmarkScore?.series).toBeUndefined();
    expect(result.benchmarkScore?.score).toBeUndefined();
    // Per-stage observation assembled from the recorder rows.
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]).toMatchObject({
      invocationId: "measure@loop/iter-0",
      stageId: "loop.measure",
      worker: "measure-worker",
      iteration: 0,
      attempt: 1,
      outcome: "accepted",
      tokens: { input: 7, output: 3, total: 10 },
      durationMs: 10,
    });
  });

  it("surfaces per-iteration series and hyperbolic score for a multi-iteration trajectory", async () => {
    const runDir = await baseRunDir("piano-run-reader-series-");
    const digest = await pinContract(runDir);
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

    const result = await run(readRunTrace(runDir));
    expect(result.complete).toBe(true);
    const key = `throughput${String.fromCharCode(0)}items/s`;
    expect(result.benchmarkScore?.series?.[key]?.map((point) => point.value)).toEqual([12, 14]);
    expect(result.benchmarkScore?.series?.[key]?.[1]).toMatchObject({ prev: 12, delta: 2, improved: true, bestSoFar: 14 });
    expect(result.stages.map((stage) => stage.iteration)).toEqual([0, 1]);
  });

  it("scores the selection stream of a tournament run", async () => {
    const runDir = await baseRunDir("piano-run-reader-selection-");
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

    const result = await run(readRunTrace(runDir));
    expect(result.complete).toBe(true);
    expect(result.selection).toEqual({ count: 2, merged: 0, carried: 1, noWinner: 1, metricless: 0 });
  });

  it("completes stage metadata from the invocation stream", async () => {
    // The invocation stream is the metadata home: a stage row whose recorder
    // records carry no model/transcript still gets requested/effective values,
    // workspace, and its transcript link from the accepted row.
    const runDir = await baseRunDir("piano-run-reader-invocations-");
    await mkdir(join(runDir, "eval-metrics"), { recursive: true });
    await writeFile(join(runDir, "system-log", "invocations.jsonl"), `${JSON.stringify({
      version: 1,
      kind: "invocation-accepted",
      timestamp: "2026-01-01T00:00:00.000Z",
      runId: "eval-run",
      jobOrdinal: 1,
      ref: "inv-0001",
      invocationId: "race.implement@race/slot-0",
      stageId: "race.implement",
      stage: "race",
      worker: "tune",
      sessionId: "session-1",
      transcriptPath: "/tmp/transcript.jsonl",
      text: "done",
      workspace: { key: "shared", cwd: "/tmp/workspace", kind: "shared" },
      requestedModel: "deepseek-v4",
      model: "deepseek-v4-flash",
      thinkingLevel: "high",
    })}\n`, "utf8");

    const result = await run(readRunTrace(runDir));
    expect(result.stages).toHaveLength(1);
    expect(result.stages[0]).toMatchObject({
      invocationId: "race.implement@race/slot-0",
      stageId: "race.implement",
      worker: "tune",
      requestedModel: "deepseek-v4",
      model: "deepseek-v4-flash",
      thinkingLevel: "high",
      workspaceCwd: "/tmp/workspace",
      transcriptPath: "/tmp/transcript.jsonl",
    });
  });

  it("reads recorder streams as evidence and reports an unreadable stream", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-run-reader-unreadable-"));
    await mkdir(join(runDir, "system-log"), { recursive: true });
    roots.push(runDir);
    await mkdir(join(runDir, "eval-metrics"), { recursive: true });
    await writeFile(join(runDir, "eval-metrics", "benchmark.jsonl"), "partial native evidence\n");

    const result = await run(readRunTrace(runDir));
    expect(result.complete).toBe(false);
    expect(result.benchmarks).toEqual([]);
    expect(result.issues.join("\n")).toContain("run state document is missing");
    expect(result.issues.join("\n")).toContain("is not JSON");
  });

  it("treats an empty eval-metrics directory as evidence with no records", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-run-reader-empty-"));
    await mkdir(join(runDir, "system-log"), { recursive: true });
    roots.push(runDir);
    await mkdir(join(runDir, "eval-metrics"), { recursive: true });

    const result = await run(readRunTrace(runDir));
    expect(result.complete).toBe(false);
    expect(result.benchmarks).toEqual([]);
    expect(result.stages).toEqual([]);
  });

  it("reports a malformed declared stream as incomplete evidence", async () => {
    const runDir = await baseRunDir("piano-run-reader-malformed-");
    const trajectory = await run(WorkflowTrajectory.open(runDir, "eval-run"));
    await run(trajectory.close("completed"));
    await mkdir(join(runDir, "eval-metrics"), { recursive: true });
    await writeFile(join(runDir, "eval-metrics", "benchmark.jsonl"), "{not-json}\n");

    const result = await run(readRunTrace(runDir));
    expect(result.complete).toBe(false);
    expect(result.issues.join("\n")).toContain("line 1 is not JSON");
  });

  it("fails closed when records lose their contract snapshot lineage", async () => {
    const runDir = await baseRunDir("piano-run-reader-lineage-");
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

    const result = await run(readRunTrace(runDir));
    expect(result.complete).toBe(false);
    expect(result.issues).toContain(`benchmark: contract snapshot ${"2".repeat(64)} is missing or unreadable`);
  });

  it("attributes records of another execution as issues, not metrics", async () => {
    const runDir = await baseRunDir("piano-run-reader-attribution-");
    const digest = await pinContract(runDir);
    const trajectory = await run(WorkflowTrajectory.open(runDir, "other-run"));
    await run(trajectory.observe({
      type: "stage_accepted",
      context: { ...context, runId: "other-run" },
      contract: { id: "metric", version: 1, digest, snapshotPath: join(runDir, "contracts", `${digest}.json`) },
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

    const result = await run(readRunTrace(runDir));
    expect(result.complete).toBe(false);
    expect(result.issues.join("\n")).toContain("belong to another execution");
  });

  it("summarizes stage progress from the run state document", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-run-reader-status-"));
    roots.push(runDir);
    await writeFile(join(runDir, "status.json"), JSON.stringify({
      version: 1,
      runId: "r",
      status: "running",
      completedStages: 5,
      plannedStages: 82,
      current: { stageId: "tune.idea" },
    }));
    expect(await run(readRunStatusSummary(runDir))).toEqual({
      completedStages: 5,
      plannedStages: 82,
      currentStageId: "tune.idea",
    });
  });

  it("fails when the recorder metrics directory is missing", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-run-reader-nometrics-"));
    roots.push(runDir);
    await expect(run(readRunTrace(runDir))).rejects.toThrow(/recorder metrics directory is missing/);
  });
});
