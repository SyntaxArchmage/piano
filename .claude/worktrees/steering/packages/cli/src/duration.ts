/** Compact duration for TUI counters: `812ms`, `12.4s`, `1m02s`, `1h05m`.
 * Deliberately short: the footer draws it next to a stage name inside a fixed
 * width column, so every extra character costs label space. */
export function formatCompactDuration(ms: number): string {
  const value = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (value < 1000) return `${Math.round(value)}ms`;
  // Round to whole seconds first so a value just under a minute reads `60s`
  // rollovers as `1m00s` instead of `59m60s`-style artefacts.
  const totalSeconds = Math.round(value / 1000);
  if (totalSeconds < 60) return `${(value / 1000).toFixed(1)}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m${String(totalSeconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(totalMinutes / 60)}h${String(totalMinutes % 60).padStart(2, "0")}m`;
}
