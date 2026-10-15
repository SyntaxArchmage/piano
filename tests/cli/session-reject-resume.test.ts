// The reject-with-feedback boundary, end to end through the REAL runSession
// loop (real runTui, real engine, real disk): a rejected sign-off resumes the
// SAME actor conversation with the reviewer's words — and that conversation
// survives /exit and `piano resume`, so the next prompt after a resume keeps
// working in the same run and the same session. Only "sending the prompt" is
// mocked (harness adapter boundary). The durable-mid-reject half of this is
// pinned at the engine level by tests/workflow/esc-pauses-run.test.ts; this
// file drives the whole reject → rework → exit → resume UX.
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
import { settledResult, type ActorSession } from "../common/fake-runner.js";

vi.mock("@piano/harness", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareHarnessHomes: vi.fn(() => Effect.succeed({ agentOptions: {} })),
}));

const SIGNOFF_WORKFLOW = `version: 3
workflow:
  name: reject-keeps-session
  nodes:
    - stage:
        name: agent
        worker: basic
        harness: pi
        tools: [read, bash, edit, write]
        from: []
        signoff: true
`;

/** The one actor conversation every attempt and every resume must keep. */
const ACTOR: ActorSession = {
  harness: "pi",
  sessionId: "sess-reject",
  transcriptPath: "/runs/reject/actors/pi/agent/session/sess-reject.jsonl",
};

