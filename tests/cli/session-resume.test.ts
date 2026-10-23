import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import {
  readResumeContext,
  readRunRow,
  summarizeRun,
} from "../../packages/cli/src/session-resume.js";

/** Write a run as the stream its readers fold: one record per turn, carrying
 * the events that turn owns. The document form is gone; a fixture shaped like
 * one still expresses the run exactly, down to the cumulative counts. */
async function writeRun(root: string, runId: string, document: Record<string, unknown>): Promise<void> {
  const events = (document.events as unknown[] | undefined) ?? [];
  const turns = (document.turns as Array<{ prompt: string; status: string; eventCount: number }> | undefined) ?? [];
  const scalars = Object.fromEntries(Object.entries(document).filter(([key]) => !["events", "turns", "runId", "updatedAt"].includes(key)));
  const records: Array<Record<string, unknown>> = [];
  let start = 0;
  let second = 0;
  for (const turn of turns) {
    records.push({
      ...scalars,
      runId: document.runId,
      timestamp: `${String(second).padStart(2, "0")}s` === "" ? "" : `2026-09-01T00:00:${String(second).padStart(2, "0")}.000Z`,
      prompt: turn.prompt,
      status: turn.status,
      events: events.slice(start, turn.eventCount),
    });
    start = turn.eventCount;
    second += 1;
  }
  if (turns.length === 0) {
    records.push({ ...scalars, runId: document.runId, timestamp: "2026-09-01T00:00:00.000Z", events });
  }
  await writeStreamRun(root, runId, records);
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

/** A run's state document, the picker row's source. */
async function writeStateRun(root: string, runId: string, status: unknown): Promise<void> {
  const runDir = join(root, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "status.json"), `${JSON.stringify(status)}\n`, "utf8");
}

/** The state a finished two-turn run records: the fields the row projects. */
function stateFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: "r",
    updatedAt: "2026-09-01T00:00:00.000Z",
    status: "completed",
    promptLength: 3,
    workflowPath: "/repo/recipes/workflows/basic.yaml",
    workspaceCwd: "/repo/work",
    turns: [
      { prompt: "one", status: "completed", eventCount: 3 },
      { prompt: "two", status: "completed", eventCount: 4 },
    ],
    ...overrides,
  };
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
    await writeFile(join(root, "run-f", "trajectory.jsonl"), "{not json\n", "utf8");

    for (const runId of ["run-f", "absent"]) {
      const exit = await Effect.runPromiseExit(
        readResumeContext(root, runId).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
        expect(exit.cause.error).toMatchObject({
          _tag: "LogsStorageError",
          operation: "read-trajectory",
          path: join(root, runId, "system-log", "trajectory.jsonl"),
        });
      }
    }
  });

  it("returns no turns for a run that recorded no events", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await writeRun(root, "run-g", { version: 1, runId: "run-g", status: "failed", promptLength: 0, events: [] });

    const context = await Effect.runPromise(
      readResumeContext(root, "run-g").pipe(Effect.provide(NodeFileSystem.layer)),
    );

    expect(context.turns).toEqual([]);
  });
});

describe("summarizeRun", () => {
  it("reduces a state document to the picker row fields", () => {
    expect(summarizeRun("run-a", { ...stateFixture(), name: "kernel tuning" })).toEqual({
      runId: "run-a",
      name: "kernel tuning",
      prompt: "one",
      workflow: "basic",
      workspaceCwd: "/repo/work",
      status: "completed",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("yields an id-only row when there is no state to read", () => {
    expect(summarizeRun("run-x", undefined)).toEqual({ runId: "run-x" });
  });
});

describe("readRunRow", () => {
  it("reads the row from the run's state document", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await writeStreamRun(root, "run-s", [{
      version: 1,
      runId: "run-s",
      timestamp: "2026-09-01T00:00:00.000Z",
      status: "completed",
      promptLength: 3,
      prompt: "only prompt",
      events: [{ type: "done" }],
    }]);
    await writeStateRun(root, "run-s", stateFixture({
      turns: [{ prompt: "only prompt", status: "completed", eventCount: 1 }],
    }));

    expect(await readRunRow(join(root, "run-s"))).toMatchObject({
      prompt: "only prompt",
      workflow: "basic",
      status: "completed",
    });
  });

  it("keeps a run whose state document does not describe it as an id-only row", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    // Evidence of a run is enough to keep it listed; what the row can say
    // about it comes from the state document, and a run that predates one —
    // or whose state document will not parse — keeps only its id.
    await writeStreamRun(root, "run-legacy", [{ version: 1, runId: "run-legacy", timestamp: "2026-09-01T00:00:00.000Z", status: "completed", events: [] }]);
    await writeRun(root, "run-junk", { version: 1, runId: "run-junk" });
    await writeStateRun(root, "run-junk", "{not json\n");

    expect(await readRunRow(join(root, "run-legacy"))).toEqual({ runId: "run-legacy" });
    expect(await readRunRow(join(root, "run-junk"))).toEqual({ runId: "run-junk" });
  });

  it("drops a run that recorded nothing to replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    // A directory left by a session that was opened and closed without a
    // prompt — clutter, not history...
    await mkdir(join(root, "bare"), { recursive: true });
    // ...and a run with state but no trajectory the picker could resume.
    await writeStateRun(root, "unresumable", stateFixture());

    expect(await readRunRow(join(root, "bare"))).toBeUndefined();
    expect(await readRunRow(join(root, "unresumable"))).toBeUndefined();
  });
});
