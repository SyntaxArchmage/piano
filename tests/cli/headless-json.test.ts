import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";

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
  executeWorkflow: vi.fn(),
  loadAndExecuteWorkflow: vi.fn(),
  // A fresh fixture run has no progress stream, so there is nothing to continue.
  readWorkflowExecutionContinuation: vi.fn(() => Effect.succeed(undefined)),
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

import { createSession, createStagingSession } from "@piano/logging";
import { executeWorkflow } from "@piano/orchestrator";
import { main } from "../../packages/cli/src/main.js";
import {
  agentEventLine,
  completedLine,
  failedLine,
  serializeLine,
  startedLine,
} from "../../packages/cli/src/headless-json.js";

const trajectoryWrite = vi.fn(() => Effect.void);
const session = {
  id: "json-stream-run",
  root: "/tmp/piano",
  runDir: "/tmp/piano/.piano.runs/json-stream-run",
  cwd: "/tmp/piano/project",
  log: { append: vi.fn(() => Effect.void), flush: vi.fn(() => Effect.void) },
  trace: {
    enter: vi.fn(() => Effect.succeed({ spanId: "t", parentId: null, depth: 0, fn: "t", startedAt: 0 })),
    currentSpan: vi.fn(() => Effect.succeed(undefined)),
    exit: vi.fn(() => Effect.void),
    error: vi.fn(() => Effect.void),
    flush: vi.fn(() => Effect.void),
  },
  trajectory: {
    path: "/tmp/piano/.piano.runs/json-stream-run/trajectory.json",
    write: trajectoryWrite,
    flush: vi.fn(() => Effect.void),
  },
} as never;

