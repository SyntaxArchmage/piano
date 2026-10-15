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
    await writeFile(join(root, runId, "trajectory.jsonl"), "x".repeat(200_000), "utf8");
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

describe("piano logs --jobs", () => {
  let root: string;
  const runId = "20260821T120000-abc123";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "piano-logs-jobs-"));
    const runDir = join(root, runId);
    await mkdir(runDir, { recursive: true });
    // Two jobs: the first paused after accepting two invocations (one on its
    // second attempt), the second alive mid-span. The fold under test is the
    // same one `/continue` consumes.
    const records = [
      {
        version: 1, kind: "execution-started", timestamp: "2026-08-21T10:00:00.000Z",
        runId: runId, jobOrdinal: 1, prompt: "fix the matmul kernel", resumed: false,
      },
      {
        version: 1, kind: "stage-started", timestamp: "2026-08-21T10:00:01.000Z",
        runId: runId, jobOrdinal: 1, invocationId: "tune.profile@root",
        stageId: "tune.profile", stage: "Profile", worker: "cuda-profile", attempt: 1,
      },
      {
        version: 1, timestamp: "2026-08-21T10:00:02.000Z",
        runId: runId, jobOrdinal: 1, invocationId: "tune.profile@root",
        stageId: "tune.profile", stage: "Profile", worker: "cuda-profile", attempt: 2,
      },
      {
        version: 1, timestamp: "2026-08-21T10:00:03.000Z",
        runId: runId, jobOrdinal: 1, invocationId: "tune.race@tune/iter-0/tune.race/slot-1",
        stageId: "tune.race", stage: "Race", worker: "cuda-idea", attempt: 1,
      },
      {
        version: 1, kind: "execution-finished", timestamp: "2026-08-21T10:00:04.000Z",
        runId: runId, status: "paused",
      },
      {
        version: 1, kind: "execution-started", timestamp: "2026-08-21T10:05:00.000Z",
        runId: runId, jobOrdinal: 2, prompt: "second pass", resumed: true,
      },
      {
        version: 1, kind: "stage-started", timestamp: "2026-08-21T10:05:01.000Z",
        runId: runId, jobOrdinal: 2, invocationId: "tune.profile@root",
        stageId: "tune.profile", stage: "Profile", worker: "cuda-profile", attempt: 1,
      },
    ];
    await writeFile(join(runDir, "progress.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists each job with its state, span and accepted counts", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await Effect.runPromise(logsCommand(["--jobs", runId], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(output).toHaveBeenCalledWith(expect.stringContaining(`Jobs: ${runId}`));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("#1"));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("paused"));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("accepted=2"));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("fix the matmul kernel"));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("#2"));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("alive"));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("second pass"));
    } finally {
      output.mockRestore();
    }
  });

  it("says so when the ledger predates the job ledger instead of listing nothing", async () => {
    // The real shape every run on this machine before the refactor has: accepted
    // lines carrying no kind and no execution anchor to group them by.
    const legacy = [
      {
        version: 1, timestamp: "2026-08-20T10:00:00.000Z", executionId: runId,
        invocationId: "tuning@root", stageId: "tuning", stage: "tuning", worker: "basic", attempt: 1,
      },
    ];
    await writeFile(join(root, runId, "progress.jsonl"), legacy.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await Effect.runPromise(logsCommand(["--jobs", runId], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(output).toHaveBeenCalledWith(expect.stringContaining(`Jobs: ${runId}`));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("no records this build reads"));
    } finally {
      output.mockRestore();
    }
  });

  it("prints one job's spans and accepted invocations with attempts", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await Effect.runPromise(logsCommand(["--jobs", "--job", "1", runId], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("Job #1"));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("span 1"));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("2026-08-21T10:00:00.000Z"));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("2026-08-21T10:00:04.000Z"));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("tune.profile@root"));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("attempt=2"));
      expect(output).toHaveBeenCalledWith(expect.stringContaining("tune.race@tune/iter-0/tune.race/slot-1"));
    } finally {
      output.mockRestore();
    }
  });

  it("uses the picker when no run id is given", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const pickable = vi.fn(() => Effect.succeed(runId));
    try {
      await Effect.runPromise(logsCommand(["--jobs"], { runsRoot: root, pickRun: pickable }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(pickable).toHaveBeenCalledWith(root, false);
      expect(output).toHaveBeenCalledWith(expect.stringContaining(`Jobs: ${runId}`));
    } finally {
      output.mockRestore();
    }
  });

  it("fails for a missing job with the available ordinals", async () => {
    const exit = await Effect.runPromiseExit(
      logsCommand(["--jobs", "--job", "9", runId], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error._tag).toBe("LogsStorageError");
      expect(exit.cause.error.message).toContain("#1");
      expect(exit.cause.error.message).toContain("#2");
    }
  });

  it("rejects --job without --jobs and combining --jobs with --trace", async () => {
    for (const args of [[ "--job", "1", runId ], [ "--jobs", "--trace", runId ]]) {
      const exit = await Effect.runPromiseExit(logsCommand(args, { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)));
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
        expect(exit.cause.error._tag).toBe("CliArgumentError");
      }
    }
  });

  it("refuses a run id outside the runs root", async () => {
    const exit = await Effect.runPromiseExit(
      logsCommand(["--jobs", "../outside"], { runsRoot: root }).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
      expect(exit.cause.error._tag).toBe("LogsStorageError");
    }
  });
});
