import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createSession, Logging, loggingService } from "../../packages/logging/src/index.js";
import {
  FakeSystemOneProvider,
  loadAndExecuteWorkflow,
  type WorkflowExecutionResult,
} from "../../packages/orchestrator/src/index.js";
import type { AgentRequest } from "../../packages/harness/src/index.js";
import { validationResultPathFromPrompt } from "../common/validation-path.mjs";

const RECIPE_ROOT = fileURLToPath(new URL("../fixtures/workflow-recipes", import.meta.url));

const WORKFLOW = `version: 3
workflow:
  name: skip-profile
  nodes:
    - loop:
        name: tune
        from: []
        feedback: measure
        entry: profile
        exit: measure
        iterations: 2
        nodes:
          - stage:
              name: profile
              worker: test-profile
              from: []
              skippable: true
              decision:
                model: fake
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

async function runWorkflow(
  measureDecision: "KEEP" | "DISCARD",
  action: "run" | "skip",
): Promise<{
  readonly result: WorkflowExecutionResult;
  readonly calls: readonly string[];
  readonly prompts: readonly string[];
  readonly invocations: readonly { readonly kind?: string; readonly invocationId?: string; readonly stageId?: string }[];
}> {
  const root = await mkdtemp(join(tmpdir(), "piano-system-one-skip-"));
  try {
    const workflowPath = join(root, "workflow.yml");
    await writeFile(workflowPath, WORKFLOW);
    const session = await Effect.runPromise(
      createSession({ root, cwd: root, runsRoot: join(root, "runs") }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    const calls: string[] = [];
    const prompts: string[] = [];
    const result = await Effect.runPromise(loadAndExecuteWorkflow({
      root,
      workflowPath,
      recipeRepositoryRoot: RECIPE_ROOT,
      runDir: session.runDir,
      runId: `skip-profile-${measureDecision.toLowerCase()}`,
      cwd: root,
      prompt: "tune the kernel",
      systemOne: new FakeSystemOneProvider({ action }),
      agentRunner: (request) => Effect.promise(async () => {
        const stage = stageId(request);
        calls.push(stage);
        prompts.push(request.prompt);
        const resultPath = validationResultPathFromPrompt(request.prompt);
        if (resultPath === undefined) throw new Error("missing result path");
        await mkdir(dirname(resultPath), { recursive: true });
        if (stage === "tune.profile") {
          await writeFile(resultPath, JSON.stringify({
            status: "ready",
            target_operator: "kernel:run",
            device: { name: "GPU", architecture: "sm_86" },
            analysis: "profile-0",
          }));
        } else {
          await writeFile(resultPath, JSON.stringify({
            decision: measureDecision,
            iteration: 0,
            hypothesis: "hold the line",
          }));
        }
        return {
          sessionId: `${stage}-session`,
          transcriptPath: `/tmp/${stage}.jsonl`,
          text: stage,
          continuation: { harness: "pi", sessionId: `${stage}-session`, transcriptPath: `/tmp/${stage}.jsonl` },
        };
      }),
    }).pipe(
      Effect.provideService(Logging, loggingService(session.log, session.trace)),
      Effect.provide(NodeFileSystem.layer),
    ));
    return {
      result,
      calls,
      prompts,
      invocations: (await readFile(join(session.runDir, "system-log", "invocations.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as { kind?: string; invocationId?: string; stageId?: string }),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("System One skip decision", () => {
  it("skips a no-improvement profile and reuses the previous accepted profile", async () => {
    const { result, calls, prompts, invocations } = await runWorkflow("DISCARD", "skip");
    expect(calls).toEqual(["tune.profile", "tune.measure", "tune.measure"]);
    const skipped = result.stages.find((stage) => stage.id === "tune.profile@tune/iter-1");
    expect(skipped?.skipped?.model).toBe("fake");
    expect(skipped?.skipped?.confidence).toBe(1);
    expect(invocations.some((row) =>
      row.kind === "invocation-accepted" && row.invocationId === "tune.profile@tune/iter-1")).toBe(true);
    expect(skipped?.skipped?.sourceInvocationId).toBe("tune.profile@tune/iter-0");
    expect(skipped?.text).toContain("Skipped by System One");
    expect(prompts.some((prompt) => prompt.includes("Skipped upstream stages"))).toBe(true);
  }, 60_000);

  it("runs when the model chooses run", async () => {
    const { result, calls, prompts } = await runWorkflow("KEEP", "run");
    expect(calls).toEqual(["tune.profile", "tune.measure", "tune.profile", "tune.measure"]);
    expect(result.stages.some((stage) => stage.skipped !== undefined)).toBe(false);
    expect(prompts.some((prompt) => prompt.includes("Skipped upstream stages"))).toBe(false);
  }, 60_000);

  it("does not impose a KEEP/no-improvement trigger", async () => {
    const { result, calls } = await runWorkflow("KEEP", "skip");
    expect(calls).toEqual(["tune.profile", "tune.measure", "tune.measure"]);
    const skipped = result.stages.find((stage) => stage.id === "tune.profile@tune/iter-1");
    expect(skipped?.skipped?.model).toBe("fake");
  }, 60_000);
});
