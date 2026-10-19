import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { findNewRunDir, matchNewRunDir, progressTickLine } from "../src/driver.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("eval run-directory association", () => {
  it("returns the only new run", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-association-"));
    roots.push(root);
    await mkdir(join(root, "run-a"));

    const result = await Effect.runPromise(findNewRunDir(root, new Set(), "/tmp/workspace-a", Date.now() - 1_000));
    expect(result.path).toBe(join(root, "run-a"));
    expect(result.reason).toBeUndefined();
  });

  it("matches the workspace across concurrent new runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-association-"));
    roots.push(root);
    await mkdir(join(root, "run-a"));
    await mkdir(join(root, "run-b"));
    await writeFile(join(root, "run-b", "log.jsonl"), JSON.stringify({ workspace: "/tmp/workspace-b" }));

    const result = await Effect.runPromise(findNewRunDir(root, new Set(), "/tmp/workspace-b", Date.now() - 1_000));
    expect(result.path).toBe(join(root, "run-b"));
    expect(result.candidates).toEqual(["run-a", "run-b"]);
  });

  it("does not attach a lone run that explicitly belongs to another workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-association-"));
    roots.push(root);
    await mkdir(join(root, "run-a"));
    await writeFile(join(root, "run-a", "log.jsonl"), JSON.stringify({ workspace: "/tmp/other" }));

    const result = await Effect.runPromise(findNewRunDir(root, new Set(), "/tmp/workspace-a", Date.now() - 1_000));
    expect(result.path).toBeUndefined();
    expect(result.reason).toContain("does not reference workspace");
  });

  it("does not confuse a workspace prefix with another workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-association-"));
    roots.push(root);
    await mkdir(join(root, "run-a"));
    await writeFile(join(root, "run-a", "log.jsonl"), JSON.stringify({ workspace: "/tmp/workspace-a-other" }));

    const result = await Effect.runPromise(findNewRunDir(root, new Set(), "/tmp/workspace-a", Date.now() - 1_000));
    expect(result.path).toBeUndefined();
    expect(result.reason).toContain("does not reference workspace");
  });

  it("fails closed when concurrent runs cannot be uniquely associated", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-association-"));
    roots.push(root);
    await mkdir(join(root, "run-a"));
    await mkdir(join(root, "run-b"));

    const result = await Effect.runPromise(findNewRunDir(root, new Set(), "/tmp/workspace-c", Date.now() - 1_000));
    expect(result.path).toBeUndefined();
    expect(result.reason).toContain("could not associate");
    expect(result.candidates).toEqual(["run-a", "run-b"]);
  });
});

describe("live-progress run-directory binding", () => {
  it("binds a lone candidate even before it emits evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-binding-"));
    roots.push(root);
    await mkdir(join(root, "run-a"));

    // The poller must not stall on a single new run that has not written its
    // first log line yet; completion-time findNewRunDir still fails closed.
    expect(matchNewRunDir(root, ["run-a"], "/tmp/workspace-a")).toBe("run-a");
  });

  it("binds only the uniquely matching run among concurrent candidates", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-binding-"));
    roots.push(root);
    await mkdir(join(root, "run-a"));
    await mkdir(join(root, "run-b"));
    await writeFile(join(root, "run-b", "progress.jsonl"), JSON.stringify({ workspace: { cwd: "/tmp/workspace-b" } }));

    expect(matchNewRunDir(root, ["run-a", "run-b"], "/tmp/workspace-b")).toBe("run-b");
  });

  it("returns undefined when concurrent candidates cannot be uniquely associated", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-binding-"));
    roots.push(root);
    await mkdir(join(root, "run-a"));
    await mkdir(join(root, "run-b"));

    // No evidence yet: the tick is skipped rather than borrowed from a
    // possibly foreign run.
    expect(matchNewRunDir(root, ["run-a", "run-b"], "/tmp/workspace-a")).toBeUndefined();
    await writeFile(join(root, "run-a", "log.jsonl"), JSON.stringify({ workspace: "/tmp/workspace-a" }));
    await writeFile(join(root, "run-b", "log.jsonl"), JSON.stringify({ workspace: "/tmp/workspace-a" }));
    // Ambiguous match: still undefined.
    expect(matchNewRunDir(root, ["run-a", "run-b"], "/tmp/workspace-a")).toBeUndefined();
  });
});

