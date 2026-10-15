// resume.jsonl is the canonical resume state: the only record of which harness
// session each actor's next turn must reopen. Two properties keep it reliable
// for a long-running coding session — a write is incremental (actors a record
// does not mention survive it) and nothing is ever rewritten, so a crash can
// lose at most the append that was in flight and can never damage an earlier
// one.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  readResumeState,
  resumeStreamPath,
  writeResumeState,
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
  return { version: 1, executionId: "run-1", promptIndex: 1, actors, ...overrides };
}

async function runDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "piano-resume-state-"));
}

function write(dir: string, value: ResumeState) {
  return Effect.runPromise(writeResumeState(dir, value).pipe(Effect.provide(NodeFileSystem.layer)));
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
    await write(dir, state({ "run-2/claude/coding/root": actor("sess-new") }, { executionId: "run-2" }));

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
      `${await readFile(resumeStreamPath(dir), "utf8")}{"version":1,"executionId":"run-1","prompt`,
      { flag: "a" },
    );

    expect((await read(dir))?.actors["run-1/claude/coding/root"]).toEqual(actor("sess-claude"));
  });

  it("reports no state when nothing has been written", async () => {
    expect(await read(await runDir())).toBeUndefined();
  });
});
