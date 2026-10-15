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
  workflowProgressPath,
  runStatusPath,
  runStatusFromParts,
  type WorkflowError,
  type WorkflowProgressPlan,
  type WorkflowProgressRecord,
  type WorkflowProgressSnapshot,
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
    handoffRecordPath: "/tmp/handoff.json",
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

    // Not recovered from the invocation id: `"tune@tune/iter-0".split("@")[0]`
    // is the stage name, not the execution.
    const started = (await readStream(runDir)).find((line) => progressRecordKind(line) === "stage-started");
    expect(started).toEqual({
      version: 1,
      kind: "stage-started",
      timestamp: "2026-01-01T00:00:00.000Z",
      runId: "execution",
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
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", true));

    // First on the stream, so a run's boundary is legible from the record
    // alone — and so the plan a reader needs to rebuild every count is in
    // evidence rather than held outside it. The job ordinal ties the span to
    // the job it belongs to.
    expect((await readStream(runDir))[0]).toEqual({
      version: 1,
      kind: "execution-started",
      timestamp: "2026-01-01T00:00:00.000Z",
      runId: "execution",
      jobOrdinal: 1,
      prompt: "do the work",
      resumed: true,
      plan: timingPlan,
    });
  });

  it("keeps a run going when its state document is unreadable", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    // A state document that no longer parses is a damaged view of the stream,
    // not a reason to refuse the run: the record lands and the fold rewrites
    // the view from the record it just wrote.
    await writeFile(runStatusPath(runDir), "{not json\n", "utf8");

    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));

    expect((await readStream(runDir))[0]).toMatchObject({ kind: "execution-started", runId: "execution" });
    const status = JSON.parse(await readFile(runStatusPath(runDir), "utf8")) as WorkflowProgressSnapshot;
    expect(status).toMatchObject({ runId: "execution", status: "running", plannedStages: 4 });
  });

  it("keeps accepted records free of the discriminator, so existing files read the same", async () => {
    const runDir = await newRunDir();
    await run(appendWorkflowProgress(runDir, record()));

    const accepted = (await readStream(runDir))[0] ?? {};
    expect(accepted.kind).toBeUndefined();
    expect(progressRecordKind(accepted)).toBe("stage-accepted");
  });

  it("reads a line with a kind it does not recognize as nothing, not as an accepted stage", () => {
    // A newer writer's record riding the same stream: a valid envelope with a
    // discriminator this reader has no meaning for. Folding it into the
    // historical shape would count the marker as accepted work.
    const marker = {
      kind: "region-finalized",
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

  it("answers which invocation is in flight, and since when, from the stream alone", async () => {
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

  it("records how an execution ended even when there is no snapshot to fold", async () => {
    at("2026-01-01T00:00:00.000Z");
    // No initialize: the snapshot is the throwaway half of this pair, and the
    // outcome must not depend on it existing.
    const runDir = await newRunDir();
    await run(finalizeWorkflowProgress(runDir, "execution", "failed", "boom"));

    expect((await readStream(runDir))[0]).toEqual({
      version: 1,
      kind: "execution-finished",
      timestamp: "2026-01-01T00:00:00.000Z",
      runId: "execution",
      status: "failed",
      error: "boom",
    });
  });

  it("closes a job on the stream without touching the snapshot's run state", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));
    await run(closeWorkflowJob(runDir, "execution", 1, "restarted"));

    expect((await readStream(runDir)).at(-1)).toEqual({
      version: 1,
      kind: "job-closed",
      timestamp: "2026-01-01T00:00:00.000Z",
      runId: "execution",
      jobOrdinal: 1,
      outcome: "restarted",
    });
    // The state document describes the latest span; a close moves only its
    // timestamp, and the job's own reading comes from the fold.
    const status = JSON.parse(
      await readFile(runStatusPath(runDir), "utf8"),
    ) as { updatedAt: string; status: string };
    expect(status.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(status.status).toBe("running");
  });

  it("reproduces the snapshot by reducing the stream from nothing", async () => {
    at("2026-01-01T00:00:00.000Z");
    const runDir = await newRunDir();
    await run(initializeWorkflowProgress(runDir, "execution", timingPlan, 1, "do the work", false));
    const tune = { stageId: "tune", stage: "tune", worker: "worker" } as const;
    const measure = { stageId: "measure", stage: "measure", worker: "worker" } as const;

    await run(markWorkflowStageStarted(runDir, "execution", {
      ...tune, invocationId: "tune@root", attempt: 1,
    }));
    at("2026-01-01T00:00:30.000Z");
    await run(appendWorkflowProgress(runDir, record({
      ...tune, invocationId: "tune@root", attempt: 1,
      progress: { status: "accepted", acceptedStages: 1, completedStages: 1, plannedStages: 4, remainingStages: 3, stageCounts: timingPlan.stageCounts, hint: "1/4" },
    })));
    at("2026-01-01T00:01:00.000Z");
    await run(markWorkflowStageStarted(runDir, "execution", {
      ...measure, invocationId: "measure@root", attempt: 1,
    }));
    at("2026-01-01T00:02:00.000Z");
    await run(finalizeWorkflowProgress(runDir, "execution", "paused"));

    // The state document the writers produced, and the same document rebuilt
    // by folding the stream they wrote. Equal output is what makes the view a
    // view of the stream rather than a second account of the run.
    const written = JSON.parse(await readFile(runStatusPath(runDir), "utf8")) as unknown;
    const rebuilt = runStatusFromParts({ progressStream: await readFile(workflowProgressPath(runDir), "utf8") });

    expect(rebuilt).toBeDefined();
    expect(rebuilt).toEqual(written);
  });
});
