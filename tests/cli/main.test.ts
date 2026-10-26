import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Fiber } from "effect";

vi.mock("@piano/logging", async (importOriginal) => ({
  ...(await importOriginal()),
  createSession: vi.fn(),
  createStagingSession: vi.fn(),
}));

vi.mock("../../packages/cli/src/tui.js", () => ({
  runTui: vi.fn(() => Effect.succeed({ type: "closed" as const })),
}));

vi.mock("@piano/orchestrator", () => ({
  LOAD_SOURCE: { module: "orchestrator", file: "workflow-file.ts", function: "loadDefaultWorkflow" },
  EXPLICIT_LOAD_SOURCE: { module: "orchestrator", file: "workflow-file.ts", function: "loadWorkflow" },
  compileWorkflow: vi.fn(() => Effect.succeed({
    name: "smoke",
    sourcePath: "/tmp/piano/workflow.yml",
    stages: [],
    regions: [],
    nodes: [],
  })),
  executeWorkflow: vi.fn(),
  loadAndExecuteWorkflow: vi.fn(),
  // A fresh fixture run has no progress stream, so there is nothing to continue.
  readWorkflowExecutionContinuation: vi.fn(() => Effect.succeed(undefined)),
  readRunStatus: vi.fn(() => Effect.succeed(undefined)),
  isWorkflowIdentifier: (value: string) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value),
  mnemonicNamespace: (slug: string, runId: string) => `${slug}-${runId}`,
  WorkflowError: class WorkflowError extends Error {},
  refreshRunStatus: vi.fn(() => Effect.void),
  reconcileCrashedRun: vi.fn(() => Effect.succeed(false)),
  runStatusPath: (runDir: string) => `${runDir}/status.json`,
  loadWorkflow: vi.fn(() => Effect.succeed({
    root: "/tmp/piano",
    workflowPath: "/tmp/piano/workflow.yml",
    document: { version: 3, workflow: { name: "smoke", nodes: [] } },
  })),
  loadDefaultWorkflow: vi.fn(() => Effect.succeed({
    root: "/tmp/piano",
    workflowPath: "/tmp/piano/workflow.yml",
    document: { version: 3, workflow: { name: "smoke", nodes: [] } },
  })),
  setWorkflowSelection: vi.fn(() => Effect.void),
  builtinWorkflowSelection: (name: string) => `builtin:${name}`,
}));

import { createSession, createStagingSession, type StagingSession } from "@piano/logging";
import { compileWorkflow, executeWorkflow, loadWorkflow } from "@piano/orchestrator";
import { runTui } from "../../packages/cli/src/tui.js";
import { main } from "../../packages/cli/src/main.js";

const trajectoryWrite = vi.fn(() => Effect.void);
const session = {
  id: "rebirth-test",
  root: "/tmp/piano",
  runDir: "/tmp/piano/.piano.runs/rebirth-test",
  cwd: "/tmp/piano/project",
  log: {
    append: vi.fn(() => Effect.void),
    flush: vi.fn(() => Effect.void),
  },
  trace: {
    enter: vi.fn(() => Effect.succeed({ spanId: "test", parentId: null, depth: 0, fn: "test", startedAt: 0 })),
    currentSpan: vi.fn(() => Effect.succeed(undefined)),
    exit: vi.fn(() => Effect.void),
    error: vi.fn(() => Effect.void),
    flush: vi.fn(() => Effect.void),
  },
  trajectory: {
    path: "/tmp/piano/.piano.runs/rebirth-test/trajectory.json",
    write: trajectoryWrite,
    flush: vi.fn(() => Effect.void),
  },
  commit: vi.fn(() => Effect.void),
} as unknown as StagingSession;

