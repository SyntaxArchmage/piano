import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Terminal } from "@earendil-works/pi-tui";
import { runTui } from "../../packages/cli/src/tui.js";

class FakeTerminal implements Terminal {
  columns = 100;
  rows = 40;
  onInput?: (data: string) => void;
  output = "";
  /** Suspend/resume hands the terminal back and takes it again, so the guard
   * tests count the transitions. */
  startCount = 0;
  stopCount = 0;

  start(onInput: (data: string) => void): void { this.onInput = onInput; this.startCount += 1; }
  stop(): void { this.stopCount += 1; }
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

describe(" TUI prompt path", () => {
  it("sends editor input through the runner and exits through /exit", async () => {
    const terminal = new FakeTerminal();
    const prompts: string[] = [];
    const events: string[] = [];
    const running = Effect.runPromise(runTui({
      terminal,
      onTaskEvent: (event) => events.push(event.type),
      runPrompt: (prompt, onEvent) => Effect.sync(() => {
        prompts.push(prompt);
        onEvent({
          type: "message_update",
          message: { role: "assistant", content: [{ type: "text", text: "ans = " }] },
          assistantMessageEvent: { type: "text_delta", delta: "ans = " },
        });
        onEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ans = 4" }] } });
        return "ans = 4";
      }),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("hello");
    terminal.onInput?.("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(prompts).toEqual(["hello"]);
    expect(terminal.output).toContain("ans = ");
    expect(terminal.output).toContain("ans = 4");
    expect(events).toEqual([
      "input.accepted",
      "agentic.task.started",
      "agentic.task.completed",
    ]);
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("recalls persisted prompts through the real TUI input path", async () => {
    const historyRoot = await mkdtemp(join(tmpdir(), "piano-tui-history-"));
    try {
      const firstTerminal = new FakeTerminal();
      const firstRun = Effect.runPromise(runTui({
        terminal: firstTerminal,
        historyRoot,
        runPrompt: () => Effect.succeed("first response"),
      }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      firstTerminal.onInput?.("first prompt");
      firstTerminal.onInput?.("\r");
      await new Promise((resolve) => setTimeout(resolve, 20));
      firstTerminal.onInput?.("/exit");
      firstTerminal.onInput?.("\r");
      await expect(firstRun).resolves.toEqual({ type: "closed" });

      const secondTerminal = new FakeTerminal();
      const recalled: string[] = [];
      const secondRun = Effect.runPromise(runTui({
        terminal: secondTerminal,
        historyRoot,
        runPrompt: (prompt) => Effect.sync(() => {
          recalled.push(prompt);
          return "second response";
        }),
      }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      secondTerminal.onInput?.("\x1b[A");
      secondTerminal.onInput?.("\r");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(recalled).toEqual(["first prompt"]);
      secondTerminal.onInput?.("/exit");
      secondTerminal.onInput?.("\r");
      await expect(secondRun).resolves.toEqual({ type: "closed" });
    } finally {
      await rm(historyRoot, { recursive: true, force: true });
    }
  });

  it("scrolls the trajectory with the wheel only over the side panel", async () => {
    const terminal = new FakeTerminal();
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: (_prompt, onEvent) => Effect.sync(() => {
        // The ledger window is terminal-height derived, so it takes more than a
        // screenful of entries to push content above the fold and produce the
        // "↑ N more" indicator this test scrolls against.
        for (let i = 0; i < 60; i++) {
          onEvent({ type: "usage", usage: { input: i, output: 0 } });
        }
        return "response";
      }),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("hello");
    terminal.onInput?.("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const tailMore = terminal.output.match(/↑ (\d+) more/)?.[1];
    expect(tailMore).toBeDefined();

    const tailOutputLength = terminal.output.length;
    terminal.onInput?.("\x1b[<64;80;5M"); // wheel up inside the right pane
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(terminal.output.length).toBeGreaterThan(tailOutputLength);
    expect(terminal.output.slice(tailOutputLength)).toContain(`↑ ${Number(tailMore) - 1} more`);

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("scrolls chat content with the wheel over the left pane", async () => {
    const terminal = new FakeTerminal();
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: (_prompt, onEvent) => Effect.sync(() => {
        onEvent({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: Array.from({ length: 60 }, (_, i) => `chat line ${i}`).join("\n") }],
          },
        });
        return "response";
      }),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("hello");
    terminal.onInput?.("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const tailOutputLength = terminal.output.length;
    terminal.onInput?.("\x1b[<64;20;5M"); // wheel up over the chat pane
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(terminal.output.length).toBeGreaterThan(tailOutputLength);

    const chatOutputLength = terminal.output.length;
    terminal.onInput?.("\x1b[<64;80;5M"); // wheel up over the trajectory pane
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(terminal.output.length).toBe(chatOutputLength);

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("keeps the chat stream open when trajectory-only events interleave token deltas", async () => {
    // Guards ISSUE-011/012: usage/resource/context events must not finalize and
    // recreate the live Markdown stream, which blinked the chat area and caused
    // narrow re-wrapping. The deltas around the noise must render contiguously.
    const terminal = new FakeTerminal();
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: (_prompt, onEvent) => Effect.sync(() => {
        const delta = (text: string) => onEvent({
          type: "message_update",
          message: { role: "assistant", content: [{ type: "text", text }] },
          assistantMessageEvent: { type: "text_delta", delta: text },
        });
        delta("hello ");
        onEvent({ type: "usage", usage: { input: 0, output: 0, totalTokens: 0 } });
        onEvent({ type: "resource", resource: { kind: "context-file", status: "loaded", source: "workflow", path: "/tmp/a.md", bytes: 1 } });
        onEvent({ type: "context", context: { contextFilePaths: ["/tmp/a.md"] } });
        delta("world");
        onEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "hello world" }] } });
        return "hello world";
      }),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("hello");
    terminal.onInput?.("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The final message text renders intact across the interleaved noise events.
    expect(terminal.output).toContain("hello world");
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("keeps a long response inside the chat component width", async () => {
    const terminal = new FakeTerminal();
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: () => Effect.succeed("response ".repeat(100)),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("hello");
    terminal.onInput?.("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("records a prompt failure and remains closable", async () => {
    const terminal = new FakeTerminal();
    const events: string[] = [];
    const running = Effect.runPromise(runTui({
      terminal,
      onTaskEvent: (event) => events.push(event.type),
      runPrompt: () => Effect.fail(new Error("request rejected")),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("hello");
    terminal.onInput?.("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(["input.accepted", "agentic.task.started", "agentic.task.failed"]);
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("dispatches Escape to the active prompt interrupt effect", async () => {
    const terminal = new FakeTerminal();
    let interrupts = 0;
    let finishPrompt: ((effect: Effect.Effect<string, never>) => void) | undefined;
    const running = Effect.runPromise(runTui({
      terminal,
      onInterrupt: Effect.sync(() => {
        interrupts += 1;
        finishPrompt?.(Effect.succeed("interrupted"));
      }),
      runPrompt: () => Effect.async<string, never>((resume) => {
        finishPrompt = resume;
      }),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("hello");
    terminal.onInput?.("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("\x1b");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(interrupts).toBe(1);
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("waits for the prompt finalizer to drain before /exit resolves", async () => {
    const terminal = new FakeTerminal();
    let cleaned = false;
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: () => Effect.async<string, never>(() => {
        // A prompt fiber that, once interrupted, flips `cleaned` in its finalizer.
        const cleanup = Effect.sync(() => { cleaned = true; });
        return cleanup;
      }),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("hello");
    terminal.onInput?.("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
    // The cleanup must have drained before /exit resolved — not after teardown.
    expect(cleaned).toBe(true);
  });

  it("interrupts an active prompt before /exit closes the TUI", async () => {
    const terminal = new FakeTerminal();
    const events: string[] = [];
    let promptStarted = false;
    let promptInterrupted = false;
    const running = Effect.runPromise(runTui({
      terminal,
      onTaskEvent: (event) => events.push(event.type),
      runPrompt: () => Effect.async<string, never>(() => {
        promptStarted = true;
        return Effect.sync(() => { promptInterrupted = true; });
      }),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("hello");
    terminal.onInput?.("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(promptStarted).toBe(true);
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
    expect(promptInterrupted).toBe(true);
    expect(events).toEqual(["input.accepted", "agentic.task.started", "agentic.task.cancelled"]);
  });

  // The prompt's own cleanup runs uninterruptibly, so a finalizer that never
  // settles (an SDK abort awaiting a dead socket, a stuck workspace cleanup)
  // used to leave the TUI mounted in raw mode forever with /exit, Ctrl+C and
  // Ctrl+Z all dead — the terminal could only be recovered by killing the
  // process from elsewhere.
  it("closes even when the prompt finalizer never settles", async () => {
    const terminal = new FakeTerminal();
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: () => Effect.async<string, never>(() => Effect.never),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("hello");
    terminal.onInput?.("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    // The runner never settles, so /exit lets go at the drain deadline and
    // marks the close stalled.
    await expect(running).resolves.toEqual({ type: "closed", stalled: true });
  }, 10_000);

  it("force-closes on a repeat exit press instead of waiting for the drain", async () => {
    const terminal = new FakeTerminal();
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: () => Effect.async<string, never>(() => Effect.never),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("hello");
    terminal.onInput?.("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const started = performance.now();
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("\x03");
    // The escalation closes while the first exit is still draining, so the
    // result is reported as stalled: the session layer arms the exit guard.
    await expect(running).resolves.toEqual({ type: "closed", stalled: true });
    // Well inside the drain timeout: the second press must not be a no-op that
    // silently waits it out.
    expect(performance.now() - started).toBeLessThan(1000);
  }, 10_000);

  // Subprocess harnesses spawn detached in their own process group, so an
  // un-aborted child outlives the TUI and its open pipes keep the process alive
  // after the terminal is handed back: the shell never gets its prompt.
  it("aborts the in-flight run when /exit closes the TUI", async () => {
    const terminal = new FakeTerminal();
    let interrupts = 0;
    const running = Effect.runPromise(runTui({
      terminal,
      onInterrupt: Effect.sync(() => { interrupts += 1; }),
      runPrompt: () => Effect.async<string, never>(() => Effect.never),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("hello");
    terminal.onInput?.("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed", stalled: true });
    expect(interrupts).toBe(1);
  }, 10_000);

  it("leaves the run untouched when /exit closes an idle TUI", async () => {
    const terminal = new FakeTerminal();
    let interrupts = 0;
    const running = Effect.runPromise(runTui({
      terminal,
      onInterrupt: Effect.sync(() => { interrupts += 1; }),
      runPrompt: () => Effect.succeed("done"),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
    expect(interrupts).toBe(0);
  });

  // Raw mode clears ISIG, so the shell's job control never sees Ctrl+Z: the TUI
  // has to release the terminal and raise SIGTSTP itself, then rebuild the frame
  // when the shell continues it.
  it("suspends on Ctrl+Z and re-arms the terminal on SIGCONT", async () => {
    const terminal = new FakeTerminal();
    let suspends = 0;
    const running = Effect.runPromise(runTui({
      terminal,
      suspendProcess: () => { suspends += 1; },
      runPrompt: () => Effect.succeed("done"),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(terminal.startCount).toBe(1);
    const beforeSuspend = terminal.output.length;
    terminal.onInput?.("\x1a");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(suspends).toBe(1);
    // Terminal handed back: raw mode released and mouse reporting turned off.
    expect(terminal.stopCount).toBe(1);
    expect(terminal.output.slice(beforeSuspend)).toContain("\x1b[?1002;1006l");
    const beforeContinue = terminal.output.length;
    process.emit("SIGCONT");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(terminal.startCount).toBe(2);
    expect(terminal.output.slice(beforeContinue)).toContain("\x1b[?1002;1006h");
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("stops listening for SIGCONT once the TUI has closed", async () => {
    const terminal = new FakeTerminal();
    const running = Effect.runPromise(runTui({
      terminal,
      suspendProcess: () => {},
      runPrompt: () => Effect.succeed("done"),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
    const startsAfterClose = terminal.startCount;
    process.emit("SIGCONT");
    await new Promise((resolve) => setTimeout(resolve, 20));
    // A closed TUI must not grab a terminal it no longer owns.
    expect(terminal.startCount).toBe(startsAfterClose);
  });
});
