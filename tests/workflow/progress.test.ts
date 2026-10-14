import { NodeContext } from "@effect/platform-node";
import type { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendWorkflowProgress,
  finalizeWorkflowProgress,
  initializeWorkflowProgress,
  markWorkflowStageStarted,
  progressRecordKind,
  workflowProgressPath,
  workflowProgressSnapshotPath,
  type WorkflowError,
  type WorkflowProgressPlan,
  type WorkflowProgressRecord,
} from "../../packages/orchestrator/src/index.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function record(overrides: Partial<WorkflowProgressRecord> = {}): Omit<WorkflowProgressRecord, "version" | "timestamp"> {
  return {
    executionId: "execution",
    invocationId: "measure",
    stageId: "measure",
    stage: "measure",
    worker: "legacy-worker",
    attempt: 1,
    workspace: { key: "shared-root", cwd: "/workspace", kind: "shared" },
    actorKey: "measure",
    harness: "pi",
    sessionId: "session",
    transcriptPath: "/tmp/transcript.jsonl",
    handoffRecordPath: "/tmp/handoff.json",
    ...overrides,
  };
}

async function appendAndRead(recordValue: Omit<WorkflowProgressRecord, "version" | "timestamp">) {
  const runDir = await mkdtemp(join(tmpdir(), "piano-progress-"));
  roots.push(runDir);
  await Effect.runPromise(appendWorkflowProgress(runDir, recordValue).pipe(Effect.provide(NodeContext.layer)));
  return JSON.parse(await readFile(workflowProgressSnapshotPath(runDir), "utf8")) as {
    latest?: { decision?: string; benchmark?: unknown; projections?: unknown };
  };
}

const timingPlan: WorkflowProgressPlan = {
  plannedStages: 4,
  stageCounts: { tune: { planned: 2, completed: 0 }, measure: { planned: 1, completed: 0 } },
};

interface SnapshotTiming {
  readonly invocationTime?: Readonly<Record<string, {
    readonly stageId?: string;
    readonly instanceId?: string;
    readonly completedMs?: number;
    readonly runningSince?: string;
  }>>;
}

/** Fixed clock, so accumulated totals are exact instead of wall-clock. */
function at(iso: string): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

async function newRunDir(): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), "piano-progress-"));
  roots.push(runDir);
  return runDir;
}

function run<A>(effect: Effect.Effect<A, WorkflowError, FileSystem.FileSystem>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));
}

async function readTiming(runDir: string): Promise<SnapshotTiming> {
  return JSON.parse(await readFile(workflowProgressSnapshotPath(runDir), "utf8")) as SnapshotTiming;
}

