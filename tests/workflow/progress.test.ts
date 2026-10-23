import { NodeContext } from "@effect/platform-node";
import type { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendWorkflowProgress,
  applyRunStatusRecord,
  finalizeWorkflowProgress,
  initializeWorkflowProgress,
  markWorkflowStageStarted,
  readRunStatus,
  reconcileCrashedRun,
  runStatusPath,
  type RunStatus,
  type WorkflowError,
  type WorkflowProgressPlan,
  type WorkflowProgressRecord,
  type WorkflowTransition,
} from "../../packages/orchestrator/src/index.js";
import { emptyRunStatus } from "../../packages/orchestrator/src/run-status.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function record(overrides: Partial<WorkflowProgressRecord> = {}): Omit<WorkflowProgressRecord, "timestamp"> {
  return {
    runId: "execution",
    invocationId: "measure",
    stageId: "measure",
    stage: "measure",
    worker: "legacy-worker",
    attempt: 1,
    ...overrides,
  };
}

const timingPlan: WorkflowProgressPlan = {
  plannedStages: 4,
  stageCounts: { tune: { planned: 2, completed: 0 }, measure: { planned: 1, completed: 0 } },
};

interface StatusTiming {
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

async function readTiming(runDir: string): Promise<StatusTiming> {
  return JSON.parse(await readFile(runStatusPath(runDir), "utf8")) as StatusTiming;
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

    // Root cause 1 pin: a paused document keeps its top-level verdict but
    // never claims a running stage; the pointer folds to "accepted" and
    // stageId survives as the resume-view pointer.
    await run(finalizeWorkflowProgress(runDir, "execution", "paused"));
    const paused = await readTiming(runDir) as StatusTiming & {
      status?: string;
      current?: { stageId?: string; status?: string };
    };
    expect(paused.status).toBe("paused");
    expect(paused.current).toMatchObject({ stageId: "measure", status: "accepted" });

    // Failed finalization still labels the stage "failed".
    await run(finalizeWorkflowProgress(runDir, "execution", "failed", "boom"));
    const failed = await readTiming(runDir) as StatusTiming & {
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

describe("workflow progress document", () => {
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

  it("opens the state document with the execution's own start, carrying its plan", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", true));

    // The state document opens with the run's boundary and the plan a reader
    // needs for every count; the job ordinal ties the span to its job.
    const status = JSON.parse(await readFile(runStatusPath(runDir), "utf8")) as {
      runId: string; status: string; plannedStages: number;
      jobs: Array<{ jobOrdinal: number; input?: string }>;
    };
    expect(status).toMatchObject({ runId: "execution", status: "running", plannedStages: 4 });
    expect(status.jobs).toMatchObject([{ jobOrdinal: 1, input: "do the work" }]);
  });

  it("keeps a run going when its state document is unreadable", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    // A state document that no longer parses is damaged, not a reason to
    // refuse the run: the transition folds over an empty document and rewrites
    // it from scratch.
    await writeFile(runStatusPath(runDir), "{not json\n", "utf8");

    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));

    const status = JSON.parse(await readFile(runStatusPath(runDir), "utf8")) as RunStatus;
    expect(status).toMatchObject({ runId: "execution", status: "running", plannedStages: 4 });
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

  it("records how an execution ended even with no prior document", async () => {
    at("2026-01-01T00:00:00.000Z");
    // No initialize: there is no prior document, and the outcome must not
    // depend on one existing.
    const runDir = await newRunDir();
    await run(finalizeWorkflowProgress(runDir, "execution", "failed", "boom"));

    const status = JSON.parse(await readFile(runStatusPath(runDir), "utf8")) as { status: string; error?: unknown };
    expect(status.status).toBe("failed");
    expect(status.error).toBe("boom");
  });

  it("closes a job and starts the next in one transition", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));
    await run(finalizeWorkflowProgress(runDir, "execution", "paused"));

    // A restart folds the close and the new job's start into one write: the
    // closed job and its successor are never observed apart.
    at("2026-01-01T00:01:00.000Z");
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 2, "again", true, { restartOrdinal: 1 }));

    const status = JSON.parse(
      await readFile(runStatusPath(runDir), "utf8"),
    ) as { status: string; jobs: Array<{ jobOrdinal: number; outcome?: string }> };
    expect(status.status).toBe("running");
    expect(status.jobs).toMatchObject([
      { jobOrdinal: 1, outcome: "restarted" },
      { jobOrdinal: 2 },
    ]);
    expect(status.jobs[1]?.outcome).toBeUndefined();
  });

});

