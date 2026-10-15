import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Fiber } from "effect";
import { describe, it } from "vitest";
import type { Terminal } from "@earendil-works/pi-tui";
import { runTui } from "../../packages/cli/src/tui.js";
import { DEFAULT_SPLIT_RATIO, rightColumns } from "../../packages/cli/src/split-drag.js";

const { Terminal: HeadlessTerminal } = createRequire(import.meta.url)("@xterm/headless") as {
  Terminal: typeof import("@xterm/headless").Terminal;
};

class ResizableTerminal implements Terminal {
  readonly screen = new HeadlessTerminal({ cols: 120, rows: 40, scrollback: 0, allowProposedApi: true });
  columns = 120;
  rows = 40;
  private onInput?: (data: string) => void;
  private onResize?: () => void;

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.onInput = onInput;
    this.onResize = onResize;
  }

  resize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.screen.resize(columns, rows);
    this.onResize?.();
  }

  input(data: string): void {
    this.onInput?.(data);
  }

  capture(): string {
    const lines: string[] = [];
    for (let row = 0; row < this.screen.rows; row += 1) {
      lines.push(this.screen.buffer.active.getLine(row)?.translateToString(true) ?? "");
    }
    return lines.join("\n");
  }

  stop(): void {
    this.screen.dispose();
  }

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

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for the resized TUI");
}

function trajectoryStart(screen: string): number {
  const row = screen.split("\n").find((line) => line.includes("▐ trajectory"));
  return row?.indexOf("▐ trajectory") ?? -1;
}

describe("TUI resize adaptation", () => {
  it("uses an injected terminal resize callback to rebuild the trajectory overlay", async () => {
    const historyRoot = await mkdtemp(join(tmpdir(), "piano-resize-tui-"));
    const terminal = new ResizableTerminal();
    const fiber = Effect.runFork(runTui({
      terminal,
      historyRoot,
      workflowGraph: { stages: [{ id: "respond", dependsOn: [] }] },
      statusPath: join(historyRoot, "status.json"),
    }));

    await waitFor(() => trajectoryStart(terminal.capture()) === 120 - rightColumns(DEFAULT_SPLIT_RATIO, 120));
    terminal.resize(100, 40);
    await waitFor(() => trajectoryStart(terminal.capture()) === 100 - rightColumns(DEFAULT_SPLIT_RATIO, 100));

    for (const character of "/exit") terminal.input(character);
    terminal.input("\r");
    await Effect.runPromise(Fiber.join(fiber));
  });
});
