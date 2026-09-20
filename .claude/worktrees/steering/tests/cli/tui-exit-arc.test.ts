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
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStagingSession } from "@piano/logging";
import type { AgentRunner } from "@piano/harness";
import { runSession } from "../../packages/cli/src/session-run.js";
import { FakeTerminal, plain, waitFor } from "../common/terminal.js";
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

/**
 * Freeze the first staging commit at a point the test controls. The production
 * code deliberately makes that commit uninterruptible: a /exit received after
 * Enter must wait for a durable cancelled trajectory rather than close the TUI
 * with nowhere to write it. Without this barrier, whether /exit lands before
 * or after the commit is a scheduler race, so the assertion below would depend
 * on suite load rather than test the contract it names.
 */
interface CommitBarrier {
  readonly entered: Promise<void>;
  readonly released: Promise<void>;
  enter(): void;
  release(): void;
}

function createCommitBarrier(): CommitBarrier {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  return {
    entered,
    released,
    enter,
    release,
  };
}

async function openSession(root: string, runner: AgentRunner, commitBarrier?: CommitBarrier) {
  const workflowPath = join(root, "workflow.yml");
  await writeFile(workflowPath, WORKFLOW);
  const staging = createStagingSession({ root, cwd: root, runsRoot: join(root, "runs") });
  if (commitBarrier !== undefined) {
    const commit = staging.commit.bind(staging);
    staging.commit = () => Effect.gen(function* () {
      yield* Effect.sync(() => commitBarrier.enter());
      yield* Effect.promise(() => commitBarrier.released);
      yield* commit();
    });
  }
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
  // The module mock is intentionally shared by this file. Its calls are not:
  // each arc owns one exit and must make its assertion against only that exit.
  // Leaving them behind made the later tests accidentally depend on execution
  // order, which is why this file passed in a full run and failed alone.
  beforeEach(() => {
    armed.mockClear();
  });

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

  it("direct /exit after Enter still commits the cancelled turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-exit-direct-"));
    try {
      const commitBarrier = createCommitBarrier();
      const { terminal, done } = await openSession(root, (request) =>
        // /exit has already aborted this request when the barrier opens. This
        // runner therefore settles promptly once commit hands control to the
        // workflow, allowing runPrompt's uninterruptible onExit to persist the
        // cancelled trajectory. An uninterruptible never-ending runner would
        // instead test the separate 2-second stalled-finalizer path below.
        hangUntilAbort(request, sessionOf(request, ACTOR)),
        commitBarrier,
      );
      // No Escape first: this is the race where /exit can arrive while the
      // staging commit is still creating the run directory. Hold commit after
      // it has begun, then prove /exit drains rather than tearing it down.
      terminal.onInput?.("start and exit");
      terminal.onInput?.("\r");
      await commitBarrier.entered;
      terminal.onInput?.("/exit");
      terminal.onInput?.("\r");
      await waitFor("/exit draining the staging commit", () =>
        plain(terminal).includes("exiting — waiting up to 2s for worker(s)"),
      );
      commitBarrier.release();
      await done;
      const runDirs = await readdir(join(root, "runs"));
      expect(runDirs).toHaveLength(1);
      const trajectory = JSON.parse(await readFile(join(root, "runs", runDirs[0]!, "trajectory.json"), "utf8")) as { status?: string };
      expect(trajectory.status).toBe("cancelled");
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
      terminal.onInput?.("make me a sandwich");
      terminal.onInput?.("\r");
      await waitFor("worker opened", () => opened === 1);
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
