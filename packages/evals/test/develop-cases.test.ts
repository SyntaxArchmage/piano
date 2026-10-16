import { stat } from "node:fs/promises";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { DEFAULT_EVALS_ROOT, loadCases, workloadsDir } from "../src/driver.js";

const models = [
  "glm-5.3-flash",
  "qwen3.8-flash",
  "deepseek-v4-flash",
  "kimi-k3",
  "deepseek-v4-pro",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "claude-sonnet-4-6",
  "claude-opus-5",
  "claude-opus-4-6",
  "claude-opus-4-8",
] as const;
const crossHarnessModels = new Set([
  "glm-5.3-flash",
  "qwen3.8-flash",
  "deepseek-v4-flash",
  "gpt-5.6-luna",
]);
const abortedDshModels = new Set([
  "deepseek-v4-pro",
  "kimi-k3",
  "gpt-5.6-terra",
  "claude-sonnet-4-6",
]);
/** Mirrors the generator's dsh-only abort set: models the generated sweep
 * places on the abort task's dsh arm and nowhere else. The reservation covers
 * the sweep, so a hand-picked cell may still select the same id. */
const abortedDshOnlyModels = new Set([
  "claude-haiku-4-5-20251001",
  "claude-sonnet-5",
  "deepseek-flash",
  "mimo-v2.6-pro",
]);
/** The hand-picked coding-team cells: each names its workflow and model
 * directly instead of joining a generated sweep, so the sweep-membership rules
 * below do not constrain them. */
