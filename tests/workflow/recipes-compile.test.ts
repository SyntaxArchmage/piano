// Every shipped workflow must load. Recipes are hand-maintained YAML; a typo
// in a key, a bad boolean, or an incompatible capability should fail here, not
// at the first run that happens to pick the file.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { compileWorkflow, parseWorkflow } from "../../packages/orchestrator/src/index.js";

const workflowsRoot = join(process.cwd(), "recipes", "workflows");

describe("shipped workflows", () => {
  it("all parse and compile", async () => {
    const files = (await readdir(workflowsRoot)).filter((file) => file.endsWith(".yml")).sort();
    expect(files.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const file of files) {
      const path = join(workflowsRoot, file);
      try {
        const parsed = await Effect.runPromise(parseWorkflow(await readFile(path, "utf8"), path));
        await Effect.runPromise(compileWorkflow(parsed, path));
      } catch (error) {
        failures.push(`${file}: ${String(error).slice(0, 200)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
