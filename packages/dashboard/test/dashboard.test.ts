import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDashboard, readDashboardState, stopDashboard } from "../src/index.js";
import { createDashboardServer, type DashboardServer } from "../server/piano-dashboard.mjs";

const execFile = promisify(execFileCallback);
const RUN_ID = "20261026T100000-dash01";

function benchmarkRecord(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    timestamp: "2026-10-26T10:01:00.000Z",
    runId: RUN_ID,
    invocationId: "tune.race.measure@tune/iter-0/tune.race/slot-0",
    stageId: "tune.race.measure",
    stage: "measure",
    worker: "cuda-benchmark-store",
    attempt: 1,
    iteration: 0,
    mapSlot: 0,
    instanceId: "tune/iter-0/tune.race/slot-0",
    actorKey: `v2/${RUN_ID}/pi/cuda-benchmark-store/tune.race/slot-0`,
    kind: "benchmark",
    pointer: "/benchmark",
    metric: {
      protocol: "benchmark/v1",
      name: "tflops",
      unit: "TFLOP/s",
      direction: "higher",
      samples: [5.1],
      best: 5.1,
      median: 5.1,
      runs: 1,
      warmup: 5,
    },
    ...overrides,
  });
}

function tokenRecord(): string {
  return JSON.stringify({
    timestamp: "2026-10-26T10:02:00.000Z",
    runId: RUN_ID,
    invocationId: "tune.race.measure@tune/iter-0/tune.race/slot-0",
    stageId: "tune.race.measure",
    stage: "measure",
    worker: "cuda-benchmark-store",
    attempt: 1,
    actorKey: `v2/${RUN_ID}/pi/cuda-benchmark-store/tune.race/slot-0`,
    kind: "token_usage",
    reported: { input: 120, output: 30, cacheRead: 40, cacheWrite: 0, total: 190 },
    delta: { input: 120, output: 30, cacheRead: 40, cacheWrite: 0, total: 190 },
    reset: false,
    outcome: "accepted",
  });
}

function durationRecord(): string {
  return JSON.stringify({
    timestamp: "2026-10-26T10:02:00.000Z",
    runId: RUN_ID,
    invocationId: "tune.race.measure@tune/iter-0/tune.race/slot-0",
    stageId: "tune.race.measure",
    stage: "measure",
    worker: "cuda-benchmark-store",
    attempt: 1,
    actorKey: `v2/${RUN_ID}/pi/cuda-benchmark-store/tune.race/slot-0`,
    kind: "duration",
    outcome: "accepted",
    durationMs: 4200,
  });
}

function invocationRecord(): string {
  return JSON.stringify({
    version: 1,
    timestamp: "2026-10-26T10:03:00.000Z",
    runId: RUN_ID,
    ref: "inv-0010",
    kind: "invocation-accepted",
    invocationId: "tune.evaluate@tune/iter-0",
    stageId: "tune.evaluate",
    stage: "evaluate",
    worker: "topsop-v2-evaluate",
    attempt: 1,
    instanceId: "tune/iter-0",
    actorKey: `v2/${RUN_ID}/dsh/topsop-v2-evaluate/root`,
  });
}

