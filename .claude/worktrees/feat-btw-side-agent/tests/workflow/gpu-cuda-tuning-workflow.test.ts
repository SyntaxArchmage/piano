import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  compileWorkflow,
  parseWorkflow,
} from "../../packages/orchestrator/src/index.js";

const workflowPath = join(process.cwd(), "recipes", "workflows", "gpu-cuda-tuning.yml");

describe("gpu-cuda-tuning workflow template", () => {
  it("is a 10-round serial CUDA tuning loop without a tournament map", async () => {
    const source = await readFile(workflowPath, "utf8");
    expect(source.match(/^[ \t]*harness: pi[ \t]*$/gm)).toHaveLength(6);
    expect(source.match(/^[ \t]*thinkingLevel: high[ \t]*$/gm)).toHaveLength(6);
    expect(source).not.toContain("harness: default");
    const parsed = await Effect.runPromiseExit(parseWorkflow(source, workflowPath));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;

    const compiled = await Effect.runPromiseExit(compileWorkflow(parsed.value, workflowPath));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (!Exit.isSuccess(compiled)) return;

    expect(compiled.value.regions).toHaveLength(1);
    expect(compiled.value.regions[0]).toMatchObject({
      kind: "loop",
      name: "tune",
      entry: "profile",
      exit: "measure",
      iterations: 10,
      feedback: "measure",
    });
    expect(compiled.value.stages.map((stage) => [stage.stage.name, stage.stage.worker])).toEqual([
      ["setup", "cuda-setup"],
      ["profile", "cuda-profile"],
      ["idea", "cuda-idea"],
      ["implement", "cuda-implement-verify"],
      ["measure", "cuda-benchmark-store"],
      ["summary", "cuda-summary"],
    ]);
    expect(compiled.value.stages.map((stage) => stage.stage.harness)).toEqual([
      "pi",
      "pi",
      "pi",
      "pi",
      "pi",
      "pi",
    ]);
    expect(compiled.value.regions.some((region) => region.kind === "map")).toBe(false);
    expect(compiled.value.stages.map((stage) => stage.stage.thinkingLevel)).toEqual([
      "high", "high", "high", "high", "high", "high",
    ]);
    expect(compiled.value.stages.every((stage) => stage.stage.validate === true)).toBe(true);
    expect(compiled.value.stages.find((stage) => stage.stage.name === "implement")?.stage.from).toEqual(["profile", "idea"]);
  });
});
