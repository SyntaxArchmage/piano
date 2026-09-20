/** How long the event loop gets to drain on its own once the program has
 * finished, before a stalled cleanup is cut short (see
 * `armStalledExitGuard`). Comfortably longer than the TUI's own drain budget,
 * so finalizers that are merely slow — evidence writes, workspace cleanup —
 * finish instead of being truncated. */
const STALLED_EXIT_GRACE_MS = 5000;

/** One `/exit` must mean one shell prompt back. When the TUI closes while an
 * interrupted run's finalizers are still wedged (a stuck model call, an SDK
 * cleanup past the drain budget, an orphaned harness child holding its stdio
 * pipes), Node never drains the event loop and the shell never gets its
 * prompt — Ctrl+C used to be the only way out. Callers arm this guard only on
 * that verdict: a ref'd timer would otherwise hold the loop open for every
 * clean exit too (`beforeExit` never fires while one is pending). */
export function armStalledExitGuard(
  graceMs: number = STALLED_EXIT_GRACE_MS,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  setTimeout(() => exit(Number(process.exitCode) || 0), graceMs);
}
