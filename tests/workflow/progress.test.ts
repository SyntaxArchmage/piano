import type { WorkflowProgressSnapshot } from "../../packages/orchestrator/src/progress.js";
import { NodeContext } from "@effect/platform-node";
import type { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendWorkflowProgress,
  applyProgressRecord,
  closeWorkflowJob,
  finalizeWorkflowProgress,
  initializeWorkflowProgress,
  markWorkflowStageStarted,
  progressRecordKind,
  readRunStatus,
  reconcileCrashedRun,
  runStatusPath,
  type WorkflowError,
  type WorkflowProgressPlan,
  type WorkflowProgressRecord,
  type WorkflowProgressStreamRecord,
} from "../../packages/orchestrator/src/index.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function record(overrides: Partial<WorkflowProgressRecord> = {}): Omit<WorkflowProgressRecord, "version" | "timestamp"> {
  return {
    runId: "execution",
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
    ...overrides,
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
  return JSON.parse(await readFile(runStatusPath(runDir), "utf8")) as SnapshotTiming;
}


describe("workflow stage time", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("leaves a started invocation open until its stage is accepted", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));
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
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));
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
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));
    const measure = { stageId: "measure", stage: "measure" } as const;
    await run(markWorkflowStageStarted(runDir, "execution", {
      ...measure, invocationId: "measure@root", worker: "worker", attempt: 1,
    }));
    at("2026-01-01T00:00:20.000Z");
    await run(finalizeWorkflowProgress(runDir, "execution", "paused"));

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
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));
    const measure = { stageId: "measure", stage: "measure" } as const;
    await run(markWorkflowStageStarted(runDir, "execution", {
      ...measure, invocationId: "measure@root", worker: "worker", attempt: 1,
    }));

    // Root cause 1 pin: a paused snapshot keeps its top-level verdict but
    // never claims a running stage; the pointer folds to "accepted" and
    // stageId survives as the resume-view pointer.
    await run(finalizeWorkflowProgress(runDir, "execution", "paused"));
    const paused = await readTiming(runDir) as SnapshotTiming & {
      status?: string;
      current?: { stageId?: string; status?: string };
    };
    expect(paused.status).toBe("paused");
    expect(paused.current).toMatchObject({ stageId: "measure", status: "accepted" });

    // Failed finalization still labels the stage "failed".
    await run(finalizeWorkflowProgress(runDir, "execution", "failed", "boom"));
    const failed = await readTiming(runDir) as SnapshotTiming & {
      status?: string;
      current?: { stageId?: string; status?: string };
    };
    expect(failed.current).toMatchObject({ stageId: "measure", status: "failed" });
  });

  it("carries measured time across a resume", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));
    const tune = { stageId: "tune", stage: "tune", instanceId: "tune/iter-0", invocationId: "tune@tune/iter-0" } as const;
    await run(markWorkflowStageStarted(runDir, "execution", { ...tune, worker: "worker", attempt: 1 }));
    at("2026-01-01T00:00:07.000Z");
    await run(appendWorkflowProgress(runDir, record(tune)));

    at("2026-01-01T00:05:00.000Z");
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", true));

    expect((await readTiming(runDir)).invocationTime?.["tune@tune/iter-0"]).toMatchObject({
      stageId: "tune",
      instanceId: "tune/iter-0",
      completedMs: 7_000,
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
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));
    await run(markWorkflowStageStarted(runDir, "execution", {
      invocationId: "tune@tune/iter-0",
      stageId: "tune",
      stage: "tune",
      worker: "worker",
      attempt: 1,
      instanceId: "tune/iter-0",
    }));

    // The state document carries the execution id its caller holds — never one
    // recovered from the invocation id (`"tune@tune/iter-0".split("@")[0]` is
    // the stage name, not the execution).
    const status = JSON.parse(await readFile(runStatusPath(runDir), "utf8")) as {
      runId: string;
      current?: { invocationId?: string; stageId?: string; attempt?: number };
    };
    expect(status.runId).toBe("execution");
    expect(status.current).toMatchObject({ invocationId: "tune@tune/iter-0", stageId: "tune", attempt: 1 });
  });

  it("opens the stream with the execution's own start, carrying its plan", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", true));

    // The state document opens with the run's boundary and the plan a reader
    // needs for every count; the job ordinal ties the span to its job.
    const status = JSON.parse(await readFile(runStatusPath(runDir), "utf8")) as {
      runId: string; status: string; plannedStages: number; jobOrdinal: number;
      jobs: Array<{ jobOrdinal: number; state: string; input?: string }>;
    };
    expect(status).toMatchObject({ runId: "execution", status: "running", plannedStages: 4, jobOrdinal: 1 });
    expect(status.jobs).toMatchObject([{ jobOrdinal: 1, state: "alive", input: "do the work" }]);
  });

  it("keeps a run going when its state document is unreadable", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    // A state document that no longer parses is a damaged view of the stream,
    // not a reason to refuse the run: the record lands and the fold rewrites
    // the view from the record it just wrote.
    await writeFile(runStatusPath(runDir), "{not json\n", "utf8");

    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));

    const status = JSON.parse(await readFile(runStatusPath(runDir), "utf8")) as WorkflowProgressSnapshot;
    expect(status).toMatchObject({ runId: "execution", status: "running", plannedStages: 4 });
  });

  it("skips an execution marker it cannot read instead of failing the view", () => {
    // A torn or hand-written line can carry a valid envelope and still lack a
    // kind's own fields. The reader contract is to skip it, not to take the
    // whole state document down with it.
    const shapeless = {
      version: 1, kind: "execution-started", timestamp: "2026-01-01T00:00:06.000Z",
      runId: "execution", jobOrdinal: 2, prompt: "second", resumed: false,
    } as unknown as WorkflowProgressStreamRecord;
    const before = applyProgressRecord(undefined, {
      version: 1, kind: "execution-started", timestamp: "2026-01-01T00:00:00.000Z",
      runId: "execution", jobOrdinal: 1, prompt: "first", resumed: false,
      plan: { plannedStages: 1, stageCounts: {} },
    } as unknown as WorkflowProgressStreamRecord);
    expect(applyProgressRecord(before, shapeless)).toEqual(before);
  });

  it("reads a line with a kind it does not recognize as nothing, not as an accepted stage", () => {
    // A newer writer's record riding the same stream: a valid envelope with a
    // discriminator this reader has no meaning for. Folding it into the
    // historical shape would count the marker as accepted work. The name is
    // deliberately not a candidate for a real kind — this exemplar has twice
    // been promoted to a known one and taken the test down with it.
    const marker = {
      kind: "not-a-kind-this-build-knows",
      runId: "execution",
      timestamp: "2026-01-01T00:00:05.000Z",
      regionId: "sweep",
    } as unknown as WorkflowProgressStreamRecord;
    expect(progressRecordKind(marker)).toBeUndefined();
    // The discriminator-less line stays the historical accepted stage.
    expect(progressRecordKind(record())).toBe("stage-accepted");

    // The snapshot reducer carries only what it understands: an unknown
    // record leaves the previous snapshot untouched, byte for byte.
    const before = applyProgressRecord(undefined, {
      version: 1,
      kind: "execution-started",
      timestamp: "2026-01-01T00:00:00.000Z",
      runId: "execution",
      jobOrdinal: 1,
      resumed: false,
      plan: timingPlan,
    } as unknown as WorkflowProgressStreamRecord);
    expect(applyProgressRecord(before, marker)).toBe(before);
  });

  it("reads a region-finalized line as region evidence the snapshot echoes", () => {
    const before = applyProgressRecord(undefined, {
      version: 1,
      kind: "execution-started",
      timestamp: "2026-01-01T00:00:00.000Z",
      runId: "execution",
      jobOrdinal: 1,
      resumed: false,
      plan: timingPlan,
    } as unknown as WorkflowProgressStreamRecord);
    const finalized = {
      version: 1,
      kind: "region-finalized",
      timestamp: "2026-01-01T00:00:05.000Z",
      runId: "execution",
      jobOrdinal: 1,
      instance: "tune",
      regionId: "tune",
      regionKind: "loop",
      outcome: "bound-iterations",
      iterations: 3,
    } as unknown as WorkflowProgressStreamRecord;
    expect(progressRecordKind(finalized)).toBe("region-finalized");
    // The snapshot has no field for region evidence, so the fold only moves
    // its clock: no counts, status, or current invocations change.
    const after = applyProgressRecord(before, finalized);
    expect(after).toEqual({ ...before, updatedAt: "2026-01-01T00:00:05.000Z" });
  });

  it("answers which invocation is in flight, and since when, from the state document", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));
    await run(markWorkflowStageStarted(runDir, "execution", {
      invocationId: "tune@tune/iter-0", stageId: "tune", stage: "tune", worker: "worker", attempt: 1,
    }));
    at("2026-01-01T00:00:30.000Z");
    await run(appendWorkflowProgress(runDir, record({ invocationId: "tune@tune/iter-0" })));
    at("2026-01-01T00:01:00.000Z");
    await run(markWorkflowStageStarted(runDir, "execution", {
      invocationId: "tune@tune/iter-1", stageId: "tune", stage: "tune", worker: "worker", attempt: 1,
    }));

    const status = JSON.parse(await readFile(runStatusPath(runDir), "utf8")) as {
      current?: { invocationId?: string };
      invocationTime?: Record<string, { runningSince?: string; completedMs?: number }>;
    };
    // Which invocation is still in flight, when it started, and how long the
    // accepted one took: the two facts acceptance records cannot supply.
    expect(status.current?.invocationId).toBe("tune@tune/iter-1");
    expect(status.invocationTime?.["tune@tune/iter-1"]?.runningSince).toBe("2026-01-01T00:01:00.000Z");
    expect(status.invocationTime?.["tune@tune/iter-0"]?.completedMs).toBe(30_000);
  });

  it("records how an execution ended even when there is no snapshot to fold", async () => {
    at("2026-01-01T00:00:00.000Z");
    // No initialize: the snapshot is the throwaway half of this pair, and the
    // outcome must not depend on it existing.
    const runDir = await newRunDir();
    await run(finalizeWorkflowProgress(runDir, "execution", "failed", "boom"));

    const status = JSON.parse(await readFile(runStatusPath(runDir), "utf8")) as { status: string; error?: unknown };
    expect(status.status).toBe("failed");
    expect(status.error).toBe("boom");
  });

  it("closes a job on the stream without touching the snapshot's run state", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));
    await run(closeWorkflowJob(runDir, "execution", 1, "restarted"));

    // The human's close marks the job itself; the run keeps its own status.
    const status = JSON.parse(
      await readFile(runStatusPath(runDir), "utf8"),
    ) as { updatedAt: string; status: string; jobs: Array<{ state: string; outcome?: string }> };
    expect(status.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(status.status).toBe("running");
    expect(status.jobs[0]).toMatchObject({ state: "finished", outcome: "restarted" });
  });

});

describe("crash reconcile", () => {
  it("folds the end record a crashed run never wrote, and only that", async () => {
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));
    await run(markWorkflowStageStarted(runDir, "execution", {
      invocationId: "tune@tune/iter-0",
      stageId: "tune",
      stage: "tune",
      worker: "worker",
      attempt: 1,
      instanceId: "tune/iter-0",
    }));

    // The process died here: the state still says `running` and its job
    // `alive`. A reopen folds the missing `execution-finished`, so the job
    // reads `paused` and the continue-or-restart question is the human's.
    expect(await run(reconcileCrashedRun(runDir))).toBe(true);
    const status = await run(readRunStatus(runDir));
    expect(status?.status).toBe("paused");
    expect(status?.jobs.map((job) => job.state)).toEqual(["paused"]);

    // A run already at rest is left alone: reconcile is not a rewrite.
    expect(await run(reconcileCrashedRun(runDir))).toBe(false);
    expect((await run(readRunStatus(runDir)))?.status).toBe("paused");
  });
});
