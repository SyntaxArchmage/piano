import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { observationStreamPath } from "@piano/base";
import { attemptHandle, type ObservationOp } from "@piano/logging";
import {
  readResumeContext,
  readRunRow,
  splitOpsByTurns,
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
  await mkdir(join(runDir, "system-log"), { recursive: true });
  await writeFile(
    join(runDir, "system-log", "trajectory.jsonl"),
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

/** A run's op stream — what `--langfuse` recorded beside the trajectory. */
async function writeOps(root: string, runId: string, ops: readonly ObservationOp[]): Promise<void> {
  const runDir = join(root, runId);
  await mkdir(join(runDir, "system-log"), { recursive: true });
  await writeFile(
    observationStreamPath(runDir),
    ops.map((op) => `${JSON.stringify(op)}\n`).join(""),
    "utf8",
  );
}

const T = "2026-09-01T00:00:00.000Z";

/** `measure@loop/iter-0:1` → the attempt that suffix names. */
function attempt(suffix: string): { readonly invocationId: string; readonly attempt: number } {
  const split = suffix.lastIndexOf(":");
  return {
    invocationId: suffix.slice(0, split),
    attempt: Number(suffix.slice(split + 1)),
  };
}

/** The event a turn records for the attempt its facts wear. */
function attemptEvent(suffix: string, content: string): Record<string, unknown> {
  return {
    type: "message_end",
    message: { role: "assistant", content },
    workflow: attempt(suffix),
  };
}

/** Facts wear the attempt suffix their turn ran; the split attributes by it. */
function start(suffix: string): ObservationOp {
  return {
    version: 1,
    timestamp: T,
    handle: attemptHandle(attempt(suffix)),
    op: "start",
    type: "agent",
    name: `stage.attempt:${attempt(suffix).invocationId}`,
  };
}

function msgHandle(suffix: string): string {
  return `msg:0:${suffix}`;
}

function emit(handle: string, name: string): Extract<ObservationOp, { op: "emit" }> {
  return { version: 1, timestamp: T, handle, op: "emit", type: "event", name };
}

function user(suffix: string, text: string): ObservationOp {
  return { ...emit(msgHandle(suffix), "user.message"), output: { role: "user", text } };
}

function assistant(suffix: string, text: string): ObservationOp {
  return {
    version: 1,
    timestamp: T,
    handle: msgHandle(suffix),
    op: "end",
    name: "assistant.message",
    output: { role: "assistant", text },
  };
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
    ...[0, 1, 2].map(() => attemptEvent("measure@loop/iter-0:1", "first")),
    attemptEvent("measure@loop/iter-1:1", "second"),
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
      readResumeContext(root, "run-stream"),
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
      readResumeContext(root, "run-a"),
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
      readResumeContext(root, "run-b"),
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
      readResumeContext(root, "run-c"),
    );

    expect(context.turns[0]?.error).toBeUndefined();
    expect(context.turns[1]?.error).toEqual({ type: "Interrupt", message: "cancelled by user" });
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
      readResumeContext(root, "run-e"),
    );

    expect(context.turns[0]?.prompt).toBe("tune the kernel");
  });

  it("fails with a typed storage error when the trajectory is missing or malformed", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await mkdir(join(root, "run-f"), { recursive: true });
    await mkdir(join(root, "run-f", "system-log"), { recursive: true });
    await writeFile(join(root, "run-f", "system-log", "trajectory.jsonl"), "{not json\n", "utf8");

    for (const runId of ["run-f", "absent"]) {
      const exit = await Effect.runPromiseExit(
        readResumeContext(root, runId),
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
      readResumeContext(root, "run-g"),
    );

    expect(context.turns).toEqual([]);
  });

  it("attaches each turn's ops from the recorded observation stream", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await writeRun(root, "run-ops", twoTurns);
    await writeOps(root, "run-ops", [
      start("measure@loop/iter-0:1"),
      user("measure@loop/iter-0:1", "one"),
      assistant("measure@loop/iter-0:1", "first"),
      start("measure@loop/iter-1:1"),
      user("measure@loop/iter-1:1", "two"),
      assistant("measure@loop/iter-1:1", "second"),
    ]);

    const context = await Effect.runPromise(readResumeContext(root, "run-ops", { wantOps: true }));

    expect(context.turns.map((turn) => turn.ops?.map((op) => op.handle))).toEqual([
      ["attempt:measure@loop/iter-0:1", "msg:0:measure@loop/iter-0:1", "msg:0:measure@loop/iter-0:1"],
      ["attempt:measure@loop/iter-1:1", "msg:0:measure@loop/iter-1:1", "msg:0:measure@loop/iter-1:1"],
    ]);
    // The event slices stay: the non-`--langfuse` path still replays them.
    expect(context.turns[0]?.events).toHaveLength(3);
  });

  it("keeps every attempt a turn ran, however many the turn spawned", async () => {
    // A map/loop/repair turn runs several attempts and each speaks its own
    // `user.message`. The split is structural, so all of them stay in the turn
    // that spawned them instead of being counted into the next one.
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    const mapTurn = {
      ...twoTurns,
      events: [
        attemptEvent("plan@map/0:1", "plan"),
        attemptEvent("build@map/1:1", "build"),
        attemptEvent("test@map/2:1", "test"),
        attemptEvent("measure@loop/iter-1:1", "second"),
      ],
      turns: [
        { prompt: "optimize gemm", status: "completed" as const, eventCount: 3 },
        { prompt: "two", status: "completed" as const, eventCount: 4 },
      ],
    };
    await writeRun(root, "run-map", mapTurn);
    await writeOps(root, "run-map", [
      start("plan@map/0:1"), user("plan@map/0:1", "plan"),
      start("build@map/1:1"), user("build@map/1:1", "build"),
      start("test@map/2:1"), user("test@map/2:1", "test"),
      start("measure@loop/iter-1:1"), user("measure@loop/iter-1:1", "two"),
    ]);

    const context = await Effect.runPromise(readResumeContext(root, "run-map", { wantOps: true }));

    expect(context.turns.map((turn) => turn.ops?.map((op) => op.handle))).toEqual([
      [
        "attempt:plan@map/0:1", "msg:0:plan@map/0:1",
        "attempt:build@map/1:1", "msg:0:build@map/1:1",
        "attempt:test@map/2:1", "msg:0:test@map/2:1",
      ],
      ["attempt:measure@loop/iter-1:1", "msg:0:measure@loop/iter-1:1"],
    ]);
  });

  it("leaves turns on their events when a fact belongs to no turn's attempts", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await writeRun(root, "run-unpaired", twoTurns);
    await writeOps(root, "run-unpaired", [user("nobody:1", "one")]);

    const context = await Effect.runPromise(readResumeContext(root, "run-unpaired", { wantOps: true }));

    expect(context.turns[0]?.ops).toBeUndefined();
    expect(context.turns[1]?.ops).toBeUndefined();
    expect(context.turns.map((turn) => turn.events.length)).toEqual([3, 1]);
  });

  it("skips the observation stream entirely when the caller will not replay ops", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    await writeRun(root, "run-no-want", twoTurns);
    await writeOps(root, "run-no-want", [
      start("measure@loop/iter-0:1"),
      user("measure@loop/iter-0:1", "one"),
    ]);

    const context = await Effect.runPromise(readResumeContext(root, "run-no-want"));

    expect(context.turns.map((turn) => turn.ops)).toEqual([undefined, undefined]);
  });
});

