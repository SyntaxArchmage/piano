// Persistent prompt history for Piano — one entry per line under the dot-piano
// root (decision 0017).
//
// The pi-tui Editor carries its own in-memory history for ↑/↓ recall, but it
// dies with the session. This module is a seed/sink around it: the TUI seeds
// the Editor's built-in history from this file at startup (oldest → newest, so
// the SDK's unshift leaves the most recent entry at history[0] for ↑ recall)
// and appends every submission back to it. The Editor's addToHistory stays the
// only in-memory mutator — this file is plain persistence, not a second store.
//
// Plain-text format: one entry per line, no extension. Everything here is
// synchronous — the file is tiny (~100 lines max) and sync keeps ordering
// trivial. All functions are best-effort: history IO must never break the TUI,
// so fs errors are swallowed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Matches the pi-tui Editor's internal history cap (dist/components/editor.js). */
export const PROMPT_HISTORY_MAX = 100;

export function promptHistoryPath(root: string): string {
  return join(root, "prompt-history");
}

/** Load persisted entries, oldest → newest (order as written in the file). */
export function loadPromptHistory(root: string): string[] {
  try {
    if (!existsSync(promptHistoryPath(root))) return [];
    return readFileSync(promptHistoryPath(root), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .slice(-PROMPT_HISTORY_MAX);
  } catch {
    // Missing file or unreadable path must yield [] — history is best-effort
    // and never breaks the TUI; an unreadable history is simply an empty one.
    return [];
  }
}

/** Append one entry, enforcing cap + consecutive-dedup; best-effort. */
export function appendPromptHistory(root: string, text: string): void {
  // Sanitize to a single line first: a submission containing newlines would
  // otherwise corrupt the one-entry-per-line format.
  const sanitized = text.replace(/[\r\n]+/g, " ").trim();
  if (!sanitized) return;

  try {
    const entries = loadPromptHistory(root);
    // Consecutive-dedup mirrors the Editor's addToHistory, so the file and the
    // in-memory history can't drift apart.
    if (entries[entries.length - 1] === sanitized) return;
    entries.push(sanitized);
    mkdirSync(root, { recursive: true });
    // Rewrite the whole file so the cap is enforced without a separate trim
    // pass — file is ≤ ~100 lines, so the cost is trivial.
    writeFileSync(
      promptHistoryPath(root),
      entries.slice(-PROMPT_HISTORY_MAX).join("\n") + "\n"
    );
  } catch {
    // Best-effort: history persistence must never break the submit path.
  }
}