describe("reborn CLI entrypoint", () => {
  beforeEach(() => {
    vi.mocked(createSession).mockReset().mockReturnValue(Effect.succeed(session));
    vi.mocked(createStagingSession).mockReset().mockReturnValue(session);
    vi.mocked(runTui).mockReset().mockReturnValue(Effect.succeed({ type: "closed" as const }));
    vi.mocked(loadWorkflow).mockReset().mockReturnValue(Effect.succeed({
      root: "/tmp/piano",
      workflowPath: "/tmp/piano/workflow.yml",
      document: { version: 3, workflow: { name: "smoke", nodes: [] } },
    }));
    vi.mocked(compileWorkflow).mockReset().mockReturnValue(Effect.succeed({
      name: "smoke",
      sourcePath: "/tmp/piano/workflow.yml",
      stages: [],
      regions: [],
      nodes: [],
      monitor: false,
    }));
    vi.mocked(executeWorkflow).mockReset();
    trajectoryWrite.mockClear();
  });

  it("opens the generic TUI with one fresh logging session", async () => {
    await Effect.runPromise(main().pipe(Effect.provide(NodeFileSystem.layer)));

    expect(createStagingSession).toHaveBeenCalledWith({ cwd: process.cwd() });
    expect(runTui).toHaveBeenCalledWith(expect.objectContaining({
      runPrompt: expect.any(Function),
      workflowGraph: expect.objectContaining({ stages: [] }),
      statusPath: "/tmp/piano/.piano.runs/rebirth-test/status.json",
    }));
  });

  it("connects the TUI interrupt effect to the active workflow signal", async () => {
    let receivedSignal: AbortSignal | undefined;
    let abortedByTui = false;
    let workflowStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => { workflowStarted = resolve; });
    vi.mocked(executeWorkflow).mockImplementation((_loaded, request) => {
      receivedSignal = request.signal;
      workflowStarted();
      return Effect.never;
    });
    vi.mocked(runTui).mockImplementation((options) => {
      if (options === undefined) return Effect.succeed({ type: "closed" as const });
      return Effect.gen(function* () {
        const prompt = options.runPrompt?.("interrupt this task", () => {});
        if (prompt === undefined) return { type: "closed" as const };
        const fiber = yield* Effect.fork(prompt);
        // A prompt reads its resume continuation before executing, so the
        // signal exists only once execution has actually begun.
        yield* Effect.promise(() => started);
        yield* (options.onInterrupt?.("mission") ?? Effect.void);
        abortedByTui = receivedSignal?.aborted ?? false;
        yield* Fiber.interrupt(fiber);
        return { type: "closed" as const };
      });
    });

    await Effect.runPromise(main().pipe(Effect.provide(NodeFileSystem.layer)));

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(abortedByTui).toBe(true);
  });

  it("loads an explicit workflow before entering the execution boundary", async () => {
    vi.mocked(executeWorkflow).mockReturnValue(Effect.succeed({ text: "ok" } as never));
    vi.mocked(runTui).mockImplementation((options) =>
      options?.runPrompt === undefined
        ? Effect.succeed({ type: "closed" as const })
        : options.runPrompt("check workflow", () => {}).pipe(
          Effect.as({ type: "closed" as const }),
          Effect.catchAll(() => Effect.succeed({ type: "closed" as const })),
        ),
    );

    await Effect.runPromise(main(["--workflow", "./special-workflow.yml"]).pipe(Effect.provide(NodeFileSystem.layer)));

    expect(loadWorkflow).toHaveBeenCalledWith("./special-workflow.yml", session.root);
    expect(executeWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({}));
  });

  it("fails an explicit workflow load instead of opening an empty TUI", async () => {
    vi.mocked(loadWorkflow).mockReturnValue(Effect.fail({
      _tag: "WorkflowError",
      phase: "load",
      path: "/tmp/missing-workflow.yml",
      message: "workflow load failed at /tmp/missing-workflow.yml: not found",
    } as never));

    const exit = await Effect.runPromiseExit(
      main(["--workflow", "/tmp/missing-workflow.yml"]).pipe(Effect.provide(NodeFileSystem.layer)),
    );

    expect(exit._tag).toBe("Failure");
    expect(runTui).not.toHaveBeenCalled();
    expect(compileWorkflow).not.toHaveBeenCalled();
  });

  it("fails an explicit workflow compile instead of opening an untracked TUI", async () => {
    vi.mocked(compileWorkflow).mockReturnValue(Effect.fail({
      _tag: "WorkflowError",
      phase: "compile",
      path: "/tmp/broken-workflow.yml",
      message: "workflow compile failed at /tmp/broken-workflow.yml: invalid graph",
    } as never));

    const exit = await Effect.runPromiseExit(
      main(["--workflow", "/tmp/broken-workflow.yml"]).pipe(Effect.provide(NodeFileSystem.layer)),
    );

    expect(exit._tag).toBe("Failure");
    expect(runTui).not.toHaveBeenCalled();
  });

  it("runs a prompt in headless mode with an explicit workflow, skipping the TUI", async () => {
    vi.mocked(executeWorkflow).mockReturnValue(Effect.succeed({
      text: "workflow result",
      sessionId: "session",
      transcriptPath: "/tmp/session.jsonl",
    } as never));

    await Effect.runPromise(main(["--workflow", "./special-workflow.yml", "-p", "check workflow"]).pipe(Effect.provide(NodeFileSystem.layer)));

    expect(loadWorkflow).toHaveBeenCalledWith("./special-workflow.yml", session.root);
    expect(executeWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      prompt: "check workflow",
    }));
    expect(runTui).not.toHaveBeenCalled();
  });

  it("passes --mnemonic through as the run's lane namespace", async () => {
    vi.mocked(executeWorkflow).mockReturnValue(Effect.succeed({
      text: "workflow result",
      sessionId: "session",
      transcriptPath: "/tmp/session.jsonl",
    } as never));

    await Effect.runPromise(main(["--workflow", "./special-workflow.yml", "--mnemonic", "gemm", "-p", "tune gemm"]).pipe(Effect.provide(NodeFileSystem.layer)));

    expect(executeWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      mnemonic: `gemm-${session.id}`,
    }));
  });

  it("runs a bare -p prompt headless without opening the TUI", async () => {
    vi.mocked(executeWorkflow).mockReturnValue(Effect.succeed({
      text: "headless result",
      sessionId: "session",
      transcriptPath: "/tmp/session.jsonl",
    } as never));

    await Effect.runPromise(main(["-p", "answer this"]).pipe(Effect.provide(NodeFileSystem.layer)));

    expect(executeWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      prompt: "answer this",
    }));
    expect(runTui).not.toHaveBeenCalled();
  });

  it("accepts --prompt before --workflow", async () => {
    vi.mocked(executeWorkflow).mockReturnValue(Effect.succeed({
      text: "workflow result",
      sessionId: "session",
      transcriptPath: "/tmp/session.jsonl",
    } as never));

    await Effect.runPromise(main(["--prompt", "check workflow", "--workflow", "./special-workflow.yml"]).pipe(Effect.provide(NodeFileSystem.layer)));

    expect(loadWorkflow).toHaveBeenCalledWith("./special-workflow.yml", session.root);
    expect(executeWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      prompt: "check workflow",
    }));
  });

  it("accepts a positional prompt after headless and workflow flags", async () => {
    vi.mocked(executeWorkflow).mockReturnValue(Effect.succeed({
      text: "workflow result",
      sessionId: "session",
      transcriptPath: "/tmp/session.jsonl",
    } as never));

    await Effect.runPromise(main([
      "-p",
      "--json",
      "--workflow",
      "./special-workflow.yml",
      "check workflow",
    ]).pipe(Effect.provide(NodeFileSystem.layer)));

    expect(loadWorkflow).toHaveBeenCalledWith("./special-workflow.yml", session.root);
    expect(executeWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      prompt: "check workflow",
    }));
    expect(runTui).not.toHaveBeenCalled();
  });

  it("persists normalized events in callback order instead of rebuilding final text", async () => {
    const events = [
      { type: "resource", resource: { kind: "system-prompt", status: "loaded", path: "/tmp/system.md", bytes: 12 } },
      { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "ans = " } },
      { type: "tool_execution_end", toolCallId: "call-1", toolName: "none", result: "unused", isError: false },
      { type: "unknown", sourceType: "future_event", data: { preserved: true } },
    ] as const;
    vi.mocked(executeWorkflow).mockImplementation((_loaded, request) => Effect.sync(() => {
      events.forEach((event) => request.onEvent?.(event));
      return {
        workflow: "smoke",
        runId: "execution-test",
        stage: "smoke-test",
        worker: "smoke-test-agent",
        text: "final text",
        sessionId: "session",
        transcriptPath: "/tmp/session.jsonl",
        stages: [],
        terminalStages: [],
        progressPath: "/tmp/progress.jsonl",
      };
    }));
    vi.mocked(runTui).mockImplementation((options) => {
      const runPrompt = options?.runPrompt;
      if (runPrompt === undefined) return Effect.succeed({ type: "closed" as const });
      return runPrompt("record events", () => {}).pipe(
        Effect.as({ type: "closed" as const }),
        Effect.catchAll(() => Effect.succeed({ type: "closed" as const })),
      );
    });

    await Effect.runPromise(main().pipe(Effect.provide(NodeFileSystem.layer)));

    expect(trajectoryWrite).toHaveBeenCalledWith(expect.objectContaining({ events }));
  });

  it("persists a cancelled trajectory when the prompt fiber is interrupted", async () => {
    vi.mocked(executeWorkflow).mockReturnValue(Effect.never);
    vi.mocked(runTui).mockImplementation((options) =>
      Effect.gen(function* () {
        const prompt = options?.runPrompt?.("cancel this task", () => {});
        if (prompt === undefined) return { type: "closed" as const };
        const fiber = yield* Effect.fork(prompt);
        yield* Effect.sleep("10 millis");
        yield* Fiber.interrupt(fiber);
        return { type: "closed" as const };
      }),
    );

    await Effect.runPromise(main().pipe(Effect.provide(NodeFileSystem.layer)));

    expect(trajectoryWrite).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
  });

  it("rejects an incomplete workflow option before opening a session", async () => {
    const result = await Effect.runPromiseExit(main(["--workflow"]).pipe(Effect.provide(NodeFileSystem.layer)));

    expect(result._tag).toBe("Failure");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects an incomplete option after an earlier valid option", async () => {
    for (const args of [["-p", "first", "-p"], ["--workflow", "flow.yml", "--workflow"]]) {
      const result = await Effect.runPromiseExit(main(args).pipe(Effect.provide(NodeFileSystem.layer)));

      expect(result._tag).toBe("Failure");
      expect(createSession).not.toHaveBeenCalled();
    }
  });
});

