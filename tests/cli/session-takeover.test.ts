import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";

vi.mock("@piano/logging", async (importOriginal) => ({
  ...(await importOriginal()),
  createSession: vi.fn(),
}));

vi.mock("../../packages/cli/src/tui.js", () => ({
  runTui: vi.fn(() => Effect.succeed({ type: "closed" as const })),
}));

vi.mock("@piano/orchestrator", () => ({
  compileWorkflow: vi.fn(() => Effect.succeed({
    name: "smoke",
    sourcePath: "/repo/recipes/workflows/basic.yaml",
    // A faithful CompiledStage: the footer reads `stage.stage.model`, so the
    // stub carries the compiled stage it stands for instead of an id alone.
    stages: [{
      id: "respond",
      dependsOn: [],
      stage: { name: "respond", worker: "basic", harness: "pi", from: [] },
    }],
    regions: [],
  })),
  executeWorkflow: vi.fn(() => Effect.succeed({
    text: "done",
    sessionId: "worker-session",
    transcriptPath: "/tmp/worker.jsonl",
    progressPath: "/tmp/progress.jsonl",
    progressSnapshotPath: "/tmp/progress.json",
  })),
  loadAndExecuteWorkflow: vi.fn(),
  readWorkflowExecutionContinuation: vi.fn(() => Effect.succeed(undefined)),
  loadWorkflow: vi.fn(() => Effect.succeed({
    root: "/repo",
    workflowPath: "/repo/recipes/workflows/basic.yaml",
    document: { version: 3, workflow: { name: "smoke", nodes: [] } },
  })),
  loadDefaultWorkflow: vi.fn(() => Effect.succeed({
    root: "/repo",
    workflowPath: "/repo/recipes/workflows/current.yaml",
    document: { version: 3, workflow: { name: "current", nodes: [] } },
  })),
  setWorkflowSelection: vi.fn(() => Effect.void),
  builtinWorkflowSelection: (name: string) => `builtin:${name}`,
}));

import { createSession, type Session } from "@piano/logging";
import { executeWorkflow, loadWorkflow, setWorkflowSelection } from "@piano/orchestrator";
import { runTui, type TuiOptions, type TuiResumeResult } from "../../packages/cli/src/tui.js";
import { runSession } from "../../packages/cli/src/session-run.js";

const OPEN = "20260901T070228-open11";
const OTHER = "20260830T101500-other2";

/** Trajectory writers per run id, so a test can tell which run a prompt wrote to. */
const writes = new Map<string, ReturnType<typeof vi.fn>>();
const renames = new Map<string, ReturnType<typeof vi.fn>>();

function fakeSession(id: string, runsRoot: string, cwd: string): Session {
  const write = vi.fn(() => Effect.void);
  const rename = vi.fn(() => Effect.void);
  writes.set(id, write);
  renames.set(id, rename);
  return {
    id,
    root: "/repo",
    runDir: join(runsRoot, id),
    cwd,
    traceId: `trace-${id}`,
    log: { append: vi.fn(() => Effect.void), flush: vi.fn(() => Effect.void) },
    trace: {
      enter: vi.fn(() => Effect.succeed({ spanId: "s", parentId: null, depth: 0, fn: "f", startedAt: 0 })),
      currentSpan: vi.fn(() => Effect.succeed(undefined)),
      exit: vi.fn(() => Effect.void),
      error: vi.fn(() => Effect.void),
      flush: vi.fn(() => Effect.void),
    },
    trajectory: {
      path: join(runsRoot, id, "trajectory.json"),
      write,
      rename,
      flush: vi.fn(() => Effect.void),
    },
  } as unknown as Session;
}

async function writeTrajectory(runsRoot: string, runId: string, document: unknown): Promise<void> {
  await mkdir(join(runsRoot, runId), { recursive: true });
  await writeFile(join(runsRoot, runId, "trajectory.json"), `${JSON.stringify(document)}\n`, "utf8");
}

