import { describe, expect, it } from "vitest";
import type { TrajectoryRecordContext, WorkflowObservation } from "@piano/trajectory";
import {
  attemptHandle,
  mapWorkflowObservation,
  toolHandle,
} from "../src/map-workflow-observation.js";

const context: TrajectoryRecordContext = {
  version: 1,
  timestamp: "2026-10-27T00:00:00.000Z",
  runId: "run-1",
  invocationId: "measure@loop/iter-2",
  stageId: "loop.measure",
  stage: "measure",
  worker: "benchmark-worker",
  attempt: 3,
  iteration: 2,
  actorKey: "run-1/pi/benchmark-worker/root",
  sessionId: "session-1",
};

describe("mapWorkflowObservation", () => {
  it("starts and ends a stage attempt under a stable handle", () => {
    const started: WorkflowObservation = {
      type: "stage_attempt_started",
      context,
      monotonicMs: 10,
    };
    const finished: WorkflowObservation = {
      type: "stage_attempt_finished",
      context,
      monotonicMs: 20,
      outcome: "validation_failed",
    };
    expect(mapWorkflowObservation(started)).toEqual([{
      action: "start",
      handle: attemptHandle(context),
      type: "agent",
      name: "stage.attempt:loop.measure",
      input: { stageId: "loop.measure", attempt: 3 },
      metadata: expect.objectContaining({
        runId: "run-1",
        invocationId: "measure@loop/iter-2",
        attempt: 3,
        iteration: 2,
      }),
    }]);
    expect(mapWorkflowObservation(finished)).toEqual([{
      action: "end",
      handle: attemptHandle(context),
      level: "WARNING",
      statusMessage: "validation_failed",
      output: { outcome: "validation_failed" },
      metadata: expect.objectContaining({ attempt: 3 }),
    }]);
  });

  it("grades attempt outcomes by severity", () => {
    const finished = (outcome: "accepted" | "failed" | "cancelled"): WorkflowObservation => ({
      type: "stage_attempt_finished",
      context,
      monotonicMs: 1,
      outcome,
    });
    expect(mapWorkflowObservation(finished("accepted"))[0]).toMatchObject({ level: "DEFAULT" });
    expect(mapWorkflowObservation(finished("failed"))[0]).toMatchObject({ level: "ERROR" });
    expect(mapWorkflowObservation(finished("cancelled"))[0]).toMatchObject({ level: "WARNING" });
  });

  it("updates the attempt with transcript-derived token usage", () => {
    const usage: WorkflowObservation = {
      type: "token_usage",
      context,
      usage: { input: 3, output: 2, cacheRead: 1, cacheWrite: 0, total: 6 },
    };
    expect(mapWorkflowObservation(usage)).toEqual([{
      action: "update",
      handle: attemptHandle(context),
      metadata: expect.objectContaining({
        usage: { input: 3, output: 2, cacheRead: 1, cacheWrite: 0, total: 6 },
      }),
    }]);
  });

  it("nests tool calls under their attempt and marks tool failure", () => {
    const started: WorkflowObservation = {
      type: "tool_call_started",
      context,
      toolCallId: "call-1",
      toolName: "bash",
      monotonicMs: 5,
    };
    const finished: WorkflowObservation = {
      type: "tool_call_finished",
      context,
      toolCallId: "call-1",
      toolName: "bash",
      isError: true,
      monotonicMs: 9,
    };
    expect(mapWorkflowObservation(started)).toEqual([{
      action: "start",
      handle: toolHandle("call-1"),
      type: "tool",
      name: "bash",
      parentHandle: attemptHandle(context),
      metadata: expect.objectContaining({ toolCallId: "call-1", toolName: "bash" }),
    }]);
    expect(mapWorkflowObservation(finished)).toEqual([{
      action: "end",
      handle: toolHandle("call-1"),
      level: "ERROR",
      statusMessage: "tool failed",
      metadata: expect.objectContaining({ isError: true }),
    }]);
  });

  it("emits acceptance metrics as an event under the attempt", () => {
    const metric = {
      protocol: "benchmark/v1" as const,
      name: "throughput",
      unit: "ops/s",
      direction: "higher" as const,
      samples: [10, 12],
      best: 12,
      median: 11,
      runs: 2,
      warmup: 1,
    };
    const accepted: WorkflowObservation = {
      type: "stage_accepted",
      context,
      metrics: [{ pointer: "/throughput", value: metric }],
    };
    expect(mapWorkflowObservation(accepted)).toEqual([{
      action: "emit",
      type: "event",
      name: "stage.accepted",
      parentHandle: attemptHandle(context),
      metadata: expect.objectContaining({
        metrics: [{ pointer: "/throughput", value: metric }],
      }),
    }]);
  });

  it("emits selection as a run-level event with the referee and winner", () => {
    const selection: WorkflowObservation = {
      type: "selection",
      runId: "run-1",
      timestamp: "2026-10-27T00:00:00.000Z",
      referee: { name: "throughput", unit: "ops/s", direction: "higher" },
      outcome: "merged",
      winnerKey: "job-1/a",
      commit: "abc123",
    };
    expect(mapWorkflowObservation(selection)).toEqual([{
      action: "emit",
      type: "event",
      name: "selection",
      metadata: {
        runId: "run-1",
        outcome: "merged",
        referee: { name: "throughput", unit: "ops/s", direction: "higher" },
        winnerKey: "job-1/a",
        commit: "abc123",
      },
    }]);
  });
});
