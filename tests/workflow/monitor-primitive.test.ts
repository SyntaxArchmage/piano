import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  compileWorkflow,
  parseWorkflow,
  type WorkflowDocument,
} from "../../packages/orchestrator/src/index.js";

const SOURCE = "/tmp/monitor-workflow.yaml";

const BASE = `version: 3
workflow:
  name: tuning
  nodes:
    - stage:
        name: measure
        worker: basic
        from: []
`;

function withMonitor(value: string): string {
  return BASE.replace("  name: tuning\n", `  name: tuning\n  monitor: ${value}\n`);
}

function run<A, E>(effect: Effect.Effect<A, E, never>): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect);
}

async function parse(source: string): Promise<Exit.Exit<WorkflowDocument, unknown>> {
  return run(parseWorkflow(source, SOURCE));
}

describe("workflow.monitor", () => {
  it("defaults to false when omitted", async () => {
    const parsed = await parse(BASE);
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    expect(parsed.value.workflow.monitor).toBe(false);

    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (!Exit.isSuccess(compiled)) return;
    expect(compiled.value.monitor).toBe(false);
  });

  it("carries true from the document into the compiled workflow", async () => {
    const parsed = await parse(withMonitor("true"));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    expect(parsed.value.workflow.monitor).toBe(true);

    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (!Exit.isSuccess(compiled)) return;
    expect(compiled.value.monitor).toBe(true);
  });

  it("refuses a non-boolean value", async () => {
    const parsed = await parse(withMonitor('"yes"'));
    expect(Exit.isFailure(parsed)).toBe(true);
    if (!Exit.isFailure(parsed)) return;
    expect(String(parsed.cause)).toContain("monitor must be a boolean");
  });

  it("keeps the top-level key set explicit", async () => {
    const parsed = await parse(BASE.replace("  name: tuning\n", "  name: tuning\n  monitoring: true\n"));
    expect(Exit.isFailure(parsed)).toBe(true);
    if (!Exit.isFailure(parsed)) return;
    expect(String(parsed.cause)).toContain('unknown field "monitoring"');
  });

  it("ships monitor: true in the kernel-tuning templates", async () => {
    for (const name of ["gpu-cuda-tuning", "gpu-cuda-tuning-tournament", "gpu-triton-tuning"]) {
      const path = join(process.cwd(), "recipes", "workflows", `${name}.yml`);
      const parsed = await Effect.runPromise(parseWorkflow(await readFile(path, "utf8"), path));
      expect(parsed.workflow.name).toBe(name);
      expect(parsed.workflow.monitor).toBe(true);
    }
  });
});
