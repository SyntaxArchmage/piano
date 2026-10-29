import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Terminal } from "@earendil-works/pi-tui";
import { runTui } from "../../packages/cli/src/tui.js";
import { detectTheme, sideTheme } from "../../packages/cli/src/theme.js";
import type { ObservationOpSink } from "@piano/logging";
import type { TuiScreenKind } from "../../packages/cli/src/tui.js";
import type { WorkflowSignoffRequest } from "@piano/orchestrator";

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

/** Poll until `predicate` holds. Used where a render is driven by an effect that
 * the test cannot await directly (a gate raised from inside a live turn). */
const waitFor = async (predicate: () => boolean, description: string): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await settle();
  }
  throw new Error(`timed out waiting for ${description}`);
};

const signoffRequest = (): WorkflowSignoffRequest => ({
  stageId: "respond",
  invocationId: "inv-1",
  stage: "respond",
  worker: "basic",
  harness: "pi",
  round: 1,
  transcriptPath: "/tmp/run/transcript.jsonl",
  excerpt: "DRAFT1",
  consumers: ["reviewer"],
});

/** A runner whose turn stays open until `finish` is called. `finish` emits the
 * assistant message before resolving, so the reply lands in that screen's
 * transcript exactly the way a real harness reply does — which is what makes it
 * observable that the reply went to the *right* screen. */
