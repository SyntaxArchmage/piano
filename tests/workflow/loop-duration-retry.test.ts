import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  compileWorkflow,
  loadAndExecuteWorkflow,
  parseWorkflow,
  retryBackoffSeconds,
  RETRY_DEFAULT_BACKOFF_MAX_SECONDS,
  RETRY_DEFAULT_BACKOFF_SECONDS,
  type WorkflowDocument,
} from "../../packages/orchestrator/src/index.js";
import { AgentError, type AgentRequest } from "../../packages/harness/src/index.js";
import type { FileSystem } from "@effect/platform";

/** Both bounds in one region. The parser must refuse it rather than pick one:
 * "whichever comes first" is never what an author wrote. */
const BOTH_BOUNDS = `version: 3
workflow:
  name: both-bounds
  nodes:
    - loop:
        name: tune
        from: []
        entry: work
        exit: work
        iterations: 3
        duration: 60
        nodes:
          - stage:
              name: work
              worker: basic
              from: []
`;

/** Neither bound. A loop without one cannot terminate. */
const NO_BOUND = `version: 3
workflow:
  name: no-bound
  nodes:
    - loop:
        name: tune
        from: []
        entry: work
        exit: work
        nodes:
          - stage:
              name: work
              worker: basic
              from: []
`;

/** A duration-bound loop whose single stage is both entry and exit, so one
 * iteration is exactly one worker turn. */
function durationLoop(seconds: number): string {
  return `version: 3
workflow:
  name: duration-loop
  nodes:
    - loop:
        name: tune
        from: []
        entry: work
        exit: work
        duration: ${seconds}
        nodes:
          - stage:
              name: work
              worker: basic
              from: []
`;
}

function retryStage(retry: string): string {
  return `version: 3
workflow:
  name: retry-stage
  nodes:
    - stage:
        name: write
        worker: basic
        retry:
${retry}
        from: []
`;
}

async function parse(text: string): Promise<Exit.Exit<WorkflowDocument, unknown>> {
  return Effect.runPromiseExit(parseWorkflow(text, "/tmp/workflow.yml"));
}

async function compile(text: string) {
  const parsed = await parse(text);
  if (!Exit.isSuccess(parsed)) throw new Error("parse failed unexpectedly");
  return Effect.runPromise(compileWorkflow(parsed.value, "/tmp/workflow.yml"));
}

/** The message a failed parse or compile produced, for asserting on the reason
 * rather than only on "it failed". */
function failureText(exit: Exit.Exit<unknown, unknown>): string {
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) return "";
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) return JSON.stringify(exit.cause);
  const value = failure.value as { readonly message?: string };
  return value.message ?? String(failure.value);
}

/** A harness continuation for a fake turn. The engine reopens the same actor
 * session across loop iterations, so a runner that omits it is refused. */
function continuation(sessionId: string) {
  return { harness: "pi" as const, sessionId, transcriptPath: `/tmp/${sessionId}.jsonl` };
}

async function testSession(root: string) {
  return Effect.runPromise(
    createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
}

function runWorkflow<A>(
  session: Awaited<ReturnType<typeof testSession>>,
  effect: Effect.Effect<A, unknown, Logging | FileSystem.FileSystem>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.provideService(Logging, loggingService(session.log, session.trace)),
    Effect.provide(NodeFileSystem.layer),
  ));
}

describe("loop bound", () => {
  it("refuses a loop that declares both iterations and duration", async () => {
    const text = failureText(await parse(BOTH_BOUNDS));
    expect(text).toContain("both iterations and duration");
  });

  it("refuses a loop that declares neither bound", async () => {
    const text = failureText(await parse(NO_BOUND));
    expect(text).toContain("no bound");
  });

  it("refuses a non-positive or non-finite duration", async () => {
    // A zero or negative duration is a loop that cannot be what its author
    // meant, and a fractional one is legal (a test relies on it), so the bound
    // is "finite and positive", not "a positive integer".
    for (const value of ["0", "-1", "0.0"]) {
      const text = failureText(await parse(durationLoop(Number(value))));
      expect(text).toContain("must be a positive number");
    }
  });

  it("carries duration into the region plan without an iteration count", async () => {
    const compiled = await compile(durationLoop(90));
    const region = compiled.regions.find((candidate) => candidate.name === "tune");
    expect(region?.duration).toBe(90);
    // No denominator is invented for a region whose length is decided at run
    // time, so importers can tell the two bounds apart.
    expect(region?.iterations).toBeUndefined();
  });

  it("still compiles an iterations loop unchanged", async () => {
    const compiled = await compile(BOTH_BOUNDS.replace("        duration: 60\n", ""));
    const region = compiled.regions.find((candidate) => candidate.name === "tune");
    expect(region?.iterations).toBe(3);
    expect(region?.duration).toBeUndefined();
  });
});