// Deterministic fake agents: concurrent `piano evals` cases each get a poller
// tick composed exactly as runCase composes it — bind the new run directories
// with matchNewRunDir, then render with progressTickLine. The run layouts are
// written here in the engine's on-disk shapes (workspace reference in an
// evidence stream; progress.json snapshot; trajectories/benchmark.jsonl), so
// presentation isolation is tested without spawning anything or waiting on
// the non-injectable 60s poll interval.
describe("parallel presentation", () => {
  async function fakeRun(
    root: string,
    id: string,
    workspace: string,
    progress: { completed: number; planned: number; stage: string; iteration: number; best: number },
  ): Promise<void> {
    await mkdir(join(root, id));
    await mkdir(join(root, id, "eval-metrics"));
    await writeFile(join(root, id, "log.jsonl"), JSON.stringify({ type: "run.started", workspace }) + "\n");
    await writeFile(join(root, id, "status.json"), JSON.stringify({
      version: 1,
      runId: id,
      status: "running",
      completedStages: progress.completed,
      plannedStages: progress.planned,
      current: { stageId: progress.stage },
    }));
    await writeFile(join(root, id, "eval-metrics", "benchmark.jsonl"), JSON.stringify({
      iteration: progress.iteration,
      metric: { name: "tflops", unit: "TFLOPS", direction: "higher", best: progress.best },
    }) + "\n");
  }

  it("each concurrent case renders only its own progress line", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-present-"));
    roots.push(root);
    await fakeRun(root, "run-a", "/tmp/ws-a", { completed: 5, planned: 82, stage: "tune.idea", iteration: 3, best: 7.5 });
    await fakeRun(root, "run-b", "/tmp/ws-b", { completed: 61, planned: 82, stage: "summary", iteration: 9, best: 8.0 });
    const created = ["run-a", "run-b"];
    const startedAt = Date.now();

    const boundA = matchNewRunDir(root, created, "/tmp/ws-a");
    const boundB = matchNewRunDir(root, created, "/tmp/ws-b");
    expect(boundA).toBe("run-a");
    expect(boundB).toBe("run-b");

    const lineA = progressTickLine("case-a#1", join(root, boundA!), startedAt);
    const lineB = progressTickLine("case-b#1", join(root, boundB!), startedAt);
    expect(lineA).toContain("stages=5/82");
    expect(lineA).toContain("current=tune.idea");
    expect(lineA).toContain("iter=3");
    expect(lineA).toContain("best=7.5000 tflops");
    expect(lineA).not.toContain("summary");
    expect(lineA).not.toContain("8.0000");
    expect(lineA).not.toContain("/tmp/ws-b");
    expect(lineB).toContain("stages=61/82");
    expect(lineB).toContain("current=summary");
    expect(lineB).toContain("iter=9");
    expect(lineB).toContain("best=8.0000 tflops");
    expect(lineB).not.toContain("tune.idea");
    expect(lineB).not.toContain("7.5000");
    expect(lineB).not.toContain("/tmp/ws-a");
  });

  it("renders nothing while concurrent candidates stay unassociated", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-present-"));
    roots.push(root);
    // Two foreign runs emitted no evidence yet: neither poller may bind, so
    // each skips the tick (runCase: `if (associated === undefined) continue`).
    await mkdir(join(root, "run-c"));
    await mkdir(join(root, "run-d"));

    expect(matchNewRunDir(root, ["run-c", "run-d"], "/tmp/ws-a")).toBeUndefined();
    expect(matchNewRunDir(root, ["run-c", "run-d"], "/tmp/ws-b")).toBeUndefined();
  });

  it("a late foreign entrant does not blur an already-associated case", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-present-"));
    roots.push(root);
    await fakeRun(root, "run-a", "/tmp/ws-a", { completed: 5, planned: 82, stage: "tune.idea", iteration: 3, best: 7.5 });
    await mkdir(join(root, "run-e")); // foreign run, evidence still pending

    // Unique match among candidates keeps case-a's line stable even while the
    // window is not clean: the binding ignores evidence-less other runs.
    const bound = matchNewRunDir(root, ["run-a", "run-e"], "/tmp/ws-a");
    expect(bound).toBe("run-a");
    expect(progressTickLine("case-a#1", join(root, bound!), Date.now())).toContain("stages=5/82");
  });
});
