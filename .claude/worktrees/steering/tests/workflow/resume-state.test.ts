// resume.json is the canonical resume state: the only record of which harness
// session each actor's next turn must reopen. Two properties keep it reliable
// for a long-running coding session — a write is incremental (actors it does
// not mention survive it) and atomic (a reader never sees a half-written
// document, and a crash cannot destroy what was already durable).
import { mkdtemp, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  readResumeState,
  resumeStatePath,
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

  it("replaces the table when the file belongs to another execution", async () => {
    const dir = await runDir();
    await write(dir, state({ "run-1/claude/coding/root": actor("sess-old") }));
    await write(dir, state({ "run-2/claude/coding/root": actor("sess-new") }, { executionId: "run-2" }));

    const stored = await read(dir);

    expect(Object.keys(stored?.actors ?? {})).toEqual(["run-2/claude/coding/root"]);
  });

  it("leaves no staging file behind and never a partial document", async () => {
    const dir = await runDir();
    await write(dir, state({ "run-1/claude/coding/root": actor("sess-claude") }));

    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(JSON.parse(await readFile(resumeStatePath(dir), "utf8"))).toMatchObject({ executionId: "run-1" });
  });

  // The window a non-atomic write left open: killed between its bytes and the
  // rename, the file it was overwriting is gone and the only surviving copy is
  // the staged one. Losing it means every actor starts over.
  it("reads the staged table a crashed write left behind", async () => {
    const dir = await runDir();
    await writeFile(resumeStatePath(dir), '{"version":1,"executionId":"run-1","prompt', "utf8");
    await writeFile(`${resumeStatePath(dir)}.4242.tmp`, `${JSON.stringify(state({
      "run-1/claude/coding/root": actor("sess-staged"),
    }))}\n`, "utf8");

    const stored = await read(dir);

    expect(stored?.actors["run-1/claude/coding/root"]).toEqual(actor("sess-staged"));
  });

  it("reads the staged table when the document is missing entirely", async () => {
    const dir = await runDir();
    await writeFile(`${resumeStatePath(dir)}.4242.tmp`, `${JSON.stringify(state({
      "run-1/claude/coding/root": actor("sess-staged"),
    }))}\n`, "utf8");

    expect((await read(dir))?.executionId).toBe("run-1");
  });

  it("prefers the newest staged table and skips an unreadable one", async () => {
    const dir = await runDir();
    const older = `${resumeStatePath(dir)}.11.tmp`;
    const newer = `${resumeStatePath(dir)}.22.tmp`;
    await writeFile(older, `${JSON.stringify(state({ "run-1/a": actor("sess-old") }))}\n`, "utf8");
    await writeFile(newer, `${JSON.stringify(state({ "run-1/b": actor("sess-new") }))}\n`, "utf8");
    await utimes(older, new Date(1_000_000), new Date(1_000_000));
    await utimes(newer, new Date(2_000_000), new Date(2_000_000));

    const stored = await read(dir);

    expect(Object.keys(stored?.actors ?? {})).toEqual(["run-1/b"]);
  });

  it("reports no state when neither the document nor a staging copy parses", async () => {
    const dir = await runDir();
    await writeFile(resumeStatePath(dir), "not valid json\n", "utf8");
    await writeFile(`${resumeStatePath(dir)}.4242.tmp`, "also not json\n", "utf8");

    expect(await read(dir)).toBeUndefined();
  });
});
