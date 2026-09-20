// The stalled-exit guard: when `/exit` closes the TUI while the interrupted
// run's finalizers are still wedged, an orphaned handle (a silent child
// holding its stdio pipe) keeps the Node process alive with the terminal
// already handed back — the shell never returns and Ctrl+C looks like the only
// way out. The guard trades that indefinite hang for a bounded wait and a
// clean exit with the program's own code. The guard is armed only on the TUI's
// stalled verdict (tui.ts / session-run.ts), so a normal exit is never
// delayed by it.
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { armStalledExitGuard } from "../../packages/cli/src/stalled-exit.js";

const stalledExitModule = fileURLToPath(new URL(
  "../../packages/cli/src/stalled-exit.js",
  import.meta.url,
)).replace(/\.js$/, ".ts");

function runGuarded(entry: string, env: Record<string, string>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["--import", "tsx", entry], {
      env: { ...process.env, PIANO_STALLED_EXIT_MODULE: stalledExitModule, ...env },
    }, (error) => {
      if (error !== null && !("code" in error)) {
        reject(error);
        return;
      }
      resolve(error === null ? 0 : (error as { code: number }).code);
    });
  });
}

describe("armStalledExitGuard", () => {
  it("calls the injected exit with the program's code once the grace expires", async () => {
    const codes: number[] = [];
    process.exitCode = 2;
    try {
      armStalledExitGuard(20, (code) => codes.push(code));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(codes).toEqual([2]);
    } finally {
      process.exitCode = 0;
    }
  });

  // The behavior the user reported cannot be unit-tested in-process (a real
  // exit would kill the test worker), so spawn a program with the same shape:
  // the work completed, one silent handle remains, and the guard is armed.
  it("ends a process an orphaned handle would keep alive forever", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-stalled-exit-"));
    try {
      const entry = join(root, "program.mjs");
      await writeFile(entry, [
        "const { armStalledExitGuard } = await import(process.env.PIANO_STALLED_EXIT_MODULE);",
        "armStalledExitGuard(Number(process.env.GRACE_MS));",
        "const net = await import(\"node:net\");",
        "net.createServer().listen(0, \"127.0.0.1\", () => console.log(\"listening\"));",
        "// Never closed: without the guard this process lives forever.",
      ].join("\n"));
      const started = performance.now();
      const code = await runGuarded(entry, { GRACE_MS: "300" });
      expect(code).toBe(0);
      // The guard fired at its 300ms deadline, not on a kill or a hang.
      expect(performance.now() - started).toBeLessThan(10_000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
