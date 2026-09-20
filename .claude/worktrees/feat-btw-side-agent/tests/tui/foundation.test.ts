import { describe, expect, it } from "vitest";
import type { Terminal } from "@earendil-works/pi-tui";
import { Effect } from "effect";
import { askQuestion, AskQuestion, type AskQuestionAnswer } from "../../packages/cli/src/ask-question.js";

const question = () => new AskQuestion({
  title: "Choose a destination",
  message: "Use the keyboard or click an option.",
  options: [
    { id: "one", label: "First", description: "the first option" },
    { id: "two", label: "Second", description: "the second option" },
  ],
  allowText: true,
  placeholder: "Type a custom answer",
});

class FakeTerminal implements Terminal {
  columns = 80;
  rows = 24;
  output = "";
  stopped = false;
  onInput?: (data: string) => void;

  start(onInput: (data: string) => void): void { this.onInput = onInput; }
  stop(): void { this.stopped = true; }
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

describe("AskQuestion", () => {
  it("renders options and a custom text row", () => {
    const rows = question().render(80).join("\n");
    expect(rows).toContain("Choose a destination");
    expect(rows).toContain("First");
    expect(rows).toContain("Type a custom answer");
  });

  it("moves selection and confirms it with Enter", () => {
    const component = question();
    let answer: AskQuestionAnswer | undefined;
    component.onAnswer = (value) => { answer = value; };
    component.handleInput("\x1b[B");
    component.handleInput("\r");
    expect(answer).toEqual({ type: "option", id: "two" });
  });

  it("selects an option by real SGR mouse click, then confirms with Enter", () => {
    const component = question();
    let answer: AskQuestionAnswer | undefined;
    component.onAnswer = (value) => { answer = value; };
    component.handleInput("\x1b[<0;8;4M");
    expect(component.selectedOption?.id).toBe("two");
    component.handleInput("\r");
    expect(answer).toEqual({ type: "option", id: "two" });
  });

  it("confirms typed text", () => {
    const component = question();
    let answer: AskQuestionAnswer | undefined;
    component.onAnswer = (value) => { answer = value; };
    component.handleInput("custom answer");
    component.handleInput("\r");
    expect(answer).toEqual({ type: "text", value: "custom answer" });
  });

  it("cancels with Escape", () => {
    const component = question();
    let cancelled = false;
    component.onCancel = () => { cancelled = true; };
    component.handleInput("\x1b");
    expect(cancelled).toBe(true);
  });

  // pi-tui negotiates the Kitty keyboard protocol (or xterm modifyOtherKeys),
  // so these keys do not always arrive as their legacy bytes. A raw comparison
  // left the question prompt uncancellable on such a terminal.
  it.each([
    ["Kitty CSI-u", "\x1b[27u"],
    ["Kitty CSI-u with modifier", "\x1b[27;1u"],
    ["xterm modifyOtherKeys", "\x1b[27;1;27~"],
  ])("cancels with Escape encoded as %s", (_label, data) => {
    const component = question();
    let cancelled = false;
    component.onCancel = () => { cancelled = true; };
    component.handleInput(data);
    expect(cancelled).toBe(true);
  });

  it.each([
    ["legacy byte", "\x7f"],
    ["Kitty CSI-u", "\x1b[127u"],
    ["xterm modifyOtherKeys", "\x1b[27;1;127~"],
  ])("deletes a character with backspace encoded as %s", (_label, data) => {
    const component = question();
    component.handleInput("abc");
    component.handleInput(data);
    expect(component.textValue).toBe("ab");
  });

  it.each([
    ["Kitty CSI-u", "\x1b[13u"],
    ["SS3 numpad Enter", "\x1bOM"],
  ])("confirms the selection with Enter encoded as %s", (_label, data) => {
    const component = question();
    let answer: AskQuestionAnswer | undefined;
    component.onAnswer = (value) => { answer = value; };
    component.handleInput("\x1b[B");
    component.handleInput(data);
    expect(answer).toEqual({ type: "option", id: "two" });
  });

  it("moves selection with application-cursor-mode arrows", () => {
    const component = question();
    component.handleInput("\x1bOB");
    expect(component.selectedOption?.id).toBe("two");
    component.handleInput("\x1bOA");
    expect(component.selectedOption?.id).toBe("one");
  });

  it("wires the component through the Effect terminal boundary", async () => {
    const terminal = new FakeTerminal();
    const running = Effect.runPromise(askQuestion(question().spec, { terminal }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    terminal.onInput?.("\x1b[<0;8;4M");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "option", id: "two" });
    expect(terminal.stopped).toBe(true);
  });
});
