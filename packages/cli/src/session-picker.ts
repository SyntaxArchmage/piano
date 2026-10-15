// `/resume` session picker: choose a previous piano run to continue.
//
// Two shapes differ from the workspace/workflow pickers and drive the design:
//
//  1. The run list is unbounded and grows with every run, so it is enumerated in
//     full (newest first — a run id sorts chronologically) but only the rows
//     inside the viewport are rendered, and only those rows have their
//     `trajectory.json` read. Metadata loading is therefore proportional to what
//     the user looks at, not to how many runs they have ever made.
//  2. Filtering needs metadata the list itself does not carry (name, first
//     prompt). Rows load lazily, so a query can only match what has been read;
//     the footer states how many rows are still unread rather than implying the
//     filter saw everything.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Key, matchesKey, type Component } from "@earendil-works/pi-tui";
import { RST, type PianoTheme } from "./theme.js";
import { formatRunId, oneLine, readRunTrajectory, summarizeRun, type RunSummary } from "./session-resume.js";

export interface SessionPickerDeps {
  readonly runsRoot: string;
  /** Run currently open in this TUI, marked so it is not resumed onto itself. */
  readonly currentRunId?: string;
  readonly onChoose: (runId: string) => void;
  readonly onCancel: () => void;
  readonly onRender?: () => void;
  readonly theme?: PianoTheme;
}

/** Visible rows. Kept small: each row costs one trajectory read on first sight. */
const MAX_VISIBLE_ITEMS = 8;

function fuzzyScore(value: string, query: string): number | undefined {
  if (query === "") return 0;
  const candidate = value.toLowerCase();
  const needle = query.toLowerCase();
  let cursor = 0;
  let score = 0;
  for (const character of needle) {
    const index = candidate.indexOf(character, cursor);
    if (index < 0) return undefined;
    score += index === cursor ? 0 : index + 1;
    cursor = index + 1;
  }
  return score;
}

function isPrintableInput(value: string): boolean {
  return value.length > 0 && [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f;
  });
}

function wrapBorder(rows: string[], width: number, theme: PianoTheme | undefined): string[] {
  if (theme === undefined) return rows;
  const line = theme.accent + "─".repeat(width) + RST;
  return [line, ...rows, line];
}

/** Everything a query can match, joined so a single fuzzy pass covers all of it. */
function haystack(runId: string, summary: RunSummary | undefined): string {
  return [runId, summary?.name, summary?.workflow, summary?.prompt]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}

/** Selects a previous run to resume. */
export class SessionPicker implements Component {
  private query = "";
  private runIds: readonly string[] = [];
  private readonly summaries = new Map<string, RunSummary>();
  /** Rows whose read is in flight, so a re-render does not queue it twice. */
  private readonly loading = new Set<string>();
  private selectedIndex = 0;
  private scanning = true;
  private scanError: string | undefined;

  constructor(private readonly deps: SessionPickerDeps) {
    void this.scan();
  }

  /** Ids matching the query. Rows without metadata yet match on id alone, so
   * they stay reachable — scrolling to them loads their metadata, which may then
   * drop them from a narrower query. */
  private get filtered(): readonly string[] {
    if (this.query === "") return this.runIds;
    return this.runIds
      .map((runId) => ({ runId, score: fuzzyScore(haystack(runId, this.summaries.get(runId)), this.query) }))
      .filter((entry): entry is { runId: string; score: number } => entry.score !== undefined)
      .map((entry) => entry.runId);
  }

  /** Count of listed rows never read, which bounds how stale a filter can be. */
  private get unread(): number {
    let count = 0;
    for (const runId of this.runIds) if (!this.summaries.has(runId)) count += 1;
    return count;
  }

