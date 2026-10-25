import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeTrajectoryRun } from "../common/trajectory-fixture.js";
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
  LOAD_SOURCE: { module: "orchestrator", file: "workflow-file.ts", function: "loadDefaultWorkflow" },
  EXPLICIT_LOAD_SOURCE: { module: "orchestrator", file: "workflow-file.ts", function: "loadWorkflow" },
  compileWorkflow: vi.fn(() => Effect.succeed({
    name: "coding",
    sourcePath: "/repo/recipes/workflows/coding-pi.yml",
    stages: [{ id: "coding", dependsOn: [], stage: { model: undefined } }],
    regions: [],
    nodes: [{ id: "coding", dependsOn: [], stage: { model: undefined } }],
  })),
  executeWorkflow: vi.fn(() => Effect.succeed({
    text: "workflow answer",
    sessionId: "worker-session",
    transcriptPath: "/tmp/worker.jsonl",
    progressPath: "/tmp/progress.jsonl",
  })),
  loadAndExecuteWorkflow: vi.fn(),
  readWorkflowExecutionContinuation: vi.fn(() => Effect.succeed(undefined)),
  refreshRunStatus: vi.fn(() => Effect.void),
  reconcileCrashedRun: vi.fn(() => Effect.succeed(false)),
  runStatusPath: (runDir: string) => `${runDir}/status.json`,
  loadWorkflow: vi.fn(() => Effect.succeed({
    root: "/repo",
    workflowPath: "/repo/recipes/workflows/coding-pi.yml",
    document: { version: 3, workflow: { name: "coding", nodes: [] } },
  })),
  loadDefaultWorkflow: vi.fn(() => Effect.succeed({
    root: "/repo",
    workflowPath: "/repo/recipes/workflows/coding-pi.yml",
    document: { version: 3, workflow: { name: "coding", nodes: [] } },
  })),
  setWorkflowSelection: vi.fn(() => Effect.void),
  builtinWorkflowSelection: (name: string) => `builtin:${name}`,
}));

import { type Session } from "@piano/logging";
import { createSession } from "@piano/logging";
import { executeWorkflow } from "@piano/orchestrator";
import type { AgentEvent, AgentRequest, AgentResult } from "@piano/harness";
import { runTui, type TuiOptions } from "../../packages/cli/src/tui.js";
import { runSession } from "../../packages/cli/src/session-run.js";
import { SIDE_AGENT_DIR, SIDE_AGENT_TOOLS } from "../../packages/cli/src/side-agent.js";

const RUN_ID = "20260909T120000-side11";
/** Another run for the TUI to take over, so a side turn after `/resume` can be
 * told apart from one before it. */
const OTHER_RUN = "20260908T090000-side22";

const trajectoryWrite = vi.fn(() => Effect.void);

function fakeSession(runsRoot: string, id: string = RUN_ID, cwd = "/repo/work"): Session {
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
      path: join(runsRoot, id, "system-log", "trajectory.jsonl"),
      write: trajectoryWrite,
      rename: vi.fn(() => Effect.void),
      flush: vi.fn(() => Effect.void),
    },
  } as unknown as Session;
}

