// The core invariant behind the empty-run fix: a session that is opened and
// left without ever sending a prompt must write NOTHING to the runs root —
// including when the user takes the TUI over to an existing run via `/resume`
// and then exits. The startup session is a staging session (main.ts), so its
// run directory is allocated only at the first commit; a takeover swaps
// `active` onto the resumed run and drops the staging commit entirely.
//
// These tests use the REAL staging session and the REAL filesystem — no
// logging mocks — so they prove nothing reaches disk, rather than asserting a
// mock was not called.

import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeTrajectoryRun } from "../common/trajectory-fixture.js";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { createStagingSession } from "@piano/logging";

vi.mock("../../packages/cli/src/tui.js", () => ({
  runTui: vi.fn(() => Effect.succeed({ type: "closed" as const })),
}));

vi.mock("@piano/harness", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareHarnessHomes: vi.fn(() => Effect.succeed({ agentOptions: {} })),
}));

vi.mock("@piano/orchestrator", () => ({
  compileWorkflow: vi.fn(() => Effect.succeed({ name: "smoke", stages: [], regions: [], nodes: [] })),
  executeWorkflow: vi.fn(() => Effect.succeed({
    text: "ok",
    sessionId: "worker-session",
    transcriptPath: "/tmp/worker.jsonl",
    progressPath: "/tmp/progress.jsonl",
  })),
  loadWorkflow: vi.fn(() => Effect.succeed({
    root: "/repo",
    workflowPath: "/repo/wf.yaml",
    document: { version: 3, workflow: { name: "smoke", nodes: [] } },
  })),
  loadDefaultWorkflow: vi.fn(() => Effect.succeed({
    root: "/repo",
    workflowPath: "/repo/wf.yaml",
    document: { version: 3, workflow: { name: "smoke", nodes: [] } },
  })),
  setWorkflowSelection: vi.fn(() => Effect.void),
  builtinWorkflowSelection: (name: string) => `builtin:${name}`,
  readWorkflowExecutionContinuation: vi.fn(() => Effect.succeed(undefined)),
  refreshRunStatus: vi.fn(() => Effect.void),
  runStatusPath: (runDir: string) => `${runDir}/status.json`,
}));

import { runTui } from "../../packages/cli/src/tui.js";
import { runSession } from "../../packages/cli/src/session-run.js";

const TARGET = "20260901T070228-target";

async function seedRun(runsRoot: string, runId: string): Promise<void> {
  await writeTrajectoryRun(join(runsRoot, runId), {
    version: 1,
    runId,
    status: "completed",
    promptLength: 5,
    events: [],
    turns: [{ prompt: "hello", status: "completed", eventCount: 0 }],
  });
}

describe("no empty run is stranded without a prompt", () => {
  let runsRoot: string;

  beforeEach(async () => {
    runsRoot = await mkdtemp(join(tmpdir(), "piano-no-empty-run-"));
    vi.mocked(runTui).mockReset().mockReturnValue(Effect.succeed({ type: "closed" as const }));
  });

  afterEach(async () => {
    // Best-effort cleanup; mkdtemp dirs are under tmp.
    await readdir(runsRoot).catch(() => []);
  });

  it("writes nothing when piano opens and closes with no prompt and no resume", async () => {
    const session = createStagingSession({ cwd: "/repo", runsRoot });

    await Effect.runPromise(runSession(session, {}).pipe(Effect.provide(NodeFileSystem.layer)));

    expect(await readdir(runsRoot)).toEqual([]);
  });

  it("writes nothing when the user resumes an existing run and exits without a prompt", async () => {
    await seedRun(runsRoot, TARGET);
    const session = createStagingSession({ cwd: "/repo", runsRoot });

    // Drive the TUI the way a real takeover does: open, resume the target run,
    // then close — never submitting a prompt.
    vi.mocked(runTui).mockImplementation((options) => Effect.gen(function* () {
      const resume = options?.onResume;
      if (resume !== undefined) {
        yield* resume(TARGET).pipe(Effect.catchAll(() => Effect.void));
      }
      return { type: "closed" as const } as const;
    }) as unknown as ReturnType<typeof runTui>);

    await Effect.runPromise(runSession(session, {}).pipe(Effect.provide(NodeFileSystem.layer)));

    // The only directory present is the run the user resumed onto — the
    // startup staging session left no empty run behind.
    expect(await readdir(runsRoot)).toEqual([TARGET]);
  });

  it("still commits a run when a prompt is sent with no resume (control)", async () => {
    const session = createStagingSession({ cwd: "/repo", runsRoot });

    // A prompt is the moment the run becomes real: drive the TUI so it calls
    // runPrompt once, which commits the staging session before executing.
    vi.mocked(runTui).mockImplementation((options) => Effect.gen(function* () {
      const runPrompt = options?.runPrompt;
      if (runPrompt !== undefined) {
        yield* runPrompt("do the thing", () => {}).pipe(Effect.catchAll(() => Effect.void));
      }
      return { type: "closed" as const } as const;
    }) as unknown as ReturnType<typeof runTui>);

    await Effect.runPromise(runSession(session, {}).pipe(Effect.provide(NodeFileSystem.layer)));

    // The staging run materialised: exactly one directory, named after the
    // session id, and it is not the target.
    const dirs = await readdir(runsRoot);
    expect(dirs).toEqual([session.id]);
  });
});