function parseLines(written: string[]): unknown[] {
  return written
    .join("")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

/** Capture stdout writes. `vi.spyOn(process.stdout, "write")` is unreliable here
 * because `session-run.ts` holds the `stdout` binding from `node:process`; a
 * direct property override on the shared object is what the code path sees. */
function captureStdout() {
  const real = process.stdout.write;
  const calls: string[] = [];
  (process.stdout as { write: unknown }).write = ((chunk: unknown) => {
    calls.push(String(chunk));
    return true;
  }) as typeof real;
  return {
    calls,
    restore: () => {
      (process.stdout as { write: unknown }).write = real;
    },
  };
}

describe("reborn CLI --json event stream", () => {
  beforeEach(() => {
    vi.mocked(createSession).mockReset().mockReturnValue(Effect.succeed(session));
    vi.mocked(createStagingSession).mockReset().mockReturnValue(session);
    vi.mocked(executeWorkflow).mockReset();
    trajectoryWrite.mockClear();
  });

  it("emits run.started, agent_event lines, and run.completed to stdout", async () => {
    const events = [
      { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "hi" } },
      { type: "tool_execution_end", toolCallId: "c1", toolName: "none", result: "x", isError: false },
    ] as const;
    vi.mocked(executeWorkflow).mockImplementation((_loaded, request) => Effect.sync(() => {
      events.forEach((event) => request.onEvent?.(event));
      return {
        workflow: "smoke", runId: "execution-test", stage: "s", worker: "w", text: "final",
        sessionId: "sess-1", transcriptPath: "/tmp/sess-1.jsonl", stages: [], terminalStages: [], progressPath: "/tmp/progress.jsonl",
      };
    }));

    const out = captureStdout();
    try {
      await Effect.runPromise(main(["--json", "-p", "answer"]).pipe(Effect.provide(NodeFileSystem.layer)));
    } finally {
      out.restore();
    }

    const lines = parseLines(out.calls);
    expect(lines[0]).toMatchObject({ event: "run.started", run_id: "json-stream-run" });
    const agentEvents = lines.filter((line) => (line as { event: string }).event === "agent_event");
    expect(agentEvents).toHaveLength(2);
    expect(agentEvents[0]).toMatchObject({ run_id: "json-stream-run", type: "message_update" });
    expect(lines[lines.length - 1]).toMatchObject({
      event: "run.completed",
      run_id: "json-stream-run",
      status: "completed",
      session_id: "sess-1",
      progress_path: "/tmp/progress.jsonl",
      status_path: "/tmp/piano/.piano.runs/json-stream-run/status.json",
    });
  });

  it("emits run.failed when the workflow fails", async () => {
    vi.mocked(executeWorkflow).mockReturnValue(Effect.fail(new Error("boom")) as never);

    const out = captureStdout();
    try {
      await Effect.runPromise(main(["--json", "-p", "answer"]).pipe(Effect.provide(NodeFileSystem.layer)));
    } catch {
      // main propagates the failure after emitting run.failed
    } finally {
      out.restore();
    }

    const lines = parseLines(out.calls);
    expect(lines[lines.length - 1]).toMatchObject({ event: "run.failed", run_id: "json-stream-run", code: "run.failed" });
  });

  it("keeps -p text output when --json is absent", async () => {
    vi.mocked(executeWorkflow).mockReturnValue(Effect.succeed({
      workflow: "smoke", stage: "s", worker: "w", text: "plain", sessionId: "sess-1", transcriptPath: "/tmp/sess-1.jsonl",
    } as never));

    const out = captureStdout();
    try {
      await Effect.runPromise(main(["-p", "answer"]).pipe(Effect.provide(NodeFileSystem.layer)));
    } finally {
      out.restore();
    }

    const written = out.calls.join("");
    expect(written).toContain("plain\n");
    expect(written).not.toContain("agent_event");
  });

  it("rejects --json without a prompt", async () => {
    const result = await Effect.runPromiseExit(main(["--json"]).pipe(Effect.provide(NodeFileSystem.layer)));
    expect(result._tag).toBe("Failure");
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("headless-json emitter mapping", () => {
  it("serializes an agent event line with the run id envelope", () => {
    const line = agentEventLine(
      { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "a" } },
      "run-1",
    );
    expect(JSON.parse(serializeLine(line))).toEqual({
      event: "agent_event",
      run_id: "run-1",
      type: "message_update",
      data: { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "a" } },
    });
  });

  it("keeps BigInt event payloads JSON-serializable", () => {
    const line = agentEventLine({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      result: { count: 1n },
      isError: false,
    }, "run-1");

    expect(JSON.parse(serializeLine(line))).toMatchObject({
      data: { result: { count: "1n" } },
    });
  });

  it("keeps the envelope when an event payload is circular", () => {
    const result: Record<string, unknown> = {};
    result.self = result;
    const encoded = serializeLine(agentEventLine({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      result,
      isError: false,
    }, "run-1"));

    expect(JSON.parse(encoded)).toMatchObject({
      event: "agent_event",
      run_id: "run-1",
      type: "tool_execution_end",
      data: "[unserializable]",
    });
  });

  it("keeps the envelope when an event payload getter throws", () => {
    const result: Record<string, unknown> = {};
    Object.defineProperty(result, "value", {
      enumerable: true,
      get: () => { throw new Error("provider result unavailable"); },
    });
    const encoded = serializeLine(agentEventLine({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      result,
      isError: true,
    }, "run-1"));

    expect(JSON.parse(encoded)).toMatchObject({
      event: "agent_event",
      run_id: "run-1",
      type: "tool_execution_end",
      data: "[unserializable]",
    });
  });

  it("serializes lifecycle markers with stable keys", () => {
    expect(JSON.parse(serializeLine(startedLine("run-2", "/cwd", "wf")))).toEqual({
      event: "run.started", run_id: "run-2", cwd: "/cwd", workflow: "wf",
    });
    expect(JSON.parse(serializeLine(completedLine("run-2", { text: "t", sessionId: "s", transcriptPath: "/p" })))).toEqual({
      event: "run.completed", run_id: "run-2", status: "completed", session_id: "s", transcript_path: "/p", text: "t",
    });
    expect(JSON.parse(serializeLine(failedLine("run-2", "e", "msg")))).toEqual({
      event: "run.failed", run_id: "run-2", code: "e", error: "msg",
    });
  });
});