/** The append-only stream, as its readers see it: one JSON object per line. */
async function readStream(runDir: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(workflowProgressPath(runDir), "utf8").catch(() => "");
  return text.split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("workflow stage time", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("leaves a started invocation open until its stage is accepted", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, false));
    await run(markWorkflowStageStarted(runDir, "execution", {
      invocationId: "tune@tune/iter-0",
      stageId: "tune",
      stage: "tune",
      worker: "worker",
      attempt: 1,
      instanceId: "tune/iter-0",
    }));

    const started = (await readTiming(runDir)).invocationTime?.["tune@tune/iter-0"];
    expect(started).toMatchObject({ stageId: "tune", instanceId: "tune/iter-0" });
    expect(started?.runningSince).toBe("2026-01-01T00:00:00.000Z");
    expect(started?.completedMs).toBeUndefined();
  });

  it("accumulates every attempt of one invocation into a single total", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, false));
    const tune = { stageId: "tune", stage: "tune", instanceId: "tune/iter-0" } as const;
    await run(markWorkflowStageStarted(runDir, "execution", {
      ...tune, invocationId: "tune@tune/iter-0", worker: "worker", attempt: 1,
    }));

    // The first attempt is accepted after 30s of work.
    at("2026-01-01T00:00:30.000Z");
    await run(appendWorkflowProgress(runDir, record({ ...tune, invocationId: "tune@tune/iter-0" })));
    const accepted = (await readTiming(runDir)).invocationTime?.["tune@tune/iter-0"];
    expect(accepted?.completedMs).toBe(30_000);
    expect(accepted?.runningSince).toBeUndefined();

    // A second attempt of the same invocation adds to the same total.
    at("2026-01-01T00:01:00.000Z");
    await run(markWorkflowStageStarted(runDir, "execution", {
      ...tune, invocationId: "tune@tune/iter-0", worker: "worker", attempt: 2,
    }));
    at("2026-01-01T00:01:05.000Z");
    await run(appendWorkflowProgress(runDir, record({
      ...tune, invocationId: "tune@tune/iter-0", attempt: 2,
    })));

    // The next loop iteration stays its own entry, so a reader can add them up.
    at("2026-01-01T00:02:00.000Z");
    await run(markWorkflowStageStarted(runDir, "execution", {
      ...tune, invocationId: "tune@tune/iter-1", instanceId: "tune/iter-1", worker: "worker", attempt: 1,
    }));
    at("2026-01-01T00:02:01.000Z");
    await run(appendWorkflowProgress(runDir, record({
      ...tune, invocationId: "tune@tune/iter-1", instanceId: "tune/iter-1",
    })));

    const timing = (await readTiming(runDir)).invocationTime;
    expect(timing?.["tune@tune/iter-0"]?.completedMs).toBe(35_000);
    expect(timing?.["tune@tune/iter-1"]?.completedMs).toBe(1_000);
  });

  it("stops the clock on finalize so a human pause is not counted as work", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, false));
    const measure = { stageId: "measure", stage: "measure" } as const;
    await run(markWorkflowStageStarted(runDir, "execution", {
      ...measure, invocationId: "measure@root", worker: "worker", attempt: 1,
    }));
    at("2026-01-01T00:00:20.000Z");
    await run(finalizeWorkflowProgress(runDir, "paused"));

    const paused = (await readTiming(runDir)).invocationTime?.["measure@root"];
    expect(paused?.completedMs).toBe(20_000);
    expect(paused?.runningSince).toBeUndefined();

    // Resuming restarts the span; the pause itself is never measured.
    at("2026-01-01T00:10:00.000Z");
    await run(markWorkflowStageStarted(runDir, "execution", {
      ...measure, invocationId: "measure@root", worker: "worker", attempt: 2,
    }));
    const resumed = (await readTiming(runDir)).invocationTime?.["measure@root"];
    expect(resumed?.completedMs).toBe(20_000);
    expect(resumed?.runningSince).toBe("2026-01-01T00:10:00.000Z");
  });

  it("folds the open stage into the terminal state on finalize", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, false));
    const measure = { stageId: "measure", stage: "measure" } as const;
    await run(markWorkflowStageStarted(runDir, "execution", {
      ...measure, invocationId: "measure@root", worker: "worker", attempt: 1,
    }));

    // Root cause 1 pin: a paused snapshot keeps its top-level verdict but
    // never claims a running stage; the pointer folds to "accepted" and
    // stageId survives as the resume-view pointer.
    await run(finalizeWorkflowProgress(runDir, "paused"));
    const paused = await readTiming(runDir) as SnapshotTiming & {
      status?: string;
      current?: { stageId?: string; status?: string };
    };
    expect(paused.status).toBe("paused");
    expect(paused.current).toMatchObject({ stageId: "measure", status: "accepted" });

    // Failed finalization still labels the stage "failed".
    await run(finalizeWorkflowProgress(runDir, "failed", "boom"));
    const failed = await readTiming(runDir) as SnapshotTiming & {
      status?: string;
      current?: { stageId?: string; status?: string };
    };
    expect(failed.current).toMatchObject({ stageId: "measure", status: "failed" });
  });

  it("carries measured time across a resume", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, false));
    const tune = { stageId: "tune", stage: "tune", instanceId: "tune/iter-0", invocationId: "tune@tune/iter-0" } as const;
    await run(markWorkflowStageStarted(runDir, "execution", { ...tune, worker: "worker", attempt: 1 }));
    at("2026-01-01T00:00:07.000Z");
    await run(appendWorkflowProgress(runDir, record(tune)));

    at("2026-01-01T00:05:00.000Z");
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, true));

    expect((await readTiming(runDir)).invocationTime?.["tune@tune/iter-0"]).toMatchObject({
      stageId: "tune",
      instanceId: "tune/iter-0",
      completedMs: 7_000,
    });
  });
});

describe("workflow progress compatibility", () => {
  it("retains legacy payload hints when no projection or contract metadata exists", async () => {
    const snapshot = await appendAndRead(record({
      resultPayload: { decision: "KEEP", benchmark: { best: 12 } },
    }));

    expect(snapshot.latest).toMatchObject({ decision: "KEEP", benchmark: { best: 12 } });
    expect(snapshot.latest?.projections).toBeUndefined();
  });

  it("does not infer canonical hints from undeclared payload fields", async () => {
    const snapshot = await appendAndRead(record({
      resultPayload: { decision: "KEEP", benchmark: { best: 12 } },
      contract: {
        id: "canonical-result",
        version: 1,
        digest: "a".repeat(64),
        snapshotPath: "/tmp/contract.json",
      },
    }));

    expect(snapshot.latest?.decision).toBeUndefined();
    expect(snapshot.latest?.benchmark).toBeUndefined();
  });

  it("uses explicit projections instead of similarly named payload fields", async () => {
    const projections = [
      { id: "round.decision", pointer: "/verdict", format: "string" as const, value: "DISCARD" },
      { id: "benchmark.evidence", pointer: "/metric", format: "json" as const, value: { best: 7 } },
    ];
    const snapshot = await appendAndRead(record({
      resultPayload: { decision: "KEEP", benchmark: { best: 12 } },
      projections,
    }));

    expect(snapshot.latest).toMatchObject({
      decision: "DISCARD",
      benchmark: { best: 7 },
      projections,
    });
  });
});

