import { homedir, tmpdir } from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { copyWorkspaceTemplate, DEFAULT_EVALS_ROOT, DEFAULT_WORKSPACE_ROOT, progressTickLine } from "../src/driver.js";
import type { EvalCase } from "../src/types.js";

// A global module-level constant is evaluated once; cache the observed default
// before any test mutates the environment.
const observedRoot = DEFAULT_WORKSPACE_ROOT;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fakeCase(id: string): EvalCase {
  return {
    id,
    group: "performance",
    prompt: "implement",
    command: "piano --workflow <workflow> -p <prompt>",
    workspace: "workspace",
    readout: {
      kind: "programmatic",
      compileCommand: "python3 verify.py --compile",
      verifyCommand: "python3 verify.py --verify",
      benchmarkCommand: "python3 verify.py --bench",
      baselineCommand: "python3 verify.py --bench",
      metricPattern: "TFLOPS: ([0-9.]+)",
      tolerance: 0.0001,
    },
    metric: { name: "tflops", direction: "higher" },
    workload: { operator: "matmul", shape: "512x512x512 f32", language: "cuda", description: "dummy" },
    tags: [{ tag: "tflops", weight: 2 }],
  };
}

describe("eval workspace destination (ISSUE-016)", () => {
  it("defaults to the user-level eval root, not the caller's cwd", () => {
    // The whole point of ISSUE-016: the copy+execute target must live under
    // ~/.piano/evals so agent edits never mutate the checked-in case material.
    expect(observedRoot).toBe(join(homedir(), ".piano", "evals"));
    expect(observedRoot).not.toBe(process.cwd());
  });

  it("copies the workspace template under the eval root, leaving the source untouched", async () => {
    const runSetId = "eval-test";
    const workspaceRoot = await mkdtemp(join(tmpdir(), "piano-eval-workspace-"));
    temporaryRoots.push(workspaceRoot);
    const workspaceDir = await Effect.runPromise(
      copyWorkspaceTemplate(
        DEFAULT_EVALS_ROOT, // real case material root (resolves workloads/)
        fakeCase("cuda-matmul-tuning-pi-dsv4f"),
        workspaceRoot,
        runSetId,
      ).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    expect(workspaceDir).toBe(join(workspaceRoot, runSetId, "cuda-matmul-tuning-pi-dsv4f"));
    expect(workspaceDir.startsWith(join(workspaceRoot, runSetId))).toBe(true);
  });

  it("renders a live progress tick from the run directory files", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-eval-tick-"));
    temporaryRoots.push(runDir);
    await writeFile(join(runDir, "progress.json"), JSON.stringify({
      completedStages: 12,
      plannedStages: 82,
      current: { stageId: "tune.race.implement" },
    }));
    await mkdir(join(runDir, "trajectories"), { recursive: true });
    await writeFile(join(runDir, "trajectories", "benchmark.jsonl"), [
      JSON.stringify({ iteration: 0, metric: { name: "tflops", best: 5.5 } }),
      JSON.stringify({ iteration: 1, metric: { name: "tflops", best: 6.5 } }),
      // A later iteration that measured worse (reverted idea) must not drag
      // the displayed all-time best down.
      JSON.stringify({ iteration: 2, metric: { name: "tflops", best: 4.2 } }),
      "{torn-partial-line",
    ].join("\n"));
    const tick = progressTickLine("case#1", runDir, Date.now() - 120_000);
    expect(tick).toContain("  case#1");
    expect(tick).toContain("elapsed=2m");
    expect(tick).toContain("stages=12/82");
    expect(tick).toContain("current=tune.race.implement");
    expect(tick).toContain("iter=2");
    expect(tick).toContain("best=6.5000 tflops");
    // A directory with nothing readable yet yields no tick line.
    expect(progressTickLine("case#1", await mkdtemp(join(tmpdir(), "piano-eval-empty-")), Date.now())).toBeUndefined();
  });
});