describe("stage retry", () => {
  it("accepts an empty policy and an explicit one", async () => {
    const bare = await compile(retryStage("          {}"));
    expect(bare.stages[0]?.stage.retry).toEqual({});
    const explicit = await compile(retryStage(
      "          attempts: unbounded\n          backoff: 5\n          backoffMax: 60",
    ));
    expect(explicit.stages[0]?.stage.retry).toEqual({ attempts: "unbounded", backoff: 5, backoffMax: 60 });
  });

  it("refuses a policy that cannot be honoured", async () => {
    // A typo in `attempts` must not quietly become "unbounded".
    expect(failureText(await parse(retryStage("          attempts: always"))))
      .toContain("stage.retry.attempts must be a positive integer");
    // Zero retries is spelled by omitting `retry`, so zero is refused rather
    // than silently read as "no retry".
    expect(failureText(await parse(retryStage("          attempts: 0"))))
      .toContain("stage.retry.attempts must be a positive integer");
    expect(failureText(await parse(retryStage("          wait: 5"))))
      .toContain('unknown field "wait" in stage.retry');
    // A cap below the base would make the schedule non-monotonic.
    expect(failureText(await parse(retryStage(
      "          backoff: 60\n          backoffMax: 5",
    )))).toContain("backoffMax must not be smaller");
  });
});

describe("retryBackoffSeconds", () => {
  it("allows no retry at all when the stage declares no policy", () => {
    expect(retryBackoffSeconds(undefined, 0)).toBeUndefined();
  });

  it("uses policy defaults when the policy is an empty object", () => {
    // The defaults are the ones a long unattended run needs: far longer than
    // the harness's own 5s/20s floor, because this layer runs after it.
    expect(retryBackoffSeconds({}, 0)).toBe(RETRY_DEFAULT_BACKOFF_SECONDS);
    expect(retryBackoffSeconds({}, 10)).toBe(RETRY_DEFAULT_BACKOFF_MAX_SECONDS);
  });

  it("doubles the wait and then holds it at the cap", () => {
    const policy = { backoff: 30, backoffMax: 300 } as const;
    expect(retryBackoffSeconds(policy, 0)).toBe(30);
    expect(retryBackoffSeconds(policy, 1)).toBe(60);
    expect(retryBackoffSeconds(policy, 2)).toBe(120);
    expect(retryBackoffSeconds(policy, 3)).toBe(240);
    expect(retryBackoffSeconds(policy, 4)).toBe(300);
    // Stays capped, and never reaches Infinity even far into a long run.
    expect(retryBackoffSeconds(policy, 40)).toBe(300);
  });

  it("stops after a finite budget and never stops when unbounded", () => {
    expect(retryBackoffSeconds({ attempts: 2, backoff: 1, backoffMax: 1 }, 0)).toBe(1);
    expect(retryBackoffSeconds({ attempts: 2, backoff: 1, backoffMax: 1 }, 1)).toBe(1);
    expect(retryBackoffSeconds({ attempts: 2, backoff: 1, backoffMax: 1 }, 2)).toBeUndefined();
    expect(retryBackoffSeconds({ attempts: "unbounded" }, 500)).toBe(RETRY_DEFAULT_BACKOFF_MAX_SECONDS);
  });
});