describe("splitOpsByTurns", () => {
  it("attributes each fact to the attempt its handle or parent names", () => {
    const ops = [
      start("measure@loop/iter-0:1"),
      { ...emit("ctx:0:measure@loop/iter-0:1", "agent.context"), metadata: { files: 1 } },
      user("measure@loop/iter-0:1", "one"),
      assistant("measure@loop/iter-0:1", "first"),
      start("measure@loop/iter-1:1"),
      user("measure@loop/iter-1:1", "two"),
      assistant("measure@loop/iter-1:1", "second"),
    ];
    const slices = splitOpsByTurns(ops, [[attempt("measure@loop/iter-0:1")], [attempt("measure@loop/iter-1:1")]]);

    expect(slices?.map((slice) => slice.map((op) => op.handle))).toEqual([
      [
        "attempt:measure@loop/iter-0:1",
        "ctx:0:measure@loop/iter-0:1",
        "msg:0:measure@loop/iter-0:1",
        "msg:0:measure@loop/iter-0:1",
      ],
      [
        "attempt:measure@loop/iter-1:1",
        "msg:0:measure@loop/iter-1:1",
        "msg:0:measure@loop/iter-1:1",
      ],
    ]);
  });

  it("attributes a fact by its parent when the handle names no attempt", () => {
    const tool = {
      version: 1 as const,
      timestamp: T,
      handle: "tool:c1",
      op: "end" as const,
      output: "ok",
      parent: attemptHandle(attempt("measure@loop/iter-0:1")),
    };
    expect(splitOpsByTurns(
      [tool],
      [[attempt("measure@loop/iter-0:1")], [attempt("measure@loop/iter-1:1")]],
    ))?.toEqual([[tool], []]);
  });

  it("returns undefined when a fact belongs to no turn, or arrives out of turn order", () => {
    expect(splitOpsByTurns([user("nobody:1", "only")], [[attempt("a:1")]])).toBeUndefined();
    expect(splitOpsByTurns(
      [user("b:1", "early"), user("a:1", "late")],
      [[attempt("a:1")], [attempt("b:1")]],
    )).toBeUndefined();
    expect(splitOpsByTurns([user("a:1", "orphan")], [[], [attempt("b:1")]])).toBeUndefined();
    expect(splitOpsByTurns([], [])).toEqual([]);
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

    expect(await Effect.runPromise(readRunRow(join(root, "run-s")))).toMatchObject({
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

    expect(await Effect.runPromise(readRunRow(join(root, "run-legacy")))).toEqual({ runId: "run-legacy" });
    expect(await Effect.runPromise(readRunRow(join(root, "run-junk")))).toEqual({ runId: "run-junk" });
  });

  it("drops a run that recorded nothing to replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-session-resume-"));
    // A directory left by a session that was opened and closed without a
    // prompt — clutter, not history...
    await mkdir(join(root, "bare"), { recursive: true });
    // ...and a run with state but no trajectory the picker could resume.
    await writeStateRun(root, "unresumable", stateFixture());

    expect(await Effect.runPromise(readRunRow(join(root, "bare")))).toBeUndefined();
    expect(await Effect.runPromise(readRunRow(join(root, "unresumable")))).toBeUndefined();
  });
});
