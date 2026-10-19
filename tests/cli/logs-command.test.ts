// `piano logs` locates a run and prints its absolute directory. The command
// owns no viewer: these tests pin the picker seam, the path on stdout, and the
// argument/run-id guards.
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { defaultRunsRoot } from "../../packages/logging/src/index.js";
import { logsCommand, runPickerLabel } from "../../packages/cli/src/logs.js";

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

describe("piano logs picker labels", () => {
  const runId = "20260821T120000-abc123";
  const row = { runId };

  it("composes the label from the row fields and truncates the prompt", () => {
    const prompt = 'Implement a `matmul.cu` that prints "TFLOPS: <value>"\nand nothing else.';
    const label = runPickerLabel(runId, {
      ...row,
      workflow: "gpu-cuda-tuning",
      status: "failed",
      prompt,
    });
    expect(label.startsWith("2026-08-21 12:00 · gpu-cuda-tuning · [failed] · Implement a `matmul.cu`")).toBe(true);
    expect(label.endsWith("…")).toBe(true);
  });

  it("omits a completed status and a missing workflow from the label", () => {
    expect(runPickerLabel(runId, { ...row, workflow: "w", status: "completed", prompt: "hi" }))
      .toBe("2026-08-21 12:00 · w · hi");
  });

  it("keeps the prompt of a run that failed before it named a workflow", () => {
    expect(runPickerLabel("20260821T150000-nowf01", {
      runId: "20260821T150000-nowf01",
      status: "failed",
      prompt: "hello",
    })).toBe("2026-08-21 15:00 · [failed] · hello");
  });

  it("degrades to an id+time row without metadata", () => {
    expect(runPickerLabel(runId, row)).toBe("2026-08-21 12:00");
    expect(runPickerLabel("legacy-dir", { runId: "legacy-dir" })).toBe("legacy-dir");
  });
});
