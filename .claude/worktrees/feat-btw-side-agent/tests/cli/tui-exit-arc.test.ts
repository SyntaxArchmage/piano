// The /exit arcs at the session level: real runSession + real runTui + real
// engine; only "sending the prompt" is scripted at the harness adapter seam
// (the pattern established by session-pause-resume-arc.test.ts). Three arcs
// pin the developer-visible contract: /exit at idle closes immediately;
// /exit mid-run drains workers that honor the abort inside the 2s budget and
// says so on screen ("exiting — waiting…"); and /exit against a worker whose
// finalizer never settles still returns the shell, with the stalled report
// and the guard arming pinned to be consistent (which drain branch a wedged
// run takes is a scheduling race at this seam — see the test for the tier
// map of the deterministic pins).
//
// IMPORTANT: the stalled-exit module is mocked for the whole file — the real
// guard would schedule a forced process.exit(0) five seconds into the vitest
// worker and kill unrelated tests. The wedge case below uses an
// uninterruptible, never-resolving runner that holds no timer and no handle,
// so the parked fiber cannot act as a second backstop; guard invocation is
// what this tier asserts, process killing itself is asserted at the PTY tier.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createStagingSession } from "@piano/logging";
import type { AgentRunner } from "@piano/harness";
import { runSession } from "../../packages/cli/src/session-run.js";
import { FakeTerminal, plain, sleep, waitFor } from "../common/terminal.js";
import { hangUntilAbort, sessionOf, settledResult, type ActorSession } from "../common/fake-runner.js";

const armed = vi.hoisted(() => vi.fn());
vi.mock("../../packages/cli/src/stalled-exit.js", () => ({
  armStalledExitGuard: (graceMs?: number) => armed(graceMs),
}));

// Same stub as the arc tests: no developer harness homes are ever touched.
vi.mock("@piano/harness", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareHarnessHomes: vi.fn(() => Effect.succeed({ agentOptions: {} })),
}));

const WORKFLOW = `version: 3
workflow:
  name: exit-arc
  nodes:
    - stage:
        name: respond
        worker: basic
        harness: pi
        tools: [read, bash, edit, write]
        from: []
`;

const ACTOR: ActorSession = {
  harness: "pi",
  sessionId: "sess-exit-arc",
  transcriptPath: "/runs/exit-arc/actors/pi/respond/session/sess-exit-arc.jsonl",
};

async function openSession(root: string, runner: AgentRunner) {
  const workflowPath = join(root, "workflow.yml");
  await writeFile(workflowPath, WORKFLOW);
  const staging = createStagingSession({ root, cwd: root, runsRoot: join(root, "runs") });
  const terminal = new FakeTerminal();
  const done = Effect.runPromise(runSession(staging, {
    workflowPath,
    terminal,
    agentRunner: runner,
  }).pipe(Effect.provide(NodeFileSystem.layer)));
  // The TUI binds onInput during boot. Wait for the binding itself rather than
  // a fixed pause: under full-suite load the boot outruns any fixed budget, and
  // keystrokes sent before it are dropped by `terminal.onInput?.(...)`, so the
  // idle /exit never reaches the shell and runSession never resolves.
  await waitFor("terminal bound", () => terminal.onInput !== undefined);
  return { terminal, done };
}

const exitNow = (terminal: FakeTerminal): void => {
  terminal.onInput?.("/exit");
  terminal.onInput?.("\r");
};

describe("/exit arcs through the real session loop", () => {
  it("idle /exit closes at once, no drain line, guard never armed", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-exit-idle-"));
    try {
      const { terminal, done } = await openSession(root, (request) => settledResult(request, "unused", ACTOR));
      exitNow(terminal);
      await done;
      expect(plain(terminal)).not.toContain("exiting — waiting");
      expect(armed).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }, 30_000);

  it("mid-run /exit drains an abort-honoring worker with a visible status line", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-exit-midrun-"));
    try {
      let opened = 0;
      const { terminal, done } = await openSession(root, (request) => {
        opened += 1;
        return hangUntilAbort(request, sessionOf(request, ACTOR));
      });
      const promptDone = (async () => {
        await sleep(50);
        terminal.onInput?.("make me a sandwich");
        terminal.onInput?.("\r");
      })();
      await waitFor("worker opened", () => opened === 1);
      await promptDone;
      exitNow(terminal);
      await done;
      // The drain status line the user can read while /exit is working.
      expect(plain(terminal)).toContain("exiting — waiting up to 2s for worker(s)");
      // The worker honored the abort inside the budget: no stall verdict.
      expect(armed).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }, 30_000);

  it("mid-run /exit against a wedged finalizer returns the shell with a consistent verdict", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-exit-wedged-"));
    try {
      let opened = 0;
      // A turn that neither honors the abort signal nor ever finishes. Whether
      // /exit lets go at the drain deadline and REPORTS the stall, or the
      // interrupted run unwinds inside the budget (the wedge sits in a child
      // fiber that holds no handle and cannot block the process exit), depends
      // on where the interrupt lands — a scheduling race under full-suite
      // load. Both branches keep the developer's contract (the shell comes
      // back); what this tier pins is the invariant: a stalled report is
      // exactly when the session layer armed the exit guard, and runSession
      // resolves either way. The stall VERDICT itself is pinned
      // deterministically at the TUI seam (tests/tui/prompt.test.ts,
      // "closes even when the prompt finalizer never settles"), and the
      // shell-comes-back guarantee at the PTY seam
      // (tests/tui/exit-arcs.pty.test.ts).
      const { terminal, done } = await openSession(root, () => {
        opened += 1;
        return Effect.uninterruptible(Effect.never);
      });
      await sleep(50);
      terminal.onInput?.("this run will wedge");
      terminal.onInput?.("\r");
      await waitFor("worker opened", () => opened === 1);
      exitNow(terminal);
      // The shell returns: runSession resolves regardless of which branch
      // the drain verdict took.
      await done;
      const stalledReported = plain(terminal).includes("exited with stalled worker(s) (finalizers wedged)");
      expect(stalledReported).toBe(armed.mock.calls.length === 1);
      if (!stalledReported) expect(armed).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }, 30_000);
});
