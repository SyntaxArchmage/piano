// One `actor-turn` row per conversation-state change; the stage runner is its
// only writer.
import { describe, expect, it } from "vitest";
import { actorTurnRow } from "../../packages/orchestrator/src/resume-state.js";

describe("actor rows", () => {
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