  render(width: number): string[] {
    const th = this.deps.theme;
    const dim = th ? th.dim : "";
    const accent = th ? th.accent : "";
    const rows = [
      ` Resume a session: ${this.deps.runsRoot}`.slice(0, width),
      `> ${this.query}`.slice(0, width),
    ];

    if (this.scanning) {
      return wrapBorder([...rows, "  Listing runs…".slice(0, width)], width, th);
    }
    if (this.scanError !== undefined) {
      rows.push(`  ${this.scanError}`.slice(0, width), "", " Esc: cancel".slice(0, width));
      return wrapBorder(rows, width, th);
    }

    const list = this.filtered;
    if (list.length === 0) {
      rows.push(
        `  ${this.runIds.length === 0 ? "no runs found" : "no run matches"}`.slice(0, width),
        "",
        " Esc: cancel".slice(0, width),
      );
      return wrapBorder(rows, width, th);
    }

    const visibleCount = Math.min(MAX_VISIBLE_ITEMS, list.length);
    const start = Math.min(
      Math.max(0, this.selectedIndex - visibleCount + 1),
      Math.max(0, list.length - visibleCount),
    );
    const end = Math.min(list.length, start + visibleCount);
    // Read metadata for exactly the window being drawn. render() stays
    // synchronous; each load re-renders when it lands.
    this.load(list.slice(start, end));

    if (start > 0) rows.push("  ↑ more".slice(0, width));
    for (let index = start; index < end; index += 1) {
      const runId = list[index];
      if (runId === undefined) continue;
      const summary = this.summaries.get(runId);
      const cursor = index === this.selectedIndex ? "❯ " : "  ";
      const current = runId === this.deps.currentRunId ? " (current)" : "";
      const plain = `${cursor}${formatRunId(runId)}${current}`;
      const label = summary?.name ?? summary?.prompt;
      const trailer = [
        summary?.workflow,
        label === undefined ? undefined : oneLine(label, 60),
      ].filter((part): part is string => part !== undefined && part !== "").join(" · ");
      const head = index === this.selectedIndex ? `${accent}${plain}${RST}` : plain;
      rows.push(trailer === ""
        ? head
        : `${head}  ${dim}${oneLine(trailer, Math.max(0, width - plain.length - 2))}${RST}`);
    }
    if (end < list.length) rows.push("  ↓ more".slice(0, width));

    const unread = this.unread;
    rows.push(
      "",
      ` ${list.length}/${this.runIds.length} runs${
        unread === 0 ? "" : ` · ${unread} not yet read, so the filter may miss them`
      } · Enter: resume · Esc: cancel`.slice(0, width),
    );
    return wrapBorder(rows, width, th);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.deps.onCancel();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.deps.onRender?.();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(Math.max(0, this.filtered.length - 1), this.selectedIndex + 1);
      this.deps.onRender?.();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const runId = this.filtered[this.selectedIndex];
      if (runId !== undefined) this.deps.onChoose(runId);
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      this.query = this.query.slice(0, -1);
      this.selectedIndex = 0;
      this.deps.onRender?.();
      return;
    }
    if (isPrintableInput(data)) {
      this.query += data;
      this.selectedIndex = 0;
      this.deps.onRender?.();
    }
  }

  invalidate(): void {}

  /** Enumerate run directories newest first. One readdir, no per-entry stat:
   * run ids sort chronologically, so the name is the ordering key. */
  private async scan(): Promise<void> {
    try {
      const entries = await readdir(this.deps.runsRoot, { withFileTypes: true });
      this.runIds = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
    } catch (cause) {
      this.runIds = [];
      const message = cause instanceof Error ? cause.message : String(cause);
      // A missing runs root means "no runs yet", which the empty list already
      // says. Anything else is a real read failure worth showing.
      if (!/ENOENT/.test(message)) this.scanError = message;
    }
    this.scanning = false;
    this.deps.onRender?.();
  }

  /** Read the metadata for the drawn window, applying the resume layer's
   * verdict on each trajectory: an absent document drops the run, anything
   * else keeps it — unreadable or malformed as an id-only row. */
  private load(runIds: readonly string[]): void {
    for (const runId of runIds) {
      if (this.summaries.has(runId) || this.loading.has(runId)) continue;
      this.loading.add(runId);
      void readRunTrajectory(join(this.deps.runsRoot, runId)).then((result) => {
        this.loading.delete(runId);
        if (result.kind === "absent") {
          this.runIds = this.runIds.filter((listed) => listed !== runId);
        } else {
          this.summaries.set(runId, summarizeRun(runId, result.kind === "present" ? result.document : undefined));
        }
        this.deps.onRender?.();
      });
    }
  }
}
