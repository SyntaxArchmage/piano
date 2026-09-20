import { mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { WorkspacePicker } from "../../packages/cli/src/workspace-picker.js";

async function waitForRender(renderCount: { value: number }): Promise<void> {
  const initial = renderCount.value;
  for (let attempt = 0; attempt < 20 && renderCount.value === initial; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("WorkspacePicker", () => {
  it("navigates to the parent with .. and lists its directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workspace-picker-"));
    const child = join(root, "child");
    await mkdir(child);
    await mkdir(join(root, "sibling"));
    const renders = { value: 0 };
    const picker = new WorkspacePicker({
      cwd: child,
      onChoose: () => {},
      onCancel: () => {},
      onRender: () => { renders.value += 1; },
    });
    await waitForRender(renders);
    expect(picker.render(100).join("\n")).toContain("../");
    picker.handleInput("\r");
    await waitForRender(renders);
    const output = picker.render(100).join("\n");
    expect(output).toContain("sibling/");
    expect(output).toContain("child/");
  });

  // Alt+Enter, not Ctrl+Enter: terminals without the Kitty keyboard protocol
  // send a bare "\r" for Ctrl+Enter, indistinguishable from plain Enter, so the
  // choose action was unreachable. Alt+Enter arrives as ESC + CR on both.
  it("chooses the highlighted directory with Alt+Enter", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workspace-picker-"));
    await mkdir(join(root, "child"));
    let chosen: string | undefined;
    const renders = { value: 0 };
    const picker = new WorkspacePicker({
      cwd: root,
      onChoose: (cwd) => { chosen = cwd; },
      onCancel: () => {},
      onRender: () => { renders.value += 1; },
    });
    await waitForRender(renders);
    picker.handleInput("\x1b[B"); // past ".." onto "child"
    picker.handleInput("\x1b\r");
    expect(chosen).toBe(join(root, "child"));
  });

  // Enter navigates into a directory, so the cursor sits on a child of the
  // directory already entered. Choose must return that child, not currentDir.
  it("chooses the highlighted child rather than the directory already entered", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workspace-picker-"));
    const child = join(root, "child");
    await mkdir(child);
    await mkdir(join(child, "grandchild"));
    let chosen: string | undefined;
    const renders = { value: 0 };
    const picker = new WorkspacePicker({
      cwd: root,
      onChoose: (cwd) => { chosen = cwd; },
      onCancel: () => {},
      onRender: () => { renders.value += 1; },
    });
    await waitForRender(renders);
    picker.handleInput("\x1b[B"); // past ".." onto "child"
    picker.handleInput("\r"); // enter "child"
    await waitForRender(renders);
    picker.handleInput("\x1b[B"); // past ".." onto "grandchild"
    picker.handleInput("\x1b\r");
    expect(chosen).toBe(join(child, "grandchild"));
  });

  it("does not add unmatched control keys to the search query", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workspace-picker-"));
    const renders = { value: 0 };
    const picker = new WorkspacePicker({
      cwd: root,
      onChoose: () => {},
      onCancel: () => {},
      onRender: () => { renders.value += 1; },
    });
    await waitForRender(renders);
    picker.handleInput("\x0f"); // Ctrl+O, a global TUI shortcut.
    picker.handleInput("\t");
    expect(picker.render(100)[1]).toBe("> ");
  });

  it("fuzzy-matches directory names without returning files", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workspace-picker-"));
    await mkdir(join(root, "AlphaRoom"));
    await mkdir(join(root, "beta"));
    const renders = { value: 0 };
    const picker = new WorkspacePicker({
      cwd: root,
      onChoose: () => {},
      onCancel: () => {},
      onRender: () => { renders.value += 1; },
    });
    await waitForRender(renders);
    picker.handleInput("ar");
    await waitForRender(renders);
    const output = picker.render(100).join("\n");
    expect(output).toContain("AlphaRoom/");
    expect(output).not.toContain("beta/");
  });

  it("scrolls the selected directory into view", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workspace-picker-"));
    for (const name of ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india"]) {
      await mkdir(join(root, name));
    }
    const renders = { value: 0 };
    const picker = new WorkspacePicker({
      cwd: root,
      onChoose: () => {},
      onCancel: () => {},
      onRender: () => { renders.value += 1; },
    });
    await waitForRender(renders);

    for (let index = 0; index < 9; index += 1) picker.handleInput("\x1b[B");
    const output = picker.render(100).join("\n");
    expect(output).toContain("❯ india/");
    expect(output).toContain("↑ more");
    expect(output).not.toContain("  alpha/");
  });

  it("keeps the filesystem root from offering a parent entry", async () => {
    const renders = { value: 0 };
    const picker = new WorkspacePicker({
      cwd: "/",
      onChoose: () => {},
      onCancel: () => {},
      onRender: () => { renders.value += 1; },
    });
    await waitForRender(renders);
    expect(picker.render(100).join("\n")).not.toContain("../");
  });

  it("renders an empty result instead of throwing for an unreadable path", async () => {
    const renders = { value: 0 };
    const picker = new WorkspacePicker({
      cwd: join(tmpdir(), "piano-workspace-picker-does-not-exist"),
      onChoose: () => {},
      onCancel: () => {},
      onRender: () => { renders.value += 1; },
    });
    await waitForRender(renders);
    expect(picker.render(100).join("\n")).toContain("No matching directories");
  });
});
