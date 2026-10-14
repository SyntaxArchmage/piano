// A run's progress reaches the screen through two files: the snapshot the
// orchestrator keeps for viewers, and the append-only stream it is a projection
// of. Reading the snapshot is the cheap path; reading the stream is what makes
// a missing snapshot cost a fold rather than the view.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendWorkflowProgress,
  finalizeWorkflowProgress,
  initializeWorkflowProgress,
  markWorkflowStageStarted,
  workflowProgressPath,
  workflowProgressSnapshotPath,
  type WorkflowError,
  type WorkflowProgressPlan,
  type WorkflowProgressRecord,
} from "../../packages/orchestrator/src/index.js";
import { readWorkflowSnapshot } from "../../packages/cli/src/progress-view.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const PLAN: WorkflowProgressPlan = {
  plannedStages: 2,
  stageCounts: { tune: { planned: 1, completed: 0 }, measure: { planned: 1, completed: 0 } },
};

function record(): Omit<WorkflowProgressRecord, "version" | "timestamp"> {
  return {
    executionId: "execution",
    invocationId: "tune@root",
    stageId: "tune",
    stage: "tune",
    worker: "basic",
    attempt: 1,
    workspace: { key: "shared-root", cwd: "/workspace", kind: "shared" },
    actorKey: "tune",
    harness: "pi",
    sessionId: "session",
    transcriptPath: "/tmp/transcript.jsonl",
    handoffRecordPath: "/tmp/handoff.json",
    progress: {
      status: "accepted",
      acceptedStages: 1,
      completedStages: 1,
      plannedStages: 2,
      remainingStages: 1,
      stageCounts: PLAN.stageCounts,
      hint: "1/2",
    },
  };
}

function run<A>(effect: Effect.Effect<A, WorkflowError, import("@effect/platform").FileSystem.FileSystem>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)));
}

/** A finished run on disk: the snapshot and the stream that produced it. */
async function finishedRun(): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), "piano-progress-view-"));
  roots.push(runDir);
  await run(initializeWorkflowProgress(runDir, "execution", PLAN, 1, false));
  await run(markWorkflowStageStarted(runDir, "execution", {
    invocationId: "tune@root", stageId: "tune", stage: "tune", worker: "basic", attempt: 1,
  }));
  await run(appendWorkflowProgress(runDir, record()));
  await run(finalizeWorkflowProgress(runDir, "execution", "completed"));
  return runDir;
}

describe("reading a run's progress", () => {
  it("reads the snapshot the orchestrator keeps", async () => {
    const runDir = await finishedRun();
    const view = await readWorkflowSnapshot(workflowProgressSnapshotPath(runDir));

    expect(view?.status).toBe("completed");
    expect(view?.completedStages).toBe(1);
    expect(view?.current?.stageId).toBe("tune");
  });

  it("draws the same view from the stream when the snapshot is gone", async () => {
    const runDir = await finishedRun();
    const snapshotPath = workflowProgressSnapshotPath(runDir);
    const fromSnapshot = await readWorkflowSnapshot(snapshotPath);

    await rm(snapshotPath);

    expect(await readWorkflowSnapshot(snapshotPath)).toEqual(fromSnapshot);
  });

  it("skips a line torn mid-append and keeps the records before it", async () => {
    const runDir = await finishedRun();
    const snapshotPath = workflowProgressSnapshotPath(runDir);
    const fromSnapshot = await readWorkflowSnapshot(snapshotPath);
    await writeFile(workflowProgressPath(runDir), '{"version":1,"executionId":"execu', { flag: "a" });

    await rm(snapshotPath);

    expect(await readWorkflowSnapshot(snapshotPath)).toEqual(fromSnapshot);
  });

  it("draws nothing when neither file can be read", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-progress-empty-"));
    roots.push(runDir);

    expect(await readWorkflowSnapshot(workflowProgressSnapshotPath(runDir))).toBeUndefined();
  });
});
