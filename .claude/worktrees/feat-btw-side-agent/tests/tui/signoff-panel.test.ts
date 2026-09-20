// Unit-level coverage for the interactive sign-off review: the review question
// is mounted as the newest block of the chat area (right above the prompt
// editor, under the transcript) rather than a floating centered overlay, and
// answering or cancelling removes the block so the chat returns to normal.
//
// The real-harness flow (approve → publish, reject → resume, Escape → failed
// run) is exercised end-to-end by signoff.pty.test.ts; these tests stub the
// sign-off channel through `runPrompt` and assert the live screen, so no model
// credentials are needed.
import { createRequire } from "node:module";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import { runTui, SignoffBlock, signoffStyles } from "../../packages/cli/src/tui.js";
import { AskQuestion, type AskQuestionAnswer, type AskQuestionSpec } from "../../packages/cli/src/ask-question.js";
import { darkTheme, lightTheme, RST } from "../../packages/cli/src/theme.js";
import type { WorkflowSignoffRequest } from "@piano/orchestrator";

const { Terminal: HeadlessTerminal } = createRequire(import.meta.url)("@xterm/headless") as {
  Terminal: typeof import("@xterm/headless").Terminal;
};

const FACE_SLOGAN = "Piano: A Programmable Agent Workflow System.";

class ScreenTerminal implements Terminal {
  readonly screen = new HeadlessTerminal({ cols: 100, rows: 40, scrollback: 0, allowProposedApi: true });
  columns = 100;
  rows = 40;
  private onInput?: (data: string) => void;

  start(onInput: (data: string) => void): void { this.onInput = onInput; }
  input(data: string): void { this.onInput?.(data); }
  capture(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.screen.rows; row += 1) {
      lines.push(this.screen.buffer.active.getLine(row)?.translateToString(true) ?? "");
    }
    return lines.join("\n");
  }
  stop(): void { this.screen.dispose(); }
  drainInput(): Promise<void> { return Promise.resolve(); }
  get kittyProtocolActive(): boolean { return false; }
  setTitle(): void {}
  setProgress(): void {}
  write(data: string): void { this.screen.write(data); }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
}

