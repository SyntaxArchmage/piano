import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { Effect } from "effect";
import { parseWorkflow } from "@piano/orchestrator";
import { Key, matchesKey, type Component } from "@earendil-works/pi-tui";
import { fuzzyScore, isPrintableInput, wrapBorder } from "./picker-support.js";
import { visibleWidth } from "./text.js";
import { RST, type PianoTheme } from "./theme.js";

export interface WorkflowPickerDeps {
  readonly cwd: string;
  readonly onChoose: (workflowPath: string, builtinName?: string) => void;
  readonly onCancel: () => void;
  readonly onRender?: () => void;
  readonly theme?: PianoTheme;
}

interface WorkflowItem {
  readonly kind: "workflow";
  readonly name: string;
  readonly path: string;
  readonly isBuiltin: boolean;
}

interface BuiltinGroupItem {
  readonly kind: "builtin-group";
}

type ListItem = WorkflowItem | BuiltinGroupItem;

async function findWorkflowFiles(root: string, excludePaths: Set<string>): Promise<WorkflowItem[]> {
  const candidates: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") return;
        await visit(path);
      } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        candidates.push(path);
      }
    }));
  };
  await visit(root);

  const valid: WorkflowItem[] = [];
  await Promise.all(candidates.map(async (path) => {
    if (excludePaths.has(resolve(path))) return;
    try {
      const source = await readFile(path, "utf8");
      await Effect.runPromise(parseWorkflow(source, path));
      valid.push({ kind: "workflow", name: relative(root, path) || entryName(path), path, isBuiltin: false });
    } catch {
      // Invalid YAML/workflow schema is intentionally not selectable.
    }
  }));
  return valid.sort((left, right) => left.name.localeCompare(right.name));
}

async function findBuiltinWorkflows(): Promise<WorkflowItem[]> {
  // Builtin recipes live at <repo-root>/recipes/workflows/ relative to this
  // source file at packages/cli/src/workflow-picker.ts.
  const here = dirname(fileURLToPath(import.meta.url));
  const recipesDir = resolve(here, "../../..", "recipes", "workflows");
  const candidates: string[] = [];
  try {
    const entries = await readdir(recipesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        candidates.push(join(recipesDir, entry.name));
      }
    }
  } catch {
    return [];
  }
  const valid: WorkflowItem[] = [];
  await Promise.all(candidates.map(async (path) => {
    try {
      const source = await readFile(path, "utf8");
      await Effect.runPromise(parseWorkflow(source, path));
      valid.push({ kind: "workflow", name: entryName(path).replace(/\.ya?ml$/i, ""), path, isBuiltin: true });
    } catch {
      // skip invalid
    }
  }));
  return valid.sort((left, right) => left.name.localeCompare(right.name));
}

function entryName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** Selects a schema-valid workflow file from the active workspace. */
export class WorkflowPicker implements Component {
  private static readonly maxVisibleItems = 8;
  private readonly root: string;
  private query = "";
  private workspaceItems: WorkflowItem[] = [];
  private builtinItems: WorkflowItem[] = [];
  private builtinExpanded = false;
  private selectedIndex = 0;
  private loading = true;
  private requestId = 0;

  constructor(private readonly deps: WorkflowPickerDeps) {
    this.root = resolve(deps.cwd);
    void this.refresh();
  }

  /** Full visible list: builtin header + (if expanded) builtin items, then the workspace matches. */
  private get listItems(): ListItem[] {
    const query = this.query;
    const workspace: ListItem[] = this.workspaceItems
      .map((item) => ({ item, score: fuzzyScore(item.name, query) }))
      .filter((v): v is { item: WorkflowItem; score: number } => v.score !== undefined)
      .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
      .map(({ item }) => item);
    const header: BuiltinGroupItem = { kind: "builtin-group" };
    if (this.builtinExpanded) {
      return [header, ...this.builtinItems, ...workspace];
    }
    return [header, ...workspace];
  }

  render(width: number): string[] {
    const th = this.deps.theme;
    const accent = th ? th.accent : "";

    const rows = [
      ` Workflows: ${this.root}`.slice(0, width),
      `> ${this.query}`.slice(0, width),
    ];

    if (this.loading) {
      return wrapBorder([...rows, "  Scanning and validating…".slice(0, width)], width, th);
    }

    const list = this.listItems;
    const visibleCount = Math.min(WorkflowPicker.maxVisibleItems, list.length);
    const start = Math.min(
      Math.max(0, this.selectedIndex - visibleCount + 1),
      Math.max(0, list.length - visibleCount),
    );
    const end = Math.min(list.length, start + visibleCount);

    if (start > 0) rows.push("  ↑ more".slice(0, width));
    for (let index = start; index < end; index += 1) {
      const item = list[index];
      if (item === undefined) continue;
      const selected = index === this.selectedIndex;
      const cursor = selected ? "❯ " : "  ";
      if (item.kind === "builtin-group") {
        const arrow = this.builtinExpanded ? "▾" : "▸";
        const label = `${cursor}${accent}${arrow} Built-in workflows${RST}`;
        rows.push(label.slice(0, width + label.length - visibleWidth(label)));
      } else if (item.isBuiltin) {
        const label = `${cursor}  ${accent}${item.name}${RST}`;
        rows.push(label.slice(0, width + label.length - visibleWidth(label)));
      } else {
        rows.push(`${cursor}${item.name}`.slice(0, width));
      }
    }
    if (end < list.length) rows.push("  ↓ more".slice(0, width));
    rows.push("", " Enter: choose · Esc: cancel".slice(0, width));
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
      this.selectedIndex = Math.min(Math.max(0, this.listItems.length - 1), this.selectedIndex + 1);
      this.deps.onRender?.();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const item = this.listItems[this.selectedIndex];
      if (item === undefined) return;
      if (item.kind === "builtin-group") {
        this.builtinExpanded = !this.builtinExpanded;
        // Keep selection on the header after toggling
        const newList = this.listItems;
        this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, newList.length - 1));
        this.deps.onRender?.();
      } else {
        // Builtin picks report their template name so the caller can record
        // "builtin:<name>" instead of a package-absolute path.
        this.deps.onChoose(item.path, item.isBuiltin ? item.name : undefined);
      }
      return;
    }
    if (matchesKey(data, Key.backspace)) {
      this.query = this.query.slice(0, -1);
      this.selectedIndex = 0;
      void this.refresh();
      return;
    }
    if (isPrintableInput(data)) {
      this.query += data;
      this.selectedIndex = 0;
      void this.refresh();
    }
  }

  invalidate(): void {}

  private async refresh(): Promise<void> {
    const requestId = ++this.requestId;
    this.loading = true;
    this.deps.onRender?.();
    const [builtins] = await Promise.all([findBuiltinWorkflows()]);
    const builtinPaths = new Set(builtins.map((b) => resolve(b.path)));
    const workspace = await findWorkflowFiles(this.root, builtinPaths);
    if (requestId !== this.requestId) return;
    this.workspaceItems = workspace;
    this.builtinItems = builtins;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.listItems.length - 1));
    this.loading = false;
    this.deps.onRender?.();
  }
}

