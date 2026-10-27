import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  compileWorkflow,
  parseWorkflow,
} from "../../packages/orchestrator/src/index.js";

const SOURCE = "/tmp/workflow.yaml";

function run<A, E>(effect: Effect.Effect<A, E, never>): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect);
}

/** A loop region with stage entry and exit boundaries. */
const LOOP_WORKFLOW = `version: 3
workflow:
  name: loop-workflow
  nodes:
    - stage:
        name: profile
        worker: test-profile
        from: []
    - loop:
        name: tune
        from: [profile]
        entry: propose
        exit: aggregate
        feedback: aggregate
        iterations: 3
        nodes:
          - stage:
              name: propose
              worker: test-idea
              from: []
          - stage:
              name: aggregate
              worker: test-store
              from: [propose]
    - stage:
        name: summary
        worker: test-summary
        from: [tune]
`;

/** A map region that fans out over proposal values. */
const MAP_WORKFLOW = `version: 3
workflow:
  name: map-workflow
  nodes:
    - stage:
        name: propose
        worker: test-idea
        from: []
    - tournament:
        name: fanout
        from: [propose]
        over: propose.strategies
        count: 4
        entry: implement
        exit: bench
        nodes:
          - stage:
              name: implement
              worker: test-implement
              from: []
          - stage:
              name: verify
              worker: test-verify
              from: [implement]
          - stage:
              name: bench
              worker: test-bench
              from: [verify]
    - stage:
        name: aggregate
        worker: test-store
        from: [fanout]
`;

