// A pi-tui terminal bound to the process's controlling terminal (/dev/tty)
// instead of stdin/stdout. Headless runs may own stdout for a machine payload
// (the --json NDJSON stream); an interactive sign-off prompt must not corrupt
// it, so it renders through this separate channel.

import * as fs from "node:fs";
import * as tty from "node:tty";
import { StdinBuffer, type Terminal } from "@earendil-works/pi-tui";

/** Opens /dev/tty. Returns undefined when the process has no controlling
 * terminal (piped stdin, CI, or a detached service). */
export function openTtyTerminal(): TtyTerminal | undefined {
  let inputFd: number;
  let outputFd: number;
  try {
    inputFd = fs.openSync("/dev/tty", "r");
  } catch {
    return undefined;
  }
  try {
    outputFd = fs.openSync("/dev/tty", "w");
  } catch {
    fs.closeSync(inputFd);
    return undefined;
  }
  return new TtyTerminal(inputFd, outputFd);
}

/** Minimal Terminal over dedicated /dev/tty streams. Kitty keyboard
 * negotiation is skipped (the protocol stays inactive), so components receive
 * legacy escape bytes — which `matchesKey` and the AskQuestion component
 * already handle. */
export class TtyTerminal implements Terminal {
  private readonly input: tty.ReadStream;
  private readonly output: tty.WriteStream;
  private stdinBuffer: StdinBuffer | undefined;
  private stdinDataHandler: ((data: string) => void) | undefined;
  private resizeHandler: (() => void) | undefined;
  private wasRaw = false;
  private stopped = false;

  constructor(inputFd: number, outputFd: number) {
    this.input = new tty.ReadStream(inputFd);
    this.output = new tty.WriteStream(outputFd);
  }

  get kittyProtocolActive(): boolean {
    return false;
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    // Mirror ProcessTerminal: batched reads are split into individual
    // sequences so component key matching sees one event at a time.
    const buffer = new StdinBuffer({ timeout: 10 });
    buffer.on("data", (sequence: string) => onInput(sequence));
    buffer.on("paste", (content: string) => onInput(`\x1b[200~${content}\x1b[201~`));
    this.stdinBuffer = buffer;
    this.wasRaw = this.input.isRaw;
    this.input.setRawMode(true);
    this.input.setEncoding("utf8");
    this.input.resume();
    this.stdinDataHandler = (data: string) => buffer.process(data);
    this.input.on("data", this.stdinDataHandler);
    this.resizeHandler = onResize;
    this.output.on("resize", onResize);
    this.output.write("\x1b[?2004h");
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.output.write("\x1b[?2004l");
    this.stdinBuffer?.destroy();
    this.stdinBuffer = undefined;
    if (this.stdinDataHandler !== undefined) this.input.removeListener("data", this.stdinDataHandler);
    if (this.resizeHandler !== undefined) this.output.removeListener("resize", this.resizeHandler);
    this.input.pause();
    try {
      this.input.setRawMode(this.wasRaw);
    } catch {
      // The fd may already be gone; restoring raw mode is best-effort.
    }
    this.input.destroy();
    this.output.destroy();
  }

  async drainInput(maxMs = 1000, idleMs = 50): Promise<void> {
    const endTime = Date.now() + maxMs;
    let lastDataTime = Date.now();
    const onData = (): void => { lastDataTime = Date.now(); };
    this.input.on("data", onData);
    try {
      while (Date.now() < endTime && Date.now() - lastDataTime < idleMs * 4) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(idleMs, endTime - Date.now())));
        if (Date.now() >= endTime) break;
      }
    } finally {
      this.input.removeListener("data", onData);
    }
  }

  write(data: string): void {
    this.output.write(data);
  }

  get columns(): number {
    return this.output.columns || Number(process.env.COLUMNS) || 80;
  }

  get rows(): number {
    return this.output.rows || Number(process.env.LINES) || 24;
  }

  moveBy(lines: number): void {
    if (lines > 0) this.output.write(`\x1b[${lines}B`);
    else if (lines < 0) this.output.write(`\x1b[${-lines}A`);
  }

  hideCursor(): void {
    this.output.write("\x1b[?25l");
  }

  showCursor(): void {
    this.output.write("\x1b[?25h");
  }

  clearLine(): void {
    this.output.write("\x1b[K");
  }

  clearFromCursor(): void {
    this.output.write("\x1b[J");
  }

  clearScreen(): void {
    this.output.write("\x1b[2J\x1b[H");
  }

  setTitle(title: string): void {
    this.output.write(`\x1b]0;${title}\x07`);
  }

  setProgress(active: boolean): void {
    // OSC 9;4 is a Windows terminal-integration hint; the tty sign-off dialog
    // is short-lived, so there is nothing to indicate.
    void active;
  }
}
