import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  compileWorkflow,
  parseWorkflow,
} from "../../packages/orchestrator/src/index.js";

const workflowPath = (name: string) =>
  join(process.cwd(), "recipes", "workflows", `${name}.yml`);

async function compileRecipeWorkflow(name: string) {
  const path = workflowPath(name);
  const parsed = await Effect.runPromiseExit(parseWorkflow(await readFile(path, "utf8"), path));
  if (!Exit.isSuccess(parsed)) throw new Error(`parse failed for ${name}`);
  const compiled = await Effect.runPromiseExit(compileWorkflow(parsed.value, path));
  if (!Exit.isSuccess(compiled)) throw new Error(`compile failed for ${name}`);
  return compiled.value;
}

describe("gpu-cuda-tuning-tournament workflow template", () => {
  it("races implement→measure once per tuning iteration as one tournament region", async () => {
    const compiled = await compileRecipeWorkflow("gpu-cuda-tuning-tournament");
    expect(compiled.name).toBe("gpu-cuda-tuning-tournament");

    // Lowered regions list nested children before their parent region.
    expect(compiled.regions).toHaveLength(2);
    const tune = compiled.regions.find((region) => region.name === "tune");
    const race = compiled.regions.find((region) => region.name === "race");
    expect(tune).toMatchObject({
      kind: "loop",
      name: "tune",
      entry: "profile",
      exit: "race",
      feedback: "race",
      iterations: 10,
    });
    // One tournament, one region: both racing stages live inside it, and the
    // loop boundary names the region (its exit resolves to the region's leaf).
    expect(race).toMatchObject({
      kind: "map",
      name: "race",
      parentId: tune?.id,
      entry: "implement",
      exit: "measure",
      over: "idea.strategies",
      count: 3,
      from: ["idea"],
    });

    expect(compiled.stages.map((stage) => [stage.stage.name, stage.stage.worker])).toEqual([
      ["setup", "cuda-setup"],
      ["profile", "cuda-profile"],
      ["idea", "cuda-idea-tournament"],
      ["implement", "cuda-implement-verify"],
      ["measure", "cuda-benchmark-store"],
      ["summary", "cuda-summary"],
    ]);
    // The race's exit leaf is the metric referee: the measure stage inside it.
    expect(race?.exitStageId).toContain("measure");
    expect(compiled.stages.every((stage) => stage.stage.validate === true)).toBe(true);
    expect(compiled.stages.every((stage) => stage.stage.harness === "pi")).toBe(true);
    expect(compiled.stages.map((stage) => stage.stage.thinkingLevel)).toEqual([
      "high", "high", "high", "high", "high", "high",
    ]);
    // Lane entry takes no in-region dependency; the strategy is injected context.
    expect(compiled.stages.find((stage) => stage.stage.name === "idea")?.stage.from).toEqual(["profile"]);
    expect(compiled.stages.find((stage) => stage.stage.name === "implement")?.stage.from).toEqual([]);
    expect(compiled.stages.find((stage) => stage.stage.name === "measure")?.stage.from).toEqual(["implement"]);
  });
});

describe("gpu-cuda-tuning harness/model variants", () => {
  const baseStages = [
    ["setup", "cuda-setup"],
    ["profile", "cuda-profile"],
    ["idea", "cuda-idea"],
    ["implement", "cuda-implement-verify"],
    ["measure", "cuda-benchmark-store"],
    ["summary", "cuda-summary"],
  ] as const;

  it("pins every stage to dsh + deepseek-v4-flash on the serial pipeline", async () => {
    const compiled = await compileRecipeWorkflow("gpu-cuda-tuning-dsh");
    expect(compiled.name).toBe("gpu-cuda-tuning-dsh");
    expect(compiled.regions).toHaveLength(1);
    expect(compiled.stages.map((stage) => [stage.stage.name, stage.stage.worker])).toEqual(baseStages);
    expect(compiled.stages.map((stage) => stage.stage.harness)).toEqual(Array(6).fill("dsh"));
    expect(compiled.stages.map((stage) => stage.stage.model)).toEqual(Array(6).fill("deepseek-v4-flash"));
  });

  it("pins every stage to claude + deepseek-v4-flash on the serial pipeline", async () => {
    const compiled = await compileRecipeWorkflow("gpu-cuda-tuning-claude");
    expect(compiled.name).toBe("gpu-cuda-tuning-claude");
    expect(compiled.regions).toHaveLength(1);
    expect(compiled.stages.map((stage) => [stage.stage.name, stage.stage.worker])).toEqual(baseStages);
    expect(compiled.stages.map((stage) => stage.stage.harness)).toEqual(Array(6).fill("claude"));
    expect(compiled.stages.map((stage) => stage.stage.model)).toEqual(Array(6).fill("deepseek-v4-flash"));
  });

  it("pins every stage to claude + qwen3.8-flash on the qwen trial pipeline", async () => {
    const compiled = await compileRecipeWorkflow("gpu-cuda-tuning-qwen");
    expect(compiled.name).toBe("gpu-cuda-tuning-qwen");
    expect(compiled.regions).toHaveLength(1);
    expect(compiled.stages.map((stage) => [stage.stage.name, stage.stage.worker])).toEqual(baseStages);
    expect(compiled.stages.map((stage) => stage.stage.harness)).toEqual(Array(6).fill("claude"));
    // qwen3.8-flash is a deliberate, unproven trial choice (see README).
    expect(compiled.stages.map((stage) => stage.stage.model)).toEqual(Array(6).fill("qwen3.8-flash"));
  });
});