describe("reject with feedback, then exit and resume", () => {
  it("keeps the same actor conversation through reject → rework → exit → resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-reject-resume-"));
    try {
      const runsRoot = join(root, "runs");
      const workflowPath = join(root, "workflow.yml");
      await writeFile(workflowPath, SIGNOFF_WORKFLOW);

      const requests: unknown[] = [];
      let call = 0;
      const runner: AgentRunner = (request) => {
        requests.push(request);
        call += 1;
        // Attempt 1 drafts the result; the rework (same turn, after the
        // rejection) and every later prompt keep answering in the same
        // conversation the engine hands over.
        const text = call === 1 ? "DRAFT1" : call === 2 ? "DRAFT2" : "final answer";
        return settledResult(request, text, ACTOR);
      };

      // ——— Session A: draft → retry with a note → rework → continue.
      const staging = createStagingSession({ root, cwd: root, runsRoot });
      const runId = staging.id;
      const terminalA = new FakeTerminal();
      const sessionA = Effect.runPromise(runSession(staging, {
        workflowPath,
        terminal: terminalA,
        agentRunner: runner,
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      await sleep(50);
      terminalA.onInput?.("task: refactor the parser");
      terminalA.onInput?.("\r");
      await waitFor("attempt 1 opened", () => requests.length === 1);
      await waitFor("review 1", () => plain(terminalA).includes("Sign off agent?"));
      // Retry with a typed note, exactly the keys the review panel maps.
      terminalA.onInput?.("\x1b[B"); // move to "Retry — run this worker again"
      terminalA.onInput?.("\r");
      await waitFor("the note question", () => plain(terminalA).includes("Retry without a note"));
      terminalA.onInput?.("redo it with DRAFT2");
      terminalA.onInput?.("\r");
      // The retry lands and the SAME actor resumes with the note.
      await waitFor("rework opened", () => requests.length === 2);
      const rework = requests[1] as { prompt?: string; continuation?: { sessionId?: string } };
      expect(rework.prompt).toContain("redo it with DRAFT2");
      expect(rework.continuation?.sessionId).toBe("sess-reject");
      // Round 2 review (the rework finished): continue it. The title carries
      // the round once a retry reopened the stage, which is also what makes
      // it distinguishable from the first review still sitting in the buffer.
      await waitFor("review 2", () => plain(terminalA).includes("Sign off agent (round 2)"));
      terminalA.onInput?.("\r");
      await waitFor("run continued", () => plain(terminalA).includes("Continue past agent"));
      // The approval echo lands before the session loop persists the turn's
      // trajectory; wait for that durable write so /exit cannot interrupt a
      // still-finishing run.
      const trajectoryPath = join(runsRoot, runId, "trajectory.json");
      await waitFor("turn 1 persisted", () => {
        try {
          const document = JSON.parse(readFileSync(trajectoryPath, "utf8")) as { turns?: unknown };
          return Array.isArray(document.turns) && document.turns.length === 1;
        } catch {
          return false;
        }
      });
      terminalA.onInput?.("/exit");
      terminalA.onInput?.("\r");
      await sessionA;

      // The completed turn is durable: one run, one conversation, one turn.
      expect((await readdir(runsRoot)).sort()).toEqual([runId]);
      expect((await readJson(join(runsRoot, runId, "progress.json"))).status).toBe("completed");
      const trajectoryA = await readJson(join(runsRoot, runId, "trajectory.json"));
      const turnsA = trajectoryA.turns as Array<{ prompt: string; status: string }>;
      expect(turnsA).toHaveLength(1);
      expect(turnsA[0]?.status).toBe("completed");
      const actorA = Object.values(await readResumeActors(join(runsRoot, runId)))[0];
      expect(actorA?.sessionId).toBe("sess-reject");
      // Two completed agent attempts inside the single turn: the draft and the
      // rework that answered the reviewer's feedback.
      expect(actorA?.turns).toBe(2);

      // ——— Session B: `piano resume <run-id>` keeps working the same run.
      const resumed = await Effect.runPromise(createSession({ root, cwd: root, runsRoot, id: runId })
        .pipe(Effect.provide(NodeFileSystem.layer)));
      const terminalB = new FakeTerminal();
      const sessionB = Effect.runPromise(runSession(resumed, {
        resumeRunId: runId,
        workflowPath,
        terminal: terminalB,
        agentRunner: runner,
      }).pipe(Effect.provide(NodeFileSystem.layer)));
      await sleep(50);
      // The finished turn replays; no failure box appears for an approved run.
      await waitFor("turn 1 replayed", () => plain(terminalB).includes("task: refactor the parser"));
      expect(plain(terminalB)).not.toContain("run failed");
      terminalB.onInput?.("task: make it faster");
      terminalB.onInput?.("\r");
      await waitFor("attempt 3 opened", () => requests.length === 3);
      await waitFor("review 3", () => plain(terminalB).includes("Sign off agent?"));
      terminalB.onInput?.("\r");
      await waitFor("run continued again", () => plain(terminalB).includes("Continue past agent"));
      await waitFor("turn 2 persisted", () => {
        try {
          const document = JSON.parse(readFileSync(trajectoryPath, "utf8")) as { turns?: unknown };
          return Array.isArray(document.turns) && document.turns.length === 2;
        } catch {
          return false;
        }
      });
      terminalB.onInput?.("/exit");
      terminalB.onInput?.("\r");
      await sessionB;

      // Still one run; the prompt after the resume answered in the SAME actor
      // conversation (no fresh session, no stranded run).
      expect(requests).toHaveLength(3);
      expect((requests[2] as { continuation?: { sessionId?: string } }).continuation?.sessionId)
        .toBe("sess-reject");
      expect((await readdir(runsRoot)).sort()).toEqual([runId]);
      expect((await readJson(join(runsRoot, runId, "progress.json"))).status).toBe("completed");
      const trajectory = await readJson(join(runsRoot, runId, "trajectory.json"));
      const turns = trajectory.turns as Array<{ prompt: string; status: string }>;
      expect(turns.map((turn) => turn.status)).toEqual(["completed", "completed"]);
      expect(turns.map((turn) => turn.prompt)).toEqual([
        "task: refactor the parser",
        "task: make it faster",
      ]);
      const actor = Object.values(await readResumeActors(join(runsRoot, runId)))[0];
      expect(actor?.sessionId).toBe("sess-reject");
      // The resumed prompt added one more completed attempt to the same
      // conversation: draft + rework + prompt 2.
      expect(actor?.turns).toBe(3);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }, 120_000);
});