async function waitFor(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${description}`);
}

function request(round = 1): WorkflowSignoffRequest {
  return {
    stageId: "respond",
    invocationId: "inv-1",
    stage: "respond",
    worker: "basic",
    harness: "pi",
    round,
    transcriptPath: "/tmp/run/transcript.jsonl",
    excerpt: "DRAFT1",
  };
}

describe("TUI sign-off review panel", () => {
  it("mounts the review as the last chat block above the prompt and closes on approval", async () => {
    const terminal = new ScreenTerminal();
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: (_prompt, _onEvent, signoff) =>
        signoff!(request()).pipe(Effect.map((decision) => decision.type)),
    }));

    await waitFor(() => terminal.capture().includes(FACE_SLOGAN), "the shell");
    expect(terminal.capture()).not.toContain("Sign off respond?");
    expect(terminal.capture()).not.toContain("Approve");

    terminal.input("review this");
    terminal.input("\r");
    await waitFor(() => terminal.capture().includes("Sign off respond?"), "the review question");
    const rows = terminal.capture().split("\n");
    const titleRow = rows.findIndex((row) => row.includes("Sign off respond?"));
    const optionRow = rows.findIndex((row) => row.includes("Approve"));
    const echoRow = rows.findIndex((row) => row.includes("review this"));
    const footerRow = rows.findIndex((row) => row.includes("COMMANDS"));
    // Inline in the chat column (left edge), not a centered overlay: the title
    // sits on the purple panel two columns inside its left edge, below the
    // reviewed user message and just above the prompt-editor/footer block.
    expect(titleRow).toBeGreaterThan(0);
    expect(rows[titleRow]?.indexOf("Sign off respond?")).toBe(2);
    expect(titleRow).toBeGreaterThan(echoRow);
    expect(optionRow).toBeGreaterThan(titleRow);
    expect(optionRow).toBeLessThan(footerRow);
    expect(footerRow - optionRow).toBeLessThanOrEqual(6);

    // Approving removes the block: the chat returns to its normal transcript.
    terminal.input("\r");
    await waitFor(() => !terminal.capture().includes("Sign off respond?"), "the panel to close");
    const after = terminal.capture();
    expect(after).not.toContain("Approve");
    expect(after).toContain("review this");
    // The finished review is echoed into the chat as a user message (styled
    // like the prompt), so the decision stays visible once the panel closes.
    expect(after).toContain("Sign off respond: approved");

    terminal.input("/exit");
    terminal.input("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("runs the reject-with-feedback flow through a second inline question", async () => {
    const terminal = new ScreenTerminal();
    const decisions: string[] = [];
    const running = Effect.runPromise(runTui({
      terminal,
      runPrompt: (_prompt, _onEvent, signoff) =>
        signoff!(request()).pipe(
          Effect.map((decision) => {
            decisions.push(decision.type);
            return decision.type === "approve" ? "approved" : "rejected";
          }),
        ),
    }));

    await waitFor(() => terminal.capture().includes(FACE_SLOGAN), "the shell");
    terminal.input("review this");
    terminal.input("\r");
    await waitFor(() => terminal.capture().includes("Reject — you should still work on:"), "the review options");

    terminal.input("\x1b[B"); // move to "Reject — you should still work on:"
    terminal.input("\r");
    await waitFor(() => terminal.capture().includes("You should still work on (respond)"), "the feedback question");
    terminal.input("redo it with DRAFT2");
    terminal.input("\r");
    await waitFor(() => decisions.includes("reject"), "the rejection decision");
    await waitFor(() => !terminal.capture().includes("You should still work on (respond)"), "the feedback panel to close");
    expect(terminal.capture()).toContain("review this");
    // The rejection and the typed reason are echoed into the chat as a user
    // message, verbatim, right where the review panel closed.
    expect(terminal.capture()).toContain("Sign off respond: you should still work on: redo it with DRAFT2");

    terminal.input("/exit");
    terminal.input("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });

  it("cancels the review with Escape instead of interrupting the agent", async () => {
    const terminal = new ScreenTerminal();
    let interrupts = 0;
    const running = Effect.runPromise(runTui({
      terminal,
      onInterrupt: Effect.sync(() => { interrupts += 1; }),
      runPrompt: (_prompt, _onEvent, signoff) =>
        signoff!(request()).pipe(Effect.map((decision) => decision.type)),
    }));

    await waitFor(() => terminal.capture().includes(FACE_SLOGAN), "the shell");
    terminal.input("review this");
    terminal.input("\r");
    await waitFor(() => terminal.capture().includes("Sign off respond?"), "the review question");

    terminal.input("\x1b"); // Escape cancels the review (like the pty flow)
    await waitFor(() => terminal.capture().includes("workflow failed"), "the cancelled-review failure");
    expect(interrupts).toBe(0);
    expect(terminal.capture()).not.toContain("Sign off respond?");

    terminal.input("/exit");
    terminal.input("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
  });
});

function reviewSpec(): AskQuestionSpec {
  return {
    title: "Sign off respond?",
    message: "worker basic · harness pi",
    details: ["result: DRAFT1", "transcript: /tmp/run/transcript.jsonl"],
    options: [
      { id: "approve", label: "Approve", description: "publish the accepted result" },
      { id: "reject", label: "Reject with feedback", description: "resume the actor with your feedback" },
    ],
  };
}

describe("SignoffBlock", () => {
  it("draws the review question as a bordered panel, not a full-width colour wash", () => {
    const theme = darkTheme;
    const panel = new SignoffBlock(new AskQuestion(reviewSpec(), signoffStyles(theme)), theme);
    const rows = panel.render(60);
    // top edge + title + message + 2 details + 2 options + bottom edge
    expect(rows.length).toBe(8);
    for (const row of rows) {
      expect(row, "every block row resets its styling").toContain(RST);
      expect(visibleWidth(row), "every block row spans the full chat width").toBe(60);
    }
    // Only the box outline is coloured across the row; the interior carries the
    // very dark purple fill. No row is a light-purple full-width wash.
    expect(rows[0]).toContain(theme.signoffBorder);
    expect(rows[0]).toContain("┌");
    expect(rows[0]).toContain("┐");
    expect(rows[0]).not.toContain(theme.signoffBg);
    expect(rows[rows.length - 1]).toContain(theme.signoffBorder);
    expect(rows[rows.length - 1]).toContain("└");
    expect(rows[rows.length - 1]).toContain("┘");
    expect(rows[rows.length - 1]).not.toContain(theme.signoffBg);
    for (const row of rows.slice(1, -1)) {
      expect(row, "the panel interior carries the dark purple fill").toContain(theme.signoffBg);
      expect(row).not.toContain(theme.signoffBorder + "─");
    }
    const out = rows.join("\n");
    expect(out).toContain("Sign off respond?");
    expect(out).toContain("Approve");
    // The question rows are restyled for the dark purple surface.
    expect(out).toContain(theme.signoffTitle);
    expect(out).toContain(theme.signoffMuted);
    expect(out).toContain(theme.signoffText);
    // Title sits two columns inside the left border (the border glyph itself
    // plus one space of the dark fill).
    expect(visibleWidth(rows[1]!.slice(0, rows[1]!.indexOf("Sign off respond?")))).toBe(2);
    expect(rows[0]).not.toContain("Sign off");
    expect(rows[rows.length - 1]).not.toContain("Sign off");
    // Interior rows open with a vertical border glyph before the fill.
    expect(rows[1]!.startsWith(theme.signoffBorder + "│" + RST + theme.signoffBg)).toBe(true);
  });

  it("leaves the question's keyboard behaviour untouched inside the panel", () => {
    const theme = darkTheme;
    const question = new AskQuestion(reviewSpec(), signoffStyles(theme));
    const panel = new SignoffBlock(question, theme);
    let answer: AskQuestionAnswer | undefined;
    question.onAnswer = (value) => { answer = value; };
    question.handleInput("\x1b[B"); // move to "Reject with feedback"
    question.handleInput("\r");
    expect(answer).toEqual({ type: "option", id: "reject" });
    expect(panel.render(60).join("\n")).toContain("Reject with feedback");
  });

  it("paints the free-text feedback question on the light-shell panel too", () => {
    const theme = lightTheme;
    const panel = new SignoffBlock(new AskQuestion({
      title: "Feedback for respond",
      options: [],
      allowText: true,
      placeholder: "Type the reviewer feedback",
    }, signoffStyles(theme)), theme);
    const rows = panel.render(60);
    expect(rows.join("\n")).toContain("Type the reviewer feedback");
    expect(rows.join("\n")).toContain(theme.signoffBorder);
    for (const row of rows.slice(1, -1)) {
      expect(row).toContain(theme.signoffBg);
      expect(visibleWidth(row)).toBe(60);
    }
    // The light shell must not fall back to a light lavender wash: the fill is
    // the same very dark purple as the dark shell, text stays light.
    expect(theme.signoffBg).toBe(darkTheme.signoffBg);
    expect(rows[0]).not.toContain(theme.signoffBg);
  });
});
