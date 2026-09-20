import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  createSession,
  Logging,
  loggingService,
} from "../../packages/logging/src/index.js";
import { loadAndExecuteWorkflow } from "../../packages/orchestrator/src/index.js";
import type {
  AgentRequest,
  AgentResult,
  AgentRunner,
} from "../../packages/harness/src/index.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const workflowPath = join(
  repositoryRoot,
  "recipes/workflows/topsop-tuning-v2.yml",
);
const userPrompt = "optimize a GCU400 operator with topsop tuning v2";

const stageWorkers: Readonly<Record<string, string>> = {
  prepare: "topsop-v2-prepare",
  characterize: "topsop-v2-characterize",
  "tune.analyze": "topsop-v2-analyze",
  "tune.implement": "topsop-v2-implement",
  "tune.evaluate": "topsop-v2-evaluate",
  "tune.promote": "topsop-v2-promote",
  summary: "topsop-v2-summary",
};

interface HandoffContext {
  readonly inputs: readonly {
    readonly id: string;
    readonly resultPayload?: unknown;
    readonly contract?: { readonly id: string; readonly snapshotPath: string };
  }[];
}

function stageId(request: AgentRequest): string {
  const match = /workflow stage `([^`]+)`/.exec(request.prompt);
  if (match?.[1] === undefined) throw new Error("missing stage id");
  return match[1];
}

function iterationOf(request: AgentRequest): number | undefined {
  const match = /tune\/iter-(\d+)/.exec(request.prompt);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function resultPath(request: AgentRequest): string {
  const path = request.prompt.split("\n").find((line) => line.endsWith("/result.json"));
  if (path === undefined) throw new Error("missing result path");
  return path;
}

function contextPath(request: AgentRequest, marker: string): string {
  const path = request.contextFilePaths?.find((candidate) =>
    candidate.includes(marker),
  );
  if (path === undefined) throw new Error(`missing ${marker}`);
  return path;
}

function contractPath(stage: string): string {
  const worker = stageWorkers[stage];
  if (worker === undefined) throw new Error(`unknown stage ${stage}`);
  return join(repositoryRoot, "recipes", worker, "contract.json");
}

function expectedInputs(
  stage: string,
  iteration: number | undefined,
  finalIteration: number,
): string[] {
  if (stage === "prepare") return [];
  if (stage === "characterize") return ["prepare@root"];
  if (stage === "summary") {
    return ["characterize@root", `tune.promote@tune/iter-${finalIteration}`];
  }
  if (iteration === undefined) throw new Error(`missing iteration for ${stage}`);

  const previous =
    iteration === 0 ? [] : [`tune.promote@tune/iter-${iteration - 1}`];
  const direct: Readonly<Record<string, string[]>> = {
    "tune.analyze": [],
    "tune.implement": [`tune.analyze@tune/iter-${iteration}`],
    "tune.evaluate": [`tune.implement@tune/iter-${iteration}`],
    "tune.promote": [`tune.evaluate@tune/iter-${iteration}`],
  };
  return ["characterize@root", ...previous, ...(direct[stage] ?? [])];
}

async function createTestSession(root: string) {
  return Effect.runPromise(
    createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(
      Effect.provide(NodeFileSystem.layer),
    ),
  );
}

function run<A>(
  session: Awaited<ReturnType<typeof createTestSession>>,
  effect: Effect.Effect<A, unknown, Logging | FileSystem.FileSystem>,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.provideService(Logging, loggingService(session.log, session.trace)),
      Effect.provide(NodeFileSystem.layer),
    ),
  );
}


function durableStateBlockedRunner(calls: AgentRequest[]): AgentRunner {
  const upstreamFailure = {
    kind: "state",
    scope: "run",
    retryable: false,
    code: "durable_state_incompatible",
    message: "existing V2 state does not match the current workspace identity",
    next_action: "retire the incompatible state or restore its recorded workspace",
  };

  return (request) =>
    Effect.promise(async (): Promise<AgentResult> => {
      calls.push(request);
      const stage = stageId(request);
      const compiled = JSON.parse(
        await readFile(contractPath(stage), "utf8"),
      ) as { example: Record<string, unknown> };
      let payload: Record<string, unknown>;

      if (stage === "prepare") {
        payload = {
          protocol_version: 2,
          status: "blocked",
          failure: upstreamFailure,
        };
      } else if (stage === "characterize") {
        payload = {
          protocol_version: 2,
          status: "blocked",
          prepared_ref: compiled.example.prepared_ref,
          failure: upstreamFailure,
        };
      } else if (stage === "summary") {
        payload = {
          protocol_version: 2,
          status: "completed",
          outcome: "blocked",
          rounds: {
            scheduled: 0,
            attempted: 0,
            measured: 0,
            target_measured: 10,
            replans: 0,
            kept: 0,
            discarded: 0,
            failed: 0,
          },
          upstream_failure: upstreamFailure,
          cleanup: {
            lease_release_attempted: true,
            lease_released: true,
            workspace_restored: true,
            issues: [],
          },
          next_action: upstreamFailure.next_action,
        };
      } else {
        throw new Error(`blocked fast path unexpectedly scheduled ${stage}`);
      }

      const output = resultPath(request);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(payload)}\n`);
      return {
        sessionId: `${stage}-blocked-fake`,
        transcriptPath: `/tmp/${stage}-blocked-fake.jsonl`,
        text: `fake blocked result for ${stage}`,
      };
    });
}

