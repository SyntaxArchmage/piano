import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { defaultRunsRoot } from "../../packages/logging/src/index.js";
import { logsCommand, readRunRowMetadata, runPickerLabel } from "../../packages/cli/src/logs.js";

describe("piano logs commands ", () => {
  let root: string;
  const runId = "20260821T120000-abc123";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logs-command-"));
    const runDir = join(root, runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "log.jsonl"), JSON.stringify({
      timestamp: "2026-08-21T10:32:07.123Z",
      severity: "info",
      stage: "session",
      event: "run.created",
      message: "Run created",
    }) + "\n", "utf8");
    await writeFile(join(runDir, "trace.jsonl"), JSON.stringify({
      timestamp: "2026-08-21T10:32:07.123Z",
      depth: 0,
      event: "exit",
      fn: "createSession",
      duration_ms: 1,
    }) + "\n", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("runs piano logs and renders the selected log", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await Effect.runPromise(logsCommand([], { runsRoot: root, pickRun: () => Effect.succeed(runId) }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(output).toHaveBeenCalledWith(expect.stringContaining(`Logs: ${runId}`));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("run.created"));
    } finally {
      output.mockRestore();
    }
  });

  it("defaults to the workspace hidden runs root", async () => {
    const pickRun = vi.fn(() => Effect.succeed(undefined));
    await Effect.runPromise(logsCommand([], { pickRun }).pipe(Effect.provide(NodeFileSystem.layer)));
    expect(pickRun).toHaveBeenCalledWith(defaultRunsRoot(), false);
  });

  it("runs piano logs --trace and renders the selected trace", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await Effect.runPromise(logsCommand(["--trace"], { runsRoot: root, pickRun: () => Effect.succeed(runId) }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(output).toHaveBeenCalledWith(expect.stringContaining(`Trace: ${runId}`));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("createSession"));
    } finally {
      output.mockRestore();
    }
  });

  it("runs the offline observability check without requiring a TTY", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const exit = await Effect.runPromiseExit(logsCommand(["--check", runId], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(exit._tag).toBe("Failure");
      expect(output).toHaveBeenCalledWith(expect.stringContaining(`OBSERVABILITY FAIL: ${runId}`));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("missing-file"));
    } finally {
      output.mockRestore();
    }
  });

  it("returns success for a complete offline evidence set", async () => {
    const timestamp = "2026-08-25T00:00:00.000Z";
    const runDir = join(root, runId);
    const transcriptPath = join(runDir, "transcript.jsonl");
    await Promise.all([
      writeFile(join(runDir, "log.jsonl"), JSON.stringify({ timestamp, run_id: runId, trace_id: "trace-1", event: "run.created" }) + "\n", "utf8"),
      writeFile(join(runDir, "trace.jsonl"), [
        { timestamp, run_id: runId, trace_id: "trace-1", seq: 1, depth: 0, span_id: "sp-1", parent_id: null, event: "enter", fn: "run" },
        { timestamp, run_id: runId, trace_id: "trace-1", seq: 2, depth: 0, span_id: "sp-1", parent_id: null, event: "exit", fn: "run", ok: true, duration_ms: 1 },
      ].map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8"),
      writeFile(join(runDir, "trajectory.jsonl"), JSON.stringify({
        version: 1,
        runId,
        timestamp,
        status: "completed",
        promptLength: 1,
        events: [],
        transcriptPath,
      }) + "\n", "utf8"),
      writeFile(transcriptPath, JSON.stringify({ type: "message", message: { role: "assistant", content: "done" } }) + "\n", "utf8"),
    ]);
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const exit = await Effect.runPromiseExit(logsCommand(["--check", runId], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(exit._tag).toBe("Success");
      expect(output).toHaveBeenCalledWith(expect.stringContaining(`OBSERVABILITY PASS: ${runId}`));
    } finally {
      output.mockRestore();
    }
  });

  it("rejects combining trace viewing with the offline check", async () => {
    const exit = await Effect.runPromiseExit(logsCommand(["--trace", "--check", runId], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error._tag).toBe("CliArgumentError");
    }
  });

  it("rejects repeated checks and run ids outside the runs root", async () => {
    const repeated = await Effect.runPromiseExit(logsCommand(["--check", runId, "--check", runId], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
    expect(repeated._tag).toBe("Failure");
    if (repeated._tag === "Failure" && repeated.cause._tag === "Fail") {
      expect(repeated.cause.error._tag).toBe("CliArgumentError");
    }

    const traversal = await Effect.runPromiseExit(logsCommand(["--check", "../outside"], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
    expect(traversal._tag).toBe("Failure");
    if (traversal._tag === "Failure" && traversal.cause._tag === "Fail") {
      expect(traversal.cause.error._tag).toBe("LogsStorageError");
    }
  });

  it("rejects removed command options", async () => {
    const exit = await Effect.runPromiseExit(logsCommand(["--verbose"], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error._tag).toBe("CliArgumentError");
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
    await writeFile(join(root, runId, "trajectory.json"), "x".repeat(200_000), "utf8");
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
