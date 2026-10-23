// A run's progress reaches the screen through the one state document it keeps,
// folded from the append-only stream behind it. Reading the document is the
// cheap path; reading the stream is what makes a missing document cost a fold
// rather than the view.
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
  runStatusPath,
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

function record(): Omit<WorkflowProgressRecord, "timestamp"> {
  return {
    runId: "execution",
    invocationId: "tune@root",
    stageId: "tune",
    stage: "tune",
    worker: "basic",
    attempt: 1,
    progress: {
      completedStages: 1,
      plannedStages: 2,
      stageCounts: PLAN.stageCounts,
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
  await run(initializeWorkflowProgress(runDir, "execution", PLAN, 1, "do the work", false));
  await run(markWorkflowStageStarted(runDir, "execution", {
    invocationId: "tune@root", stageId: "tune", stage: "tune", worker: "basic", attempt: 1,
  }));
  await run(appendWorkflowProgress(runDir, record()));
  await run(finalizeWorkflowProgress(runDir, "execution", "completed"));
  return runDir;
}

describe("reading a run's progress", () => {
  it("reads the state document the run keeps", async () => {
    const runDir = await finishedRun();
    const view = await readWorkflowSnapshot(runDir);

    expect(view?.status).toBe("completed");
    expect(view?.completedStages).toBe(1);
    expect(view?.current?.stageId).toBe("tune");
  });

  it("draws nothing when the state document is torn or absent", async () => {
    const runDir = await finishedRun();
    await writeFile(runStatusPath(runDir), '{"version":1,"runId":"ru', "utf8");

    expect(await readWorkflowSnapshot(runDir)).toBeUndefined();
  });

  it("draws nothing when neither file can be read", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-progress-empty-"));
    roots.push(runDir);

    expect(await readWorkflowSnapshot(runDir)).toBeUndefined();
  });
});