function fakeRunner(calls: AgentRequest[]): AgentRunner {
  return (request) =>
    Effect.promise(async (): Promise<AgentResult> => {
      calls.push(request);
      const stage = stageId(request);
      const contract = JSON.parse(await readFile(contractPath(stage), "utf8")) as {
        example: unknown;
      };
      const output = resultPath(request);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(contract.example)}\n`);
      const iteration = iterationOf(request);
      return {
        sessionId: `${stage}-${iteration ?? "root"}-fake`,
        transcriptPath: `/tmp/${stage}-${iteration ?? "root"}-fake.jsonl`,
        text: `fake accepted result for ${stage}`,
        continuation: {
          harness: "dsh",
          sessionId: `${stage}-${iteration ?? "root"}-fake`,
          transcriptPath: `/tmp/${stage}-${iteration ?? "root"}-fake.jsonl`,
        },
      };
    });
}

describe("topsop tuning v2 dataflow", () => {
  it("passes only baseline, previous promotion, and direct producer handoffs", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-topsop-v2-dataflow-"));
    const calls: AgentRequest[] = [];
    try {
      const session = await createTestSession(root);
      const workflowSource = await readFile(workflowPath, "utf8");
      const iterationsMatch = /^\s*iterations:\s*(\d+)\s*$/m.exec(workflowSource);
      if (iterationsMatch?.[1] === undefined) {
        throw new Error("missing fixed iteration count");
      }
      const loopIterations = Number(iterationsMatch[1]);
      const result = await run(
        session,
        loadAndExecuteWorkflow({
          root,
          workflowPath,
          runDir: session.runDir,
          executionId: "topsop-v2-dataflow",
          cwd: root,
          prompt: userPrompt,
          agentRunner: fakeRunner(calls),
        }),
      );

      const expectedStageCount = 3 + loopIterations * 4;
      expect(calls).toHaveLength(expectedStageCount);
      expect(result.stages).toHaveLength(expectedStageCount);
      const accepted = new Map(result.stages.map((stage) => [stage.id, stage]));

      for (const request of calls) {
        expect(request.model).toBe("deepseek-flash");
        const stage = stageId(request);
        const handoff = JSON.parse(
          await readFile(contextPath(request, "/handoff-context/"), "utf8"),
        ) as HandoffContext;
        expect(handoff.inputs.map((input) => input.id), stage).toEqual(
          expectedInputs(stage, iterationOf(request), loopIterations - 1),
        );
        for (const input of handoff.inputs) {
          expect(input.resultPayload).toEqual(accepted.get(input.id)?.resultPayload);
        }
      }

      const roundOneAnalyze = calls.find(
        (request) =>
          stageId(request) === "tune.analyze" && iterationOf(request) === 1,
      );
      expect(roundOneAnalyze).toBeDefined();
      if (roundOneAnalyze !== undefined) {
        const handoff = JSON.parse(
          await readFile(contextPath(roundOneAnalyze, "/handoff-context/"), "utf8"),
        ) as HandoffContext;
        expect(handoff.inputs.map((input) => input.id)).toEqual([
          "characterize@root",
          "tune.promote@tune/iter-0",
        ]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("short-circuits a durable-state block through characterize and summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-topsop-v2-blocked-"));
    const calls: AgentRequest[] = [];
    try {
      const session = await createTestSession(root);
      const result = await run(
        session,
        loadAndExecuteWorkflow({
          root,
          workflowPath,
          runDir: session.runDir,
          executionId: "topsop-v2-durable-state-blocked",
          cwd: root,
          prompt: userPrompt,
          agentRunner: durableStateBlockedRunner(calls),
        }),
      );

      expect(calls.map(stageId)).toEqual(["prepare", "characterize", "summary"]);
      expect(result.stages.map((stage) => stage.id)).toEqual([
        "prepare@root",
        "characterize@root",
        "summary@root",
      ]);
      expect(result.stages.some((stage) => stage.id.startsWith("tune."))).toBe(false);

      const characterize = calls.find((request) => stageId(request) === "characterize");
      const summary = calls.find((request) => stageId(request) === "summary");
      expect(characterize).toBeDefined();
      expect(summary).toBeDefined();

      if (characterize !== undefined) {
        const handoff = JSON.parse(
          await readFile(contextPath(characterize, "/handoff-context/"), "utf8"),
        ) as HandoffContext;
        expect(handoff.inputs.map((input) => input.id)).toEqual(["prepare@root"]);
      }
      if (summary !== undefined) {
        const handoff = JSON.parse(
          await readFile(contextPath(summary, "/handoff-context/"), "utf8"),
        ) as HandoffContext;
        expect(handoff.inputs.map((input) => input.id)).toEqual([
          "characterize@root",
        ]);
      }

      expect(result.stages.at(-1)?.resultPayload).toMatchObject({
        status: "completed",
        outcome: "blocked",
        rounds: { scheduled: 0, attempted: 0, measured: 0 },
        upstream_failure: { code: "durable_state_incompatible" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

});
