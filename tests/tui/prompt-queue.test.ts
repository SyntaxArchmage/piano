// Mid-turn input first tries the steering channel; only what the channel does
// not take (no active turn, or a backend that cannot steer) is held as the
// queued next turn — and, when the run reaches a terminal state, submitted as
// a normal next prompt of the same session. A human-interrupted run does not
// auto-restart — the queued text returns to the editor instead.
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Terminal } from "@earendil-works/pi-tui";
import { runTui } from "../../packages/cli/src/tui.js";

class FakeTerminal implements Terminal {
  columns = 100;
  rows = 40;
  onInput?: (data: string) => void;
  output = "";
  start(onInput: (data: string) => void): void { this.onInput = onInput; }
  stop(): void {}
  drainInput(): Promise<void> { return Promise.resolve(); }
  get kittyProtocolActive(): boolean { return false; }
  setTitle(): void {}
  setProgress(): void {}
  write(data: string): void { this.output += data; }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label: string, check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor(${label}) timed out`);
    await sleep(10);
  }
}

/** runPrompt that records every accepted prompt and keeps each turn open
 * until the test completes it (success) or fails it (interrupt-shaped error). */
function makeHarness() {
  const calls: string[] = [];
  const open: Array<(exit: Effect.Effect<string, unknown>) => void> = [];
  const complete = (exit: Effect.Effect<string, unknown>) => {
    const finish = open.shift();
    if (finish === undefined) throw new Error("no open prompt to complete");
    finish(exit);
  };
  const runPrompt = (prompt: string) =>
    Effect.async<string, unknown>((resume) => {
      calls.push(prompt);
      open.push((exit) => resume(exit));
    });
  return { calls, runPrompt, complete };
}

/** Terminal writes with every escape sequence stripped (colors, cursor moves,
 * OSC titles) — what a human would read as screen text. */
/* eslint-disable no-control-regex -- test helper strips terminal escape codes */
const plain = (terminal: FakeTerminal) =>
  terminal.output
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
/* eslint-enable no-control-regex */

describe("prompt queue while a workflow runs", () => {
  it("holds a prompt submitted mid-run and runs it as the next prompt when the run finishes", async () => {
    const terminal = new FakeTerminal();
    const harness = makeHarness();
    const running = Effect.runPromise(runTui({ terminal, runPrompt: (p) => harness.runPrompt(p) }));
    await sleep(30);
    terminal.onInput?.("first");
    terminal.onInput?.("\r");
    await waitFor("first accepted", () => harness.calls.length === 1);
    terminal.onInput?.("second");
    terminal.onInput?.("\r");
    await sleep(50);
    // The running workflow sees no change: no new prompt reached the runner.
    expect(harness.calls).toEqual(["first"]);
    expect(plain(terminal)).toContain("queued");
    // The run finishes; the queued prompt starts it again, same session path.
    harness.complete(Effect.succeed("answer one"));
    await waitFor("second accepted", () => harness.calls.length === 2);
    expect(harness.calls).toEqual(["first", "second"]);
    // The follow-up is a real user turn, not only a duration footer.
    expect(plain(terminal)).toContain("second");
    harness.complete(Effect.succeed("answer two"));
    await sleep(50);
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("keeps only the latest queued prompt and does not touch the running workflow", async () => {
    const terminal = new FakeTerminal();
    const harness = makeHarness();
    const running = Effect.runPromise(runTui({ terminal, runPrompt: (p) => harness.runPrompt(p) }));
    await sleep(30);
    terminal.onInput?.("first");
    terminal.onInput?.("\r");
    await waitFor("first accepted", () => harness.calls.length === 1);
    terminal.onInput?.("second");
    terminal.onInput?.("\r");
    terminal.onInput?.("third");
    terminal.onInput?.("\r");
    await sleep(50);
    expect(harness.calls).toEqual(["first"]);
    harness.complete(Effect.succeed("done"));
    await waitFor("next accepted", () => harness.calls.length === 2);
    expect(harness.calls).toEqual(["first", "third"]);
    harness.complete(Effect.succeed("done"));
    await sleep(50);
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("runs text typed while the sign-off panel owns the keyboard as the next prompt", async () => {
    const terminal = new FakeTerminal();
    const harness = makeHarness();
    // The first turn blocks in the sign-off review, like a real gated stage.
    const runPrompt = (prompt: string, _onEvent: unknown, signoff?: (req: unknown) => Effect.Effect<unknown>) =>
      prompt === "first"
        ? Effect.gen(function* () {
          yield* signoff!({
            stageId: "agent@root", invocationId: "agent@root", stage: "agent", worker: "basic",
            harness: "pi", round: 1, transcriptPath: "/tmp/t.jsonl", excerpt: "excerpt",
            // Nothing consumes this stage, so continuing is the single-step
            // decision the test's one Enter is written for.
            consumers: [],
          });
          return "answer one";
        })
        : harness.runPrompt(prompt);
    const running = Effect.runPromise(runTui({ terminal, runPrompt: runPrompt as never }));
    await sleep(30);
    terminal.onInput?.("first");
    terminal.onInput?.("\r");
    await waitFor("panel mounted", () => plain(terminal).includes("Sign off agent@root?"));
    // The review owns the keyboard; the next prompt is typed into the panel.
    terminal.onInput?.("next task");
    terminal.onInput?.("\r"); // Enter still answers the gate: approve
    await waitFor("second accepted", () => harness.calls.length === 1);
    // The approved review ends the run; the typed text ran as its next turn.
    expect(harness.calls).toEqual(["next task"]);
    harness.complete(Effect.succeed("answer two"));
    await sleep(50);
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("hands the queued prompt back to the editor when the run is interrupted", async () => {
    const terminal = new FakeTerminal();
    const harness = makeHarness();
    // Esc dispatches deps.onInterrupt; the real one aborts the controller and
    // the prompt then fails with a cancellation-shaped error.
    let interruptActive = (): void => {};
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: (p) => harness.runPrompt(p),
      onInterrupt: () => Effect.sync(() => interruptActive()),
    }));
    await sleep(30);
    terminal.onInput?.("first");
    terminal.onInput?.("\r");
    await waitFor("first accepted", () => harness.calls.length === 1);
    interruptActive = () => harness.complete(Effect.fail({ kind: "cancelled" }));
    terminal.onInput?.("second");
    terminal.onInput?.("\r");
    await sleep(50);
    expect(harness.calls).toEqual(["first"]);
    const mark = plain(terminal).length; // the editor is empty while queued
    terminal.onInput?.("\x1b"); // Esc → interrupt shortcut
    await waitFor("interrupt settled", () => {
      const after = plain(terminal).slice(mark);
      return after.includes("second") && after.includes("interrupted");
    }, 3000);
    // Nothing auto-restarted the workflow; the text is back in the editor.
    expect(harness.calls).toEqual(["first"]);
    // Submitting again runs it as the next prompt of the same session.
    terminal.onInput?.("\r");
    await waitFor("re-submitted", () => harness.calls.length === 2);
    expect(harness.calls).toEqual(["first", "second"]);
    harness.complete(Effect.succeed("answer two"));
    await sleep(50);
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });
});

// Tier: mocked integration. Running-input routing goes through the steering
// channel before the queue — the branch reads the channel's answer, never a
// harness name. Delivered text is consumed there and never restarts the run;
// only what the channel returns becomes the queued next turn (unchanged).
describe(" mid-turn steering ahead of the queue", () => {
  it("delivers running-input to the steering channel and starts no new prompt", async () => {
    const terminal = new FakeTerminal();
    const harness = makeHarness();
    const steered: string[] = [];
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: (p) => harness.runPrompt(p),
      steerActive: (text) => {
        steered.push(text);
        return Effect.succeed("delivered" as const);
      },
    }));
    await sleep(30);
    terminal.onInput?.("first");
    terminal.onInput?.("\r");
    await waitFor("first accepted", () => harness.calls.length === 1);
    terminal.onInput?.("go left");
    terminal.onInput?.("\r");
    await waitFor("steered echo", () => plain(terminal).includes("steered"));
    expect(steered).toEqual(["go left"]);
    expect(harness.calls).toEqual(["first"]); // no new prompt was started
    expect(plain(terminal)).toContain("steered");
    // Steering must show the actual user text, not merely a status marker.
    expect(plain(terminal)).toContain("go left");
    // The run ending replays nothing: the steered text was consumed mid-turn.
    harness.complete(Effect.succeed("answer one"));
    await sleep(50);
    expect(harness.calls).toEqual(["first"]);
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("falls back to the queue when the channel reports no live session", async () => {
    const terminal = new FakeTerminal();
    const harness = makeHarness();
    let attempted = 0;
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: (p) => harness.runPrompt(p),
      steerActive: () => {
        attempted += 1;
        return Effect.succeed("no-active-turn" as const);
      },
    }));
    await sleep(30);
    terminal.onInput?.("first");
    terminal.onInput?.("\r");
    await waitFor("first accepted", () => harness.calls.length === 1);
    terminal.onInput?.("second");
    terminal.onInput?.("\r");
    await waitFor("queue echo", () => plain(terminal).includes("queued"));
    expect(attempted).toBe(1);
    expect(plain(terminal)).toContain("queued");
    harness.complete(Effect.succeed("answer one"));
    await waitFor("second accepted", () => harness.calls.length === 2);
    expect(harness.calls).toEqual(["first", "second"]);
    harness.complete(Effect.succeed("answer two"));
    await sleep(50);
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("queues with a refusal note when a live session rejects the steer", async () => {
    const terminal = new FakeTerminal();
    const harness = makeHarness();
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: (p) => harness.runPrompt(p),
      steerActive: () => Effect.fail(new Error("session closed")),
    }));
    await sleep(30);
    terminal.onInput?.("first");
    terminal.onInput?.("\r");
    await waitFor("first accepted", () => harness.calls.length === 1);
    terminal.onInput?.("second");
    terminal.onInput?.("\r");
    await waitFor("refused", () => plain(terminal).includes("steering refused"));
    harness.complete(Effect.succeed("answer one"));
    await waitFor("second accepted", () => harness.calls.length === 2);
    expect(harness.calls).toEqual(["first", "second"]);
    harness.complete(Effect.succeed("answer two"));
    await sleep(50);
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });
});
