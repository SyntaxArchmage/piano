// The full user arc behind "a half-way stop is a pause, not a failure", as one
// deterministic session-level test through the REAL runSession loop, real
// runTui, real engine and real disk state — only "sending the prompt" is
// mocked, at the harness adapter boundary (the same seam the engine tests in
// tests/workflow/esc-pauses-run.test.ts drive):
//
//   prompt 1 → sign-off continued → workflow completed → /exit
//   → resume → prompt 2 → Escape mid-run → paused → /exit
//   → resume → the interrupted turn replays as "interrupted", not failed
//   → prompt 3 → continued → completed.
//
// Every hop goes through the production code paths: `piano resume` is
// `runSession({ resumeRunId })` here, and each resumed session reopens the SAME
// run directory, so the assertions pin that the whole arc stays in ONE run
// with ONE actor conversation — no re-created execution, no stranded second
// run, honest per-turn statuses on disk and in the replay.
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createSession, createStagingSession } from "@piano/logging";
import type { AgentRunner } from "@piano/harness";
import { runSession } from "../../packages/cli/src/session-run.js";
import { FakeTerminal, plain, sleep, waitFor } from "../common/terminal.js";
import { readJson, readResumeActors } from "../common/fs.js";
import { hangUntilAbort, sessionOf, settledResult, type ActorSession } from "../common/fake-runner.js";

// prepareHarnessHomes writes the developer's own harness home; the session
// tests stub it and inject the agent adapter instead (real harness config is
// exercised by the e2e suites).
vi.mock("@piano/harness", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareHarnessHomes: vi.fn(() => Effect.succeed({ agentOptions: {} })),
}));

const SIGNOFF_WORKFLOW = `version: 3
workflow:
  name: arc-pause-resume
  nodes:
    - stage:
        name: agent
        worker: basic
        harness: pi
        tools: [read, bash, edit, write]
        from: []
        signoff: true
`;

/** The one actor conversation every hop of the arc must keep running. */
const ACTOR: ActorSession = {
  harness: "pi",
  sessionId: "sess-arc",
  transcriptPath: "/runs/arc/actors/pi/agent/session/sess-arc.jsonl",
};

/** Progress snapshot for a run, read synchronously so waitFor can poll it. */
function progressStatus(runsRoot: string, runId: string): string | undefined {
  try {
    const raw = readFileSync(join(runsRoot, runId, "status.json"), "utf8");
    return (JSON.parse(raw) as { status?: string }).status;
  } catch {
    return undefined;
  }
}

/** Turn entries recorded in a run's state so far (undefined mid-write). */
function recordedTurns(runsRoot: string, runId: string): Array<{ prompt: string; status: string }> | undefined {
  try {
    const raw = readFileSync(join(runsRoot, runId, "status.json"), "utf8");
    const document = JSON.parse(raw) as { turns?: Array<{ prompt: string; status: string }> };
    return Array.isArray(document.turns) ? document.turns : [];
  } catch {
    return undefined;
  }
}

