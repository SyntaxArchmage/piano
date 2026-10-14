import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import {
  readResumeContext,
  readRunSummary,
  readRunTrajectory,
  summarizeRun,
  trajectoryReadFailed,
} from "../../packages/cli/src/session-resume.js";

async function writeRun(root: string, runId: string, document: unknown): Promise<void> {
  const runDir = join(root, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "trajectory.json"), `${JSON.stringify(document)}\n`, "utf8");
}

/** A run recorded only in its append-only stream, as every new run is. */
async function writeStreamRun(root: string, runId: string, records: readonly unknown[]): Promise<void> {
  const runDir = join(root, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    join(runDir, "trajectory.jsonl"),
    records.map((record) => `${JSON.stringify(record)}\n`).join(""),
    "utf8",
  );
}

const twoTurns = {
  version: 1 as const,
  runId: "r",
  updatedAt: "2026-09-01T00:00:00.000Z",
  status: "completed" as const,
  promptLength: 3,
  workflowPath: "/repo/recipes/workflows/basic.yaml",
  workspaceCwd: "/repo/work",
  events: [
    { type: "spawn", harness: "pi" },
    { type: "message_end", message: { role: "assistant", content: "first" } },
    { type: "done" },
    { type: "message_end", message: { role: "assistant", content: "second" } },
  ],
  turns: [
    { prompt: "one", status: "completed" as const, eventCount: 3 },
    { prompt: "two", status: "completed" as const, eventCount: 4 },
  ],
};

describe("readResumeContext", () => {
  it("replays a run recorded only in its append-only stream", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    const base = {
      version: 1,
      runId: "r",
      timestamp: "2026-09-01T00:00:00.000Z",
      status: "completed",
      promptLength: 3,
      workflowPath: "/repo/recipes/workflows/basic.yaml",
      workspaceCwd: "/repo/work",
    };
    await writeStreamRun(root, "run-stream", [
      { ...base, prompt: "one", events: twoTurns.events.slice(0, 3) },
      { ...base, prompt: "two", events: twoTurns.events.slice(3) },
    ]);

    const context = await Effect.runPromise(
      readResumeContext(root, "run-stream").pipe(Effect.provide(NodeFileSystem.layer)),
    );

    // Same replay as the equivalent document gives, down to the per-turn
    // slices — the counts are folded, not read off a stored field.
    expect(context.turns.map((turn) => turn.prompt)).toEqual(["one", "two"]);
    expect(context.turns[0]?.events).toHaveLength(3);
    expect(context.turns[1]?.events).toHaveLength(1);
    expect(context.workflowPath).toBe("/repo/recipes/workflows/basic.yaml");
    expect(context.workspaceCwd).toBe("/repo/work");
  });

  it("slices events per turn using the cumulative event count", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await writeRun(root, "run-a", twoTurns);

    const context = await Effect.runPromise(
      readResumeContext(root, "run-a").pipe(Effect.provide(NodeFileSystem.layer)),
    );

    expect(context.turns.map((turn) => turn.prompt)).toEqual(["one", "two"]);
    expect(context.turns[0]?.events).toHaveLength(3);
    expect(context.turns[1]?.events).toHaveLength(1);
    expect(context.workflowPath).toBe("/repo/recipes/workflows/basic.yaml");
    expect(context.workspaceCwd).toBe("/repo/work");
  });

  it("clamps a turn boundary that exceeds the recorded events", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await writeRun(root, "run-b", {
      ...twoTurns,
      turns: [{ prompt: "one", status: "completed", eventCount: 99 }],
    });

    const context = await Effect.runPromise(
      readResumeContext(root, "run-b").pipe(Effect.provide(NodeFileSystem.layer)),
    );

    expect(context.turns).toHaveLength(1);
    expect(context.turns[0]?.events).toHaveLength(4);
  });

  it("attaches the recorded failure to a cancelled final turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await writeRun(root, "run-c", {
      ...twoTurns,
      status: "cancelled",
      error: { type: "Interrupt", message: "cancelled by user" },
      turns: [
        { prompt: "one", status: "completed", eventCount: 3 },
        { prompt: "two", status: "cancelled", eventCount: 4 },
      ],
    });

    const context = await Effect.runPromise(
      readResumeContext(root, "run-c").pipe(Effect.provide(NodeFileSystem.layer)),
    );

    expect(context.turns[0]?.error).toBeUndefined();
    expect(context.turns[1]?.error).toEqual({ type: "Interrupt", message: "cancelled by user" });
  });

  it("degrades a run recorded before turns existed to a single turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await writeRun(root, "run-d", {
      version: 1,
      runId: "run-d",
      updatedAt: "2026-08-01T00:00:00.000Z",
      status: "completed",
      promptLength: 12,
      events: [
        { type: "message_start", message: { role: "user", content: [{ type: "text", text: "what is 2+2?" }] } },
        { type: "done" },
      ],
    });

    const context = await Effect.runPromise(
      readResumeContext(root, "run-d").pipe(Effect.provide(NodeFileSystem.layer)),
    );

    expect(context.turns).toHaveLength(1);
    expect(context.turns[0]?.prompt).toBe("what is 2+2?");
    expect(context.turns[0]?.events).toHaveLength(2);
  });

  it("strips the appended workflow stage context from a replayed prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await writeRun(root, "run-e", {
      ...twoTurns,
      turns: [{
        prompt: "tune the kernel\n\n## Workflow stage context\nYou are executing workflow stage `plan`.",
        status: "completed",
        eventCount: 4,
      }],
    });

    const context = await Effect.runPromise(
      readResumeContext(root, "run-e").pipe(Effect.provide(NodeFileSystem.layer)),
    );

    expect(context.turns[0]?.prompt).toBe("tune the kernel");
  });

  it("fails with a typed storage error when the trajectory is missing or malformed", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await mkdir(join(root, "run-f"), { recursive: true });
    await writeFile(join(root, "run-f", "trajectory.json"), "{not json\n", "utf8");

    for (const runId of ["run-f", "absent"]) {
      const exit = await Effect.runPromiseExit(
        readResumeContext(root, runId).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
        expect(exit.cause.error).toMatchObject({
          _tag: "LogsStorageError",
          operation: "read-trajectory",
          path: join(root, runId, "trajectory.json"),
        });
      }
    }
  });

  it("returns no turns for a run that recorded no events", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await writeRun(root, "run-g", { version: 1, runId: "run-g", status: "failed", events: [] });

    const context = await Effect.runPromise(
      readResumeContext(root, "run-g").pipe(Effect.provide(NodeFileSystem.layer)),
    );

    expect(context.turns).toEqual([]);
  });
});

