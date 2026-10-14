// A run is over exactly once, and every record of it has to say the same
// thing. Three of them answer "how did this end", and they are written by
// different paths at different moments: the append-only stream on the way out,
// the snapshot folded from it, and the workflow-trajectory index beside them.
// Nothing but this keeps them agreeing.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, isCancellation, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  executeWorkflow,
  loadWorkflow,
  progressRecordKind,
} from "../../packages/orchestrator/src/index.js";
import { AgentError, type AgentResult, type AgentRunner } from "../../packages/harness/src/index.js";
import { readJson, readStream } from "../common/fs.js";

const TWO_STAGE_WORKFLOW = `version: 3
workflow:
  name: outcome-consistency
  nodes:
    - stage:
        name: first
        worker: basic
        harness: pi
        from: []
    - stage:
        name: second
        worker: basic
        harness: pi
        from: [first]
`;

const SESSION = {
  harness: "pi",
  sessionId: "sess-consistent",
  transcriptPath: "/runs/consistency/actors/pi/session/sess-consistent.jsonl",
};

/** Every turn succeeds, except that `failWith` makes the very first one fail
 * with a non-retryable kind, and a signal that fires leaves it hanging until
 * the run is interrupted. */
function scriptedRunner(failWith?: "authentication"): AgentRunner {
  return (request) => {
    if (failWith !== undefined) {
      return Effect.fail(new AgentError({ kind: failWith, message: "no credentials" }));
    }
    if (request.signal !== undefined) {
      return Effect.async<AgentResult, AgentError>((resume) => {
        const abort = (): void => resume(Effect.fail(new AgentError({ kind: "cancelled", message: "interrupted" })));
        if (request.signal?.aborted) {
          abort();
          return;
        }
        request.signal?.addEventListener("abort", abort, { once: true });
        return Effect.sync(() => request.signal?.removeEventListener("abort", abort));
      });
    }
    return Effect.succeed<AgentResult>({
      ...SESSION,
      text: "done",
      continuation: { ...SESSION },
    });
  };
}

async function startRun(root: string, failWith?: "authentication") {
  await writeFile(join(root, "workflow.yml"), TWO_STAGE_WORKFLOW, "utf8");
  const session = await Effect.runPromise(
    createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
  const workflow = await Effect.runPromise(
    loadWorkflow(join(root, "workflow.yml"), root).pipe(
      Effect.provideService(Logging, loggingService(session.log, session.trace)),
      Effect.provide(NodeFileSystem.layer),
    ),
  );
  const run = (signal?: AbortSignal) => executeWorkflow(workflow, {
    runDir: session.runDir,
    cwd: root,
    prompt: "do the work",
    executionId: session.id,
    ...(signal === undefined ? {} : { signal }),
    agentRunner: scriptedRunner(failWith),
  }).pipe(
    Effect.provideService(Logging, loggingService(session.log, session.trace)),
    Effect.provide(NodeFileSystem.layer),
  );
  return { runDir: session.runDir, run };
}

/** What the three records say about the run, side by side. */
async function outcomeOf(runDir: string) {
  const stream = await readStream(runDir, "progress.jsonl");
  const last = stream.at(-1) ?? {};
  const snapshot = await readJson(join(runDir, "progress.json"));
  const index = await readJson(join(runDir, "trajectories", "index.json"));
  return {
    streamEnd: { kind: progressRecordKind(last), status: last.status },
    snapshot: snapshot.status,
    index: index.status,
    // How many recorder streams the run left open. A finished run leaves none:
    // an open one is what a later reader would take for "still going".
    openStreams: (Array.isArray(index.streams) ? index.streams : [])
      .filter((stream) => (stream as { status?: string }).status === "running").length,
  };
}

describe("a run's outcome is recorded the same way everywhere", () => {
  it("agrees on success", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-outcome-"));
    try {
      const { runDir, run } = await startRun(root);
      const result = await Effect.runPromise(run());
      expect(result.stages).toHaveLength(2);

      expect(await outcomeOf(runDir)).toEqual({
        streamEnd: { kind: "execution-finished", status: "completed" },
        snapshot: "completed",
        index: "completed",
        openStreams: 0,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("agrees on failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-outcome-"));
    try {
      const { runDir, run } = await startRun(root, "authentication");
      const exit = await Effect.runPromise(Effect.exit(run()));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(await outcomeOf(runDir)).toEqual({
        streamEnd: { kind: "execution-finished", status: "failed" },
        snapshot: "failed",
        index: "failed",
        openStreams: 0,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("agrees on a human interrupt", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-outcome-"));
    try {
      const { runDir, run } = await startRun(root);
      const controller = new AbortController();
      const fiber = Effect.runFork(run(controller.signal));
      await Effect.runPromise(Effect.sleep(50));
      controller.abort();
      const exit = await Effect.runPromise(Fiber.await(fiber));

      expect(Exit.isFailure(exit) && isCancellation(exit.cause)).toBe(true);
      // A pause, not a failure: the next prompt continues this run.
      expect(await outcomeOf(runDir)).toEqual({
        streamEnd: { kind: "execution-finished", status: "paused" },
        snapshot: "paused",
        index: "cancelled",
        openStreams: 0,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