const holdOpen = () => {
  const state: {
    emit?: (event: unknown) => void;
    resume?: (effect: Effect.Effect<string>) => void;
  } = {};
  const runner = (_prompt: string, onEvent: (event: never) => void) => {
    state.emit = onEvent as (event: unknown) => void;
    return Effect.async<string, never>((resume) => { state.resume = resume; });
  };
  const finish = (text: string): void => {
    state.emit?.({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });
    state.resume?.(Effect.succeed(text));
  };
  return { runner, finish };
};

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

  it("keeps the two conversations' ops on their own screens", async () => {
    // Ops carry no screen of their own; the producer routes them. Without
    // that, `/btw` would draw the mission's replies and vice versa.
    const terminal = new FakeTerminal();
    const sinks: Partial<Record<TuiScreenKind, ObservationOpSink>> = {};
    const reply = (target: TuiScreenKind, text: string) =>
      (): Effect.Effect<string> => Effect.sync(() => {
        sinks[target]?.([{
          version: 1,
          timestamp: new Date(1_000).toISOString(),
          handle: target === "mission" ? "msg:0:agent@root:1" : "msg:0:root:0",
          op: "end",
          name: "assistant.message",
          output: { role: "assistant", text },
        }]);
        return text;
      });
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: reply("mission", "mission secret"),
      runSideAgent: reply("side", "side secret"),
      attachObservationSink: (sink, target) => {
        sinks[target] = sink;
      },
    }));
    await settle();

    terminal.onInput?.("build the thing");
    terminal.onInput?.("\r");
    await waitFor(() => terminal.output.includes("mission secret"), "the mission reply to paint");

    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    const afterEnter = terminal.output.length;
    terminal.onInput?.("what changed");
    terminal.onInput?.("\r");
    await waitFor(() => terminal.output.includes("side secret"), "the side reply to paint");
    const painted = terminal.output.slice(afterEnter);
    expect(painted).not.toContain("mission secret");
    expect(painted).toContain("side secret");

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

  it("enters while a prompt is in flight, and keeps the two conversations apart", async () => {
    const terminal = new FakeTerminal();
    const side: string[] = [];
    const run = holdOpen();
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: run.runner,
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
    // Entering is no longer refused: the run keeps working on its own screen
    // while the side agent owns the foreground.
    expect(terminal.output.slice(beforeBtw)).not.toContain("finish or interrupt the current prompt");
    expect(terminal.output.slice(beforeBtw)).toContain("⌥ btw");
    expect(side).toEqual([]);

    // A prompt typed here belongs to the side agent...
    const afterEnter = terminal.output.length;
    terminal.onInput?.("what does this flag do");
    terminal.onInput?.("\r");
    await settle();
    expect(side).toEqual(["what does this flag do"]);

    // ...and the run's reply, which lands while the side screen is in front,
    // goes to the run's transcript and never reaches this one.
    run.finish("mission answer");
    await settle();
    expect(terminal.output.slice(afterEnter)).not.toContain("mission answer");

    // Going back shows the run's conversation, answer included.
    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    expect(terminal.output.slice(afterEnter)).toContain("mission answer");

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  }, 10_000);

  it("interrupts the turn of the screen in front, not the one that started last", async () => {
    const terminal = new FakeTerminal();
    const targets: string[] = [];
    const running = Effect.runPromise(runTui({
      terminal,
      onInterrupt: (target) => Effect.sync(() => { targets.push(target); }),
      runPrompt: holdOpen().runner,
      runSideAgent: holdOpen().runner,
    }));
    await settle();

    terminal.onInput?.("run something long");
    terminal.onInput?.("\r");
    await settle();
    terminal.onInput?.("/btw side errand");
    terminal.onInput?.("\r");
    await settle();
    // Both turns are live. Escape can only mean the conversation being looked
    // at, so a side turn must not steal the run's interrupt key.
    terminal.onInput?.("\x1b");
    await settle();
    expect(targets).toEqual(["side"]);

    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    terminal.onInput?.("\x1b");
    await settle();
    expect(targets).toEqual(["side", "mission"]);

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  }, 10_000);

  it("brings the run forward when it needs an answer", async () => {
    const terminal = new FakeTerminal();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: (_prompt, _onEvent, signoff) => Effect.gen(function* () {
        yield* Effect.promise(() => gate);
        const decision = yield* signoff!(signoffRequest());
        return decision.type;
      }),
      runSideAgent: replyWith("side answer", []),
    }));
    await settle();

    terminal.onInput?.("run the workflow");
    terminal.onInput?.("\r");
    await settle();
    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    const afterEnter = terminal.output.length;

    // The gate is mounted as the run's newest chat block. Left behind on the
    // side screen it would be invisible while holding the keyboard, and the run
    // would stall with nothing on screen to answer.
    release();
    await waitFor(() => terminal.output.slice(afterEnter).includes("Sign off"), "the gate comes to the front");

    // Escape answers the gate (cancelling the review), not the side agent.
    terminal.onInput?.("\x1b");
    await settle();
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  }, 10_000);

  it("paints the side screen in a palette of its own", async () => {
    const terminal = new FakeTerminal();
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: replyWith("mission answer", []),
      runSideAgent: replyWith("side answer", []),
    }));
    await settle();

    // The two screens must be tellable apart at a glance, so the guarantee is
    // asserted on the two colours that carry the most pixels: the brand accent
    // (banner border, editor border, footer label) and the bar.
    const base = detectTheme();
    const side = sideTheme(base);
    expect(side.accent).not.toBe(base.accent);
    expect(side.barBg).not.toBe(base.barBg);

    const beforeBtw = terminal.output.length;
    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    const sideFrame = terminal.output.slice(beforeBtw);
    expect(sideFrame).toContain(side.accent);
    expect(sideFrame).toContain(side.barBg);

    // ...and the run's own palette comes back with the run.
    const beforeReturn = terminal.output.length;
    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    expect(terminal.output.slice(beforeReturn)).toContain(base.barBg);

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

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

  it("names the workspace it can write to, on the side screen's own footer", async () => {
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
    expect(terminal.output).toContain("⌥ btw");
    expect(terminal.output).toContain("/tmp/some-workspace");

    const afterLeave = terminal.output.length;
    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    // Leaving repaints the footer as the run's own status panel, so the side
    // notice never lingers on the run's screen.
    expect(terminal.output.slice(afterLeave)).not.toContain("⌥ btw");

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
      onInterrupt: () => Effect.sync(() => {
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

  it("refuses a run-level command from the side screen instead of acting where it cannot be seen", async () => {
    const terminal = new FakeTerminal();
    const renamed: string[] = [];
    const mission: string[] = [];
    const running = Effect.runPromise(runTui({
      terminal,
      onRename: (name) => Effect.sync(() => { renamed.push(name); }),
      runPrompt: replyWith("mission answer", mission),
      runSideAgent: replyWith("side answer", []),
    }));
    await settle();

    terminal.onInput?.("/btw");
    terminal.onInput?.("\r");
    await settle();
    const afterEnter = terminal.output.length;
    terminal.onInput?.("/rename something else");
    terminal.onInput?.("\r");
    await settle();
    // Acting on the run from a chat the developer cannot see would look like
    // nothing happened; the hint names the way back instead.
    expect(renamed).toEqual([]);
    expect(terminal.output.slice(afterEnter)).toContain("/rename acts on the run; /btw returns to it");

    // The side agent still reads a plain prompt as its own.
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });
});
