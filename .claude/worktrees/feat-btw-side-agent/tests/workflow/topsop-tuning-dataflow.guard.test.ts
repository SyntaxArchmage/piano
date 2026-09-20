import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  loadAndExecuteWorkflow,
} from "../../packages/orchestrator/src/index.js";
import type { AgentRequest, AgentResult, AgentRunner } from "../../packages/harness/src/index.js";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const workflowPath = join(repositoryRoot, "recipes", "workflows", "topsop-tuning.yml");
const userPrompt = "tune the target operator using the complete topsop workflow";

const stageWorkers: Readonly<Record<string, string>> = {
  "setup-env": "topsop-setup-env",
  explore: "topsop-explore",
  theory: "topsop-theory",
  "tune.profile": "topsop-profile",
  "tune.idea": "topsop-idea",
  "tune.implement": "topsop-implement",
  "tune.verify": "topsop-verification",
  "tune.measure": "topsop-measure",
  summary: "topsop-summary",
};

const rootProducers = ["setup-env@root", "explore@root", "theory@root"] as const;

interface HandoffInput {
  readonly id: string;
  readonly stageId: string;
  readonly resultPayload?: unknown;
  readonly projections?: readonly unknown[];
  readonly contract?: { readonly id: string; readonly snapshotPath: string };
}

interface HandoffContext {
  readonly inputs: readonly HandoffInput[];
}

interface HandoffRecord {
  readonly producer: HandoffInput;
}

function stageId(request: AgentRequest): string {
  const match = /workflow stage `([^`]+)`/.exec(request.prompt);
  if (match?.[1] === undefined) throw new Error(`missing stage id in worker prompt: ${request.prompt}`);
  return match[1];
}

function iterationOf(request: AgentRequest): number | undefined {
  const match = /tune\/iter-(\d+)/.exec(request.prompt);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function resultPath(request: AgentRequest): string {
  const path = request.prompt.split("\n").find((line) => line.endsWith("/result.json"));
  if (path === undefined) throw new Error(`missing validation result path in worker prompt: ${request.prompt}`);
  return path;
}

function contextPath(request: AgentRequest, marker: string): string {
  const path = request.contextFilePaths?.find((candidate) => candidate.includes(marker));
  if (path === undefined) {
    throw new Error(`missing ${marker} in context for ${stageId(request)}`);
  }
  return path;
}

function expectedProducerIds(stage: string, iteration: number | undefined): readonly string[] {
  if (stage === "setup-env") return [];
  if (stage === "explore") return [rootProducers[0]];
  if (stage === "theory") return [...rootProducers.slice(0, 2)];
  if (stage === "summary") {
    return [...rootProducers, "tune.measure@tune/iter-7"];
  }

  if (iteration === undefined) throw new Error(`missing loop iteration for ${stage}`);
  const handoffStages: Readonly<Record<string, readonly string[]>> = {
    "tune.profile": [],
    "tune.idea": ["profile"],
    "tune.implement": ["profile", "idea"],
    // Verification consumes the implementation report and the immutable
    // root context (target case / build credentials); it must not need to
    // rediscover the proposal from the worker's mutable workspace.
    "tune.verify": ["implement"],
    // Measurement owns profile collection. It consumes the proposal,
    // implementation, and correctness evidence; baseline/root context is
    // inherited from the enclosing scope.
    "tune.measure": ["idea", "implement", "verify"],
  };
  const currentRound = (handoffStages[stage] ?? []).map((name) => `tune.${name}@tune/iter-${iteration}`);
  const priorFeedback = iteration === 0 ? [] : [`tune.measure@tune/iter-${iteration - 1}`];
  return [...rootProducers, ...priorFeedback, ...currentRound];
}

function run<A>(
  session: Awaited<ReturnType<typeof createTestSession>>,
  effect: Effect.Effect<A, unknown, Logging | FileSystem.FileSystem>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.provideService(Logging, loggingService(session.log, session.trace)),
    Effect.provide(NodeFileSystem.layer),
  ));
}

async function createTestSession(root: string) {
  return Effect.runPromise(
    createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(
      Effect.provide(NodeFileSystem.layer),
    ),
  );
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function exampleContractPath(stage: string): string {
  const worker = stageWorkers[stage];
  if (worker === undefined) throw new Error(`unexpected worker stage ${stage}`);
  return join(repositoryRoot, "recipes", worker, "contract.json");
}

function fakeRunner(calls: AgentRequest[]): AgentRunner {
  return (request) => Effect.promise(async (): Promise<AgentResult> => {
    calls.push(request);
    const stage = stageId(request);
    const contract = await readJson<{ readonly example: unknown }>(exampleContractPath(stage));
    const outputPath = resultPath(request);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(contract.example)}\n`);
    const iteration = iterationOf(request);
    return {
      sessionId: `${stage}-${iteration ?? "root"}-fake`,
      transcriptPath: `/tmp/${stage}-${iteration ?? "root"}-fake.jsonl`,
      text: `fake accepted result for ${stage}`,
      continuation: {
        harness: "pi",
        sessionId: `${stage}-${iteration ?? "root"}-fake`,
        transcriptPath: `/tmp/${stage}-${iteration ?? "root"}-fake.jsonl`,
      },
    };
  });
}