describe("one run across finish → exit → resume → Escape → exit → resume", () => {
  it("keeps one run and one actor conversation through the whole arc", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-arc-pause-resume-"));
    try {
      const runsRoot = join(root, "runs");
      const workflowPath = join(root, "workflow.yml");
      await writeFile(workflowPath, SIGNOFF_WORKFLOW);

      const requests: unknown[] = [];
      let call = 0;
      const runner: AgentRunner = (request) => {
        requests.push(request);
        call += 1;
        // Turn 2 is the interrupted one: it hangs until the TUI's Escape fires
        // the AbortController, then fails like a real cancelled turn, stashing
        // the session it was asked to reopen.
        if (call === 2) return hangUntilAbort(request, sessionOf(request, ACTOR));
        return settledResult(request, call === 1 ? "answer one" : "answer three", ACTOR);
      };

      // ——— Session A: prompt 1 runs the coding workflow to its terminal state.
      const staging = createStagingSession({ root, cwd: root, runsRoot });
      const runId = staging.id;
      const terminalA = new FakeTerminal();
      const sessionA = Effect.runPromise(runSession(staging, {
        workflowPath,
        terminal: terminalA,
        agentRunner: runner,
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      await sleep(50);
      terminalA.onInput?.("task one: add a counter");
      terminalA.onInput?.("\r");
      await waitFor("attempt 1 opened", () => requests.length === 1);
      await waitFor("signoff 1", () => plain(terminalA).includes("Sign off agent?"));
      terminalA.onInput?.("\r"); // approve: the workflow reaches its terminal state
      await waitFor("run 1 continued", () => plain(terminalA).includes("Continue past"));
      // The approval echo lands before the session loop persists the turn's
      // trajectory; wait for that durable write so /exit cannot interrupt a
      // still-finishing run.
      await waitFor("turn 1 persisted", () => recordedTurns(runsRoot, runId)?.length === 1);
      terminalA.onInput?.("/exit");
      terminalA.onInput?.("\r");
      await sessionA;
      // One real run directory — nothing stranded by the exit.
      expect((await readdir(runsRoot)).sort()).toEqual([runId]);

      // ——— Session B: `piano resume <run-id>`, prompt 2, Escape mid-run.
      const resumedB = await Effect.runPromise(createSession({ root, cwd: root, runsRoot, id: runId })
        .pipe(Effect.provide(NodeFileSystem.layer)));
      const terminalB = new FakeTerminal();
      const sessionB = Effect.runPromise(runSession(resumedB, {
        resumeRunId: runId,
        workflowPath,
        terminal: terminalB,
        agentRunner: runner,
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      await sleep(50);
      // The completed turn replays before the session accepts any input.
      await waitFor("turn 1 replayed", () => plain(terminalB).includes("task one: add a counter"));
      terminalB.onInput?.("task two: make it red");
      terminalB.onInput?.("\r");
      await waitFor("attempt 2 opened", () => requests.length === 2);
      terminalB.onInput?.("\x1b"); // Escape: interrupt, exactly like the real key
      await waitFor("the run ended as interrupted", () => plain(terminalB).includes("interrupted"));
      // Durable pause: progress says paused, and the interrupted attempt did
      // not consume the turn or lose the actor conversation.
      expect(progressStatus(runsRoot, runId)).toBe("paused");
      const mid = Object.values(await readResumeActors(join(runsRoot, runId)))[0];
      expect(mid?.sessionId).toBe("sess-arc");
      expect(mid?.turns).toBe(1);
      terminalB.onInput?.("/exit");
      terminalB.onInput?.("\r");
      await sessionB;

      // ——— Session C: resume again; the interrupted turn replays honestly.
      const resumedC = await Effect.runPromise(createSession({ root, cwd: root, runsRoot, id: runId })
        .pipe(Effect.provide(NodeFileSystem.layer)));
      const terminalC = new FakeTerminal();
      const sessionC = Effect.runPromise(runSession(resumedC, {
        resumeRunId: runId,
        workflowPath,
        terminal: terminalC,
        agentRunner: runner,
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      await sleep(50);
      // Both turns come back; the interrupted one is an interrupt, not a failure.
      await waitFor("interrupted turn replayed", () => plain(terminalC).includes("interrupted"));
      expect(plain(terminalC)).toContain("task two: make it red");
      expect(plain(terminalC)).not.toContain("run failed");
      terminalC.onInput?.("task three: finish the counter");
      terminalC.onInput?.("\r");
      await waitFor("attempt 3 opened", () => requests.length === 3);
      await waitFor("signoff 3", () => plain(terminalC).includes("Sign off agent?"));
      terminalC.onInput?.("\r");
      await waitFor("run 3 continued", () => plain(terminalC).includes("Continue past"));
      await waitFor("turn 3 persisted", () => recordedTurns(runsRoot, runId)?.length === 3);
      terminalC.onInput?.("/exit");
      terminalC.onInput?.("\r");
      await sessionC;

      // ——— One run, one actor conversation, three honest turns.
      expect(requests).toHaveLength(3);
      for (const index of [1, 2]) {
        const continuation = (requests[index] as { continuation?: { sessionId?: string } }).continuation;
        expect(continuation?.sessionId).toBe("sess-arc");
      }
      expect((await readdir(runsRoot)).sort()).toEqual([runId]);
      expect((await readJson(join(runsRoot, runId, "status.json"))).status).toBe("completed");
      const trajectory = await readJson(join(runsRoot, runId, "status.json"));
      const turns = trajectory.turns as Array<{ prompt: string; status: string; eventCount: number }>;
      expect(turns.map((turn) => turn.status)).toEqual(["completed", "cancelled", "completed"]);
      expect(turns.map((turn) => turn.prompt)).toEqual([
        "task one: add a counter",
        "task two: make it red",
        "task three: finish the counter",
      ]);
      // The actor map finished the same conversation it started (turn 1 + turn
      // 3 completed; the interrupted turn never consumed one).
      const finalActor = Object.values(await readResumeActors(join(runsRoot, runId)))[0];
      expect(finalActor?.sessionId).toBe("sess-arc");
      expect(finalActor?.turns).toBe(2);
      // The interrupted prompt's job was continued, not replaced: two jobs,
      // and the second is the one that finished.
      expect((trajectory.jobs as Array<{ jobOrdinal: number; state: string }>).map((job) => job.jobOrdinal))
        .toEqual([1, 2]);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }, 120_000);
});
