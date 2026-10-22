import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { refreshRunStatus } from "../../packages/orchestrator/src/index.js";
import { runStatusFromTrajectory } from "../../packages/orchestrator/src/run-status.js";
import { foldStatus } from "../common/status-fold.js";

const timestamp = "2026-01-01T00:00:00.000Z";

function jsonl(lines: readonly object[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

describe("run status", () => {
  it("folds the ledger's job and actor state", () => {
    const status = foldStatus([
      {
        kind: "execution-started",
        timestamp,
        runId: "run-1",
        jobOrdinal: 1,
        prompt: "do the work",
        resumed: false,
        plan: { plannedStages: 2, stageCounts: { tune: { planned: 2, completed: 0 } } },
      },
      {
        kind: "stage-accepted",
        timestamp,
        runId: "run-1",
        invocationId: "tune@root",
        stageId: "tune",
        stage: "tune",
        worker: "basic",
        attempt: 1,
        workspace: { key: "shared", cwd: "/work", kind: "shared" },
        sessionId: "session-1",
        transcriptPath: "/t.jsonl",
      },
      {
        kind: "actor-turn",
        timestamp,
        runId: "run-1",
        jobOrdinal: 1,
        invocationId: "tune@root",
        attempt: 1,
        actorKey: "run-1/basic/root",
        harness: "pi",
        worker: "basic",
        lane: "root",
        sessionId: "s",
        transcriptPath: "/t.jsonl",
        turn: 1,
      },
    ]);

    expect(status).toMatchObject({
      version: 1,
      runId: "run-1",
      updatedAt: timestamp,
      status: "running",
      plannedStages: 2,
      stageCounts: { tune: { planned: 2, completed: 0 } },
      actors: { "run-1/basic/root": { harness: "pi", sessionId: "s", transcriptPath: "/t.jsonl", turns: 1 } },
    });
    expect(status?.jobs).toHaveLength(1);
    expect(status?.jobs[0]).toMatchObject({ jobOrdinal: 1, input: "do the work" });
  });

  it("folds the trajectory's turn list and prompt length", () => {
    const status = runStatusFromTrajectory(jsonl([
      {
        version: 1,
        runId: "run-1",
        timestamp,
        status: "completed",
        promptLength: 3,
        events: [],
        prompt: "do the work",
      },
    ]));
    expect(status).toMatchObject({
      runId: "run-1",
      promptLength: 3,
      turns: [{ prompt: "do the work", status: "completed" }],
    });
  });

  it("takes its lifecycle status from the trajectory on bootstrap", () => {
    const status = runStatusFromTrajectory(jsonl([
      { version: 1, runId: "run-2", timestamp, status: "failed", promptLength: 1, events: [], error: "boom" },
    ]));
    expect(status).toMatchObject({ runId: "run-2", status: "failed", error: "boom" });
  });

  it("reads a run recorded only in its trajectory", () => {
    const status = runStatusFromTrajectory(jsonl([
      {
        version: 1,
        runId: "run-3",
        timestamp,
        status: "completed",
        promptLength: 2,
        events: [],
        workflowPath: "/w.yaml",
      },
    ]));
    expect(status).toMatchObject({ runId: "run-3", status: "completed", workflowPath: "/w.yaml", jobs: [] });
  });

  it("has no state for a run nothing describes", () => {
    expect(runStatusFromTrajectory()).toBeUndefined();
  });

  it("takes its actors from the ledger's actor-turn rows", () => {
    // The ledger is the run's own record of each conversation-state change.
    const status = foldStatus([
      {
        kind: "actor-turn",
        timestamp,
        runId: "run-5",
        jobOrdinal: 1,
        invocationId: "tune@root",
        attempt: 1,
        actorKey: "run-5/basic/root",
        harness: "pi",
        worker: "basic",
        lane: "root",
        sessionId: "sess-5",
        transcriptPath: "/t.jsonl",
        turn: 2,
      },
    ]);
    expect(status?.actors).toEqual({
      "run-5/basic/root": { harness: "pi", sessionId: "sess-5", transcriptPath: "/t.jsonl", turns: 2 },
    });
  });

  it("says which turns ran and how they ended, not where their events sit", () => {
    // The state document answers how a run is doing; the replay slices events
    // by folding the trajectory itself. So `eventCount` — a fact about the
    // evidence — never reaches the view, even though the fold computes it.
    const status = runStatusFromTrajectory(jsonl([
      {
        version: 1,
        runId: "run-4",
        timestamp,
        status: "completed",
        promptLength: 2,
        prompt: "first",
        events: [{ type: "done" }],
      },
    ]));
    expect(status?.turns).toEqual([{ prompt: "first", status: "completed" }]);
  });

  it("bootstraps status.json from the trajectory without erasing the job table", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-status-refresh-"));
    try {
      await mkdir(join(runDir, "system-log"), { recursive: true });
      const trajectoryPath = join(runDir, "system-log", "trajectory.jsonl");
      await writeFile(trajectoryPath, jsonl([
        {
          version: 1,
          runId: "run-9",
          timestamp,
          status: "completed",
          promptLength: 4,
          prompt: "work",
          events: [],
          name: "named",
        },
      ]));
      await Effect.runPromise(refreshRunStatus(runDir).pipe(Effect.provide(NodeFileSystem.layer)));
      const bootstrapped = JSON.parse(await readFile(join(runDir, "status.json"), "utf8")) as {
        runId: string;
        status: string;
        name?: string;
        turns?: readonly { prompt: string }[];
      };
      expect(bootstrapped).toMatchObject({
        runId: "run-9",
        status: "completed",
        name: "named",
        turns: [{ prompt: "work", status: "completed" }],
      });

      // A later turn refreshes the narrative fields and keeps the job table.
      await writeFile(trajectoryPath, jsonl([
        {
          version: 1,
          runId: "run-9",
          timestamp,
          status: "completed",
          promptLength: 4,
          prompt: "work",
          events: [],
          name: "named",
        },
        {
          version: 1,
          runId: "run-9",
          timestamp: "2026-01-01T00:01:00.000Z",
          status: "failed",
          promptLength: 4,
          prompt: "again",
          events: [],
          error: "boom",
        },
      ]));
      await Effect.runPromise(refreshRunStatus(runDir).pipe(Effect.provide(NodeFileSystem.layer)));
      const refreshed = JSON.parse(await readFile(join(runDir, "status.json"), "utf8")) as {
        turns?: readonly { prompt: string }[];
        error?: unknown;
      };
      expect(refreshed.turns?.map((turn) => turn.prompt)).toEqual(["work", "again"]);
      expect(refreshed.error).toBe("boom");
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});