describe("shipped topsop-tuning worker dataflow guard", () => {
  it("preserves task, contracts, accepted evidence, and declared loop handoff dataflow", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-topsop-dataflow-guard-"));
    const calls: AgentRequest[] = [];
    try {
      const session = await createTestSession(root);
      const result = await run(session, loadAndExecuteWorkflow({
        root,
        workflowPath,
        runDir: session.runDir,
        executionId: "topsop-dataflow-guard",
        cwd: root,
        prompt: userPrompt,
        agentRunner: fakeRunner(calls),
      }));

      expect(calls).toHaveLength(44);
      expect(result.stages).toHaveLength(44);
      const acceptedById = new Map(result.stages.map((stage) => [stage.id, stage] as const));

      const handoffMismatches: Array<{ stage: string; actual: readonly string[]; expected: readonly string[] }> = [];
      for (const request of calls) {
        const stage = stageId(request);
        const iteration = iterationOf(request);
        expect(request.prompt.startsWith(`## User task (whole workflow)\n${userPrompt}\n`), stage).toBe(true);

        const snapshotPath = contextPath(request, "/contracts/");
        expect(await readFile(snapshotPath, "utf8"), `${stage} contract snapshot`).toBe(
          await readFile(exampleContractPath(stage), "utf8"),
        );

        const handoff = await readJson<HandoffContext>(contextPath(request, "/handoff-context/"));
        const actual = handoff.inputs.map((input) => input.id);
        const expected = expectedProducerIds(stage, iteration);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) handoffMismatches.push({ stage, actual, expected });
        for (const input of handoff.inputs) {
          const producer = acceptedById.get(input.id);
          expect(producer, `${stage} handoff producer ${input.id}`).toBeDefined();
          if (producer === undefined) continue;
          expect(input.resultPayload, `${stage} handoff payload from ${input.id}`).toEqual(producer.resultPayload);
          expect(input.projections, `${stage} handoff projections from ${input.id}`).toEqual(producer.projections);
          expect(input.contract, `${stage} handoff contract from ${input.id}`).toEqual(producer.contract);
        }
      }
      const roundOneIdea = calls.find((request) => stageId(request) === "tune.idea" && iterationOf(request) === 1);
      expect(roundOneIdea, "round-1 idea request").toBeDefined();
      if (roundOneIdea !== undefined) {
        const handoff = await readJson<HandoffContext>(contextPath(roundOneIdea, "/handoff-context/"));
        expect(handoff.inputs.map((input) => input.id), "round-1 idea feedback").toContain("tune.measure@tune/iter-0");
      }

      for (const accepted of result.stages) {
        const stage = accepted.stageId;
        const resultId = accepted.id;
        expect(accepted.resultPayload, `${resultId} accepted payload`).toBeDefined();
        expect(accepted.contract, `${resultId} worker contract reference`).toEqual(expect.objectContaining({
          id: JSON.parse(await readFile(exampleContractPath(stage), "utf8")).id,
          snapshotPath: expect.stringContaining("/contracts/"),
        }));
        expect(accepted.handoffRecordPath, `${resultId} handoff record`).toBeDefined();
        const record = await readJson<HandoffRecord>(accepted.handoffRecordPath);
        expect(record.producer.resultPayload, `${resultId} recorded accepted payload`).toEqual(accepted.resultPayload);
        expect(record.producer.contract, `${resultId} recorded contract`).toEqual(accepted.contract);
        expect(record.producer.projections ?? [], `${resultId} recorded projections`).toEqual(accepted.projections ?? []);
      }
      expect(handoffMismatches, "real topsop producer handoff mismatches").toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
