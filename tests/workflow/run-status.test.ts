import { describe, expect, it } from "vitest";
import { runStatusFromParts } from "../../packages/orchestrator/src/index.js";

const timestamp = "2026-01-01T00:00:00.000Z";

function progressStream(lines: readonly object[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

describe("run status", () => {
  it("folds one state out of the three ledgers a run keeps", () => {
    const status = runStatusFromParts({
      progressStream: progressStream([
        {
          version: 1,
          kind: "execution-started",
          timestamp,
          executionId: "run-1",
          jobOrdinal: 1,
          prompt: "do the work",
          resumed: false,
          plan: { plannedStages: 2, stageCounts: { tune: { planned: 2, completed: 0 } } },
        },
        {
          version: 1,
          kind: "stage-accepted",
          timestamp,
          executionId: "run-1",
          invocationId: "tune@root",
          stageId: "tune",
          stage: "tune",
          worker: "basic",
          attempt: 1,
          workspace: { key: "shared", cwd: "/work", kind: "shared" },
          sessionId: "session-1",
          transcriptPath: "/t.jsonl",
          handoffRecordPath: "/h.json",
        },
      ]),
      resume: JSON.stringify({
        version: 1,
        executionId: "run-1",
        promptIndex: 1,
        actors: {
          "run-1/basic/root": { harness: "pi", sessionId: "s", transcriptPath: "/t.jsonl", turns: 1 },
        },
      }),
      trajectoryStream: progressStream([
        {
          version: 1,
          runId: "run-1",
          timestamp,
          status: "completed",
          promptLength: 3,
          events: [],
          // A turn is what a record that carried a prompt closes with; the
          // fold derives the list rather than trusting one on the record.
          prompt: "do the work",
        },
      ]),
    });

    // The three ledgers name the run two different things; the state says it
    // once. The run's status comes from the lifecycle ledger: a trajectory
    // record's status is the turn it closed, which is `completed` while the
    // run around it is still going.
    expect(status).toMatchObject({
      version: 1,
      runId: "run-1",
      updatedAt: timestamp,
      status: "running",
      promptLength: 3,
      turns: [{ prompt: "do the work", status: "completed" }],
      plannedStages: 2,
      stageCounts: { tune: { planned: 2, completed: 0 } },
      promptIndex: 1,
      actors: { "run-1/basic/root": { harness: "pi", sessionId: "s", transcriptPath: "/t.jsonl", turns: 1 } },
    });
    expect(status?.jobs).toHaveLength(1);
    expect(status?.jobs[0]).toMatchObject({ jobOrdinal: 1, input: "do the work" });
  });

  it("keeps the run's own status even when only the trajectory says it", () => {
    const status = runStatusFromParts({
      trajectoryStream: progressStream([
        { version: 1, runId: "run-2", timestamp, status: "failed", promptLength: 1, events: [], error: "boom" },
      ]),
    });
    expect(status).toMatchObject({ runId: "run-2", status: "failed", error: "boom" });
  });

  it("reads a run recorded before the ledgers existed", () => {
    const status = runStatusFromParts({
      trajectoryDocument: JSON.stringify({
        version: 1,
        runId: "run-3",
        updatedAt: timestamp,
        status: "completed",
        promptLength: 2,
        events: [],
        workflowPath: "/w.yaml",
      }),
    });
    expect(status).toMatchObject({ runId: "run-3", status: "completed", workflowPath: "/w.yaml", jobs: [] });
  });

  it("has no state for a run nothing describes", () => {
    expect(runStatusFromParts({})).toBeUndefined();
    expect(runStatusFromParts({ resume: JSON.stringify({ version: 1 }) })).toBeUndefined();
  });

  it("says which turns ran and how they ended, not where their events sit", () => {
    // The state document answers how a run is doing; the replay slices events
    // by folding the trajectory itself. So `eventCount` — a fact about the
    // evidence — never reaches the view, even though the fold computes it.
    const status = runStatusFromParts({
      trajectoryStream: progressStream([
        {
          version: 1,
          runId: "run-4",
          timestamp,
          status: "completed",
          promptLength: 2,
          prompt: "first",
          events: [{ type: "done" }],
        },
      ]),
    });
    expect(status?.turns).toEqual([{ prompt: "first", status: "completed" }]);
  });
});
