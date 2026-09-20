import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Cause, Effect, Exit, Option } from "effect";
import { join } from "node:path";
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
const WORKFLOW = join(
  ROOT,
  "recipes/workflows/topsop-tuning-v2-tournament.yml",
);

function stages(nodes: readonly WorkflowNode[]): readonly WorkflowStage[] {
  return nodes.flatMap((node) =>
    "stage" in node
      ? [node.stage]
      : stages("loop" in node ? node.loop.nodes : node.tournament.nodes),
  );
}

function stageByName(document: WorkflowDocument, name: string): WorkflowStage {
  const stage = stages(document.workflow.nodes).find((item) => item.name === name);
  if (stage === undefined) throw new Error(`missing stage ${name}`);
  return stage;
}

function runLogging<A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Logging>,
): Promise<Exit.Exit<A, E>> {
  const log = new LogWriter(
    "topsop-v2-tournament-test",
    "/tmp/topsop-v2-tournament-test-log.jsonl",
  );
  const trace = new TraceWriter(
    "topsop-v2-tournament-test",
    "/tmp/topsop-v2-tournament-test-trace.jsonl",
  );
  return Effect.runPromiseExit(
    effect.pipe(
      Effect.provideService(Logging, loggingService(log, trace)),
      Effect.provide(NodeFileSystem.layer),
    ),
  );
}

describe("topsop tuning v2 tournament workflow", () => {
  it("reuses the V2 pipeline around one serial-device tournament partition", async () => {
    const result = await runLogging(loadWorkflow(WORKFLOW, ROOT, ROOT));
    expect(Exit.isSuccess(result)).toBe(true);
    if (Exit.isFailure(result)) {
      const failure = Cause.failureOption(result.cause);
      throw new Error(
        Option.isSome(failure) ? String(failure.value) : "workflow load failed",
      );
    }

    const loaded = result.value;
    expect(loaded.document.workflow.name).toBe(
      "topsop-tuning-v2-tournament",
    );
    expect(loaded.document.workflow.autoCommit).not.toBe(true);

    for (const stage of stages(loaded.document.workflow.nodes)) {
      expect(stage.harness, stage.name).toBe("dsh");
      expect(stage.model, stage.name).toBe("deepseek-flash");
      expect(stage.thinkingLevel, stage.name).toBe("low");
      expect(stage.timeout, stage.name).toBeUndefined();
    }

    const loopNode = loaded.document.workflow.nodes.find((node) => "loop" in node);
    expect(loopNode).toBeDefined();
    if (loopNode === undefined || !("loop" in loopNode)) return;
    expect(loopNode.loop.from).toEqual(["characterize"]);
    expect(loopNode.loop.feedback).toBe("promote");
    expect(loopNode.loop.entry).toBe("partition");
    expect(loopNode.loop.exit).toBe("promote");
    expect(loopNode.loop.iterations).toBe(5);

    const raceNode = loopNode.loop.nodes.find((node) => "tournament" in node);
    expect(raceNode).toBeDefined();
    if (raceNode === undefined || !("tournament" in raceNode)) return;
    expect(raceNode.tournament.from).toEqual(["partition"]);
    expect(raceNode.tournament.over).toBe("partition.lanes");
    expect(raceNode.tournament.count).toBe(3);
    expect(raceNode.tournament.parallel).toBe(false);
    expect(raceNode.tournament.entry).toBe("analyze");
    expect(raceNode.tournament.exit).toBe("evaluate");

    expect(stageByName(loaded.document, "partition").worker).toBe(
      "topsop-v2-tournament-partition",
    );
    expect(stageByName(loaded.document, "analyze").worker).toBe(
      "topsop-v2-analyze",
    );
    expect(stageByName(loaded.document, "implement").worker).toBe(
      "topsop-v2-implement",
    );
    expect(stageByName(loaded.document, "evaluate").worker).toBe(
      "topsop-v2-evaluate",
    );
    expect(stageByName(loaded.document, "evaluate").tools).toContain("edit");
    expect(stageByName(loaded.document, "promote").worker).toBe(
      "topsop-v2-promote",
    );
    expect(stageByName(loaded.document, "summary").worker).toBe(
      "topsop-v2-summary",
    );

    const partition = loaded.workerResources?.get(
      "topsop-v2-tournament-partition\u0000dsh",
    )?.contract;
    expect(partition?.manifest.outputs.projections).toContainEqual(
      expect.objectContaining({
        id: "workflow.map-items",
        pointer: "/lanes",
        required: true,
      }),
    );

    const evaluate = loaded.workerResources?.get(
      "topsop-v2-evaluate\u0000dsh",
    )?.contract;
    expect(evaluate?.manifest.outputs.metrics).toEqual([
      expect.objectContaining({
        pointer: "/referee",
        format: "benchmark/v1",
        required: false,
      }),
    ]);
  });
});