describe("duration-bound loop execution", () => {
  it("runs at least one iteration and stops when the duration elapses", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-duration-loop-"));
    try {
      await writeFile(join(root, "duration.yml"), durationLoop(0.25));
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "duration.yml"),
        runDir: session.runDir,
        runId: "duration",
        cwd: root,
        prompt: "keep working",
        agentRunner: (request) => Effect.promise(async () => {
          calls.push(request);
          // Slow enough that the deadline lands in the middle of a round, so
          // the test also proves the bound is sampled between iterations
          // rather than only checked before the first.
          await new Promise((resolve) => setTimeout(resolve, 100));
          const sessionId = `s-${calls.length}`;
          return {
            sessionId,
            transcriptPath: `/tmp/${sessionId}.jsonl`,
            text: "round done",
            continuation: continuation(sessionId),
          };
        }),
      }));
      // The bound is what ends the test: an unbounded loop would never return.
      expect(calls.length).toBeGreaterThanOrEqual(1);
      // ~0.25s of 100ms rounds is three rounds. The ceiling is slack, not the
      // assertion — the point is that the loop stopped near its duration
      // instead of running to a count.
      expect(calls.length).toBeLessThanOrEqual(8);
      expect(result.stages).toHaveLength(calls.length);
      // Every accepted stage belongs to the same region, one per iteration.
      expect(new Set(result.stages.map((stage) => stage.stageId))).toEqual(new Set(["tune.work"]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("keeps the progress denominator ahead of the numerator while the loop is open", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-duration-progress-"));
    try {
      await writeFile(join(root, "duration.yml"), durationLoop(0.25));
      const session = await testSession(root);
      const snapshots: Array<{ plannedStages: number; completedStages: number; stageCounts: Record<string, { planned: number; completed: number }> }> = [];
      await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "duration.yml"),
        runDir: session.runDir,
        runId: "duration-progress",
        cwd: root,
        prompt: "keep working",
        agentRunner: (_request) => Effect.promise(async () => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          // Read the snapshot the engine just wrote for the previous round.
          // `logging/static-analysis.ts` rejects a snapshot whose completed
          // count exceeds its planned count, so an unknown-length loop must
          // grow its denominator rather than divide by one iteration.
          try {
            snapshots.push(JSON.parse(await readFile(join(session.runDir, "status.json"), "utf8")));
          } catch {
            // The first attempt may run before any snapshot exists.
          }
          const sessionId = `p-${snapshots.length}-${Math.random()}`;
          return {
            sessionId,
            transcriptPath: `/tmp/${sessionId}.jsonl`,
            text: "round done",
            continuation: continuation(sessionId),
          };
        }),
      }));
      expect(snapshots.length).toBeGreaterThan(0);
      for (const snapshot of snapshots) {
        expect(snapshot.completedStages).toBeLessThanOrEqual(snapshot.plannedStages);
        for (const count of Object.values(snapshot.stageCounts)) {
          expect(count.completed).toBeLessThanOrEqual(count.planned);
        }
      }
      // With more than one round the denominator must have grown past its
      // initial single-iteration value, which is the behaviour under test.
      if (snapshots.length > 1) {
        const last = snapshots.at(-1)!;
        expect(last.stageCounts["tune.work"]?.planned).toBeGreaterThan(1);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("stage retry execution", () => {
  it("retries a failed attempt until it succeeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-stage-retry-"));
    try {
      // One second of backoff, twice: the test spends two seconds to prove a
      // run that would otherwise have died carries on.
      await writeFile(join(root, "retry.yml"), retryStage(
        "          attempts: 3\n          backoff: 1\n          backoffMax: 1",
      ));
      const session = await testSession(root);
      const calls: AgentRequest[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "retry.yml"),
        runDir: session.runDir,
        runId: "retry",
        cwd: root,
        prompt: "write something",
        agentRunner: (request) => Effect.suspend(() => {
          calls.push(request);
          if (calls.length <= 2) {
            return Effect.fail(new AgentError({ kind: "harness-unavailable", message: `gateway down (${calls.length})` }));
          }
          return Effect.succeed({
            sessionId: "retry-session",
            transcriptPath: "/tmp/retry-session.jsonl",
            text: "written",
            continuation: continuation("retry-session"),
          });
        }),
      }));
      expect(calls).toHaveLength(3);
      expect(result.stages).toHaveLength(1);
      // The retries belong to the same actor, so a resumed session is reused
      // rather than the run fanning out into unrelated conversations.
      expect(new Set(calls.map((call) => call.sessionDir))).toHaveLength(1);
      const log = await readFile(join(session.runDir, "log.jsonl"), "utf8");
      const scheduled = log.split("\n")
        .filter((line) => line.includes("stage.retry.scheduled"))
        .map((line) => JSON.parse(line) as { attributes?: { delayMs?: number; retry?: number } });
      expect(scheduled).toHaveLength(2);
      expect(scheduled.map((entry) => entry.attributes?.retry)).toEqual([1, 2]);
      expect(scheduled.map((entry) => entry.attributes?.delayMs)).toEqual([1000, 1000]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("still fails when the policy runs out", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-stage-retry-exhausted-"));
    try {
      await writeFile(join(root, "retry.yml"), retryStage(
        "          attempts: 1\n          backoff: 1\n          backoffMax: 1",
      ));
      const session = await testSession(root);
      let calls = 0;
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "retry.yml"),
        runDir: session.runDir,
        runId: "retry-exhausted",
        cwd: root,
        prompt: "write something",
        agentRunner: () => Effect.suspend(() => {
          calls += 1;
          // `harness-unavailable` is retryable at the harness boundary, so the
          // only thing that can stop this is the stage's own budget — which is
          // what makes it a fair test of exhaustion.
          return Effect.fail(new AgentError({ kind: "harness-unavailable", message: "gateway down" }));
        }),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      // One initial attempt plus one retry, then the real error surfaces
      // instead of the run hanging.
      expect(calls).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("does not retry a stage that declares no policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-stage-no-retry-"));
    try {
      await writeFile(join(root, "plain.yml"), `version: 3
workflow:
  name: plain
  nodes:
    - stage:
        name: write
        worker: basic
        from: []
`);
      const session = await testSession(root);
      let calls = 0;
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root,
        workflowPath: join(root, "plain.yml"),
        runDir: session.runDir,
        runId: "plain",
        cwd: root,
        prompt: "write something",
        agentRunner: () => Effect.suspend(() => {
          calls += 1;
          return Effect.fail(new AgentError({ kind: "harness-unavailable", message: "gateway down" }));
        }),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      // The harness's own retry floor is 5s/20s; this assertion is about the
      // *stage* not adding a third attempt on top of it.
      expect(calls).toBeLessThanOrEqual(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
