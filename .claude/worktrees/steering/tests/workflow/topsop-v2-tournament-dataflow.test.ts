import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type {
  AgentRequest,
  AgentResult,
  AgentRunner,
} from "../../packages/harness/src/index.js";
import {
  createSession,
  Logging,
  loggingService,
} from "../../packages/logging/src/index.js";
import { loadAndExecuteWorkflow } from "../../packages/orchestrator/src/index.js";

const ROOT = process.cwd();
const WORKFLOW = join(
  ROOT,
  "recipes/workflows/topsop-tuning-v2-tournament.yml",
);

const WORKERS: Readonly<Record<string, string>> = {
  prepare: "topsop-v2-prepare",
  characterize: "topsop-v2-characterize",
  "tune.partition": "topsop-v2-tournament-partition",
  "tune.race.analyze": "topsop-v2-analyze",
  "tune.race.implement": "topsop-v2-implement",
  "tune.race.evaluate": "topsop-v2-evaluate",
  "tune.promote": "topsop-v2-promote",
  summary: "topsop-v2-summary",
};

function stageId(request: AgentRequest): string {
  const match = /workflow stage `([^`]+)`/.exec(request.prompt);
  if (match?.[1] === undefined) throw new Error("missing stage id");
  return match[1];
}

function resultPath(request: AgentRequest): string {
  const path = request.prompt.split("\n").find((line) => line.endsWith("/result.json"));
  if (path === undefined) throw new Error("missing result path");
  return path;
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

function fakeRunner(calls: AgentRequest[]): AgentRunner {
  return (request) =>
    Effect.promise(async (): Promise<AgentResult> => {
      calls.push(request);
      const stage = stageId(request);
      const worker = WORKERS[stage];
      if (worker === undefined) throw new Error(`unknown stage ${stage}`);
      const contract = JSON.parse(
        await readFile(join(ROOT, "recipes", worker, "contract.json"), "utf8"),
      ) as { example: unknown };
      const output = resultPath(request);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, `${JSON.stringify(contract.example)}\n`);
      return {
        sessionId: `${stage}-fake`,
        transcriptPath: `/tmp/${stage}-fake.jsonl`,
        text: `fake accepted result for ${stage}`,
        continuation: {
          harness: "dsh",
          sessionId: `${stage}-fake`,
          transcriptPath: `/tmp/${stage}-fake.jsonl`,
        },
      };
    });
}

describe("topsop tuning v2 tournament dataflow", () => {
  it("injects three lane mandates and forwards only the measured winner", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-topsop-v2-tournament-"));
    const calls: AgentRequest[] = [];
    try {
      const workflowSource = (await readFile(WORKFLOW, "utf8")).replace(
        /iterations:\s*\d+/,
        "iterations: 1",
      );
      const workflowPath = join(root, "topsop-tuning-v2-tournament.yml");
      await writeFile(workflowPath, workflowSource);
      await writeFile(join(root, "kernel.tops"), "baseline\n");
      const session = await createTestSession(root);

      await run(
        session,
        loadAndExecuteWorkflow({
          root,
          workflowPath,
          runDir: session.runDir,
          executionId: "topsop-v2-tournament-dataflow",
          cwd: root,
          prompt: "optimize one GCU400 operator",
          agentRunner: fakeRunner(calls),
        }),
      );

      const analyzeCalls = calls.filter(
        (request) => stageId(request) === "tune.race.analyze",
      );
      expect(analyzeCalls).toHaveLength(3);
      const mapItems = await Promise.all(analyzeCalls.map(async (request) => {
        const path = request.contextFilePaths?.find((candidate) =>
          candidate.endsWith("/map-item.json"),
        );
        if (path === undefined) throw new Error("missing map-item.json");
        return JSON.parse(await readFile(path, "utf8")) as {
          item: { over: string; index: number; value: { lane_id: string } };
        };
      }));
      expect(mapItems.map(({ item }) => item)).toMatchObject([
        { over: "partition.lanes", index: 0, value: { lane_id: "lane-0" } },
        { over: "partition.lanes", index: 1, value: { lane_id: "lane-1" } },
        { over: "partition.lanes", index: 2, value: { lane_id: "lane-2" } },
      ]);

      const promote = calls.find((request) => stageId(request) === "tune.promote");
      expect(promote).toBeDefined();
      const handoffPath = promote?.contextFilePaths?.find((candidate) =>
        candidate.includes("/handoff-context/"),
      );
      if (handoffPath === undefined) throw new Error("missing promote handoff");
      const handoff = JSON.parse(await readFile(handoffPath, "utf8")) as {
        inputs: Array<{ stageId: string; instanceId?: string }>;
      };
      const raceInputs = handoff.inputs.filter((input) =>
        input.stageId === "tune.race.evaluate",
      );
      expect(raceInputs).toHaveLength(1);
      expect(raceInputs[0]?.instanceId).toContain("slot-0");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
