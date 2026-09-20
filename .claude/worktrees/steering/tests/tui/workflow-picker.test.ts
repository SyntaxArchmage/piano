import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { WorkflowPicker } from "../../packages/cli/src/workflow-picker.js";

const validWorkflow = `version: 3
workflow:
  name: selected
  nodes:
    - stage:
        name: respond
        worker: worker
        from: []
`;

async function waitForRender(renderCount: { value: number }): Promise<void> {
  const initial = renderCount.value;
  for (let attempt = 0; attempt < 20 && renderCount.value === initial; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("WorkflowPicker", () => {
  it("lists only schema-valid YAML files inside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-picker-"));
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "valid.yml"), validWorkflow);
    await writeFile(join(root, "nested", "valid.yaml"), validWorkflow);
    await writeFile(join(root, "invalid.yml"), "version: 2\nworkflow: {}\n");
    await writeFile(join(root, "notes.txt"), validWorkflow);
    const renders = { value: 0 };
    const picker = new WorkflowPicker({
      cwd: root,
      onChoose: () => {},
      onCancel: () => {},
      onRender: () => { renders.value += 1; },
    });
    await waitForRender(renders);
    const output = picker.render(100).join("\n");
    expect(output).toContain("valid.yml");
    expect(output).toContain("nested/valid.yaml");
    expect(output).not.toContain("invalid.yml");
    expect(output).not.toContain("notes.txt");
  });

  it("returns the selected workflow path", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-picker-"));
    const workflowPath = join(root, "workflow.yml");
    await writeFile(workflowPath, validWorkflow);
    const renders = { value: 0 };
    let chosen: string | undefined;
    const picker = new WorkflowPicker({
      cwd: root,
      onChoose: (path) => { chosen = path; },
      onCancel: () => {},
      onRender: () => { renders.value += 1; },
    });
    await waitForRender(renders);
    // The builtin group occupies the first slot, so the workspace match is one
    // row down until the group is expanded.
    picker.handleInput("\u001b[B");
    picker.handleInput("\r");
    expect(chosen).toBe(workflowPath);
  });

  // The builtin group leads the list in every state the picker can be in. It
  // used to be appended, which put it below every workspace match — the last
  // row a user could reach — so pin the ordering rather than one sample of it.
  it("keeps the builtin group as the first list item", async () => {
    const manyFiles = Array.from({ length: 12 }, (_, index) => `w${String(index).padStart(2, "0")}.yml`);
    const cases: {
      label: string;
      files: readonly string[];
      query?: string;
      expand: boolean;
      /** What the rows below the group must show: a row, a pattern, or nothing. */
      workspaceRows?: string | RegExp | "none";
    }[] = [
      { label: "empty workspace", files: [], expand: false, workspaceRows: "none" },
      { label: "empty workspace, expanded", files: [], expand: true, workspaceRows: "none" },
      { label: "one workspace workflow", files: ["local.yml"], expand: false, workspaceRows: "local.yml" },
      { label: "one workspace workflow, expanded", files: ["local.yml"], expand: true },
      { label: "more matches than the window fits", files: manyFiles, expand: false, workspaceRows: /w\d\d\.yml/ },
      {
        label: "a query matching a workspace workflow",
        files: ["coding-local.yml"], query: "coding", expand: false, workspaceRows: "coding-local.yml",
      },
      {
        label: "a query matching no workspace workflow",
        files: ["local.yml"], query: "zzz", expand: false, workspaceRows: "none",
      },
      {
        label: "a query with the group expanded",
        files: ["coding-local.yml"], query: "coding", expand: true,
      },
    ];

    for (const { label, files, query, expand, workspaceRows } of cases) {
      const root = await mkdtemp(join(tmpdir(), "piano-workflow-picker-top-"));
      for (const file of files) await writeFile(join(root, file), validWorkflow);
      const renders = { value: 0 };
      const picker = new WorkflowPicker({
        cwd: root,
        onChoose: () => {},
        onCancel: () => {},
        onRender: () => { renders.value += 1; },
      });
      await waitForRender(renders);
      if (query !== undefined) {
        picker.handleInput(query);
        await waitForRender(renders);
      }
      if (expand) {
        // Enter acts on the selected item, so the group only expands here if it
        // is the item the picker selected first.
        picker.handleInput("\r");
      }

      const rows = picker.render(100);
      // Row 0 is the title, row 1 the query echo, row 2 the first list item.
      expect(rows[2], label).toContain(`${expand ? "▾" : "▸"} Built-in workflows`);
      if (query !== undefined) expect(rows[1], label).toContain(`> ${query}`);
      const below = rows.slice(3).join("\n");
      if (expand) {
        expect(below, label).toMatch(/coding-|gpu-cuda-tuning|gpu-triton-tuning/);
      }
      if (workspaceRows === "none") {
        expect(below, label).not.toContain(".yml");
      } else if (workspaceRows !== undefined) {
        expect(below, label).toMatch(workspaceRows);
      }
    }
  });

  it("keeps workspace workflows selectable while the builtin group is expanded", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-picker-scroll-"));
    await writeFile(join(root, "local.yml"), validWorkflow);
    const renders = { value: 0 };
    let chosen: string | undefined;
    const picker = new WorkflowPicker({
      cwd: root,
      onChoose: (path) => { chosen = path; },
      onCancel: () => {},
      onRender: () => { renders.value += 1; },
    });
    await waitForRender(renders);

    // Expanding pushes the workspace matches below the builtin names, so they
    // leave the visible window; they must stay reachable by scrolling.
    picker.handleInput("\r");
    expect(picker.render(100).join("\n")).not.toContain("local.yml");

    for (let step = 0; step < 100 && !picker.render(100).join("\n").includes("local.yml"); step += 1) {
      picker.handleInput("\u001b[B");
    }
    expect(picker.render(100).join("\n")).toContain("local.yml");
    picker.handleInput("\r");
    expect(chosen).toBe(join(root, "local.yml"));
  });

  // Built-in workflows live in the repo's own recipes/workflows/ directory.
  // This test runs from the repo root so import.meta.url resolution finds them.
  it("shows a collapsed Built-in workflows entry that expands on Enter", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-picker-empty-"));
    const renders = { value: 0 };
    const picker = new WorkflowPicker({
      cwd: root,
      onChoose: () => {},
      onCancel: () => {},
      onRender: () => { renders.value += 1; },
    });
    await waitForRender(renders);

    // Builtin header should appear collapsed in the initial render
    const collapsed = picker.render(100).join("\n");
    expect(collapsed).toContain("▸ Built-in workflows");
    expect(collapsed).not.toContain("▾ Built-in workflows");

    // Navigate to the builtin header and expand it
    // The header is the first (and only) meaningful item since the workspace is empty
    picker.handleInput("\r");
    const expanded = picker.render(100).join("\n");
    expect(expanded).toContain("▾ Built-in workflows");
    // At least one recipe workflow name should appear after expansion
    expect(expanded).toMatch(/coding|gpu-cuda-tuning|gpu-triton-tuning/);
  });

  it("does not include builtin workflows in workspace fuzzy search results", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-workflow-picker-empty-"));
    // A workspace workflow that matches the query, so the assertion below has
    // a workspace result to inspect rather than an empty region.
    await writeFile(join(root, "coding-local.yml"), validWorkflow);
    const renders = { value: 0 };
    const picker = new WorkflowPicker({
      cwd: root,
      onChoose: () => {},
      onCancel: () => {},
      onRender: () => { renders.value += 1; },
    });
    await waitForRender(renders);
    // Type a query that matches builtin workflow names
    picker.handleInput("coding");
    await waitForRender(renders);
    const output = picker.render(100).join("\n");
    const lines = output.split("\n");
    const headerIndex = lines.findIndex((l) => l.includes("Built-in workflows"));
    // The group sits above the workspace matches, so the workspace results are
    // the rows below it; the builtin names stay inside the collapsed group.
    const resultsBelowHeader = lines.slice(headerIndex + 1).join("\n");
    expect(resultsBelowHeader).toContain("coding-local.yml");
    expect(resultsBelowHeader).not.toContain("coding-pi");
  });
});
