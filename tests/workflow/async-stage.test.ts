import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeFileSystem } from "@effect/platform-node";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  loadAndExecuteWorkflow,
} from "../../packages/orchestrator/src/index.js";
import { AsyncStageQueue } from "../../packages/orchestrator/src/async-stage-queue.js";
import type { InternalStageResult } from "../../packages/orchestrator/src/execution-types.js";
import { AgentError, type AgentRequest } from "../../packages/harness/src/index.js";
import { validationResultPathFromPrompt } from "../common/validation-path.mjs";

const RECIPE_ROOT = fileURLToPath(new URL("../fixtures/workflow-recipes", import.meta.url));

const WORKFLOW = `version: 3
workflow:
  name: async-profile
  nodes:
    - loop:
        name: tune
        from: []
        entry: profile
        exit: measure
        iterations: 2
        nodes:
          - stage:
              name: profile
              worker: test-profile
              from: []
              async: true
          - stage:
              name: measure
              worker: test-round
              from: [profile]
`;

function stageId(request: AgentRequest): string {
  const matched = /workflow stage `([^`]+)`/.exec(request.prompt);
  if (matched?.[1] === undefined) throw new Error(`missing stage: ${request.prompt}`);
  return matched[1];
}

describe("async stage queue", () => {
  it("delivers a ready result to every direct consumer exactly once", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-async-queue-"));
    try {
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const queue = new AsyncStageQueue();
      const fake = { stageId: "profile", acceptance: { id: "inv-1" } } as unknown as InternalStageResult;
      await Effect.runPromise(Effect.gen(function* () {
        yield* queue.submit({
          stageId: "profile",
          consumers: ["measure", "implement"],
          run: Effect.succeed(fake),
        });
        yield* queue.idle();
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      const measureFirst = await Effect.runPromise(queue.consume(["profile"], "measure"));
      const implement = await Effect.runPromise(queue.consume(["profile"], "implement"));
      const measureAgain = await Effect.runPromise(queue.consume(["profile"], "measure"));
      expect(measureFirst).toHaveLength(1);
      expect(implement).toHaveLength(1);
      expect(measureAgain).toHaveLength(0);
      await Effect.runPromise(queue.shutdown());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("starts downstream without a pending profile and collects it in the next iteration", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-async-stage-"));
    try {
      const workflowPath = join(root, "workflow.yml");
      await writeFile(workflowPath, WORKFLOW);
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const prompts: string[] = [];
      const measurePrompts: string[] = [];
      let measureCount = 0;
      let releaseProfile: (() => void) | undefined;
      const profileGate = new Promise<void>((resolve) => { releaseProfile = resolve; });
      let profileStarted: (() => void) | undefined;
      const profileStartedGate = new Promise<void>((resolve) => { profileStarted = resolve; });

      const result = await Effect.runPromise(loadAndExecuteWorkflow({
        root,
        workflowPath,
        recipeRepositoryRoot: RECIPE_ROOT,
        runDir: session.runDir,
        runId: "async-profile",
        cwd: root,
        prompt: "tune the kernel",
        agentRunner: (request) => Effect.promise(async () => {
          const stage = stageId(request);
          prompts.push(request.prompt);
          const resultPath = validationResultPathFromPrompt(request.prompt);
          if (resultPath === undefined) throw new Error("missing result path");
          await mkdir(dirname(resultPath), { recursive: true });
          if (stage === "tune.profile") {
            profileStarted?.();
            await profileGate;
            await writeFile(resultPath, JSON.stringify({
              status: "ready",
              target_operator: "kernel:run",
              device: { name: "GPU", architecture: "sm_86" },
              analysis: "async profile",
            }));
          } else {
            measureCount += 1;
            measurePrompts.push(request.prompt);
            if (measureCount === 1) {
              releaseProfile?.();
              // Let the queued profile acceptance land before the next
              // iteration asks for a handoff.
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            await writeFile(resultPath, JSON.stringify({
              decision: "DISCARD",
              iteration: measureCount - 1,
              hypothesis: "hold",
            }));
          }
          return {
            sessionId: `${stage}-${measureCount}`,
            transcriptPath: `/tmp/${stage}-${measureCount}.jsonl`,
            text: stage,
            continuation: {
              harness: "pi",
              sessionId: `${stage}-${measureCount}`,
              transcriptPath: `/tmp/${stage}-${measureCount}.jsonl`,
            },
          };
        }),
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));

      await profileStartedGate;
      expect(measurePrompts).toHaveLength(2);
      expect(measurePrompts[0]).toContain("Pending asynchronous upstream stages");
      expect(measurePrompts[0]).not.toContain("inputs.json");
      expect(measurePrompts[1]).toContain("inputs.json");
      expect(prompts.some((prompt) => prompt.includes("Pending asynchronous upstream stages"))).toBe(true);
      expect(prompts.some((prompt) => prompt.includes("inputs.json"))).toBe(true);
      const invocations = (await readFile(
        join(session.runDir, "system-log", "invocations.jsonl"),
        "utf8",
      )).trim().split("\n").map((line) => JSON.parse(line) as { kind?: string; worker?: string });
      expect(invocations.some((row) => row.kind === "invocation-accepted" && row.worker === "test-profile")).toBe(true);
      expect(result.stages.some((stage) => stage.stageId === "tune.profile")).toBe(false);
      expect(result.stages.some((stage) => stage.stageId === "tune.measure")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("fails the run when an async stage fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-async-failure-"));
    try {
      const workflowPath = join(root, "workflow.yml");
      await writeFile(workflowPath, WORKFLOW);
      const session = await Effect.runPromise(
        createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
      );
      const exit = await Effect.runPromiseExit(loadAndExecuteWorkflow({
        root,
        workflowPath,
        recipeRepositoryRoot: RECIPE_ROOT,
        runDir: session.runDir,
        runId: "async-failure",
        cwd: root,
        prompt: "tune the kernel",
        agentRunner: (request) => {
          const stage = stageId(request);
          if (stage === "tune.profile") {
            return Effect.fail(new AgentError({ kind: "unknown", message: "async profile failed" }));
          }
          return Effect.promise(async () => {
            const resultPath = validationResultPathFromPrompt(request.prompt);
            if (resultPath === undefined) throw new Error("missing result path");
            await mkdir(dirname(resultPath), { recursive: true });
            await writeFile(resultPath, JSON.stringify({
              decision: "DISCARD",
              iteration: 0,
              hypothesis: "hold",
            }));
            return {
              sessionId: "measure",
              transcriptPath: "/tmp/measure.jsonl",
              text: "measure",
              continuation: { harness: "pi", sessionId: "measure", transcriptPath: "/tmp/measure.jsonl" },
            };
          });
        },
      }).pipe(
        Effect.provideService(Logging, loggingService(session.log, session.trace)),
        Effect.provide(NodeFileSystem.layer),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.pretty(exit.cause)).toContain("async profile failed");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
