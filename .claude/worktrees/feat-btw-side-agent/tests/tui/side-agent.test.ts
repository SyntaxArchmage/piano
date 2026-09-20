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

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

/** Answer a prompt with one assistant message, so the reply lands in the chat. */
const replyWith = (text: string, seen: string[]) =>
  (prompt: string, onEvent: (event: never) => void): Effect.Effect<string> => Effect.sync(() => {
    seen.push(prompt);
    (onEvent as (event: unknown) => void)({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text }] },
    });
    return text;
  });

describe(" TUI /btw side agent", () => {
  it("routes prompts to the side agent while it is in front, and back to the run on return", async () => {
    const terminal = new FakeTerminal();
    const mission: string[] = [];
    const side: string[] = [];
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: replyWith("mission answer", mission),
      runSideAgent: replyWith("side answer", side),
    }));
    await settle();

    terminal.onInput?.("build the thing");
    terminal.onInput?.("\r");
    await settle();
    expect(mission).toEqual(["build the thing"]);

    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    // The pane belongs to the side agent now: its banner shows, and the
    // mission's reply is no longer on screen.
    const afterEnter = terminal.output.length;
    expect(terminal.output).toContain("⌥ btw");
    terminal.onInput?.("what does this flag do");
    terminal.onInput?.("\r");
    await settle();
    expect(side).toEqual(["what does this flag do"]);
    expect(mission).toEqual(["build the thing"]);
    expect(terminal.output.slice(afterEnter)).toContain("side answer");

    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    // Back on the run: the mission conversation was put aside, not discarded,
    // so its earlier answer is on screen again.
    const afterLeave = terminal.output.length;
    expect(terminal.output.slice(afterEnter)).toContain("mission answer");
    terminal.onInput?.("keep going");
    terminal.onInput?.("\r");
    await settle();
    expect(mission).toEqual(["build the thing", "keep going"]);
    expect(side).toEqual(["what does this flag do"]);
    // The side agent's answer is not mixed into the run's conversation.
    expect(terminal.output.slice(afterLeave)).not.toContain("side answer");

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("runs an inline prompt on entry and stays with the side agent", async () => {
    const terminal = new FakeTerminal();
    const mission: string[] = [];
    const side: string[] = [];
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: replyWith("mission answer", mission),
      runSideAgent: replyWith("side answer", side),
    }));
    await settle();

    terminal.onInput?.("/btw fix the typo in README");
    terminal.onInput?.("\r");
    await settle();
    expect(side).toEqual(["fix the typo in README"]);
    expect(mission).toEqual([]);

    // Still in front: a bare follow-up goes to the side agent too.
    terminal.onInput?.("and stage it");
    terminal.onInput?.("\r");
    await settle();
    expect(side).toEqual(["fix the typo in README", "and stage it"]);

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("keeps the side conversation when it is left and re-entered", async () => {
    const terminal = new FakeTerminal();
    const side: string[] = [];
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: replyWith("mission answer", []),
      runSideAgent: replyWith("side answer", side),
    }));
    await settle();

    terminal.onInput?.("/btw first side question");
    terminal.onInput?.("\r");
    await settle();
    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    const afterLeave = terminal.output.length;
    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    // Re-entering returns to the same conversation, so the earlier exchange is
    // rendered again — the banner is not re-emitted for a second visit.
    const afterReenter = terminal.output.slice(afterLeave);
    expect(afterReenter).toContain("first side question");
    expect(side).toEqual(["first side question"]);

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("refuses to switch while a prompt is in flight", async () => {
    const terminal = new FakeTerminal();
    const side: string[] = [];
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: () => Effect.async<string, never>(() => {}),
      runSideAgent: replyWith("side answer", side),
    }));
    await settle();

    terminal.onInput?.("long running");
    terminal.onInput?.("\r");
    await settle();
    const beforeBtw = terminal.output.length;
    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    expect(terminal.output.slice(beforeBtw)).toContain("finish or interrupt the current prompt");
    // The switch was refused, so a later prompt still belongs to the run.
    expect(side).toEqual([]);

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    // `/exit` interrupts the in-flight prompt, which yields immediately here.
    await expect(running).resolves.toEqual({ type: "closed" });
  }, 10_000);

  it("reports the side agent as unavailable when the session provides no runner", async () => {
    const terminal = new FakeTerminal();
    const mission: string[] = [];
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: replyWith("mission answer", mission),
    }));
    await settle();

    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    expect(terminal.output).toContain("the side agent is not available in this session");
    // The run keeps the chat: a missing runner must not strand the developer on
    // an empty side pane.
    terminal.onInput?.("carry on");
    terminal.onInput?.("\r");
    await settle();
    expect(mission).toEqual(["carry on"]);

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("reports a side agent failure as its own, not as a failed workflow", async () => {
    const terminal = new FakeTerminal();
    const events: string[] = [];
    const running = Effect.runPromise(runTui({
      terminal,
      onTaskEvent: (event) => events.push(event.type),
      runPrompt: replyWith("mission answer", []),
      runSideAgent: () => Effect.fail(new Error("tool refused")),
    }));
    await settle();

    terminal.onInput?.("/btw touch the file");
    terminal.onInput?.("\r");
    await settle();
    expect(terminal.output).toContain("side agent failed");
    expect(terminal.output).not.toContain("workflow failed");
    expect(events).toEqual(["input.accepted", "agentic.task.started", "agentic.task.failed"]);

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("keeps a footer notice naming the workspace it can write to, only while it is in front", async () => {
    const terminal = new FakeTerminal();
    const running = Effect.runPromise(runTui({
      terminal,
      workspaceCwd: "/tmp/some-workspace",
      runPrompt: replyWith("mission answer", []),
      runSideAgent: replyWith("side answer", []),
    }));
    await settle();

    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    // The side agent can run bash, so where it is pointed must never be a
    // guess: the footer says so for as long as it owns the prompt.
    expect(terminal.output).toContain("⌥ side agent");
    expect(terminal.output).toContain("/tmp/some-workspace");

    const afterLeave = terminal.output.length;
    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    // Leaving repaints the footer without the notice, so the run's own status
    // panel is never left claiming a side agent owns the prompt.
    expect(terminal.output.slice(afterLeave)).not.toContain("⌥ side agent");

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("interrupts a side turn through the same interrupt key as the run", async () => {
    const terminal = new FakeTerminal();
    let interrupts = 0;
    let finishSide: ((effect: Effect.Effect<string, never>) => void) | undefined;
    const running = Effect.runPromise(runTui({
      terminal,
      onInterrupt: Effect.sync(() => {
        interrupts += 1;
        finishSide?.(Effect.succeed("interrupted"));
      }),
      runPrompt: replyWith("mission answer", []),
      runSideAgent: () => Effect.async<string, never>((resume) => { finishSide = resume; }),
    }));
    await settle();

    terminal.onInput?.("/btw run the suite");
    terminal.onInput?.("\r");
    await settle();
    terminal.onInput?.("\x1b");
    await settle();
    expect(interrupts).toBe(1);

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });
});