describe("workflow progress stream", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("records a started invocation, with the execution id its caller holds", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, false));
    await run(markWorkflowStageStarted(runDir, "execution", {
      invocationId: "tune@tune/iter-0",
      stageId: "tune",
      stage: "tune",
      worker: "worker",
      attempt: 1,
      instanceId: "tune/iter-0",
    }));

    // Not recovered from the invocation id: `"tune@tune/iter-0".split("@")[0]`
    // is the stage name, not the execution.
    const started = (await readStream(runDir)).find((line) => progressRecordKind(line) === "stage-started");
    expect(started).toEqual({
      version: 1,
      kind: "stage-started",
      timestamp: "2026-01-01T00:00:00.000Z",
      executionId: "execution",
      invocationId: "tune@tune/iter-0",
      stageId: "tune",
      stage: "tune",
      worker: "worker",
      attempt: 1,
      instanceId: "tune/iter-0",
    });
  });

  it("opens the stream with the execution's own start, carrying its plan", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, true));

    // First on the stream, so a run's boundary is legible from the record
    // alone — and so the plan a reader needs to rebuild every count is in
    // evidence rather than held outside it.
    expect((await readStream(runDir))[0]).toEqual({
      version: 1,
      kind: "execution-started",
      timestamp: "2026-01-01T00:00:00.000Z",
      executionId: "execution",
      resumed: true,
      plan: timingPlan,
    });
  });

  it("keeps accepted records free of the discriminator, so existing files read the same", async () => {
    const runDir = await newRunDir();
    await run(appendWorkflowProgress(runDir, record()));

    const accepted = (await readStream(runDir))[0] ?? {};
    expect(accepted.kind).toBeUndefined();
    expect(progressRecordKind(accepted)).toBe("stage-accepted");
  });

  it("answers which invocation is in flight, and since when, from the stream alone", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, false));
    await run(markWorkflowStageStarted(runDir, "execution", {
      invocationId: "tune@tune/iter-0", stageId: "tune", stage: "tune", worker: "worker", attempt: 1,
    }));
    at("2026-01-01T00:00:30.000Z");
    await run(appendWorkflowProgress(runDir, record({ invocationId: "tune@tune/iter-0" })));
    at("2026-01-01T00:01:00.000Z");
    await run(markWorkflowStageStarted(runDir, "execution", {
      invocationId: "tune@tune/iter-1", stageId: "tune", stage: "tune", worker: "worker", attempt: 1,
    }));

    // Fold the stream the way a reader would. Two facts have to come out of it
    // that acceptance records cannot supply on their own: which invocation is
    // still in flight and when it started, and how long the accepted one took.
    const startedAt = new Map<string, string>();
    const lastKind = new Map<string, "started" | "accepted">();
    const durationMs = new Map<string, number>();
    for (const line of await readStream(runDir)) {
      const kind = progressRecordKind(line);
      if (kind === "execution-started") continue;
      const invocationId = String(line.invocationId);
      const timestamp = String(line.timestamp);
      if (kind === "stage-started") {
        startedAt.set(invocationId, timestamp);
        lastKind.set(invocationId, "started");
        continue;
      }
      lastKind.set(invocationId, "accepted");
      const since = startedAt.get(invocationId);
      if (since !== undefined) durationMs.set(invocationId, Date.parse(timestamp) - Date.parse(since));
    }
    const inFlight = [...lastKind]
      .filter(([, kind]) => kind === "started")
      .map(([invocationId]) => ({ invocationId, since: startedAt.get(invocationId) }));

    expect(durationMs.get("tune@tune/iter-0")).toBe(30_000);
    expect(inFlight).toEqual([{ invocationId: "tune@tune/iter-1", since: "2026-01-01T00:01:00.000Z" }]);

    // The snapshot written beside the stream says the same thing, which is what
    // makes the snapshot a view rather than the only copy.
    expect((await readTiming(runDir)).invocationTime?.["tune@tune/iter-1"]?.runningSince)
      .toBe("2026-01-01T00:01:00.000Z");
  });
});
