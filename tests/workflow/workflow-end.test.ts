// The workflow-END contract, isolated: a scripted-harness workflow RESOLVES —
// and its progress ledger reports completed — exactly when its last worker
// has finished, for the three shapes the user hits: one worker, fan-out
// (multi worker), and a loop. Where the big suite pins per-shape mechanics
// (ordering, inputs, iteration actors), these tests pin only the end: the
// effect settles, every planned worker ran exactly once, and the state
// document lands at completedStages === plannedStages. A workflow that "never
// ends after all workers finish" fails here.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  executeWorkflow,
  loadAndExecuteWorkflow,
  loadWorkflow,
} from "../../packages/orchestrator/src/index.js";
import type { AgentRequest } from "../../packages/harness/src/index.js";
import { validationResultPathFromPrompt } from "../common/validation-path.mjs";

const ONE_WORKER_WORKFLOW = `version: 3
workflow:
  name: end-single
  nodes:
    - stage:
        name: respond
        worker: basic
        from: []
`;

const FAN_OUT_WORKFLOW = `version: 3
workflow:
  name: end-fan-out
  nodes:
    - stage:
        name: left
        worker: basic
        from: []
    - stage:
        name: right
        worker: basic
        from: []
    - stage:
        name: joined
        worker: basic
        from: [left, right]
`;


const EARLY_STOP_LOOP_WORKFLOW = `version: 3
workflow:
  name: end-loop-on-contract-stop
  nodes:
    - stage:
        name: seed
        worker: stop-feedback
        from: []
    - loop:
        name: tune
        from: [seed]
        feedback: report
        entry: propose
        exit: report
        iterations: 3
        nodes:
          - stage:
              name: propose
              worker: stop-feedback
              from: []
          - stage:
              name: report
              worker: stop-feedback
              from: [propose]
    - stage:
        name: summary
        worker: stop-feedback
        from: [tune]
`;

const STOP_FEEDBACK_CONTRACT = {
  schema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      next_action: { enum: ["continue", "stop"] },
    },
    required: ["next_action"],
    additionalProperties: false,
  },
  example: { next_action: "stop" },
  outputs: {
    metrics: [],
    projections: [{
      id: "workflow.loop-control",
      pointer: "/next_action",
      format: "string",
      required: true,
    }],
  },
};

const LOOP_WORKFLOW = `version: 3
workflow:
  name: end-loop
  nodes:
    - stage:
        name: seed
        worker: basic
        from: []
    - loop:
        name: tune
        from: [seed]
        entry: propose
        exit: report
        iterations: 3
        nodes:
          - stage:
              name: propose
              worker: basic
              from: []
          - stage:
              name: report
              worker: smoke-test-agent
              from: [propose]
`;

