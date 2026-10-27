import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  compileWorkflow,
  loadAndExecuteWorkflow,
  parseWorkflow,
} from "../../packages/orchestrator/src/index.js";
import {
  AgentError,
  type AgentRequest,
  type AgentRunner,
} from "../../packages/harness/src/index.js";
import { settledResult } from "../common/fake-runner.js";
import { sleep } from "../common/terminal.js";

const SOURCE = "/tmp/concurrency.yml";

/** One shape with the two knobs these tests vary: the root concurrency limit
 * and whether the right branch shares the left branch's actor. */
function fanOut(options: { readonly concurrency?: number; readonly rightWorker?: string } = {}): string {
  const concurrency = options.concurrency === undefined ? "" : `  concurrency: ${options.concurrency}\n`;
  return `version: 3
workflow:
  name: concurrency-fan-out
${concurrency}  nodes:
    - stage: { name: left, worker: basic, from: [] }
    - stage: { name: right, worker: ${options.rightWorker ?? "smoke-test-agent"}, from: [] }
    - stage: { name: joined, worker: basic, from: [left, right] }
`;
}

const FAN_OUT = fanOut({ concurrency: 2 });
const SERIAL_FAN_OUT = fanOut();
const SAME_ACTOR_FAN_OUT = fanOut({ concurrency: 2, rightWorker: "basic" });

const FAIL_FAST = `version: 3
workflow:
  name: concurrency-fail-fast
  concurrency: 2
  nodes:
    - stage: { name: a, worker: basic, from: [] }
    - stage: { name: b, worker: smoke-test-agent, from: [] }
    - stage: { name: c, worker: basic, from: [] }
    - stage: { name: d, worker: basic, from: [a, b, c] }
`;

function stageId(request: AgentRequest): string {
  const matched = /workflow stage `([^`]+)`/.exec(request.prompt);
  if (matched?.[1] === undefined) throw new Error(`missing stage: ${request.prompt}`);
  return matched[1];
}

function sessionFor(stage: string) {
  return { harness: "pi", sessionId: `${stage}-session`, transcriptPath: `/tmp/${stage}.jsonl` };
}

async function run(root: string, source: string, agentRunner: AgentRunner) {
  await writeFile(join(root, "workflow.yml"), source);
  const session = await Effect.runPromise(
    createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
  return await Effect.runPromiseExit(loadAndExecuteWorkflow({
    root,
    workflowPath: join(root, "workflow.yml"),
    runDir: session.runDir,
    runId: "concurrency",
    cwd: root,
    prompt: "run",
    agentRunner,
  }).pipe(
    Effect.provideService(Logging, loggingService(session.log, session.trace)),
    Effect.provide(NodeFileSystem.layer),
  ));
}

describe("workflow concurrency", () => {
  it("parses concurrency and defaults to 1", async () => {
    const parsed = await Effect.runPromise(parseWorkflow(FAN_OUT, SOURCE));
    const compiled = await Effect.runPromise(compileWorkflow(parsed, SOURCE));
    expect(compiled.concurrency).toBe(2);

    const defaultParsed = await Effect.runPromise(parseWorkflow(SERIAL_FAN_OUT, SOURCE));
    const defaultCompiled = await Effect.runPromise(compileWorkflow(defaultParsed, SOURCE));
    expect(defaultCompiled.concurrency).toBe(1);
  });

  it("rejects a non-positive concurrency", async () => {
    const exit = await Effect.runPromiseExit(parseWorkflow(fanOut({ concurrency: 0 }), SOURCE));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("keeps serial order when concurrency is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-concurrency-serial-"));
    try {
      let leftDone = false;
      let rightSawLeftDone = false;
      const calls: string[] = [];
      const exit = await run(root, SERIAL_FAN_OUT, (request) => Effect.gen(function* () {
        const stage = stageId(request);
        calls.push(stage);
        if (stage === "left") {
          yield* Effect.promise(() => sleep(30));
          leftDone = true;
        } else if (stage === "right") {
          rightSawLeftDone = leftDone;
        }
        return yield* settledResult(request, stage, sessionFor(stage));
      }));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(rightSawLeftDone).toBe(true);
      expect(calls).toEqual(["left", "right", "joined"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("keeps same-actor stages serial even when concurrency allows", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-concurrency-actor-"));
    try {
      let leftDone = false;
      let rightSawLeftDone = false;
      const exit = await run(root, SAME_ACTOR_FAN_OUT, (request) => Effect.gen(function* () {
        const stage = stageId(request);
        if (stage === "left") {
          yield* Effect.promise(() => sleep(30));
          leftDone = true;
        } else if (stage === "right") {
          rightSawLeftDone = leftDone;
        }
        return yield* settledResult(request, stage, sessionFor(stage));
      }));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(rightSawLeftDone).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("starts independent nodes together when concurrency allows", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-concurrency-parallel-"));
    try {
      let leftDone = false;
      let releaseLeft: (() => void) | undefined;
      const leftGate = new Promise<void>((resolve) => { releaseLeft = resolve; });
      let overlapped = false;
      const calls: string[] = [];
      const exit = await run(root, FAN_OUT, (request) => Effect.gen(function* () {
        const stage = stageId(request);
        calls.push(stage);
        if (stage === "left") {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, 500); });
          yield* Effect.promise(() => Promise.race([leftGate, timeout]));
          if (timer !== undefined) clearTimeout(timer);
          leftDone = true;
        } else if (stage === "right") {
          overlapped = !leftDone;
          releaseLeft?.();
        }
        return yield* settledResult(request, stage, sessionFor(stage));
      }));
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(overlapped).toBe(true);
      expect(new Set(calls)).toEqual(new Set(["left", "right", "joined"]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("stops starting new nodes after a failure and lets the batch finish", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-concurrency-fail-"));
    try {
      const calls: string[] = [];
      let bCompleted = false;
      const exit = await run(root, FAIL_FAST, (request) => Effect.gen(function* () {
        const stage = stageId(request);
        calls.push(stage);
        if (stage === "a") {
          return yield* Effect.fail(new AgentError({ kind: "unknown", message: "a failed" }));
        }
        if (stage === "b") {
          yield* Effect.promise(() => sleep(100));
          bCompleted = true;
        }
        return yield* settledResult(request, stage, sessionFor(stage));
      }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("a failed");
      expect(bCompleted).toBe(true);
      expect(calls).toEqual(["a", "b"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
