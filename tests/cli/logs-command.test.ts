// `piano logs` locates a run and prints its absolute directory. The command
// owns no viewer: these tests pin the picker seam, the path on stdout, and the
// argument/run-id guards.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { defaultRunsRoot } from "../../packages/logging/src/index.js";
import { logsCommand, readRunRowMetadata, runPickerLabel } from "../../packages/cli/src/logs.js";

describe("piano logs", () => {
  let root: string;
  const runId = "20260821T120000-abc123";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logs-command-"));
    await mkdir(join(root, runId), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("prints the absolute run directory for an explicit run id", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await Effect.runPromise(logsCommand([runId], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(output).toHaveBeenCalledWith(join(root, runId));
    } finally {
      output.mockRestore();
    }
  });

  it("prints the selected run's directory when no id is given", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await Effect.runPromise(logsCommand([], { runsRoot: root, pickRun: () => Effect.succeed(runId) })
        .pipe(Effect.provide(NodeFileSystem.layer)));
      expect(output).toHaveBeenCalledWith(join(root, runId));
    } finally {
      output.mockRestore();
    }
  });

  it("prints nothing when the picker is cancelled", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await Effect.runPromise(logsCommand([], { runsRoot: root, pickRun: () => Effect.succeed(undefined) })
        .pipe(Effect.provide(NodeFileSystem.layer)));
      expect(output).not.toHaveBeenCalled();
    } finally {
      output.mockRestore();
    }
  });

  it("defaults to the workspace hidden runs root", async () => {
    const pickRun = vi.fn(() => Effect.succeed(undefined));
    await Effect.runPromise(logsCommand([], { pickRun }).pipe(Effect.provide(NodeFileSystem.layer)));
    expect(pickRun).toHaveBeenCalledWith(defaultRunsRoot());
  });

  it("rejects a run id outside the runs root", async () => {
    const exit = await Effect.runPromiseExit(logsCommand(["../outside"], { runsRoot: root })
      .pipe(Effect.provide(NodeFileSystem.layer)));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error._tag).toBe("LogsStorageError");
    }
  });

  it("fails for a run id with no directory", async () => {
    const exit = await Effect.runPromiseExit(logsCommand(["20260821T130000-def456"], { runsRoot: root })
      .pipe(Effect.provide(NodeFileSystem.layer)));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error._tag).toBe("LogsStorageError");
      expect(exit.cause.error.message).toContain("no run directory");
    }
  });

  it("rejects options and more than one run id", async () => {
    for (const args of [["--trace"], [runId, runId]]) {
      const exit = await Effect.runPromiseExit(logsCommand(args, { runsRoot: root })
        .pipe(Effect.provide(NodeFileSystem.layer)));
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
        expect(exit.cause.error._tag).toBe("CliArgumentError");
      }
    }
  });
});

describe("piano logs picker rows", () => {
  let root: string;
  const runId = "20260821T120000-abc123";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logs-picker-"));
    await mkdir(join(root, runId), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("takes the row from the run's state document", async () => {
    const prompt = 'Implement a `matmul.cu` that prints "TFLOPS: <value>"\nand nothing else.';
    // One small document is the whole row. The trajectory beside it is the
    // evidence and is never opened to list a run.
    await mkdir(join(root, runId, "system-log"), { recursive: true });
    await writeFile(join(root, runId, "system-log", "trajectory.jsonl"), "x".repeat(200_000), "utf8");
    await writeFile(join(root, runId, "status.json"), JSON.stringify({
      version: 1,
      runId,
      status: "failed",
      workflowPath: "/home/albert/.piano/gpu-cuda-tuning.yml",
      turns: [{ prompt, status: "failed", eventCount: 3 }],
    }), "utf8");

    expect(readRunRowMetadata(join(root, runId))).toEqual({
      workflow: "gpu-cuda-tuning",
      status: "failed",
      prompt,
    });
    const label = runPickerLabel(runId, readRunRowMetadata(join(root, runId)));
    expect(label.startsWith("2026-08-21 12:00 · gpu-cuda-tuning · [failed] · Implement a `matmul.cu`")).toBe(true);
    expect(label.endsWith("…")).toBe(true);
  });

  it("omits a completed status and a missing workflow from the label", () => {
    expect(runPickerLabel(runId, { workflow: "w", status: "completed", prompt: "hi" }))
      .toBe("2026-08-21 12:00 · w · hi");
  });

  it("keeps the row of a run that failed before it named a workflow", async () => {
    // A run can fail while loading its workflow, so its state has a prompt and
    // no workflowPath. The row must keep the prompt rather than dropping to an
    // id+time label.
    const runIdNoWorkflow = "20260821T150000-nowf01";
    await mkdir(join(root, runIdNoWorkflow), { recursive: true });
    await writeFile(join(root, runIdNoWorkflow, "status.json"), JSON.stringify({
      version: 1,
      runId: runIdNoWorkflow,
      status: "failed",
      turns: [{ prompt: "hello", status: "failed", eventCount: 0 }],
    }), "utf8");

    expect(readRunRowMetadata(join(root, runIdNoWorkflow))).toEqual({ status: "failed", prompt: "hello" });
  });

  it("degrades to an id+time row without a state document", () => {
    const missing = join(root, "20260821T130000-def456");
    expect(readRunRowMetadata(missing)).toEqual({});
    expect(runPickerLabel(runId, {})).toBe("2026-08-21 12:00");
    expect(runPickerLabel("legacy-dir", {})).toBe("legacy-dir");
  });
});
