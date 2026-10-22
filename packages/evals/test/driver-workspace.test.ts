import { homedir, tmpdir } from "node:os";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { execFile } from "node:child_process";
import {
  copyWorkspaceTemplate,
  DEFAULT_EVALS_ROOT,
  DEFAULT_WORKSPACE_ROOT,
  loadCase,
  measureWorkspaceChanges,
  prepareWorkspaceDiffBaseline,
  progressTickLine,
} from "../src/driver.js";
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

  it("extracts a shared develop workspace archive into an isolated case directory", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "piano-eval-archive-"));
    temporaryRoots.push(workspaceRoot);
    const caseId = "aborted-subprocess-settlement-pi-deepseek-v4-flash-medium";
    const kase = await Effect.runPromise(
      loadCase(DEFAULT_EVALS_ROOT, caseId).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    const workspaceDir = await Effect.runPromise(
      copyWorkspaceTemplate(DEFAULT_EVALS_ROOT, kase, workspaceRoot, "eval-archive").pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    );

    await expect(stat(join(workspaceDir, "package.json"))).resolves.toMatchObject({});
    await expect(stat(join(workspaceDir, "packages", "harness", "src", "subprocess.ts"))).resolves.toMatchObject({});
    await expect(stat(join(workspaceDir, ".git"))).rejects.toThrow();
  });

  it("measures delivered lines against the grader baseline across agent commits", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "piano-eval-diff-"));
    temporaryRoots.push(workspaceDir);
    await writeFile(join(workspaceDir, "changed.txt"), "one\ntwo\n", "utf8");
    await writeFile(join(workspaceDir, "deleted.txt"), "gone\n", "utf8");
    const baseline = await prepareWorkspaceDiffBaseline(workspaceDir);

    await writeFile(join(workspaceDir, "changed.txt"), "one\nchanged\nextra\n", "utf8");
    await rm(join(workspaceDir, "deleted.txt"));
    await writeFile(join(workspaceDir, "added.txt"), "new\nlines\n", "utf8");
    await new Promise<void>((resolve, reject) => {
      execFile("git", ["init", "--quiet"], { cwd: workspaceDir }, (initError) => {
        if (initError !== null) return reject(initError);
        execFile("git", ["add", "--all"], { cwd: workspaceDir }, (addError) => {
          if (addError !== null) return reject(addError);
          execFile("git", [
            "-c", "user.name=Eval Agent",
            "-c", "user.email=agent@localhost",
            "commit", "--quiet", "--message=agent changes",
          ], { cwd: workspaceDir }, (commitError) => commitError === null ? resolve() : reject(commitError));
        });
      });
    });

    await expect(measureWorkspaceChanges(workspaceDir, baseline)).resolves.toEqual({
      files: 3,
      additions: 4,
      deletions: 2,
      total: 6,
      testIntegrity: { cheating: false, addedFiles: 0, modifiedFiles: 0, deletedFiles: 0 },
    });
  });

  it("rejects a case id that escapes the run root before deleting anything", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "piano-eval-boundary-"));
    temporaryRoots.push(workspaceRoot);
    const sentinel = join(workspaceRoot, "sentinel.txt");
    await writeFile(sentinel, "keep", "utf8");

    const result = await Effect.runPromiseExit(
      copyWorkspaceTemplate(DEFAULT_EVALS_ROOT, { ...fakeCase("safe"), id: "../.." }, workspaceRoot, "run").pipe(
        Effect.provide(NodeFileSystem.layer),
      ),
    );

    expect(result._tag).toBe("Failure");
    await expect(stat(sentinel)).resolves.toMatchObject({});
  });

  it("flags modified or deleted existing tests while allowing new test files", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "piano-eval-test-integrity-"));
    temporaryRoots.push(workspaceDir);
    await mkdir(join(workspaceDir, "tests"), { recursive: true });
    await writeFile(join(workspaceDir, "tests", "existing.test.ts"), "test('old', () => {})\n", "utf8");
    const baseline = await prepareWorkspaceDiffBaseline(workspaceDir);
    await writeFile(join(workspaceDir, "tests", "existing.test.ts"), "test('changed', () => {})\n", "utf8");
    await writeFile(join(workspaceDir, "tests", "new.test.ts"), "test('new', () => {})\n", "utf8");

    const changes = await measureWorkspaceChanges(workspaceDir, baseline);

    expect(changes.testIntegrity).toEqual({
      cheating: true,
      addedFiles: 1,
      modifiedFiles: 1,
      deletedFiles: 0,
    });
  });

  it("renders a live progress tick from the run directory files", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "piano-eval-tick-"));
    temporaryRoots.push(runDir);
    await writeFile(join(runDir, "status.json"), JSON.stringify({
      version: 1,
      runId: "piano-eval-tick",
      status: "running",
      completedStages: 12,
      plannedStages: 82,
      current: { stageId: "tune.race.implement" },
    }));
    await mkdir(join(runDir, "eval-metrics"), { recursive: true });
    await writeFile(join(runDir, "eval-metrics", "benchmark.jsonl"), [
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
