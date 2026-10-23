import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { isKittyProtocolActive, setKittyProtocolActive, type Terminal } from "@earendil-works/pi-tui";
import { runTui } from "../../packages/cli/src/tui.js";

/** Mouse reporting is a DEC private mode, so the whole feature is observable as
 * writes on the terminal. This fake records them in order. */
class FakeTerminal implements Terminal {
  columns = 120;
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

const MOUSE_ON = "\x1b[?1002;1006h";
const MOUSE_OFF = "\x1b[?1002;1006l";
/** This terminal reports no Kitty support, so Alt+C arrives as the legacy
 * escape-prefixed form. The CSI-u encodings are covered in shortcuts.test.ts. */
const ALT_C = "\x1bc";
const WHEEL_UP_OVER_CHAT = "\x1b[<64;20;5M";

const settle = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 20));

/** Poll until `check` holds. The TUI paints the footer on its own schedule, and
 * a fixed sleep is a race on a loaded machine: the first render can land after
 * the window closes. */
async function waitForOutput(terminal: FakeTerminal, check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`output never matched; saw:\n${terminal.output}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("copy mode", () => {
  it("hands the mouse to the terminal on Alt+C and takes it back", async () => {
    const kittyWasActive = isKittyProtocolActive();
    setKittyProtocolActive(false);
    const terminal = new FakeTerminal();
    const running = Effect.runPromise(runTui({ terminal }));
    // Piano owns the mouse at startup, and the footer advertises the binding.
    await waitForOutput(terminal, () => terminal.output.includes(MOUSE_ON) && terminal.output.includes("Alt+C"));
    expect(terminal.output).not.toContain("COPY MODE");

    const beforeEnter = terminal.output.length;
    terminal.onInput?.(ALT_C);
    await waitForOutput(terminal, () => terminal.output.slice(beforeEnter).includes("COPY MODE"));
    const entered = terminal.output.slice(beforeEnter);
    expect(entered).toContain(MOUSE_OFF);
    expect(entered).not.toContain(MOUSE_ON);
    // Without the badge the released mouse reads as a hang.
    expect(entered).toContain("COPY MODE");

    const beforeExit = terminal.output.length;
    terminal.onInput?.(ALT_C);
    await waitForOutput(terminal, () => terminal.output.slice(beforeExit).includes("copy mode"));
    const exited = terminal.output.slice(beforeExit);
    expect(exited).toContain(MOUSE_ON);
    expect(exited).not.toContain(MOUSE_OFF);
    expect(exited).toContain("copy mode");
    expect(exited).not.toContain("COPY MODE");

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
    setKittyProtocolActive(kittyWasActive);
  });

  it("ignores mouse reports while copy mode holds the mouse", async () => {
    const kittyWasActive = isKittyProtocolActive();
    setKittyProtocolActive(false);
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
    await settle();
    terminal.onInput?.("hello");
    terminal.onInput?.("\r");
    await settle();

    terminal.onInput?.(ALT_C);
    await settle();
    // A report already in flight when the mode flipped must not scroll the
    // transcript out from under a selection, and must not reach the editor as
    // raw escape text either — hence consumed, not passed on.
    const inCopyMode = terminal.output.length;
    terminal.onInput?.(WHEEL_UP_OVER_CHAT);
    await settle();
    expect(terminal.output.length).toBe(inCopyMode);

    // The contrast: the very same report scrolls again once Piano has the mouse
    // back, so the guard is scoped to copy mode rather than disabling the wheel.
    terminal.onInput?.(ALT_C);
    await settle();
    const backInNormalMode = terminal.output.length;
    terminal.onInput?.(WHEEL_UP_OVER_CHAT);
    await settle();
    expect(terminal.output.length).toBeGreaterThan(backInNormalMode);

    terminal.onInput?.("/exit");
    terminal.onInput?.("\r");
    await expect(running).resolves.toEqual({ type: "closed" });
    setKittyProtocolActive(kittyWasActive);
  });
});
