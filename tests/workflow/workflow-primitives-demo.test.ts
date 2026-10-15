import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { compileWorkflow, loadWorkflow, parseWorkflow } from "../../packages/orchestrator/src/index.js";
import { LogWriter, TraceWriter, Logging, loggingService } from "../../packages/logging/src/index.js";
import { NodeFileSystem } from "@effect/platform-node";

const workflowPath = join(process.cwd(), "recipes", "workflows", "workflow-primitives-demo.yml");

async function compiledDemo() {
  const parsed = await Effect.runPromiseExit(parseWorkflow(await readFile(workflowPath, "utf8"), workflowPath));
  if (!Exit.isSuccess(parsed)) throw new Error(`demo workflow parse failed: ${JSON.stringify(parsed.cause)}`);
  const compiled = await Effect.runPromiseExit(compileWorkflow(parsed.value, workflowPath));
  if (!Exit.isSuccess(compiled)) throw new Error(`demo workflow compile failed: ${JSON.stringify(compiled.cause)}`);
  return compiled.value;
}

describe("workflow primitives demo recipe", () => {
  it("keeps the demo graph short and exercises loop plus parallel tournament", async () => {
    const compiled = await compiledDemo();
    expect(compiled.name).toBe("workflow-primitives-demo");
    expect(compiled.stages.map(({ stage }) => stage.name)).toEqual([
      "prepare", "inspect", "report", "make-items", "lane", "finish",
    ]);
    expect(compiled.regions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "observe", kind: "loop", iterations: 2, feedback: "report" }),
      expect.objectContaining({ name: "fanout", kind: "map", count: 2, parallel: true, over: "make-items.items" }),
    ]));
  });

  it("uses worker-owned contracts and discoverable demo skills", async () => {
    const log = new LogWriter("workflow-primitives-demo-test", join(tmpdir(), "piano-workflow-primitives-demo-log.jsonl"), "trace-workflow-primitives-demo-test");
    const trace = new TraceWriter("workflow-primitives-demo-test", join(tmpdir(), "piano-workflow-primitives-demo-trace.jsonl"), "trace-workflow-primitives-demo-test");
    const loaded = await Effect.runPromiseExit(loadWorkflow(workflowPath).pipe(
      Effect.provideService(Logging, loggingService(log, trace)),
      Effect.provide(NodeFileSystem.layer),
    ));
    if (!Exit.isSuccess(loaded)) throw new Error(`demo workflow load failed: ${JSON.stringify(loaded.cause)}`);
    const resources = loaded.value.workerResources;
    expect(resources).toBeDefined();
    for (const worker of ["observer-worker", "items-worker", "lane-worker", "summary-worker"]) {
      const matches = [...resources!.keys()].filter((key) => key.startsWith(`${worker}\u0000`));
      expect(matches, worker).not.toHaveLength(0);
      expect(resources!.get(matches[0]!)?.contract, worker).toBeDefined();
      expect(resources!.get(matches[0]!)?.skillPaths.length, worker).toBeGreaterThan(0);
    }
  });
});
