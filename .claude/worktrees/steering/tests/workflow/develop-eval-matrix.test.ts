import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { compileWorkflow, parseWorkflow } from "../../packages/orchestrator/src/index.js";

const expectedTools = {
  pi: ["read", "bash", "edit", "write", "find", "grep", "ls", "web_fetch"],
  claude: ["Read", "Bash", "Edit", "Write", "Glob", "Grep"],
  dsh: ["read", "bash", "edit", "write"],
} as const;

describe("develop eval workflow matrix", () => {
  it("compiles every generated workflow as one coding stage", async () => {
    const workflowDir = join(process.cwd(), "recipes", "eval-workflows");
    const files = (await readdir(workflowDir)).filter((file) => file.startsWith("develop-") && file.endsWith(".yml"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const name = file.slice(0, -".yml".length);
      const path = join(workflowDir, file);
      const parsed = await Effect.runPromiseExit(parseWorkflow(await readFile(path, "utf8"), path));
      expect(Exit.isSuccess(parsed)).toBe(true);
      if (!Exit.isSuccess(parsed)) return;
      const compiled = await Effect.runPromiseExit(compileWorkflow(parsed.value, path));
      expect(Exit.isSuccess(compiled)).toBe(true);
      if (!Exit.isSuccess(compiled)) return;

      expect(compiled.value.name).toBe(name);
      expect(compiled.value.regions).toEqual([]);
      expect(compiled.value.stages).toHaveLength(1);
      const stage = compiled.value.stages[0]?.stage;
      expect(stage).toMatchObject({
        name: "coding",
        worker: "basic",
        from: [],
      });
      if (stage === undefined) continue;
      expect(["pi", "claude", "dsh"]).toContain(stage.harness);
      expect(["medium", "max"]).toContain(stage.thinkingLevel);
      if (stage.harness === "pi" || stage.harness === "claude" || stage.harness === "dsh") {
        expect(stage.tools).toEqual(expectedTools[stage.harness]);
      }
    }
  });
});