describe("/btw side agent through the live session", () => {
  let runsRoot: string;
  let session: Session;
  /** Every AgentRequest the injected runner saw, newest last. */
  let requests: AgentRequest[];
  /** What the injected runner does with a captured request. Answers at once by
   * default; the interrupt test replaces it with a turn that only ends on abort. */
  let handle: (request: AgentRequest) => Effect.Effect<AgentResult>;

  /** Drive `runSession` with a scripted TUI so a test can call the side-agent
   * callback the real TUI would call for `/btw`. */
  async function withTui(drive: (options: TuiOptions) => Promise<void>): Promise<void> {
    vi.mocked(runTui).mockImplementation((options) => Effect.promise(async () => {
      if (options !== undefined) await drive(options);
      return { type: "closed" as const };
    }));
    await Effect.runPromise(runSession(session, {
      agentRunner: (request) => Effect.suspend(() => {
        requests.push(request);
        return handle(request);
      }),
    }).pipe(Effect.provide(NodeFileSystem.layer)));
  }

  const side = (options: TuiOptions, prompt: string, onEvent: (event: AgentEvent) => void = () => {}) =>
    Effect.runPromise(
      (options.runSideAgent?.(prompt, onEvent) ?? Effect.die("no side agent")).pipe(
        Effect.provide(NodeFileSystem.layer),
      ) as Effect.Effect<{ text: string; sessionId: string; transcriptPath: string }>,
    );

  beforeEach(async () => {
    runsRoot = await mkdtemp(join(tmpdir(), "piano-side-agent-"));
    session = fakeSession(runsRoot);
    requests = [];
    trajectoryWrite.mockClear();
    vi.mocked(executeWorkflow).mockClear();
    // A takeover opens the run it is handed; give every id a usable session so a
    // stray call can never hand `undefined` to the code under test.
    vi.mocked(createSession).mockReset().mockImplementation((options) =>
      Effect.succeed(fakeSession(runsRoot, (options as { id?: string }).id ?? "fresh")));
    handle = (request) => Effect.succeed({
      sessionId: "side-session",
      transcriptPath: join(request.sessionDir ?? "", "transcript.jsonl"),
      text: "side answer",
      continuation: {
        harness: "pi",
        sessionId: "side-session",
        transcriptPath: join(request.sessionDir ?? "", "transcript.jsonl"),
      },
    });
  });

  afterEach(async () => {
    await rm(runsRoot, { recursive: true, force: true });
  });

  it("answers with one direct agent call in the session workspace, never a workflow", async () => {
    let result: { text: string; sessionId: string } | undefined;
    await withTui(async (options) => { result = await side(options, "rename the flag"); });

    expect(result).toMatchObject({ text: "side answer", sessionId: "side-session" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      prompt: "rename the flag",
      cwd: "/repo/work",
      sessionDir: join(runsRoot, RUN_ID, "sessions", SIDE_AGENT_DIR),
      tools: [...SIDE_AGENT_TOOLS],
    });
    // The differentiator: `/btw` is a lone agent call, so the mission's
    // workflow engine is never entered.
    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it("chains turns through the harness continuation", async () => {
    await withTui(async (options) => {
      await side(options, "first");
      await side(options, "second");
      await side(options, "third");
    });

    expect(requests.map((request) => request.prompt)).toEqual(["first", "second", "third"]);
    // A first turn has nothing to continue; every later turn resumes the side
    // agent's own session instead of starting a stranger.
    expect(requests[0]?.continuation).toBeUndefined();
    expect(requests[1]?.continuation).toMatchObject({ harness: "pi", sessionId: "side-session" });
    expect(requests[2]?.continuation).toMatchObject({ harness: "pi", sessionId: "side-session" });
  });

  it("keeps its evidence out of the run's trajectory and execution tree", async () => {
    await withTui(async (options) => { await side(options, "look around"); });

    // The trajectory is the workflow's evidence: a side turn replayed as a
    // workflow turn would be a lie, so nothing is written to it.
    expect(trajectoryWrite).not.toHaveBeenCalled();
    expect(requests[0]?.sessionDir).not.toContain("executions");
  });

  it("streams the agent's events and lets the run's interrupt key stop the turn", async () => {
    const seen: string[] = [];
    handle = (request) => Effect.async<AgentResult>((resume) => {
      request.onEvent?.({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "working" }] } });
      request.signal?.addEventListener("abort", () => {
        resume(Effect.succeed({ sessionId: "side-session", transcriptPath: "/tmp/side.jsonl", text: "stopped" }));
      });
    });

    let result: { text: string } | undefined;
    await withTui(async (options) => {
      const turn = side(options, "run the suite", (event) => seen.push(event.type));
      await new Promise((resolve) => setTimeout(resolve, 10));
      // The TUI's Escape key drives this: a side turn registers into its own
      // interrupt slot, and the TUI names the screen the key was pressed on.
      await Effect.runPromise(options.onInterrupt?.("side") ?? Effect.void);
      result = await turn;
    });

    expect(seen).toEqual(["message_end"]);
    expect(result?.text).toBe("stopped");
  });

  it("starts a fresh side conversation in the run the TUI takes over", async () => {
    await writeTrajectoryRun(join(runsRoot, OTHER_RUN), {
      version: 1,
      status: "completed",
      workspaceCwd: "/repo/other-work",
      events: [],
      turns: [{ prompt: "earlier work", status: "completed", eventCount: 0 }],
    });

    await withTui(async (options) => {
      await side(options, "before takeover");
      await Effect.runPromise(
        (options.onResume?.(OTHER_RUN) ?? Effect.die("no resume handler")).pipe(
          Effect.provide(NodeFileSystem.layer),
          Effect.mapError((error) => error as Error),
        ) as Effect.Effect<unknown, Error>,
      );
      await side(options, "after takeover");
    });

    // The side agent belongs to the run it lives in: after a takeover its files
    // go to the new run's directory and its workspace follows the resumed one.
    expect(requests[1]).toMatchObject({
      prompt: "after takeover",
      cwd: "/repo/other-work",
      sessionDir: join(runsRoot, OTHER_RUN, "sessions", SIDE_AGENT_DIR),
    });
    // Resuming the old transcript here would point the new run's agent at a
    // conversation filed under the run the TUI just left.
    expect(requests[1]?.continuation).toBeUndefined();
  });

  it("leaves the mission workflow reachable after a side turn", async () => {
    await withTui(async (options) => {
      await side(options, "quick fix");
      await Effect.runPromise(
        (options.runPrompt?.("carry on", () => {}) ?? Effect.void).pipe(
          Effect.provide(NodeFileSystem.layer),
        ) as Effect.Effect<unknown>,
      );
    });

    // The side visit does not disturb the run: the next prompt still continues
    // the same execution, in the same run directory.
    expect(executeWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      runId: RUN_ID,
      runDir: join(runsRoot, RUN_ID),
      prompt: "carry on",
    }));
    expect(trajectoryWrite).toHaveBeenCalledWith(expect.objectContaining({ prompt: "carry on", status: "completed" }));
  });
});
