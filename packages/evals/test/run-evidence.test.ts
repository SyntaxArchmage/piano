// Evidence discovery guards for the run's audience-split layout: transcripts
// under `sessions/`, streams under `system-log/`. The helpers are fallback
// paths used when a run failed before (or, for multi-stage runs, never writes)
// the top-level `transcriptPath`, so a stale scan silently degrades eval
// evidence.
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { findTranscriptPath, evidencePaths } from "../src/run-case.js";

describe("evals evidence discovery across run layouts", () => {
  it("finds session transcripts when the top-level transcriptPath is absent", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-evals-transcript-"));
    try {
      const transcript = join(runDir, "sessions", "pi", "agent", "root", "session", "2026-01-01T00-00-00-000Z_session.jsonl");
      await mkdir(join(transcript, ".."), { recursive: true });
      await writeFile(transcript, '{"role":"user","content":"go"}\n');
      await mkdir(join(runDir, "system-log"), { recursive: true });
      await writeFile(join(runDir, "system-log", "trajectory.jsonl"), `${JSON.stringify({ version: 1, runId: "r", timestamp: "2026-01-01T00:00:00.000Z", status: "failed", promptLength: 1, events: [] })}\n`);
      expect(await Effect.runPromise(findTranscriptPath(runDir))).toBe(transcript);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("prefers the state document's transcriptPath", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-evals-transcript-status-"));
    try {
      const fallback = join(runDir, "sessions", "pi", "agent", "root", "session", "fallback.jsonl");
      await mkdir(join(fallback, ".."), { recursive: true });
      await writeFile(fallback, '{"role":"user","content":"go"}\n');
      const top = join(runDir, "sessions", "pi", "agent", "root", "session", "real.jsonl");
      await writeFile(top, '{"role":"user","content":"go"}\n');
      await writeFile(join(runDir, "status.json"), JSON.stringify({ status: "completed", transcriptPath: top }));
      expect(await Effect.runPromise(findTranscriptPath(runDir))).toBe(top);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });

  it("resolves the run's evidence streams under system-log/", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-evals-evidence-paths-"));
    try {
      await mkdir(join(runDir, "system-log"), { recursive: true });
      for (const name of ["log.jsonl", "trace.jsonl", "trajectory.jsonl"]) {
        await writeFile(join(runDir, "system-log", name), "{}\n");
      }
      expect(await Effect.runPromise(evidencePaths(runDir))).toMatchObject({
        logPath: join(runDir, "system-log", "log.jsonl"),
        tracePath: join(runDir, "system-log", "trace.jsonl"),
        trajectoryPath: join(runDir, "system-log", "trajectory.jsonl"),
      });
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});
