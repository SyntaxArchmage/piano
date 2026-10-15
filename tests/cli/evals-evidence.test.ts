// Evidence discovery guards for the two run layouts: the historical
// `executions/` tree and the current orchestrator's `prompts/<n>/invocations`
// + `actors/` tree. Both helpers are fallback paths used when a run failed
// before (or, for multi-stage runs, never writes) the top-level
// `transcriptPath`, so a stale scan silently degrades eval evidence.
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findTranscriptPath, readHandoffRecords } from "../../packages/evals/src/driver.js";

async function tempRunDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

describe("evals evidence discovery across run layouts", () => {
  it("finds actor-session transcripts when the top-level transcriptPath is absent", async () => {
    const runDir = await tempRunDir("piano-evals-transcript-");
    try {
      const transcript = join(runDir, "actors", "pi", "agent", "root", "session", "2026-01-01T00-00-00-000Z_session.jsonl");
      await mkdir(join(transcript, ".."), { recursive: true });
      await writeFile(transcript, '{"role":"user","content":"go"}\n');
      await writeFile(join(runDir, "trajectory.json"), JSON.stringify({ status: "failed" }));
      expect(findTranscriptPath(runDir)).toBe(transcript);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("still prefers the state document's transcriptPath and the legacy executions layout", async () => {
    const runDir = await tempRunDir("piano-evals-transcript-legacy-");
    try {
      const legacy = join(runDir, "executions", "execution-1", "transcript.jsonl");
      await mkdir(join(legacy, ".."), { recursive: true });
      await writeFile(legacy, '{"role":"user","content":"go"}\n');
      expect(findTranscriptPath(runDir)).toBe(legacy);

      const top = join(runDir, "actors", "pi", "agent", "root", "session", "real.jsonl");
      await mkdir(join(top, ".."), { recursive: true });
      await writeFile(top, '{"role":"user","content":"go"}\n');
      await writeFile(join(runDir, "status.json"), JSON.stringify({ status: "completed", transcriptPath: top }));
      expect(findTranscriptPath(runDir)).toBe(top);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("collects handoff records from the prompts/invocations layout", async () => {
    const runDir = await tempRunDir("piano-evals-handoff-");
    try {
      const recordPath = join(runDir, "prompts", "1", "invocations", "handoff", "record.json");
      await mkdir(join(recordPath, ".."), { recursive: true });
      await writeFile(recordPath, JSON.stringify({ producer: { id: "race.implement", stageId: "race.implement" } }));
      const records = readHandoffRecords(runDir);
      expect(records.map((record) => record.id)).toEqual(["race.implement"]);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});
