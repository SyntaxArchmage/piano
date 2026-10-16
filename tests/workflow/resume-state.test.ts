// The actor table the run's own ledger records: one `actor-turn` row per
// conversation-state change, newest row per actor winning. The three writers
// (the stage path, the consolidation path, the fold that reads them back) meet
// here so they cannot spell the same row differently.
import { describe, expect, it } from "vitest";
import {
  actorTableFrom,
  actorTurnRow,
  foldActorTurns,
  type ResumeActorState,
} from "../../packages/orchestrator/src/resume-state.js";

function actor(sessionId: string, turns = 1): ResumeActorState {
  return {
    harness: "claude",
    sessionId,
    transcriptPath: `/runs/${sessionId}.jsonl`,
    turns,
    continuation: { harness: "claude", sessionId, transcriptPath: `/runs/${sessionId}.jsonl` },
  };
}

function turn(actorKey: string, turns: number, sessionId = "sess-claude", jobOrdinal = 1) {
  return {
    version: 1, kind: "actor-turn" as const, timestamp: "2026-08-21T10:00:00.000Z",
    runId: "run-1", jobOrdinal, invocationId: "coding@root", attempt: 1,
    actorKey, harness: "claude", worker: "coding", lane: "root",
    sessionId, transcriptPath: `/runs/${sessionId}.jsonl`, turn: turns,
    continuation: { harness: "claude", sessionId, transcriptPath: `/runs/${sessionId}.jsonl` },
  };
}

describe("actor table from the ledger", () => {
  it("folds the newest row per actor and ignores other kinds", () => {
    const folded = foldActorTurns([
      turn("run-1/claude/coding/root", 1),
      turn("run-1/pi/racing/race/slot-0", 1, "sess-pi"),
      // A later row for the same actor supersedes it.
      turn("run-1/claude/coding/root", 2),
      // Rows of other kinds are not actor state.
      { kind: "region-finalized" },
    ]);

    expect(Object.keys(folded).sort()).toEqual([
      "run-1/claude/coding/root",
      "run-1/pi/racing/race/slot-0",
    ]);
    expect(folded["run-1/claude/coding/root"]).toEqual(actor("sess-claude", 2));
    // The continuation is the harness's own pointer, copied verbatim.
    expect(folded["run-1/pi/racing/race/slot-0"]?.continuation).toEqual(actor("sess-pi").continuation);
  });

  it("takes its prompt index from the newest row", () => {
    const table = actorTableFrom([
      turn("run-1/claude/coding/root", 1),
      turn("run-1/pi/racing/race/slot-0", 1, "sess-pi", 2),
    ]);

    expect(table.jobOrdinal).toBe(2);
    expect(Object.keys(table.actors)).toHaveLength(2);
  });

  it("has no actors and no prompt index when the ledger holds none", () => {
    expect(actorTableFrom([])).toEqual({ jobOrdinal: 0, actors: {} });
  });

  it("builds a row only for an actor that is durable", () => {
    const state = (overrides: Partial<{ harness?: string; sessionId?: string; transcriptPath?: string; turns: number }>) =>
      actorTurnRow({
        runId: "run-1",
        jobOrdinal: 1,
        invocationId: "coding@root",
        attempt: 1,
        actorKey: "run-1/claude/coding/root",
        harness: "claude",
        worker: "coding",
        lane: "root",
        state: { turns: 1, ...overrides },
      });

    expect(state({ harness: "claude", sessionId: "sess", transcriptPath: "/t.jsonl" })).toMatchObject({
      kind: "actor-turn",
      actorKey: "run-1/claude/coding/root",
      turn: 1,
    });
    // No session to reopen: there is nothing worth recording.
    expect(state({ sessionId: "sess", transcriptPath: "/t.jsonl" })).toBeUndefined();
  });
});
