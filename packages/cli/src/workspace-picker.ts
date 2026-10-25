import { dirname, join, resolve } from "node:path";
import { Effect } from "effect";
import { io } from "@piano/base";
import { Key, matchesKey, type Component } from "@earendil-works/pi-tui";
import { fuzzyScore, isPrintableInput, wrapBorder } from "./picker-support.js";
import { type PianoTheme } from "./theme.js";

interface WorkspacePickerDeps {
  readonly cwd: string;
  readonly onChoose: (cwd: string) => void;
  readonly onCancel: () => void;
  readonly onRender?: () => void;
  readonly theme?: PianoTheme;
}

interface DirectoryItem {
  readonly name: string;
  readonly path: string;
}

export class WorkspacePicker implements Component {
  private static readonly maxVisibleItems = 8;
  private currentDir: string;
  private query = "";
  private items: DirectoryItem[] = [];
  private selectedIndex = 0;
  private loading = true;
  private requestId = 0;

  constructor(private readonly deps: WorkspacePickerDeps) {
    this.currentDir = resolve(deps.cwd);
    Effect.runFork(this.refresh());
  }

  render(width: number): string[] {
    const title = ` Workspace: ${this.currentDir}`;
    const search = `> ${this.query}`;
    const rows = [title.slice(0, width), search.slice(0, width)];
    if (this.loading) return wrapBorder([...rows, "  Loading…".slice(0, width)], width, this.deps.theme);
    if (this.items.length === 0) return wrapBorder([...rows, "  No matching directories".slice(0, width)], width, this.deps.theme);
    const visibleCount = Math.min(WorkspacePicker.maxVisibleItems, this.items.length);
    const start = Math.min(
      Math.max(0, this.selectedIndex - visibleCount + 1),
      Math.max(0, this.items.length - visibleCount),
    );
    const end = Math.min(this.items.length, start + visibleCount);
    if (start > 0) rows.push("  ↑ more".slice(0, width));
    for (let index = start; index < end; index += 1) {
      const item = this.items[index];
      if (item === undefined) continue;
      const prefix = index === this.selectedIndex ? "❯ " : "  ";
      rows.push(`${prefix}${item.name}/`.slice(0, width));
    }
    if (end < this.items.length) rows.push("  ↓ more".slice(0, width));
    rows.push("", " Enter: open · Alt+Enter: choose · Esc: cancel".slice(0, width));
    return wrapBorder(rows, width, this.deps.theme);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.deps.onCancel();
      return;
    }
    if (matchesKey(data, Key.alt("enter"))) {
      const selected = this.items[this.selectedIndex];
      this.deps.onChoose(selected?.path ?? this.currentDir);
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.deps.onRender?.();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(Math.max(0, this.items.length - 1), this.selectedIndex + 1);
      this.deps.onRender?.();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const selected = this.items[this.selectedIndex];
      if (selected !== undefined) {
        this.currentDir = selected.path;
        this.query = "";
        this.selectedIndex = 0;
        Effect.runFork(this.refresh());
      }
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      this.query = this.query.slice(0, -1);
      Effect.runFork(this.refresh());
      return;
    }
    if (isPrintableInput(data)) {
      this.query += data;
      this.selectedIndex = 0;
      Effect.runFork(this.refresh());
    }
  }

  invalidate(): void {}

  private refresh(): Effect.Effect<void> {
    const requestId = ++this.requestId;
    this.loading = true;
    this.deps.onRender?.();
    return io.readdir(this.currentDir).pipe(
      Effect.flatMap((entries) => Effect.try({
        try: () => {
          if (requestId !== this.requestId) return;
          const candidates: DirectoryItem[] = [
            ...(dirname(this.currentDir) === this.currentDir ? [] : [{ name: "..", path: dirname(this.currentDir) }]),
            ...entries
              .filter((entry) => entry.isDirectory())
              .map((entry) => ({ name: entry.name, path: join(this.currentDir, entry.name) })),
          ];
          this.items = candidates
            .map((item) => ({ item, score: fuzzyScore(item.name, this.query) }))
            .filter((value): value is { item: DirectoryItem; score: number } => value.score !== undefined)
            .sort((left, right) => left.score - right.score || left.item.name.localeCompare(right.item.name))
            .map(({ item }) => item);
          this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.items.length - 1));
          this.loading = false;
          this.deps.onRender?.();
        },
        catch: (cause) => cause,
      })),
      Effect.catchAll(() => Effect.sync(() => {
        if (requestId !== this.requestId) return;
        this.items = [];
        this.loading = false;
        this.deps.onRender?.();
      })),
    );
  }
}