describe("summarizeRun", () => {
  it("reduces a document to the picker row fields", () => {
    expect(summarizeRun("run-a", { ...twoTurns, name: "kernel tuning" })).toEqual({
      runId: "run-a",
      name: "kernel tuning",
      prompt: "one",
      workflow: "basic",
      workspaceCwd: "/repo/work",
      status: "completed",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("yields an id-only row when there is no document to read", () => {
    expect(summarizeRun("run-x", undefined)).toEqual({ runId: "run-x" });
  });

  it("reads the first prompt of a pre-turns document from its events", () => {
    const summary = summarizeRun("run-y", {
      version: 1,
      events: [{ type: "context", context: { userMessage: "old prompt\n\n## Workflow stage context\nstage" } }],
    });
    expect(summary.prompt).toBe("old prompt");
  });
});

describe("readRunTrajectory", () => {
  it("describes a run recorded only in its stream", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await writeStreamRun(root, "run-s", [{
      version: 1,
      runId: "run-s",
      timestamp: "2026-09-01T00:00:00.000Z",
      status: "completed",
      promptLength: 3,
      workflowPath: "/repo/recipes/workflows/basic.yaml",
      prompt: "only prompt",
      events: [{ type: "done" }],
    }]);

    const verdict = await readRunTrajectory(join(root, "run-s"));

    expect(verdict.kind).toBe("present");
    expect(summarizeRun("run-s", verdict.kind === "present" ? verdict.document : undefined))
      .toMatchObject({ prompt: "only prompt", workflow: "basic", status: "completed" });
  });

  it("calls a run with neither form absent, and keeps unparsable bytes listed", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await mkdir(join(root, "bare"), { recursive: true });
    await mkdir(join(root, "junk"), { recursive: true });
    await writeFile(join(root, "junk", "trajectory.json"), "{not json\n", "utf8");

    // Absent is the one outcome that drops a run from the picker...
    expect((await readRunTrajectory(join(root, "bare"))).kind).toBe("absent");
    // ...and unparsable bytes are not it: the run was there, so it stays.
    const junk = await readRunTrajectory(join(root, "junk"));
    expect(junk.kind).toBe("present");
    expect(junk.kind === "present" ? junk.document : "unset").toBeUndefined();
  });
});

describe("readRunSummary", () => {
  it("never fails, even for a run directory without a trajectory", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await mkdir(join(root, "bare"), { recursive: true });

    const summary = await Effect.runPromise(
      readRunSummary(root, "bare").pipe(Effect.provide(NodeFileSystem.layer)),
    );

    expect(summary).toEqual({ runId: "bare" });
  });
});

describe("trajectoryReadFailed", () => {
  it("classifies a missing file as the one unresumable outcome", () => {
    const error = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    expect(trajectoryReadFailed(error)).toEqual({ kind: "absent" });
  });

  it("keeps every other failure resumable-looking so the run stays listed", () => {
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    expect(trajectoryReadFailed(denied)).toEqual({ kind: "unreadable" });
    expect(trajectoryReadFailed(new Error("EIO"))).toEqual({ kind: "unreadable" });
    expect(trajectoryReadFailed("not an error")).toEqual({ kind: "unreadable" });
  });
});