const handPickedWorkflows = new Set([
  "../../../recipes/workflows/team-claude.yml",
  "../../../recipes/workflows/team-claude-mimo.yml",
]);
describe("develop eval cases", () => {
  it("keeps every generated case self-describing and uniquely addressable", async () => {
    const cases = await Effect.runPromise(
      loadCases(DEFAULT_EVALS_ROOT, { group: "develop" }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((kase) => kase.id)).size).toBe(cases.length);
    expect(new Set(cases.map((kase) => kase.workflow)).size).toBeGreaterThan(0);

    for (const kase of cases) {
      expect(kase.group).toBe("develop");
      expect(kase.dimensions).toBeDefined();
      expect(kase.id).toBe(`${kase.dimensions!.task}-${kase.dimensions!.harness}-${kase.dimensions!.model}-${kase.dimensions!.effort}`);
      expect(["medium", "max"]).toContain(kase.dimensions!.effort);
      if (kase.dimensions!.harness !== "pi" && !handPickedWorkflows.has(kase.workflow ?? "")) {
        const onAbortTask = kase.dimensions!.task === "aborted-subprocess-settlement";
        const model = kase.dimensions!.model;
        expect(
          crossHarnessModels.has(model)
          || (onAbortTask && abortedDshModels.has(model))
          || (onAbortTask && abortedDshOnlyModels.has(model)),
        ).toBe(true);
      }
      expect(kase.tags.map(({ tag }) => tag)).toEqual(["sw-dev", "correctness", "code-change", "cost"]);
      expect(kase.command).toContain("piano --workflow <workflow> -p <prompt>");
      expect(kase.prepareCommand).toBe("npm install --ignore-scripts --no-audit --no-fund");
      expect(kase.readout.compileCommand).toBe("npm run typecheck");
      expect(kase.readout.verifyCommand).toBe("npm test");
      await expect(stat(join(workloadsDir(DEFAULT_EVALS_ROOT), kase.id, kase.workspace))).resolves.toMatchObject({});
      await expect(stat(join(workloadsDir(DEFAULT_EVALS_ROOT), kase.id, kase.workflow!))).resolves.toMatchObject({});
    }
  });

  it("ships the coding-team discuss case with its implementation workflow", async () => {
    const cases = await Effect.runPromise(
      loadCases(DEFAULT_EVALS_ROOT, { group: "develop" }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    const codingCase = cases.find((kase) => kase.id === "coding-team-questions-claude-deepseek-flash-max");
    expect(codingCase).toMatchObject({
      prompt: expect.stringContaining("discuss primitive"),
      workflow: "../../../recipes/workflows/team-claude.yml",
      dimensions: {
        task: "coding-team-questions",
        harness: "claude",
        model: "deepseek-flash",
        effort: "max",
      },
    });
  });

  it("pairs each deepseek-flash coding-team lane model with a mimo-v2.6-pro sibling", async () => {
    const cases = await Effect.runPromise(
      loadCases(DEFAULT_EVALS_ROOT, { group: "develop" }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    const mimoCase = cases.find((kase) => kase.id === "coding-team-questions-claude-mimo-v2.6-pro-max");
    expect(mimoCase).toMatchObject({
      prompt: expect.stringContaining("discuss primitive"),
      workflow: "../../../recipes/workflows/team-claude-mimo.yml",
      dimensions: {
        task: "coding-team-questions",
        harness: "claude",
        model: "mimo-v2.6-pro",
        effort: "max",
      },
    });
  });

  it("keeps the serial tournament case selectable as a tuning-cuda case only", async () => {
    const cases = await Effect.runPromise(
      loadCases(DEFAULT_EVALS_ROOT, { group: "tuning-cuda" }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    const serialCase = cases.find((kase) => kase.id === "cuda-matmul-tuning-tournament-pi-dsv4f-serial");
    if (serialCase === undefined) throw new Error("serial tournament case is missing");
    expect(serialCase).toMatchObject({
      group: "tuning-cuda",
      workflow: "../../../recipes/workflows/gpu-cuda-tuning-tournament-serial.yml",
      // Shares the concurrent arm's seed so the workflow switch is the only
      // variable between the two cases.
      workspace: "../cuda-matmul-tuning-tournament-pi-dsv4f/workspace",
      command: "piano --workflow <workflow> -p <prompt>",
    });
    expect(serialCase.tags.map(({ tag }) => tag)).toEqual(["tflops", "correctness"]);
    expect(serialCase.prompt).toContain("parallel: false");
    expect(serialCase.prompt).not.toContain("piano evals --parallel");
    await expect(stat(join(workloadsDir(DEFAULT_EVALS_ROOT), serialCase.id, serialCase.workspace)))
      .resolves.toMatchObject({});

    // `--group` also matches grader tags, so a `serial` tag would silently
    // add a second selector for this case. It must stay reachable through its
    // group and its id only.
    const bySerialGroup = await Effect.runPromise(
      loadCases(DEFAULT_EVALS_ROOT, { group: "serial" }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    expect(bySerialGroup).toEqual([]);
  });

  it("keeps non-cross-harness models on pi except for abort dsh cases", async () => {
    const cases = await Effect.runPromise(
      loadCases(DEFAULT_EVALS_ROOT, { group: "develop" }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    for (const model of models.filter((candidate) => !crossHarnessModels.has(candidate))) {
      const modelCases = cases.filter((kase) => kase.id.includes(`-${model}-`));
      expect(modelCases.length).toBeGreaterThan(0);
      expect(modelCases.filter((kase) => kase.id.includes("-dsh-")).every((kase) =>
        kase.id.includes("aborted-subprocess-settlement"),
      )).toBe(true);
      expect(modelCases.filter((kase) => kase.id.includes("footer-workflow-column-width"))).toHaveLength(2);
    }
  });

  it("keeps the dsh-only abort models to the abort task's dsh arms in the generated sweep", async () => {
    const cases = await Effect.runPromise(
      loadCases(DEFAULT_EVALS_ROOT, { group: "develop" }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    for (const model of abortedDshOnlyModels) {
      const swept = cases.filter((kase) =>
        kase.dimensions!.model === model && !handPickedWorkflows.has(kase.workflow ?? ""));
      // Exactly the abort task's two dsh arms: no pi arm, and no other swept
      // task, so adding a model here cannot widen the rest of the matrix. A
      // hand-picked cell may still select the same id for normal use.
      expect(swept.map((kase) => kase.id).sort()).toEqual([
        `aborted-subprocess-settlement-dsh-${model}-max`,
        `aborted-subprocess-settlement-dsh-${model}-medium`,
      ]);
      expect(swept.every((kase) => kase.dimensions!.harness === "dsh")).toBe(true);
    }
  });
});