describe(" loop/map workflow DSL", () => {
  it("compiles a loop region and orders its leaves by dependency", async () => {
    const parsed = await run(parseWorkflow(LOOP_WORKFLOW, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;

    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (!Exit.isSuccess(compiled)) return;

    // Leaves flattened in topological order: profile → propose → aggregate → summary.
    expect(compiled.value.stages.map((s) => s.stage.name)).toEqual([
      "profile",
      "propose",
      "aggregate",
      "summary",
    ]);
    // Loop region is emitted with resolved boundaries (loop contains propose+aggregate).
    const region = compiled.value.regions.find((r) => r.kind === "loop");
    expect(region).toBeDefined();
    expect(region?.name).toBe("tune");
    expect(region?.iterations).toBe(3);
    expect(region?.entryStageId).toBe("tune.propose");
    expect(region?.exitStageId).toBe("tune.aggregate");
    expect(region?.feedback).toBe("aggregate");
    expect(region?.from).toEqual(["profile"]);
  });

  it("compiles a map region with a fan-out count and over field", async () => {
    const parsed = await run(parseWorkflow(MAP_WORKFLOW, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;

    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isSuccess(compiled)).toBe(true);
    if (!Exit.isSuccess(compiled)) return;

    expect(compiled.value.stages.map((s) => s.stage.name)).toEqual([
      "propose",
      "implement",
      "verify",
      "bench",
      "aggregate",
    ]);
    const region = compiled.value.regions.find((r) => r.kind === "map");
    expect(region).toBeDefined();
    expect(region?.name).toBe("fanout");
    expect(region?.over).toBe("propose.strategies");
    expect(region?.count).toBe(4);
    expect(region?.entryStageId).toBe("fanout.implement");
    expect(region?.exitStageId).toBe("fanout.bench");
  });

  it("defaults a tournament to concurrent lanes and honors the parallel switch", async () => {
    const concurrent = await run(parseWorkflow(MAP_WORKFLOW, SOURCE));
    expect(Exit.isSuccess(concurrent)).toBe(true);
    if (!Exit.isSuccess(concurrent)) return;
    const concurrentCompiled = await run(compileWorkflow(concurrent.value, SOURCE));
    expect(Exit.isSuccess(concurrentCompiled)).toBe(true);
    if (!Exit.isSuccess(concurrentCompiled)) return;
    // Omitting the switch keeps the historical fan-out behavior.
    expect(concurrentCompiled.value.regions.find((r) => r.kind === "map")?.parallel).toBe(true);

    const serialSource = MAP_WORKFLOW.replace("count: 4", "count: 4\n        parallel: false");
    const serial = await run(parseWorkflow(serialSource, SOURCE));
    expect(Exit.isSuccess(serial)).toBe(true);
    if (!Exit.isSuccess(serial)) return;
    const serialCompiled = await run(compileWorkflow(serial.value, SOURCE));
    expect(Exit.isSuccess(serialCompiled)).toBe(true);
    if (!Exit.isSuccess(serialCompiled)) return;
    expect(serialCompiled.value.regions.find((r) => r.kind === "map")?.parallel).toBe(false);
  });

  it("rejects a non-boolean tournament parallel switch", async () => {
    const bad = MAP_WORKFLOW.replace("count: 4", "count: 4\n        parallel: \"true\"");
    const parsed = await run(parseWorkflow(bad, SOURCE));
    expect(Exit.isFailure(parsed)).toBe(true);
    if (Exit.isFailure(parsed)) {
      expect(String(parsed.cause)).toContain("parallel must be a boolean");
    }
  });

  it("accepts the maximum safe count and rejects unsafe region counts", async () => {
    const maxSafeCount = String(Number.MAX_SAFE_INTEGER);
    const validSources = [
      LOOP_WORKFLOW.replace("iterations: 3", `iterations: ${maxSafeCount}`),
      MAP_WORKFLOW.replace("count: 4", `count: ${maxSafeCount}`),
    ];
    for (const source of validSources) {
      const parsed = await run(parseWorkflow(source, SOURCE));
      expect(Exit.isSuccess(parsed)).toBe(true);
    }

    const invalidSources = [
      LOOP_WORKFLOW.replace("iterations: 3", "iterations: 9007199254740992"),
      MAP_WORKFLOW.replace("count: 4", "count: 9007199254740992"),
    ];

    for (const source of invalidSources) {
      const parsed = await run(parseWorkflow(source, SOURCE));
      expect(Exit.isFailure(parsed)).toBe(true);
    }
  });

  it("rejects async stages inside a tournament", async () => {
    const bad = MAP_WORKFLOW.replace(
      "              name: verify\n              worker: test-verify",
      "              name: verify\n              worker: test-verify\n              async: true",
    );
    const parsed = await run(parseWorkflow(bad, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isFailure(compiled)).toBe(true);
    if (Exit.isFailure(compiled)) {
      expect(String(compiled.cause)).toContain("async stages are not supported in tournaments");
    }
  });

  it("rejects async loop exit/feedback stages", async () => {
    const bad = LOOP_WORKFLOW.replace(
      "              name: aggregate\n              worker: test-store",
      "              name: aggregate\n              worker: test-store\n              async: true",
    );
    const parsed = await run(parseWorkflow(bad, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isFailure(compiled)).toBe(true);
    if (Exit.isFailure(compiled)) {
      expect(String(compiled.cause)).toContain("loop exit/feedback stage");
    }
  });

  it("rejects a loop entry node that declares local from dependencies", async () => {
    const bad = LOOP_WORKFLOW.replace(
      "              from: []\n          - stage:\n              name: aggregate",
      "              from: [propose]\n          - stage:\n              name: aggregate",
    );
    const parsed = await run(parseWorkflow(bad, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isFailure(compiled)).toBe(true);
  });

  it("rejects loop feedback that is not a direct child node", async () => {
    const bad = LOOP_WORKFLOW.replace("feedback: aggregate", "feedback: missing");
    const parsed = await run(parseWorkflow(bad, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;

    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isFailure(compiled)).toBe(true);
    if (Exit.isFailure(compiled)) {
      expect(String(compiled.cause)).toContain('feedback "missing" must reference a direct child');
    }
  });

  it("rejects a map whose over field does not select a from node", async () => {
    const bad = MAP_WORKFLOW.replace(
      "over: propose.strategies",
      "over: unrelated.field",
    );
    const parsed = await run(parseWorkflow(bad, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isFailure(compiled)).toBe(true);
  });

  it("rejects a stage depending on an unknown node in its scope", async () => {
    const bad = LOOP_WORKFLOW.replace("from: [tune]", "from: [unknown]");
    const parsed = await run(parseWorkflow(bad, SOURCE));
    expect(Exit.isSuccess(parsed)).toBe(true);
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    expect(Exit.isFailure(compiled)).toBe(true);
  });

  it("rejects the pre-preview map node keyword and points at tournament", async () => {
    const bad = MAP_WORKFLOW.replace("- tournament:", "- map:");
    const parsed = await run(parseWorkflow(bad, SOURCE));
    expect(Exit.isFailure(parsed)).toBe(true);
    if (Exit.isFailure(parsed)) {
      expect(String(parsed.cause)).toContain('"map" was renamed to "tournament"');
    }
  });
});
