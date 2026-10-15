import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { readWorkflowExecutionContinuation } from "../../packages/orchestrator/src/workflow-resume.js";
import type { ResumeState } from "../../packages/orchestrator/src/resume-state.js";

function resumeState(overrides: Partial<ResumeState> = {}): ResumeState {
  return {
    version: 1,
    runId: "run-1",
    promptIndex: 1,
    actors: {
      "run-1/pi/plan": { harness: "pi", sessionId: "sess-a", transcriptPath: "/runs/run-1/plan.jsonl", turns: 1, continuation: { harness: "pi", sessionId: "sess-a", transcriptPath: "/runs/run-1/plan.jsonl" } },
    },
    ...overrides,
  };
}

async function runDirWithState(state: ResumeState): Promise<string> {
  const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-resume-"));
  await writeFile(join(runDir, "resume.jsonl"), `${JSON.stringify(state)}\n`, "utf8");
  return runDir;
}

function read(runDir: string, runId: string) {
  return Effect.runPromise(
    readWorkflowExecutionContinuation(runDir, runId).pipe(Effect.provide(NodeFileSystem.layer)),
  );
}

describe("readWorkflowExecutionContinuation", () => {
  it("keeps the newest accepted turn per actor and counts the turns", async () => {
    const runDir = await runDirWithState(resumeState({
      actors: {
        "run-1/pi/plan": { harness: "pi", sessionId: "sess-new", transcriptPath: "/runs/run-1/plan-new.jsonl", turns: 2, continuation: { harness: "pi", sessionId: "sess-new", transcriptPath: "/runs/run-1/plan-new.jsonl" } },
        "run-1/pi/build": { harness: "pi", sessionId: "sess-b", transcriptPath: "/runs/run-1/build.jsonl", turns: 1, continuation: { harness: "pi", sessionId: "sess-b", transcriptPath: "/runs/run-1/build.jsonl" } },
      },
    }));

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

  // The orchestrator writes the actor table it was seeded with back on every
  // prompt. A reader that returned only `turns` per actor handed the writer
  // entries it then discarded for lacking an identity, so the next prompt on a
  // different workflow silently abandoned every actor the previous prompt had
  // left behind — the session was still on disk, just no longer reachable.
  it("carries each actor's identity, so writing the table back cannot drop it", async () => {
    const runDir = await runDirWithState(resumeState({
      actors: {
        "run-1/claude/coding/root": {
          harness: "claude",
          sessionId: "claude-8316eba0-7264-49f3-8804-dcd120a64a26",
          transcriptPath: "/runs/run-1/coding.jsonl",
          turns: 1,
          continuation: {
            harness: "claude",
            sessionId: "claude-8316eba0-7264-49f3-8804-dcd120a64a26",
            nativeSessionId: "d8615d88-8a3a-4e61-9a01-32b6bfe483c3",
            transcriptPath: "/runs/run-1/coding.jsonl",
          },
        },
      },
    }));

    const continuation = await read(runDir, "run-1");
    const actor = continuation?.actors.get("run-1/claude/coding/root");

    expect(actor).toMatchObject({
      harness: "claude",
      sessionId: "claude-8316eba0-7264-49f3-8804-dcd120a64a26",
      transcriptPath: "/runs/run-1/coding.jsonl",
    });
    // The harness's own handle survives the round trip too: dropping it would
    // send Claude to a fresh session on the next prompt.
    expect(actor?.continuation.nativeSessionId).toBe("d8615d88-8a3a-4e61-9a01-32b6bfe483c3");
  });

  it("ignores actors without a continuation (staged but not accepted)", async () => {
    const runDir = await runDirWithState(resumeState({
      actors: {
        "run-1/pi/plan": { harness: "pi", sessionId: "sess-a", transcriptPath: "/t.jsonl", turns: 1, continuation: { harness: "pi", sessionId: "sess-a", transcriptPath: "/t.jsonl" } },
        "run-1/pi/build": { harness: "pi", sessionId: "sess-b", transcriptPath: "/b.jsonl", turns: 1 },
      },
    }));

    const continuation = await read(runDir, "run-1");

    expect([...(continuation?.actors.keys() ?? [])]).toEqual(["run-1/pi/plan"]);
  });

  it("keeps map lanes apart, since the actor key carries the lane", async () => {
    const runDir = await runDirWithState(resumeState({
      actors: {
        "run-1/pi/tune/0": { harness: "pi", sessionId: "sess-0", transcriptPath: "/runs/run-1/tune-0.jsonl", turns: 1, continuation: { harness: "pi", sessionId: "sess-0", transcriptPath: "/runs/run-1/tune-0.jsonl" } },
        "run-1/pi/tune/1": { harness: "pi", sessionId: "sess-1", transcriptPath: "/runs/run-1/tune-1.jsonl", turns: 1, continuation: { harness: "pi", sessionId: "sess-1", transcriptPath: "/runs/run-1/tune-1.jsonl" } },
      },
    }));

    const continuation = await read(runDir, "run-1");

    expect(continuation?.actors.get("run-1/pi/tune/0")?.continuation.sessionId).toBe("sess-0");
    expect(continuation?.actors.get("run-1/pi/tune/1")?.continuation.sessionId).toBe("sess-1");
  });

  it("returns undefined when no actors have continuations", async () => {
    const runDir = await runDirWithState(resumeState({
      actors: {
        "run-1/pi/plan": { harness: "pi", sessionId: "sess-a", transcriptPath: "/t.jsonl", turns: 1 },
      },
    }));

    expect(await read(runDir, "run-1")).toBeUndefined();
  });

  it("returns undefined when the run has no resume.json at all", async () => {
    const empty = await mkdtemp(join(tmpdir(), "piano-workflow-resume-"));
    expect(await read(empty, "run-1")).toBeUndefined();
  });

  it("returns undefined when resume.jsonl is malformed", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-resume-"));
    await writeFile(join(runDir, "resume.jsonl"), "not valid json\n", "utf8");
    expect(await read(runDir, "run-1")).toBeUndefined();
  });

  it("fails with a typed workflow error when resume.jsonl is a directory", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-workflow-resume-"));
    await mkdir(join(runDir, "resume.jsonl"), { recursive: true });

    const exit = await Effect.runPromiseExit(
      readWorkflowExecutionContinuation(runDir, "run-1").pipe(Effect.provide(NodeFileSystem.layer)),
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error).toMatchObject({ _tag: "WorkflowError", phase: "schedule" });
    }
  });
});
