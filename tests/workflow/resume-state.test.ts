// The legacy resume stream, read-only now: it holds the actor table for runs
// written before the ledger's `actor-turn` rows existed. Two properties of its
// format keep it readable — a record is incremental (actors it does not mention
// survive it) and nothing is ever rewritten, so a crash could lose at most the
// append that was in flight and never damage an earlier one.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  foldActorTurns,
  readResumeState,
  resumeStreamPath,
  type ResumeState,
} from "../../packages/orchestrator/src/resume-state.js";

function actor(sessionId: string, turns = 1): ResumeState["actors"][string] {
  return {
    harness: "claude",
    sessionId,
    transcriptPath: `/runs/${sessionId}.jsonl`,
    turns,
    continuation: { harness: "claude", sessionId, transcriptPath: `/runs/${sessionId}.jsonl` },
  };
}

function state(actors: ResumeState["actors"], overrides: Partial<ResumeState> = {}): ResumeState {
  return { version: 1, runId: "run-1", promptIndex: 1, actors, ...overrides };
}

async function runDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "piano-resume-state-"));
}

/** Append one table to the legacy stream exactly as the retired writer did:
 * one complete ResumeState per line, newest last. */
async function write(dir: string, value: ResumeState) {
  await mkdir(dir, { recursive: true });
  await writeFile(resumeStreamPath(dir), `${JSON.stringify(value)}\n`, { flag: "a" });
}

function read(dir: string) {
  return Effect.runPromise(readResumeState(dir).pipe(Effect.provide(NodeFileSystem.layer)));
}

describe("resume state persistence", () => {
  it("keeps actors a later prompt did not touch", async () => {
    const dir = await runDir();
    await write(dir, state({ "run-1/claude/coding/root": actor("sess-claude") }));
    await write(dir, state({
      "run-1/pi/coding/root": actor("sess-pi"),
    }, { promptIndex: 2 }));

    const stored = await read(dir);

    expect(Object.keys(stored?.actors ?? {}).sort()).toEqual([
      "run-1/claude/coding/root",
      "run-1/pi/coding/root",
    ]);
    // The untouched actor keeps its identity, not just its key: that identity
    // is what the next prompt hands to `--resume`.
    expect(stored?.actors["run-1/claude/coding/root"]).toEqual(actor("sess-claude"));
    expect(stored?.promptIndex).toBe(2);
  });

  it("replaces the table when the record belongs to another execution", async () => {
    const dir = await runDir();
    await write(dir, state({ "run-1/claude/coding/root": actor("sess-old") }));
    await write(dir, state({ "run-2/claude/coding/root": actor("sess-new") }, { runId: "run-2" }));

    const stored = await read(dir);

    expect(Object.keys(stored?.actors ?? {})).toEqual(["run-2/claude/coding/root"]);
  });

  it("appends one record per write instead of rewriting what came before", async () => {
    const dir = await runDir();
    await write(dir, state({ "run-1/claude/coding/root": actor("sess-claude") }));
    const first = await readFile(resumeStreamPath(dir), "utf8");
    await write(dir, state({
      "run-1/claude/coding/root": actor("sess-claude", 2),
    }, { promptIndex: 2 }));

    const grown = await readFile(resumeStreamPath(dir), "utf8");

    // The earlier bytes are untouched: this is what makes a crash able to lose
    // only the record that was in flight.
    expect(grown.startsWith(first)).toBe(true);
    expect(grown.trim().split("\n")).toHaveLength(2);
  });

  it("skips a torn final record and keeps everything before it", async () => {
    const dir = await runDir();
    await write(dir, state({ "run-1/claude/coding/root": actor("sess-claude") }));
    // A process killed mid-append leaves a line that never finished.
    await writeFile(
      resumeStreamPath(dir),
      `${await readFile(resumeStreamPath(dir), "utf8")}{"version":1,"runId":"run-1","prompt`,
      { flag: "a" },
    );

    expect((await read(dir))?.actors["run-1/claude/coding/root"]).toEqual(actor("sess-claude"));
  });

  it("reports no state when nothing has been written", async () => {
    expect(await read(await runDir())).toBeUndefined();
  });

  it("folds the actor table from the ledger's actor-turn rows", () => {
    const turn = (actorKey: string, turns: number, sessionId = "sess-claude") => ({
      version: 1, kind: "actor-turn" as const, timestamp: "2026-08-21T10:00:00.000Z",
      runId: "run-1", jobOrdinal: 1, invocationId: "coding@root", attempt: 1,
      actorKey, harness: "claude", worker: "coding", lane: "root",
      sessionId, transcriptPath: `/runs/${sessionId}.jsonl`, turn: turns,
      continuation: { harness: "claude", sessionId, transcriptPath: `/runs/${sessionId}.jsonl` },
    });
    const folded = foldActorTurns([
      turn("run-1/claude/coding/root", 1),
      turn("run-1/pi/racing/race/slot-0", 1, "sess-pi"),
      // A later row for the same actor supersedes it, the way the resume
      // writer's own merge rule does.
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
});
