import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { matchNewRunDir } from "../src/run-locator.js";
import { progressTickLine, shellQuote, substituteCommand } from "../src/launcher.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// ISSUE-018 regression: a prompt containing an apostrophe (e.g. "candidate's")
// used to be escaped as `'\"'\"'` which embedded stray backslashes and left an
// unbalanced single quote. bash then split one logical `-p <prompt>` argv into
// many tokens, so the CLI rejected the arg and bash raised "unexpected EOF".
describe("shellQuote (ISSUE-018)", () => {
  it("escapes a single quote with the POSIX close/reopen idiom", () => {
    expect(shellQuote("candidate's core")).toBe("'candidate'\\''s core'");
  });

  it("keeps a multi-line prompt with an apostrophe as ONE argv token", () => {
    const prompt = "do not edit the grader's\n`verify.py` files.";
    // Keep this unit test process-free: runShell exercises the real bash
    // boundary, while this deterministic contract also works in restricted
    // test runners that cannot create child processes.
    expect(shellQuote(prompt)).toBe("'do not edit the grader'\\''s\n`verify.py` files.'");
  });
});

// Same argv-integrity family as ISSUE-018: substituteCommand inserted the
// quoted prompt via String.replaceAll with a plain string replacement, so `$`
// patterns inside any case prompt (`$&` in sed/regex mission text, or a
// `$'` apostrophe idiom) were expanded — `$&` injected the matched
// `<prompt>` placeholder back into the launched command.
describe("substituteCommand", () => {
  it("substitutes placeholder keys with literal values", () => {
    expect(substituteCommand("piano --workflow <workflow> -p <prompt>", {
      workflow: "'/work/gpu.yml'",
      prompt: "'optimize GEMM'",
    })).toBe("piano --workflow '/work/gpu.yml' -p 'optimize GEMM'");
  });

  it("keeps dollar patterns in the substituted value literal", () => {
    const value = shellQuote("run `sed 's/x/y/'` then echo $& and $' quoting");
    const command = substituteCommand("piano -p <prompt>", { prompt: value });
    // The old string-replacement form expanded `$&` into the matched
    // `<prompt>` placeholder and dropped `` $` ``/`$'` semantics.
    expect(command).toBe(`piano -p ${value}`);
    expect(command).not.toContain("<prompt>");
    expect(command).toContain("$&");
  });

  it("never rescans substituted values for other placeholders", () => {
    const prompt = shellQuote("set the <workflow> placeholder explicitly");
    const command = substituteCommand("piano -p <prompt> --workflow <workflow>", {
      prompt,
      workflow: "'/work/gpu.yml'",
    });
    // Sequential per-key replacement would re-enter the prompt text on the
    // later <workflow> pass and silently rewrite the user's task.
    expect(command).toBe(`piano -p ${prompt} --workflow '/work/gpu.yml'`);
  });

  it("returns the template unchanged for an empty variable set", () => {
    expect(substituteCommand("piano -p <prompt>", {})).toBe("piano -p <prompt>");
  });
});

describe("progressTickLine", () => {
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
    const empty = await mkdtemp(join(tmpdir(), "piano-eval-empty-"));
    temporaryRoots.push(empty);
    expect(progressTickLine("case#1", empty, Date.now())).toBeUndefined();
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
    temporaryRoots.push(root);
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
    temporaryRoots.push(root);
    // Two foreign runs emitted no evidence yet: neither poller may bind, so
    // each skips the tick (runCase: `if (associated === undefined) continue`).
    await mkdir(join(root, "run-c"));
    await mkdir(join(root, "run-d"));

    expect(matchNewRunDir(root, ["run-c", "run-d"], "/tmp/ws-a")).toBeUndefined();
    expect(matchNewRunDir(root, ["run-c", "run-d"], "/tmp/ws-b")).toBeUndefined();
  });

  it("a late foreign entrant does not blur an already-associated case", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-present-"));
    temporaryRoots.push(root);
    await fakeRun(root, "run-a", "/tmp/ws-a", { completed: 5, planned: 82, stage: "tune.idea", iteration: 3, best: 7.5 });
    await mkdir(join(root, "run-e")); // foreign run, evidence still pending

    // Unique match among candidates keeps case-a's line stable even while the
    // window is not clean: the binding ignores evidence-less other runs.
    const bound = matchNewRunDir(root, ["run-a", "run-e"], "/tmp/ws-a");
    expect(bound).toBe("run-a");
    expect(progressTickLine("case-a#1", join(root, bound!), Date.now())).toContain("stages=5/82");
  });
});