// The full eval matrix: harness x model x shape. Every cell compiles through
// the real loader (which also enforces exact native tool ids per harness) and
// pins its stage wiring, so a drifted recipe fails the gate.
describe("gpu-cuda-tuning eval matrix", () => {
  type Cell = {
    readonly recipe: string;
    readonly harness: "pi" | "claude" | "dsh";
    readonly model: string;
    readonly tournament: boolean;
  };
  const models = { dsv4: "deepseek-v4-flash", qwen: "qwen3.8-flash", luna: "gpt-5.6-luna" };
  const cells: readonly Cell[] = [
    // serial
    { recipe: "gpu-cuda-tuning-luna", harness: "claude", model: models.luna, tournament: false },
    { recipe: "gpu-cuda-tuning-dsh-qwen", harness: "dsh", model: models.qwen, tournament: false },
    { recipe: "gpu-cuda-tuning-dsh-luna", harness: "dsh", model: models.luna, tournament: false },
    { recipe: "gpu-cuda-tuning-pi-qwen", harness: "pi", model: models.qwen, tournament: false },
    { recipe: "gpu-cuda-tuning-pi-luna", harness: "pi", model: models.luna, tournament: false },
    // tournament
    { recipe: "gpu-cuda-tuning-tournament-claude", harness: "claude", model: models.dsv4, tournament: true },
    { recipe: "gpu-cuda-tuning-tournament-qwen", harness: "claude", model: models.qwen, tournament: true },
    { recipe: "gpu-cuda-tuning-tournament-luna", harness: "claude", model: models.luna, tournament: true },
    { recipe: "gpu-cuda-tuning-tournament-dsh", harness: "dsh", model: models.dsv4, tournament: true },
    { recipe: "gpu-cuda-tuning-tournament-dsh-qwen", harness: "dsh", model: models.qwen, tournament: true },
    { recipe: "gpu-cuda-tuning-tournament-dsh-luna", harness: "dsh", model: models.luna, tournament: true },
    { recipe: "gpu-cuda-tuning-tournament-pi-qwen", harness: "pi", model: models.qwen, tournament: true },
    { recipe: "gpu-cuda-tuning-tournament-pi-luna", harness: "pi", model: models.luna, tournament: true },
  ];

  for (const cell of cells) {
    it(`compiles ${cell.recipe} with uniform harness/model wiring`, async () => {
      const compiled = await compileRecipeWorkflow(cell.recipe);
      expect(compiled.name).toBe(cell.recipe);
      expect(compiled.stages.every((stage) => stage.stage.harness === cell.harness)).toBe(true);
      expect(compiled.stages.every((stage) => stage.stage.model === cell.model)).toBe(true);
      expect(compiled.stages.every((stage) => stage.stage.validate === true)).toBe(true);
      if (cell.tournament) {
        expect(compiled.regions.map((region) => region.kind).sort()).toEqual(["loop", "map"]);
        expect(compiled.stages.map((stage) => stage.stage.name)).toEqual([
          "setup", "profile", "idea", "implement", "measure", "summary",
        ]);
        expect(compiled.stages.find((stage) => stage.stage.name === "idea")?.stage.worker)
          .toBe("cuda-idea-tournament");
      } else {
        expect(compiled.regions).toHaveLength(1);
        expect(compiled.regions[0]?.kind).toBe("loop");
        expect(compiled.stages.map((stage) => stage.stage.worker)).toEqual([
          "cuda-setup", "cuda-profile", "cuda-idea", "cuda-implement-verify",
          "cuda-benchmark-store", "cuda-summary",
        ]);
      }
      // dsh's idea stage is the only one granted web search (its native tool id).
      const ideaTools = compiled.stages.find((stage) => stage.stage.name === "idea")?.stage.tools ?? [];
      if (cell.harness === "dsh") expect(ideaTools).toContain("web_search");
      else expect(ideaTools).not.toContain("web_search");
    });
  }
});
