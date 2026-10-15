// The complex UX the shell promises for a half-way stop: Escape interrupts the
// model and the run ends as *interrupted*, /exit hands the shell back — even
// when the run ignores its interrupt entirely — and /resume brings the chat
// back with the interrupted turn replayed honestly, so the next prompt keeps
// running the same run. The engine half (resume.json + progress.json) lives in
// tests/workflow/esc-pauses-run.test.ts and the full session arc (exit →
// resume → Escape → resume across real disk state) lives in
// tests/cli/session-pause-resume-arc.test.ts; this file pins the TUI boundary.
// The scripted terminal lives in tests/common.
import { Effect } from "effect";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentError } from "../../packages/harness/src/index.js";
import { runTui, type TuiResumeResult } from "../../packages/cli/src/tui.js";
import { FakeTerminal, plain, sleep, waitFor } from "../common/terminal.js";

describe("half-way stop: Escape, /exit, and /resume in one UX", () => {
  it("Escape interrupts the open run and the TUI stays usable", async () => {
    const terminal = new FakeTerminal();
    const events: string[] = [];
    const prompts: string[] = [];
    let interrupts = 0;
    // The open turn's abort handle, fired by onInterrupt exactly like the
    // engine reacts to its AbortController.
    let abortOpenTurn: (() => void) | undefined;
    const running = Effect.runPromise(runTui({
      terminal,
      onInterrupt: () => Effect.sync(() => {
        interrupts += 1;
        abortOpenTurn?.();
      }),
      onTaskEvent: (event) => events.push(event.type),
      runPrompt: (prompt) => {
        prompts.push(prompt);
        return Effect.async<string, unknown>((resume) => {
          abortOpenTurn = () => resume(Effect.fail(new AgentError({
            kind: "cancelled",
            message: "pi request cancelled",
          })));
        });
      },
    }));
    await sleep(30);
    terminal.onInput?.("do the work");
    terminal.onInput?.("\r");
    await waitFor("the run opened", () => prompts.length === 1);
    terminal.onInput?.("\x1b");
    await waitFor("the run ended as interrupted", () => events.includes("agentic.task.cancelled"));
    await sleep(80);
    expect(events).toEqual(["input.accepted", "agentic.task.started", "agentic.task.cancelled"]);
    // The chat says the honest word, and the run is really over: the TUI
    // accepts input again (the prompt editor still works after the interrupt).
    expect(plain(terminal)).toContain("interrupted");
    expect(interrupts).toBe(1);
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("/exit closes even when the run ignores the interrupt entirely", async () => {
    // The hang the user reported: a model call that neither settles nor dies.
    // The TUI must still hand the terminal back within its drain budget —
    // Ctrl+C must never be the only way out.
    const terminal = new FakeTerminal();
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: () => Effect.async<string, never>(() => {
        // No resume path at all: only the outer drain timeout lets go.
      }).pipe(Effect.uninterruptible),
    }));
    await sleep(30);
    terminal.onInput?.("long task");
    terminal.onInput?.("\r");
    await sleep(50);
    const started = performance.now();
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    // The run was still wedged at the drain deadline: the result carries the
    // stall verdict so the session layer arms the stalled-exit guard.
    await expect(running).resolves.toEqual({ type: "closed", stalled: true });
    expect(performance.now() - started).toBeLessThan(5000);
  }, 15_000);

  it("/resume replays the interrupted turn honestly and the next prompt keeps the run", async () => {
    const runsRoot = await mkdtemp(join(tmpdir(), "piano-tui-pause-resume-"));
    try {
      // A real progress.json saying "paused": the footer parser must accept it
      // rather than reject the snapshot (an unknown status hid the whole graph).
      const snapshotPath = join(runsRoot, "status.json");
      await writeFile(snapshotPath, `${JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        runId: "run-1",
        status: "paused",
        plannedStages: 1,
        completedStages: 0,
        acceptedStages: 0,
        remainingStages: 1,
        stageCounts: { agent: { planned: 1, completed: 0 } },
      })}\n`);
      const resumeResult: TuiResumeResult = {
        runId: "run-1",
        turns: [{
          prompt: "do the work",
          status: "cancelled",
          events: [{ type: "message_end", message: { role: "assistant", content: "partial reasoning" } }],
          error: { type: "AgentError", message: "pi request cancelled", kind: "cancelled" },
        }],
      };
      const prompts: string[] = [];
      const resumed: string[] = [];
      const terminal = new FakeTerminal();
      const running = Effect.runPromise(runTui({
        terminal,
        resumeRunId: "run-1",
        onResume: (runId) => {
          resumed.push(runId);
          return Effect.succeed({ ...resumeResult, statusPath: snapshotPath });
        },
        runPrompt: (prompt) => Effect.sync(() => {
          prompts.push(prompt);
          return "resumed answer";
        }),
      }));
      await waitFor("the takeover replayed", () => plain(terminal).includes("resumed run-1"));
      expect(resumed).toEqual(["run-1"]);
      // The interrupted turn comes back marked as an interrupt, not a failure,
      // and its transcript is there.
      const screen = plain(terminal);
      expect(screen).toContain("partial reasoning");
      expect(screen).toContain("interrupted");
      expect(screen).not.toContain("run failed");
      // The next prompt runs on the resumed session — the paused -> running
      // edge the engine test pins at the disk level.
      terminal.onInput?.("continue");
      terminal.onInput?.("\r");
      await waitFor("the next prompt ran", () => prompts.includes("continue"));
      terminal.onInput?.("/exit");
      terminal.onInput?.("\r");
      await expect(running).resolves.toEqual({ type: "closed" });
    } finally {
      await rm(runsRoot, { recursive: true, force: true });
    }
  });
});