describe("run status fold", () => {
  const started = (ordinal: number, timestamp: string) => ({
    kind: "execution-started",
    timestamp,
    runId: "projection",
    jobOrdinal: ordinal,
    prompt: `job ${ordinal}`,
    resumed: ordinal > 1,
    plan: timingPlan,
  }) as unknown as WorkflowTransition;
  const finished = (status: "completed" | "failed" | "paused", timestamp: string) => ({
    kind: "execution-finished",
    timestamp,
    runId: "projection",
    status,
  }) as unknown as WorkflowTransition;

  it("follows the run status through start and finish", () => {
    // Only the boundary records write status; job rows are history.
    let status = applyRunStatusRecord(undefined, started(1, "2026-01-01T00:00:00.000Z"));
    expect(status.status).toBe("running");
    status = applyRunStatusRecord(status, finished("paused", "2026-01-01T00:00:01.000Z"));
    expect(status.status).toBe("paused");
    status = applyRunStatusRecord(status, started(2, "2026-01-01T00:00:02.000Z"));
    expect(status.status).toBe("running");
    status = applyRunStatusRecord(status, finished("completed", "2026-01-01T00:00:03.000Z"));
    expect(status.status).toBe("completed");
    status = applyRunStatusRecord(status, started(3, "2026-01-01T00:00:04.000Z"));
    status = applyRunStatusRecord(status, finished("failed", "2026-01-01T00:00:05.000Z"));
    expect(status.status).toBe("failed");
  });

  it("closes a restarted job and starts its successor in one record", () => {
    // The restart's close rides the successor's start, so a closed job can
    // never be the latest one in a persisted document.
    let status = applyRunStatusRecord(undefined, started(1, "2026-01-01T00:00:00.000Z"));
    status = applyRunStatusRecord(status, finished("paused", "2026-01-01T00:00:01.000Z"));
    status = applyRunStatusRecord(status, {
      ...started(2, "2026-01-01T00:00:02.000Z"),
      closesJobOrdinal: 1,
    } as unknown as WorkflowTransition);
    expect(status.status).toBe("running");
    expect(status.jobs).toMatchObject([
      { jobOrdinal: 1, outcome: "restarted" },
      { jobOrdinal: 2 },
    ]);
    expect(status.jobs[1]?.outcome).toBeUndefined();
  });

  it("keeps the status a record wrote when the document holds no job yet", () => {
    // A run finalized without initialize (a failure before any job) still
    // records its own outcome; there is nothing to update in the job table.
    const status = applyRunStatusRecord(undefined, finished("failed", "2026-01-01T00:00:00.000Z"));
    expect(status.status).toBe("failed");
    expect(status.jobs).toEqual([]);
  });

  it("leaves a job-less document's status standing for bookkeeping records", () => {
    // A trajectory bootstrap can record `cancelled` before any job exists.
    // Only start/finish records write status, so a bookkeeping record must
    // not revive it.
    const cancelled: RunStatus = { ...emptyRunStatus("projection", "2026-01-01T00:00:00.000Z"), status: "cancelled" };
    const regionExit = {
      kind: "region-finalized",
      timestamp: "2026-01-01T00:00:01.000Z",
      runId: "projection",
      jobOrdinal: 1,
      instance: "tune",
      regionId: "tune",
      regionKind: "loop",
      outcome: "bound-iterations",
      iterations: 1,
    } as unknown as WorkflowTransition;
    expect(applyRunStatusRecord(cancelled, regionExit).status).toBe("cancelled");
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

    // The process died here: the state still says `running`. A reopen folds
    // the missing `execution-finished`, so the run reads `paused` and the
    // continue-or-restart question is the human's.
    expect(await run(reconcileCrashedRun(runDir))).toBe(true);
    const status = await run(readRunStatus(runDir));
    expect(status?.status).toBe("paused");

    // A run already at rest is left alone: reconcile is not a rewrite.
    expect(await run(reconcileCrashedRun(runDir))).toBe(false);
    expect((await run(readRunStatus(runDir)))?.status).toBe("paused");
  });
});
