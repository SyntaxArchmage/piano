import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Cause, Effect, Exit, Option } from "effect";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadWorkflow,
  type WorkflowDocument,
  type WorkflowNode,
  type WorkflowStage,
} from "../../packages/orchestrator/src/index.js";
import {
  LogWriter,
  Logging,
  TraceWriter,
  loggingService,
} from "../../packages/logging/src/index.js";

const ROOT = process.cwd();
const V1_WORKFLOW = join(ROOT, "recipes/workflows/topsop-tuning.yml");
const V2_WORKFLOW = join(ROOT, "recipes/workflows/topsop-tuning-v2.yml");

function stages(nodes: readonly WorkflowNode[]): readonly WorkflowStage[] {
  return nodes.flatMap((node) =>
    "stage" in node
      ? [node.stage]
      : stages("loop" in node ? node.loop.nodes : node.tournament.nodes),
  );
}

function runLogging<A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Logging>,
): Promise<Exit.Exit<A, E>> {
  const log = new LogWriter("topsop-v2-test", "/tmp/topsop-v2-test-log.jsonl");
  const trace = new TraceWriter(
    "topsop-v2-test",
    "/tmp/topsop-v2-test-trace.jsonl",
  );
  return Effect.runPromiseExit(
    effect.pipe(
      Effect.provideService(Logging, loggingService(log, trace)),
      Effect.provide(NodeFileSystem.layer),
    ),
  );
}

function stageByName(document: WorkflowDocument, name: string): WorkflowStage {
  const stage = stages(document.workflow.nodes).find((item) => item.name === name);
  if (stage === undefined) throw new Error(`missing stage ${name}`);
  return stage;
}

