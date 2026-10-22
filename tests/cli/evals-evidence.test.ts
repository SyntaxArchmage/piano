// Evidence discovery guards for the run's audience-split layout: transcripts
// under `actors/` (with the historical `executions/` tree as a fallback),
// streams under `system-log/`, and handoff records on the invocation stream.
// The helpers are fallback paths used when a run failed before (or, for
// multi-stage runs, never writes) the top-level `transcriptPath`, so a stale
// scan silently degrades eval evidence.
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findTranscriptPath, evidencePaths, readHandoffRecords } from "../../packages/evals/src/driver.js";

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
      await mkdir(join(runDir, "system-log"), { recursive: true });
      await writeFile(join(runDir, "system-log", "trajectory.jsonl"), `${JSON.stringify({ version: 1, runId: "r", timestamp: "2026-01-01T00:00:00.000Z", status: "failed", promptLength: 1, events: [] })}\n`);
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

  it("resolves the run's evidence streams through system-log/ and the legacy root", async () => {
    // The audience-split layout moved the streams under system-log/: a reader
    // that still named the root spellings reported every new run as evidence-
    // missing while the files sat one directory below.
    const runDir = await tempRunDir("piano-evals-evidence-paths-");
    try {
      await mkdir(join(runDir, "system-log"), { recursive: true });
      for (const name of ["log.jsonl", "trace.jsonl", "trajectory.jsonl"]) {
        await writeFile(join(runDir, "system-log", name), "{}\n");
      }
      expect(evidencePaths(runDir)).toMatchObject({
        logPath: join(runDir, "system-log", "log.jsonl"),
        tracePath: join(runDir, "system-log", "trace.jsonl"),
        trajectoryPath: join(runDir, "system-log", "trajectory.jsonl"),
      });

      // A run that predates the split stays evaluable through its root files.
      const legacy = await tempRunDir("piano-evals-evidence-legacy-");
      try {
        for (const name of ["log.jsonl", "trace.jsonl", "trajectory.jsonl"]) {
          await writeFile(join(legacy, name), "{}\n");
        }
        expect(evidencePaths(legacy)).toMatchObject({
          logPath: join(legacy, "log.jsonl"),
          tracePath: join(legacy, "trace.jsonl"),
          trajectoryPath: join(legacy, "trajectory.jsonl"),
        });
      } finally {
        await rm(legacy, { recursive: true, force: true });
      }
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("collects handoff records from the invocation stream", async () => {
    // The stream is the metadata home going forward: a run whose record
    // documents are gone still contributes its stage evidence.
    const runDir = await tempRunDir("piano-evals-invocations-stream-");
    try {
      await mkdir(join(runDir, "system-log"), { recursive: true });
      await writeFile(join(runDir, "system-log", "invocations.jsonl"), `${JSON.stringify({
        version: 1,
        kind: "invocation-accepted",
        timestamp: "2026-01-01T00:00:00.000Z",
        runId: "r",
        jobOrdinal: 1,
        ref: "inv-0001",
        invocationId: "race.implement@race/slot-0",
        stageId: "race.implement",
        stage: "race",
        worker: "tune",
        sessionId: "session-1",
        transcriptPath: "/tmp/transcript.jsonl",
        text: "done",
        workspace: { key: "shared", cwd: "/tmp/workspace", kind: "shared" },
      })}\n`, "utf8");
      const records = readHandoffRecords(runDir);
      expect(records.map((record) => record.id)).toEqual(["race.implement@race/slot-0"]);
      expect(records[0]).toMatchObject({ stageId: "race.implement", worker: "tune", ref: "inv-0001" });
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});
