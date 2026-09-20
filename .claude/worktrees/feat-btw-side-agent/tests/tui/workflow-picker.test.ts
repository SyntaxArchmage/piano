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
    picker.handleInput("\r");
    expect(chosen).toBe(workflowPath);
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
    // "coding" should NOT appear as a workspace search result above the builtin header
    const lines = output.split("\n");
    const headerIndex = lines.findIndex((l) => l.includes("Built-in workflows"));
    // Skip the title row (0) and search-echo row (1 — contains the typed query)
    const resultsAboveHeader = lines.slice(2, headerIndex).join("\n");
    expect(resultsAboveHeader).not.toContain("coding");
  });
});
