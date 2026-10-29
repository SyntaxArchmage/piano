import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { observationStreamPath } from "@piano/base";

vi.mock("@piano/logging", async (importOriginal) => {
  const original = await importOriginal<typeof import("@piano/logging")>();
  return {
    ...original,
    createSession: vi.fn(),
    createStagingSession: vi.fn(),
    // Record what the evidence sinks write and let it through: the off-case
    // then proves no write is ever *issued*, without sleeping on a write that
    // is fire-and-forget by construction.
    appendJsonlLine: vi.fn(original.appendJsonlLine),
  };
});

vi.mock("../../packages/cli/src/tui.js", () => ({
  runTui: vi.fn(() => Effect.succeed({ type: "closed" as const })),
}));

vi.mock("@piano/orchestrator", () => {
  const workflowStub = {
    root: "/tmp/piano",
    workflowPath: "/tmp/piano/workflow.yml",
    document: { version: 3, workflow: { name: "smoke", nodes: [] } },
  };
  return {
    LOAD_SOURCE: { module: "orchestrator", file: "workflow-file.ts", function: "loadDefaultWorkflow" },
    EXPLICIT_LOAD_SOURCE: { module: "orchestrator", file: "workflow-file.ts", function: "loadWorkflow" },
    executeWorkflow: vi.fn(),
    loadAndExecuteWorkflow: vi.fn(),
    readWorkflowExecutionContinuation: vi.fn(() => Effect.succeed(undefined)),
    refreshRunStatus: vi.fn(() => Effect.void),
    reconcileCrashedRun: vi.fn(() => Effect.succeed(false)),
    runStatusPath: (runDir: string) => `${runDir}/status.json`,
    loadWorkflow: vi.fn(() => Effect.succeed(workflowStub)),
    loadDefaultWorkflow: vi.fn(() => Effect.succeed(workflowStub)),
    setWorkflowSelection: vi.fn(() => Effect.void),
    builtinWorkflowSelection: (name: string) => `builtin:${name}`,
  };
});

import { appendJsonlLine, createSession, createStagingSession, parseObservationOps } from "@piano/logging";
import { executeWorkflow } from "@piano/orchestrator";
import { main } from "../../packages/cli/src/main.js";

/** `--langfuse` is a switch, not a leak. Off, a run records exactly the local
 * evidence it always has — no op stream appears beside the trajectory. On, the
 * same turn is appended to `system-log/observations.jsonl`, which is what
 * resume and the Langfuse export read. The plan's regression check, pinned. */

async function runWith(args: readonly string[], runDir: string): Promise<readonly unknown[]> {
  /** Everything the harness's own `AgentEvent` ledger was handed. */
  const trajectoryWrite = vi.fn((_record: unknown) => Effect.void);
  const session = {
    id: "switch-run",
    root: "/tmp/piano",
    runDir,
    cwd: "/tmp/piano/project",
    log: { append: () => Effect.void, flush: () => Effect.void },
    trace: {
      enter: () => Effect.succeed({ spanId: "t", parentId: null, depth: 0, fn: "t", startedAt: 0 }),
      currentSpan: () => Effect.succeed(undefined),
      exit: () => Effect.void,
      error: () => Effect.void,
      flush: () => Effect.void,
    },
    trajectory: {
      path: join(runDir, "trajectory.json"),
      write: trajectoryWrite,
      flush: () => Effect.void,
    },
  } as never;
  vi.mocked(createSession).mockReturnValue(Effect.succeed(session));
  vi.mocked(createStagingSession).mockReturnValue(session);
  vi.mocked(executeWorkflow).mockImplementation((_loaded, request) => Effect.sync(() => {
    request.onEvent?.({
      type: "message_end",
      message: { role: "assistant", content: "measured 12.3" },
      workflow: {
        stageId: "loop.measure",
        invocationId: "measure@loop/iter-0",
        worker: "benchmark-worker",
        attempt: 1,
      },
    } as never);
    return {
      workflow: "smoke", runId: "switch-run", stage: "s", worker: "w", text: "final",
      sessionId: "sess-1", transcriptPath: "/tmp/sess-1.jsonl", stages: [], terminalStages: [],
      progressPath: "/tmp/progress.jsonl",
    } as never;
  }));

  // `--json` writes the wire to stdout; the evidence file is what is asserted.
  // `session-run.ts` holds the `stdout` binding from `node:process`, so this
  // overrides the shared object directly rather than spying on the property.
  const real = process.stdout.write;
  (process.stdout as { write: unknown }).write = (() => true) as typeof real;
  try {
    await Effect.runPromise(main([...args, "-p", "answer"]).pipe(Effect.provide(NodeFileSystem.layer)));
  } finally {
    (process.stdout as { write: unknown }).write = real;
  }
  return trajectoryWrite.mock.calls.map(([record]) => record);
}

describe("--langfuse evidence switch", () => {
  let runDir: string;

  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), "piano-langfuse-switch-"));
    vi.mocked(appendJsonlLine).mockClear();
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  /** Every line the evidence sinks handed to the run's op stream. */
  function observationWrites(): string[] {
    return vi.mocked(appendJsonlLine).mock.calls
      .filter(([, path]) => path === observationStreamPath(runDir))
      .map(([, , line]) => line);
  }

  it("issues no write to the observation stream when the switch is off", async () => {
    await runWith(["--json"], runDir);

    expect(observationWrites()).toEqual([]);
  });

  it("records the turn's ops beside the trajectory when the switch is on", async () => {
    await runWith(["--json", "--langfuse"], runDir);

    expect(observationWrites().join("")).toContain("measure@loop/iter-0");
    // ...and they land on disk as the op stream resume and the Langfuse
    // export read. The write is fire-and-forget by construction (a write gap
    // is an evidence gap, never a run failure), so it lands a tick after the
    // run resolves.
    const recorded = await vi.waitFor(async () => {
      const ops = parseObservationOps(await readFile(observationStreamPath(runDir), "utf8"));
      if (ops.length === 0) throw new Error("no ops recorded yet");
      return ops;
    });
    expect(recorded.some((op) => op.metadata?.invocationId === "measure@loop/iter-0")).toBe(true);
  });

  it("records the AgentEvent ledger either way, adding only the op stream", async () => {
    const off = await runWith(["--json"], runDir);
    const on = await runWith(["--json", "--langfuse"], runDir);
    // Two empty ledgers would compare equal while proving nothing, and rows
    // nobody recognises would too.
    expect(off.length).toBeGreaterThan(0);
    expect(JSON.stringify(off)).toContain("measure@loop/iter-0");
    expect(on).toEqual(off);
  });
});
