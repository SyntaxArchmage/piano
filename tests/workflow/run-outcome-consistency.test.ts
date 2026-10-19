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

/** Two terminals in one scope, declared in an order that disagrees with the
 * dependency order: `summary` is declared first but depends on `work`, which is
 * declared last. A run's final result is the terminal that finished last, not
 * the one declared last. */
const TWO_TERMINAL_WORKFLOW = `version: 3
workflow:
  name: two-terminals
  nodes:
    - stage:
        name: summary
        worker: basic
        harness: pi
        from: [work]
    - stage:
        name: side
        worker: basic
        harness: pi
        from: []
    - stage:
        name: work
        worker: basic
        harness: pi
        from: []
`;

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

async function startRun(root: string, failWith?: "authentication", source = TWO_STAGE_WORKFLOW) {
  await writeFile(join(root, "workflow.yml"), source, "utf8");
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
    runId: session.id,
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
  const snapshot = await readJson(join(runDir, "status.json"));
  return {
    streamEnd: { kind: progressRecordKind(last), status: last.status },
    snapshot: snapshot.status,
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
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("a run's final result is its last-finished terminal", () => {
  it("does not fall back to the last-declared one when a scope has two terminals", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-outcome-"));
    try {
      const { run } = await startRun(root, undefined, TWO_TERMINAL_WORKFLOW);
      const result = await Effect.runPromise(run());

      // `side` is declared before `work`, so it is the last *declared*
      // terminal; `summary` waits on `work` and finishes after it. The run
      // reports the one that finished last, in finishing order.
      expect(result.terminalStages.map((stage) => stage.stage)).toEqual(["side", "summary"]);
      expect(result.stage).toBe("summary");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