describe("topsop tuning v2 compatibility boundary", () => {
  it("loads entirely through origin/main workflow primitives", async () => {
    const result = await runLogging(loadWorkflow(V2_WORKFLOW, ROOT, ROOT));
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isFailure(result)) {
      const failure = Cause.failureOption(result.cause);
      throw new Error(
        Option.isSome(failure) ? String(failure.value) : "workflow load failed",
      );
    }

    const loaded = result.value;
    expect(loaded.document.workflow.name).toBe("topsop-tuning-v2");
    expect(loaded.workerResources?.size).toBe(7);
    expect(stages(loaded.document.workflow.nodes).map((stage) => stage.worker)).toEqual([
      "topsop-v2-prepare",
      "topsop-v2-characterize",
      "topsop-v2-analyze",
      "topsop-v2-implement",
      "topsop-v2-evaluate",
      "topsop-v2-promote",
      "topsop-v2-summary",
    ]);

    const expectedSkills: Readonly<Record<string, readonly string[]>> = {
      "topsop-v2-prepare": [
        "topsop-v2-command-safety",
        "topsop-v2-evidence-protocol",
        "topsop-v2-knowledge-router",
        "topsop-v2-prepare",
        "topsop-v2-source-evidence",
      ],
      "topsop-v2-characterize": [
        "topsop-v2-characterize",
        "topsop-v2-command-safety",
        "topsop-v2-evidence-protocol",
        "topsop-v2-knowledge-router",
      ],
      "topsop-v2-analyze": [
        "topsop-v2-analyze",
        "topsop-v2-command-safety",
        "topsop-v2-evidence-protocol",
        "topsop-v2-knowledge-router",
        "topsop-v2-source-evidence",
      ],
      "topsop-v2-implement": [
        "topsop-v2-command-safety",
        "topsop-v2-evidence-protocol",
        "topsop-v2-implement",
        "topsop-v2-knowledge-router",
        "topsop-v2-source-evidence",
        "topsop-v2-validation",
      ],
      "topsop-v2-evaluate": [
        "topsop-v2-command-safety",
        "topsop-v2-evaluate",
        "topsop-v2-evidence-protocol",
        "topsop-v2-knowledge-router",
        "topsop-v2-validation",
      ],
      "topsop-v2-promote": [
        "topsop-v2-command-safety",
        "topsop-v2-evidence-protocol",
        "topsop-v2-knowledge-router",
        "topsop-v2-promote",
      ],
      "topsop-v2-summary": [
        "topsop-v2-command-safety",
        "topsop-v2-evidence-protocol",
        "topsop-v2-knowledge-router",
        "topsop-v2-summary",
      ],
    };
    for (const [worker, expected] of Object.entries(expectedSkills)) {
      const resources = loaded.workerResources?.get(`${worker}\u0000dsh`);
      expect(resources, worker).toBeDefined();
      expect(resources?.skillPaths.map((path) => basename(path)).sort(), worker).toEqual(expected);
      expect(resources?.skillPaths.every((path) =>
        path.includes(`/recipes/${worker}/skills/`),
      ), worker).toBe(true);
    }
  });

  it("keeps V1 and V2 worker namespaces isolated", async () => {
    const [v1, v2] = await Promise.all([
      readFile(V1_WORKFLOW, "utf8"),
      readFile(V2_WORKFLOW, "utf8"),
    ]);

    expect(v1).not.toContain("topsop-v2-");
    expect(v2).not.toMatch(/worker: topsop-(?!v2-)/);
    expect(v2).not.toMatch(/^\s*autoCommit:/m);
    expect(v2).not.toMatch(/^\s*timeout:/m);
  });

  it("uses the compact four-stage loop and direct handoff chain", async () => {
    const result = await runLogging(loadWorkflow(V2_WORKFLOW, ROOT, ROOT));
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isFailure(result)) return;

    const document = result.value.document;
    for (const stage of stages(document.workflow.nodes)) {
      expect(stage.harness, stage.name).toBe("dsh");
      expect(stage.model, stage.name).toBe("deepseek-flash");
      expect(stage.thinkingLevel, stage.name).toBe("low");
      expect(stage.memory, stage.name).not.toBe(false);
      expect(stage.tools, stage.name).toContain("glob");
      expect(stage.tools, stage.name).toContain("grep");
      expect(stage.tools, stage.name).not.toContain("ls");
      expect(stage.tools, stage.name).not.toContain("find");
    }

    const loopNode = document.workflow.nodes.find((node) => "loop" in node);
    expect(loopNode).toBeDefined();
    if (loopNode === undefined || !("loop" in loopNode)) return;

    expect(loopNode.loop.from).toEqual(["characterize"]);
    expect(loopNode.loop.feedback).toBe("promote");
    expect(loopNode.loop.entry).toBe("analyze");
    expect(loopNode.loop.exit).toBe("promote");
    expect(loopNode.loop.iterations).toBe(5);
    expect(loopNode.loop.nodes.map((node) =>
      "stage" in node ? node.stage.name : "nested-region",
    )).toEqual(["analyze", "implement", "evaluate", "promote"]);

    expect(stageByName(document, "prepare").from).toEqual([]);
    expect(stageByName(document, "characterize").from).toEqual(["prepare"]);
    expect(stageByName(document, "analyze").from).toEqual([]);
    expect(stageByName(document, "implement").from).toEqual(["analyze"]);
    expect(stageByName(document, "evaluate").from).toEqual(["implement"]);
    expect(stageByName(document, "promote").from).toEqual(["evaluate"]);
    expect(stageByName(document, "summary").from).toEqual([
      "characterize",
      "tune",
    ]);
  });

  it("grants edit only to preparation, implementation, and final progress writeback", async () => {
    const result = await runLogging(loadWorkflow(V2_WORKFLOW, ROOT, ROOT));
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isFailure(result)) return;

    const document = result.value.document;
    for (const name of ["prepare", "implement", "summary"]) {
      expect(stageByName(document, name).tools).toContain("edit");
    }
    for (const name of ["characterize", "analyze", "evaluate", "promote"]) {
      expect(stageByName(document, name).tools).not.toContain("edit");
    }
  });

  it("documents the separate V2 durable-state namespace", async () => {
    const [agents, skill, contract, design] = await Promise.all([
      readFile(join(ROOT, "recipes/topsop-v2-prepare/agents.md"), "utf8"),
      readFile(
        join(
          ROOT,
          "recipes/topsop-v2-prepare/skills/topsop-v2-prepare/SKILL.md",
        ),
        "utf8",
      ),
      readFile(join(ROOT, "recipes/topsop-v2-prepare/contract.json"), "utf8"),
      readFile(join(ROOT, "docs/topsop-tuning/v2/topsop-tuning-v2-design.md"), "utf8"),
    ]);

    for (const text of [agents, skill, contract, design]) {
      expect(text).toContain("topsop-v2");
    }
    expect(design).toContain("V1 and V2 share only the workspace lease");
    expect(design).toContain("V1 worker lineage");
    expect(design).toContain("workflow.loop-control=stop");
  });
});
