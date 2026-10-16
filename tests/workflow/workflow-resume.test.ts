import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { readWorkflowExecutionContinuation } from "../../packages/orchestrator/src/workflow-resume.js";

const timestamp = "2026-08-25T00:00:00.000Z";

/** One `actor-turn` row, the shape the orchestrator appends when an actor's
 * conversation state changes. */
function turn(input: {
  actorKey: string;
  harness: string;
  worker: string;
  lane: string;
  sessionId: string;
  transcriptPath: string;
  turns: number;
  continuation?: unknown;
}) {
  return {
    version: 1,
    kind: "actor-turn",
    timestamp,
    runId: "run-1",
    jobOrdinal: 1,
    invocationId: `${input.worker}@${input.lane}`,
    attempt: 1,
    actorKey: input.actorKey,
    harness: input.harness,
    worker: input.worker,
    lane: input.lane,
    sessionId: input.sessionId,
    transcriptPath: input.transcriptPath,
    turn: input.turns,
    ...(input.continuation === undefined ? {} : { continuation: input.continuation }),
  };
}

function actor(input: {
  actorKey: string;
  harness?: string;
  worker?: string;
  lane?: string;
  sessionId: string;
  transcriptPath: string;
  turns?: number;
  continuation?: unknown;
}) {
  return turn({
    harness: input.harness ?? "pi",
    worker: input.worker ?? "plan",
    lane: input.lane ?? "root",
    turns: input.turns ?? 1,
    continuation: input.continuation ?? {
      harness: input.harness ?? "pi",
      sessionId: input.sessionId,
      transcriptPath: input.transcriptPath,
    },
    ...input,
  });
}

async function runDirWith(rows: readonly object[]): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-resume-"));
  if (rows.length > 0) {
    await writeFile(
      join(runDir, "progress.jsonl"),
      `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      "utf8",
    );
  }
  return runDir;
}

function read(runDir: string, runId: string) {
  return Effect.runPromise(
    readWorkflowExecutionContinuation(runDir, runId).pipe(Effect.provide(NodeFileSystem.layer)),
  );
}

describe("readWorkflowExecutionContinuation", () => {
  it("keeps the newest accepted turn per actor and counts the turns", async () => {
    const runDir = await runDirWith([
      actor({
        actorKey: "run-1/pi/plan",
        sessionId: "sess-old",
        transcriptPath: "/runs/run-1/plan.jsonl",
      }),
      actor({
        actorKey: "run-1/pi/plan",
        sessionId: "sess-new",
        transcriptPath: "/runs/run-1/plan-new.jsonl",
        turns: 2,
      }),
      actor({
        actorKey: "run-1/pi/build",
        worker: "build",
        sessionId: "sess-b",
        transcriptPath: "/runs/run-1/build.jsonl",
      }),
    ]);

    const continuation = await read(runDir, "run-1");

    expect(continuation?.id).toBe("run-1");
    expect(continuation?.actors.size).toBe(2);
    expect(continuation?.actors.get("run-1/pi/plan")).toEqual({
      turns: 2,
      harness: "pi",
      sessionId: "sess-new",
      transcriptPath: "/runs/run-1/plan-new.jsonl",
      continuation: { harness: "pi", sessionId: "sess-new", transcriptPath: "/runs/run-1/plan-new.jsonl" },
    });
    expect(continuation?.actors.get("run-1/pi/build")?.turns).toBe(1);
  });

  // The identity fields are what let the next prompt reopen the same
  // conversation. A reader that returned only `turns` per actor handed the
  // writer entries it then discarded for lacking an identity, so the next
  // prompt on a different workflow silently abandoned every actor the previous
  // prompt had left behind — the session was still on disk, just no longer
  // reachable.
  it("carries each actor's identity, so a rebuilt actor can reopen its session", async () => {
    const sessionId = "claude-8316eba0-7264-49f3-8804-dcd120a64a26";
    const runDir = await runDirWith([
      actor({
        actorKey: "run-1/claude/coding/root",
        harness: "claude",
        worker: "coding",
        sessionId,
        transcriptPath: "/runs/run-1/coding.jsonl",
        continuation: {
          harness: "claude",
          sessionId,
          nativeSessionId: "d8615d88-8a3a-4e61-9a01-32b6bfe483c3",
          transcriptPath: "/runs/run-1/coding.jsonl",
        },
      }),
    ]);

    const continuation = await read(runDir, "run-1");
    const resumed = continuation?.actors.get("run-1/claude/coding/root");

    expect(resumed).toMatchObject({
      harness: "claude",
      sessionId,
      transcriptPath: "/runs/run-1/coding.jsonl",
    });
    // The harness's own handle survives the round trip too: dropping it would
    // send Claude to a fresh session on the next prompt.
    expect(resumed?.continuation.nativeSessionId).toBe("d8615d88-8a3a-4e61-9a01-32b6bfe483c3");
  });

  it("ignores actors without a continuation (staged but not accepted)", async () => {
    const runDir = await runDirWith([
      actor({ actorKey: "run-1/pi/plan", sessionId: "sess-a", transcriptPath: "/t.jsonl" }),
      actor({
        actorKey: "run-1/pi/build",
        worker: "build",
        sessionId: "sess-b",
        transcriptPath: "/b.jsonl",
        continuation: undefined,
      }),
    ]);

    const continuation = await read(runDir, "run-1");

    expect([...(continuation?.actors.keys() ?? [])]).toEqual(["run-1/pi/plan"]);
  });

  it("keeps map lanes apart, since the actor key carries the lane", async () => {
    const runDir = await runDirWith([
      actor({
        actorKey: "run-1/pi/tune/0",
        worker: "tune",
        lane: "0",
        sessionId: "sess-0",
        transcriptPath: "/runs/run-1/tune-0.jsonl",
      }),
      actor({
        actorKey: "run-1/pi/tune/1",
        worker: "tune",
        lane: "1",
        sessionId: "sess-1",
        transcriptPath: "/runs/run-1/tune-1.jsonl",
      }),
    ]);

    const continuation = await read(runDir, "run-1");

    expect(continuation?.actors.get("run-1/pi/tune/0")?.continuation.sessionId).toBe("sess-0");
    expect(continuation?.actors.get("run-1/pi/tune/1")?.continuation.sessionId).toBe("sess-1");
  });

  it("returns undefined when no actors have continuations", async () => {
    const runDir = await runDirWith([
      actor({
        actorKey: "run-1/pi/plan",
        sessionId: "sess-a",
        transcriptPath: "/t.jsonl",
        continuation: undefined,
      }),
    ]);

    expect(await read(runDir, "run-1")).toBeUndefined();
  });

  it("returns undefined when the ledger holds no actor rows", async () => {
    expect(await read(await runDirWith([]), "run-1")).toBeUndefined();
  });
});