async function makeRunsRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "piano-dashboard-test-"));
  const runDir = join(root, RUN_ID);
  const repoDir = join(root, "workflow-repo");
  const workflowPath = join(repoDir, "gpu-cuda-tuning-tournament.yml");
  await mkdir(join(runDir, "eval-metrics"), { recursive: true });
  await mkdir(join(runDir, "system-log"), { recursive: true });
  await mkdir(join(runDir, "results"), { recursive: true });
  await mkdir(join(runDir, "workspace-records", "job-1%2Ftune%2Fiter-0%2Ftune.race%2Fslot-0"), { recursive: true });
  await mkdir(repoDir, { recursive: true });
  await writeFile(workflowPath, "version: 3\n");
  await execFile("git", ["init", "-q", "-b", "main", repoDir]);
  await execFile("git", ["-C", repoDir, "add", "."]);
  await execFile("git", [
    "-C", repoDir,
    "-c", "user.name=Piano Test",
    "-c", "user.email=test@example.com",
    "-c", "commit.gpgsign=false",
    "commit", "-qm", "fixture",
  ]);
  await execFile("git", ["-C", repoDir, "remote", "add", "origin", "git@github.com:acme/piano.git"]);
  await writeFile(
    join(runDir, "workspace-records", "job-1%2Ftune%2Fiter-0%2Ftune.race%2Fslot-0", "record.json"),
    `${JSON.stringify({
      version: 3,
      key: "job-1/tune/iter-0/tune.race/slot-0",
      laneBranch: "tuna/test/lane-0",
      baseCommit: "a".repeat(40),
    })}\n`,
  );
  await writeFile(join(runDir, "status.json"), `${JSON.stringify({
    runId: RUN_ID,
    status: "running",
    updatedAt: "2026-10-26T10:04:00.000Z",
    workflowPath,
    mnemonic: "test-run",
    plannedStages: 10,
    completedStages: 4,
    stageCounts: { "tune.race.measure": { planned: 3, completed: 2 } },
    current: {
      status: "running",
      invocationId: "tune.race.measure@tune/iter-1/tune.race/slot-1",
      stageId: "tune.race.measure",
      stage: "measure",
      attempt: 1,
      instanceId: "tune/iter-1/tune.race/slot-1",
      iteration: 1,
    },
    invocationTime: { "setup@root": { stageId: "setup", completedMs: 1000 } },
    jobs: [{
      jobOrdinal: 1,
      accepted: [{}, {}],
      attempts: { "setup@root": 1 },
      regions: {
        tune: {
          kind: "region-finalized",
          regionId: "tune",
          regionKind: "loop",
          instance: "tune",
          outcome: "bound-iterations",
          iterations: 1,
          commits: [{ iteration: 0, commit: "b".repeat(40) }],
        },
      },
    }],
    actors: {
      [`v2/${RUN_ID}/pi/cuda-benchmark-store/tune.race/slot-0`]: {
        harness: "pi",
        transcriptPath: "/home/albert/.piano/runs/secret.jsonl",
      },
      [`v2/${RUN_ID}/dsh/topsop-v2-evaluate/root`]: {
        harness: "dsh",
        transcriptPath: "/home/albert/.piano/runs/secret2.jsonl",
      },
    },
    error: { type: "Sequential", message: "a failed attempt" },
  })}\n`);
  await writeFile(join(runDir, "eval-metrics", "benchmark.jsonl"), [
    benchmarkRecord(),
    benchmarkRecord({
      timestamp: "2026-10-26T10:01:30.000Z",
      invocationId: "tune.race.measure@tune/iter-0/tune.race/slot-1",
      mapSlot: 1,
      instanceId: "tune/iter-0/tune.race/slot-1",
      actorKey: `v2/${RUN_ID}/pi/cuda-benchmark-store/tune.race/slot-1`,
      metric: {
        protocol: "benchmark/v1",
        name: "tflops",
        unit: "TFLOP/s",
        direction: "higher",
        samples: [4.2],
        best: 4.2,
        median: 4.2,
        runs: 1,
        warmup: 5,
      },
    }),
    "not json",
  ].join("\n") + "\n");
  await writeFile(join(runDir, "eval-metrics", "token-usage.jsonl"), `${tokenRecord()}\n`);
  await writeFile(join(runDir, "eval-metrics", "duration.jsonl"), `${durationRecord()}\n`);
  await writeFile(join(runDir, "system-log", "invocations.jsonl"), `${invocationRecord()}\n`);
  // A contract that projects performance fields instead of declaring metrics.
  await writeFile(join(runDir, "results", "inv-0010-attempt-1.json"), `${JSON.stringify({
    decision: "KEEP",
    profile: {
      kernel_latency_us: 183.87,
      llc_rw_sum_gbps: 2253.92,
      sip_1d_efficiency: 0.3352,
    },
  })}\n`);
  return root;
}

