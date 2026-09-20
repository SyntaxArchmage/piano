// Deterministic TUI driver bits shared by every test that opens a real
// runTui — or the session loop that owns it — on a scripted terminal:
// a FakeTerminal that captures output, sleep/waitFor for scripted pacing, and
// plain() to strip ANSI so assertions read screen text instead of control
// codes. Extracted from tests/tui/{basic-workflow-coding,pause-exit-resume,
// prompt-queue}.test.ts so the new session-arc tests reuse one copy instead
// of a fourth local duplicate.

import type { Terminal } from "@earendil-works/pi-tui";

export class FakeTerminal implements Terminal {
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

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The budget is deliberately wide: under the full concurrent suite the event
// loop can starve for seconds, and these are pacing waits, not latency pins.
export async function waitFor(label: string, check: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor(${label}) timed out`);
    await sleep(10);
  }
}

/** Escape strips the ANSI so assertions read screen text, not control codes. */
/* eslint-disable no-control-regex -- test helper strips terminal escape codes */
export const plain = (terminal: FakeTerminal) =>
  terminal.output
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
/* eslint-enable no-control-regex */
