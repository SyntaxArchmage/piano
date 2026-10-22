// An actor is keyed by session × harness × worker × lane, under a `v2` prefix.
// Worker — the recipe's role — rather than logical stage: one worker continues
// a single conversation across stages, loop iterations, workflow switches, and
// prompts of a session. These tests pin the format.
import { describe, expect, it } from "vitest";
import {
  ACTOR_KEY_VERSION,
  actorSessionDirectory,
  workflowActorKey,
  type WorkflowRuntimeFrame,
  type WorkflowRuntimeInvocation,
} from "../../packages/orchestrator/src/index.js";

const invocation = (
  stageId: string,
  frames: readonly WorkflowRuntimeFrame[] = [],
): WorkflowRuntimeInvocation => ({
  runId: "run-1",
  jobOrdinal: 1,
  stageId,
  stageName: stageId,
  frames,
});

describe("workflowActorKey", () => {
  it("keys the actor by worker, so two stages on the same worker share one", () => {
    expect(workflowActorKey(invocation("profile"), "pi", "basic"))
      .toBe(workflowActorKey(invocation("measure"), "pi", "basic"));
  });

  it("separates different workers, harnesses, and sessions", () => {
    const base = workflowActorKey(invocation("a"), "pi", "basic");
    expect(workflowActorKey(invocation("a"), "pi", "other")).not.toBe(base);
    expect(workflowActorKey(invocation("a"), "claude", "basic")).not.toBe(base);
    expect(workflowActorKey({ ...invocation("a"), runId: "run-2" }, "pi", "basic")).not.toBe(base);
  });

  it("ignores loop frames, separates tournament lanes, and carries the version marker", () => {
    const loop = (iteration: number): WorkflowRuntimeFrame => ({ kind: "loop", regionId: "tune", iteration });
    const slot = (slot: number): WorkflowRuntimeFrame => ({ kind: "map", regionId: "race", slot });
    const rootKey = workflowActorKey(invocation("measure"), "pi", "cuda-benchmark-store");
    expect(rootKey).toBe(`${ACTOR_KEY_VERSION}/run-1/pi/cuda-benchmark-store/root`);
    expect(workflowActorKey(invocation("measure", [loop(0)]), "pi", "cuda-benchmark-store")).toBe(rootKey);
    expect(workflowActorKey(invocation("measure", [loop(1)]), "pi", "cuda-benchmark-store")).toBe(rootKey);
    expect(workflowActorKey(invocation("measure", [slot(0)]), "pi", "cuda-benchmark-store"))
      .not.toBe(workflowActorKey(invocation("measure", [slot(1)]), "pi", "cuda-benchmark-store"));
  });
});

describe("actorSessionDirectory", () => {
  it("keys the on-disk session directory by worker, not stage", () => {
    expect(actorSessionDirectory("/runs/r", invocation("respond"), "pi", "basic"))
      .toBe("/runs/r/sessions/trajectory-pi-basic-root");
    expect(actorSessionDirectory(
      "/runs/r",
      invocation("x", [{ kind: "map", regionId: "race", slot: 1 }]),
      "pi",
      "basic",
    )).toBe("/runs/r/sessions/trajectory-pi-basic-race-slot-1");
  });
});