describe("dashboard server", () => {
  type RunList = {
    runs: Array<{ id: string; status: string; workflowName?: string; hasBenchmark: boolean }>;
  };
  type Detail = {
    status: {
      workflowName?: string;
      error?: string;
      jobs: Array<{ jobOrdinal: number; outcome?: string; accepted: number }>;
      harnesses: Record<string, string>;
    };
    repository?: { branch?: string; commit: string; webUrl?: string };
    records: {
      benchmark: Array<{
        mapSlot?: number;
        git?: {
          branch?: string;
          commit?: string;
          commitKind?: "iteration" | "base" | "repo";
          branchUrl?: string;
          commitUrl?: string;
        };
      }>;
      derived: Array<{
        iteration?: number;
        metric: { name: string; unit: string; direction: string; best: number };
      }>;
      tokenUsage: unknown[];
      duration: unknown[];
    };
    warnings: string[];
    sources: { derived?: string };
  };
  let server: DashboardServer | undefined;
  let root: string | undefined;

  afterEach(async () => {
    if (server !== undefined) await server.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    server = undefined;
    root = undefined;
  });

  it("lists runs and returns benchmark, derived, token and duration evidence", async () => {
    root = await makeRunsRoot();
    server = createDashboardServer({ runsRoot: root, host: "127.0.0.1", port: 0 });
    const info = await server.listen();
    const base = `http://127.0.0.1:${info.port}`;

    const health = await fetch(`${base}/healthz`).then((response) => response.json()) as { product?: string };
    expect(health.product).toBe("piano-dashboard");

    const list = await fetch(`${base}/api/runs`).then((response) => response.json()) as RunList;
    expect(list.runs).toHaveLength(1);
    expect(list.runs[0]).toMatchObject({
      id: RUN_ID,
      status: "running",
      workflowName: "gpu-cuda-tuning-tournament",
      hasBenchmark: true,
    });

    const detail = await fetch(`${base}/api/runs/${RUN_ID}`).then((response) => response.json()) as Detail;
    expect(detail.records.benchmark).toHaveLength(2);
    expect(detail.records.benchmark.map((record) => record.mapSlot)).toEqual([0, 1]);
    expect(detail.status.workflowName).toBe("gpu-cuda-tuning-tournament");
    expect(detail.status.error).toBe("Sequential");
    expect(detail.status.jobs).toEqual([{ jobOrdinal: 1, outcome: undefined, accepted: 2 }]);
    // Harnesses are exposed, transcript paths are not.
    expect(detail.status.harnesses).toEqual({
      [`v2/${RUN_ID}/pi/cuda-benchmark-store/tune.race/slot-0`]: "pi",
      [`v2/${RUN_ID}/dsh/topsop-v2-evaluate/root`]: "dsh",
    });
    expect(JSON.stringify(detail)).not.toContain("secret.jsonl");

    // The workflow checkout and the tournament lane are separate provenance:
    // the point uses the lane branch and its fork commit, while the run
    // exposes the repository page as a fallback.
    expect(detail.repository).toMatchObject({
      branch: "main",
      webUrl: "https://github.com/acme/piano",
    });
    expect(detail.repository?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(detail.records.benchmark[0]?.git).toMatchObject({
      branch: "tuna/test/lane-0",
      commit: "a".repeat(40),
      commitKind: "base",
      branchUrl: "https://github.com/acme/piano/tree/tuna/test/lane-0",
      commitUrl: `https://github.com/acme/piano/commit/${"a".repeat(40)}`,
    });
    expect(detail.records.benchmark[1]?.git).toBeUndefined();

    // The topsop-style result contributes three derived metrics.
    const derived = detail.records.derived;
    expect(derived.map((record) => record.metric.name).sort()).toEqual(["kernel_latency_us", "llc_rw_sum_gbps", "sip_1d_efficiency"]);
    expect(derived.find((record) => record.metric.name === "kernel_latency_us")).toMatchObject({
      iteration: 0,
      metric: { unit: "µs", direction: "lower", best: 183.87 },
    });
    expect(derived.find((record) => record.metric.name === "llc_rw_sum_gbps")).toMatchObject({
      metric: { unit: "GB/s", direction: "higher" },
    });

    expect(detail.records.tokenUsage).toHaveLength(1);
    expect(detail.records.duration).toHaveLength(1);
    expect(detail.warnings).toEqual(["benchmark.jsonl: skipped 1 malformed line(s)"]);
    expect(detail.sources.derived).toBe("results/*.json");
  });

  it("rejects traversal and unknown runs", async () => {
    root = await makeRunsRoot();
    server = createDashboardServer({ runsRoot: root, host: "127.0.0.1", port: 0 });
    const info = await server.listen();
    const base = `http://127.0.0.1:${info.port}`;

    const traversal = await fetch(`${base}/api/runs/${encodeURIComponent("../secret")}`);
    expect(traversal.status).toBe(404);
    const missing = await fetch(`${base}/api/runs/does-not-exist`);
    expect(missing.status).toBe(404);
    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("PIANO");
  });

  it("spawns a detached sidecar, reuses it, and stops it", async () => {
    root = await mkdtemp(join(tmpdir(), "piano-dashboard-sidecar-"));
    const stateFile = join(root, "server.json");
    try {
      const first = await ensureDashboard({ runsRoot: root, stateFile, host: "127.0.0.1", port: 0, runId: "run-1" });
      expect(first).toBeDefined();
      if (first === undefined) return;
      expect(first.reused).toBe(false);
      expect(first.url).toContain("/r/run-1");
      expect(readDashboardState(stateFile)?.pid).toBe(first.pid);

      const second = await ensureDashboard({ runsRoot: root, stateFile, host: "127.0.0.1", port: 0 });
      expect(second).toMatchObject({ reused: true, port: first.port, pid: first.pid });

      expect(stopDashboard(stateFile)).toBe(true);
      let stopped = false;
      for (let attempt = 0; attempt < 40 && !stopped; attempt += 1) {
        stopped = await fetch(`http://127.0.0.1:${first.port}/healthz`, { signal: AbortSignal.timeout(200) })
          .then(() => false, () => true);
        if (!stopped) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(stopped).toBe(true);
    } finally {
      stopDashboard(stateFile);
    }
  });
});