const twoTurns = {
  version: 1,
  updatedAt: "2026-08-30T10:15:00.000Z",
  status: "cancelled",
  workflowPath: "/repo/recipes/workflows/basic.yaml",
  workspaceCwd: "/repo/work",
  error: { type: "Interrupt", message: "cancelled by user" },
  events: [
    { type: "spawn", harness: "pi" },
    { type: "message_end", message: { role: "assistant", content: "first answer" } },
    { type: "message_end", message: { role: "assistant", content: "second answer" } },
  ],
  turns: [
    { prompt: "first", status: "completed", eventCount: 2 },
    { prompt: "second", status: "cancelled", eventCount: 3 },
  ],
};

describe("in-place run takeover", () => {
  let runsRoot: string;
  let session: Session;

  /** Drive `runSession` with a scripted TUI so a test can call the resume and
   * prompt callbacks the real TUI would. */
  async function withTui(drive: (options: TuiOptions) => Promise<void>): Promise<void> {
    vi.mocked(runTui).mockImplementation((options) => Effect.promise(async () => {
      if (options !== undefined) await drive(options);
      return { type: "closed" as const };
    }));
    await Effect.runPromise(runSession(session, {}).pipe(Effect.provide(NodeFileSystem.layer)));
  }

  const resume = (options: TuiOptions, runId: string): Promise<TuiResumeResult> =>
    Effect.runPromise(
      (options.onResume?.(runId) ?? Effect.die("no resume handler")).pipe(
        Effect.mapError((error) => error as Error),
      ) as Effect.Effect<TuiResumeResult, Error>,
    );

  beforeEach(async () => {
    runsRoot = await mkdtemp(join(tmpdir(), "piano-takeover-"));
    writes.clear();
    renames.clear();
    session = fakeSession(OPEN, runsRoot, "/repo");
    await writeTrajectory(runsRoot, OPEN, { version: 1, status: "completed", events: [], turns: [] });
    await writeTrajectory(runsRoot, OTHER, twoTurns);
    vi.mocked(createSession).mockReset().mockImplementation((options) =>
      Effect.succeed(fakeSession((options as { id?: string }).id ?? "fresh", runsRoot, "/repo")));
    vi.mocked(loadWorkflow).mockClear();
    vi.mocked(executeWorkflow).mockClear();
    vi.mocked(setWorkflowSelection).mockClear();
  });

  afterEach(async () => {
    await rm(runsRoot, { recursive: true, force: true });
  });

  it("hands back the run's turns, workspace, workflow, and progress snapshot", async () => {
    let result: TuiResumeResult | undefined;
    await withTui(async (options) => { result = await resume(options, OTHER); });

    expect(result?.runId).toBe(OTHER);
    expect(result?.turns.map((turn) => turn.prompt)).toEqual(["first", "second"]);
    // Events are sliced per turn, and the recorded failure belongs to the
    // cancelled final turn only.
    expect(result?.turns[0]?.events).toHaveLength(2);
    expect(result?.turns[0]?.error).toBeUndefined();
    expect(result?.turns[1]?.events).toHaveLength(1);
    expect(result?.turns[1]?.error).toMatchObject({ type: "Interrupt" });
    // The turn's own verdict travels with it: the replay labels an
    // interrupted turn as interrupted, never as a failed run.
    expect(result?.turns[1]?.status).toBe("cancelled");
    expect(result?.turns[0]?.status).toBe("completed");
    expect(result?.workspaceCwd).toBe("/repo/work");
    expect(result?.workflowGraph).toMatchObject({ name: "smoke", path: "/repo/recipes/workflows/basic.yaml" });
    expect(result?.progressSnapshotPath).toBe(join(runsRoot, OTHER, "progress.json"));
    // The workflow the run recorded is reloaded, not the one already open.
    expect(loadWorkflow).toHaveBeenCalledWith("/repo/recipes/workflows/basic.yaml", "/repo");
  });

  it("sends the next prompt to the resumed run, reusing its id as the execution id", async () => {
    await withTui(async (options) => {
      await resume(options, OTHER);
      await Effect.runPromise(
        (options.runPrompt?.("next", () => {}) ?? Effect.void).pipe(Effect.provide(NodeFileSystem.layer)) as Effect.Effect<unknown>,
      );
    });

    // The prompt runs on the workflow the resumed run recorded ("smoke"), not
    // on the default the session started with ("current").
    expect(executeWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowPath: "/repo/recipes/workflows/basic.yaml",
        document: { version: 3, workflow: { name: "smoke", nodes: [] } },
      }),
      expect.objectContaining({
        executionId: OTHER,
        runDir: join(runsRoot, OTHER),
        // The resumed run's workspace, not the one the session started in.
        cwd: "/repo/work",
        prompt: "next",
      }),
    );
    // A takeover is not a default choice: the config record must stay untouched.
    expect(setWorkflowSelection).not.toHaveBeenCalled();
    // Evidence follows the takeover: the run left behind is not written to.
    expect(writes.get(OTHER)).toHaveBeenCalledWith(expect.objectContaining({ prompt: "next", status: "completed" }));
    expect(writes.get(OPEN)).not.toHaveBeenCalled();
  });

  it("renames the run the TUI is showing, not the one it opened with", async () => {
    await withTui(async (options) => {
      await resume(options, OTHER);
      await Effect.runPromise((options.onRename?.("kernel tuning") ?? Effect.void) as Effect.Effect<unknown>);
    });

    expect(renames.get(OTHER)).toHaveBeenCalledWith("kernel tuning");
    expect(renames.get(OPEN)).not.toHaveBeenCalled();
  });

  it("reuses the already-open session when the run is the session's own", async () => {
    await withTui(async (options) => {
      const result = await resume(options, OPEN);
      expect(result.runId).toBe(OPEN);
    });

    // A second session on the same run would append to its log and trace twice.
    expect(createSession).not.toHaveBeenCalled();
  });

  it("keeps the open workflow when the run recorded none", async () => {
    await writeTrajectory(runsRoot, OTHER, { version: 1, status: "completed", events: [], turns: [] });

    let result: TuiResumeResult | undefined;
    await withTui(async (options) => { result = await resume(options, OTHER); });

    expect(result?.workflowGraph).toBeUndefined();
    expect(loadWorkflow).not.toHaveBeenCalled();
  });

  it("keeps the open workflow and still takes over when the recorded one cannot be loaded", async () => {
    vi.mocked(loadWorkflow).mockReturnValue(Effect.fail({
      _tag: "WorkflowError", phase: "load", path: "/repo/recipes/workflows/basic.yaml", message: "gone",
    } as never));

    let result: TuiResumeResult | undefined;
    await withTui(async (options) => { result = await resume(options, OTHER); });

    // The takeover still happens, but silently running a different workflow is not
    // acceptable, so no graph is handed back.
    expect(result?.runId).toBe(OTHER);
    expect(result?.workflowGraph).toBeUndefined();
    expect(result?.turns).toHaveLength(2);
  });

  it("fails the takeover, and keeps the open run, for an unreadable run", async () => {
    let failure: unknown;
    await withTui(async (options) => {
      const exit = await Effect.runPromiseExit(
        (options.onResume?.("20260101T000000-absent") ?? Effect.void) as Effect.Effect<unknown>,
      );
      failure = exit._tag === "Failure" && exit.cause._tag === "Fail" ? exit.cause.error : undefined;
      await Effect.runPromise(
        (options.runPrompt?.("after", () => {}) ?? Effect.void).pipe(Effect.provide(NodeFileSystem.layer)) as Effect.Effect<unknown>,
      );
    });

    expect(failure).toMatchObject({ _tag: "LogsStorageError", operation: "read-trajectory" });
    expect(executeWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      executionId: OPEN,
      runDir: join(runsRoot, OPEN),
    }));
  });
});
