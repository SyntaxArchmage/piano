import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Terminal as HeadlessTerminalInstance } from "@xterm/headless";
import { spawn, type IPty } from "node-pty";

const { Terminal: HeadlessTerminal } = createRequire(import.meta.url)("@xterm/headless") as {
  Terminal: typeof HeadlessTerminalInstance;
};

const root = fileURLToPath(new URL("../..", import.meta.url));
const entrypoint = join(root, "packages/cli/bin/piano.mjs");
export interface TuiSession {
  readonly home: string;
  key(name: string): void;
  capture(): string;
  resize(columns: number, rows: number): void;
  stillRunning(): boolean;
  close(): void;
}

function screenText(screen: HeadlessTerminalInstance): string {
  const lines: string[] = [];
  for (let row = 0; row < screen.rows; row += 1) {
    lines.push(screen.buffer.active.getLine(row)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}

export function startTui(
  home = mkdtempSync(join(tmpdir(), "piano-tui-")),
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = {},
  cwd = root,
): TuiSession {
  mkdirSync(join(home, ".piano"), { recursive: true });
  const columns = 120;
  const rows = 40;
  const screen = new HeadlessTerminal({
    cols: columns,
    rows,
    scrollback: 0,
    convertEol: true,
    allowProposedApi: true,
  });
  const child: IPty = spawn(process.execPath, [entrypoint, ...args], {
    name: "xterm-256color",
    cols: columns,
    rows,
    cwd,
    env: {
      ...process.env,
      ...env,
      HOME: env.HOME ?? home,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    } as Record<string, string>,
  });
  let running = true;
  let disposed = false;
  let currentScreen = screenText(screen);
  child.onData((data) => {
    if (disposed) return;
    // xterm headless parses writes asynchronously; publish the snapshot only
    // after the chunk has been applied so capture() never exposes a partial
    // virtual screen.
    screen.write(data, () => {
      if (!disposed) currentScreen = screenText(screen);
    });
  });
  child.onExit(() => { running = false; });

  return {
    home,
    key: (key) => child.write(key === "Escape" ? "\x1b" : key === "Enter" ? "\r" : key === "C-c" ? "\x03" : key),
    capture: () => currentScreen,
    resize: (nextColumns, nextRows) => {
      screen.resize(nextColumns, nextRows);
      child.resize(nextColumns, nextRows);
    },
    stillRunning: () => running,
    close: () => {
      disposed = true;
      if (running) child.kill();
      screen.dispose();
      rmSync(home, { recursive: true, force: true });
    },
  };
}