function stageId(request: AgentRequest): string {
  const matched = /workflow stage `([^`]+)`/.exec(request.prompt);
  if (matched?.[1] === undefined) throw new Error(`missing workflow stage context: ${request.prompt}`);
  return matched[1];
}

function validationPath(request: AgentRequest): string {
  const path = validationResultPathFromPrompt(request.prompt);
  if (path === undefined) throw new Error(`missing validation result path: ${request.prompt}`);
  return path;
}

async function testSession(root: string) {
  return await Effect.runPromise(
    createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
}

function runWorkflow<A>(session: Awaited<ReturnType<typeof testSession>>, effect: Effect.Effect<A, unknown, Logging | import("@effect/platform").FileSystem.FileSystem>): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.provideService(Logging, loggingService(session.log, session.trace)),
    Effect.provide(NodeFileSystem.layer),
  ));
}

/** The end-of-run ledger every shape must reach: completed, fully planned,
 * zero remaining. Read after the execution effect has ALREADY resolved — the
 * point of this suite is that resolution happens at all, then that it is
 * honest. */
async function readFinalProgress(runDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(runDir, "status.json"), "utf8")) as Record<string, unknown>;
}

describe("workflow ends when its scripted workers finish", () => {
  it("resolves after the single worker, progress completed", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-end-single-"));
    try {
      await writeFile(join(root, "one.yml"), ONE_WORKER_WORKFLOW);
      const session = await testSession(root);
      const stages: string[] = [];
      const result = await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "one.yml"), runDir: session.runDir, runId: "end-single", cwd: root, prompt: "answer",
        agentRunner: (request) => Effect.promise(async () => {
          stages.push(stageId(request));
          return {
            sessionId: "s1", transcriptPath: "/tmp/s1.jsonl", text: "done",
            continuation: { harness: "pi", sessionId: "s1", transcriptPath: "/tmp/s1.jsonl" },
          };
        }),
      }));
      expect(stages).toEqual(["respond"]);
      expect(result.stages.map((stage) => stage.id)).toEqual(["respond@root"]);
      expect(await readFinalProgress(session.runDir)).toMatchObject({
        status: "completed", plannedStages: 1, completedStages: 1,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("resolves only after every fan-out worker, progress completed", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-end-fanout-"));
    try {
      await writeFile(join(root, "fan.yml"), FAN_OUT_WORKFLOW);
      const session = await testSession(root);
      const stages: string[] = [];
      await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "fan.yml"), runDir: session.runDir, runId: "end-fanout", cwd: root, prompt: "join",
        agentRunner: (request) => Effect.promise(async () => {
          const stage = stageId(request);
          stages.push(stage);
          // A visible delay keeps "resolves after ALL workers" honest: if the
          // engine settled on the first one, the joined turn and the count
          // below would fail.
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            sessionId: `s-${stage}`, transcriptPath: `/tmp/${stage}.jsonl`, text: `${stage} out`,
            continuation: { harness: "pi", sessionId: `s-${stage}`, transcriptPath: `/tmp/${stage}.jsonl` },
          };
        }),
      }));
      expect(stages).toEqual(["left", "right", "joined"]);
      expect(await readFinalProgress(session.runDir)).toMatchObject({
        status: "completed", plannedStages: 3, completedStages: 3,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("resolves after the exact iteration count, progress completed", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-end-loop-"));
    try {
      await writeFile(join(root, "loop.yml"), LOOP_WORKFLOW);
      const session = await testSession(root);
      const stages: string[] = [];
      await runWorkflow(session, loadAndExecuteWorkflow({
        root, workflowPath: join(root, "loop.yml"), runDir: session.runDir, runId: "end-loop", cwd: root, prompt: "iterate",
        agentRunner: (request) => Effect.promise(async () => {
          const stage = stageId(request);
          stages.push(stage);
          return {
            sessionId: `s-${stages.length}`, transcriptPath: `/tmp/s-${stages.length}.jsonl`, text: `${stage} out`,
            continuation: { harness: "pi", sessionId: `s-${stages.length}`, transcriptPath: `/tmp/s-${stages.length}.jsonl` },
          };
        }),
      }));
      expect(stages).toEqual([
        "seed",
        "tune.propose", "tune.report",
        "tune.propose", "tune.report",
        "tune.propose", "tune.report",
      ]);
      expect(await readFinalProgress(session.runDir)).toMatchObject({
        status: "completed", plannedStages: 7, completedStages: 7,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

  it("ends a bounded loop when its feedback contract projects stop", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-end-loop-stop-"));
    try {
      const workerDir = join(root, "recipes", "stop-feedback");
      const contractsDir = join(root, "recipes", "contracts");
      await mkdir(workerDir, { recursive: true });
      await mkdir(contractsDir, { recursive: true });
      await writeFile(join(workerDir, "agents.md"), "Return the requested loop decision.\n");
      await writeFile(join(contractsDir, "stop-feedback.json"), JSON.stringify(STOP_FEEDBACK_CONTRACT));
      await writeFile(join(root, "loop-stop.yml"), EARLY_STOP_LOOP_WORKFLOW);
      const session = await testSession(root);
      const stages: string[] = [];
      const loaded = await runWorkflow(
        session,
        loadWorkflow(join(root, "loop-stop.yml"), root, root),
      );
      const result = await runWorkflow(session, executeWorkflow(loaded, {
        runDir: session.runDir,
        runId: "end-loop-stop",
        cwd: root,
        prompt: "iterate until done",
        agentRunner: (request) => Effect.promise(async () => {
          const stage = stageId(request);
          stages.push(stage);
          // Every stage carries the stop-feedback contract, so each turn must
          // publish a valid decision; only the feedback stage stops the loop.
          const path = validationPath(request);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, JSON.stringify({
            next_action: stage === "tune.report" ? "stop" : "continue",
          }));
          return {
            sessionId: `s-${stages.length}`,
            transcriptPath: `/tmp/s-${stages.length}.jsonl`,
            text: `${stage} out`,
            continuation: {
              harness: "pi",
              sessionId: `s-${stages.length}`,
              transcriptPath: `/tmp/s-${stages.length}.jsonl`,
            },
          };
        }),
      }));

      expect(stages).toEqual(["seed", "tune.propose", "tune.report", "summary"]);
      expect(result.stages.map((stage) => stage.id)).toEqual([
        "seed@root",
        "tune.propose@tune/iter-0",
        "tune.report@tune/iter-0",
        "summary@root",
      ]);
      expect(await readFinalProgress(session.runDir)).toMatchObject({
        status: "completed",
        plannedStages: 4,
        completedStages: 4,
        stageCounts: {
          "tune.propose": { planned: 1, completed: 1 },
          "tune.report": { planned: 1, completed: 1 },
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);

});
