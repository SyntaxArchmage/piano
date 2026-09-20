import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  compileWorkflow,
  parseWorkflow,
  scheduleWorkflow,
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
        validate: profile-report
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
              validate: optimization-proposal
              from: []
          - stage:
              name: aggregate
              worker: test-store
              validate: tournament-results
              from: [propose]
    - stage:
        name: summary
        worker: test-summary
        validate: summary-report
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
        validate: optimization-proposal
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
              validate: implementation-record
              from: []
          - stage:
              name: verify
              worker: test-verify
              validate: verification-report
              from: [implement]
          - stage:
              name: bench
              worker: test-bench
              validate: benchmark-evidence
              from: [verify]
    - stage:
        name: aggregate
        worker: test-store
        validate: tournament-results
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

  it("schedules loop-nested stages with a dotted region path", async () => {
    const parsed = await run(parseWorkflow(LOOP_WORKFLOW, SOURCE));
    if (!Exit.isSuccess(parsed)) return;
    const compiled = await run(compileWorkflow(parsed.value, SOURCE));
    if (!Exit.isSuccess(compiled)) return;

    const scheduled = await run(scheduleWorkflow(compiled.value));
    expect(Exit.isSuccess(scheduled)).toBe(true);
    if (!Exit.isSuccess(scheduled)) return;

    const byName = new Map(scheduled.value.map((s) => [s.stage.name, s]));
    expect(byName.get("profile")?.regionPath).toBeUndefined();
    expect(byName.get("propose")?.regionPath).toEqual(["tune"]);
    expect(byName.get("aggregate")?.regionPath).toEqual(["tune"]);
    expect(byName.get("summary")?.regionPath).toBeUndefined();
    expect(scheduled.value.map((s) => s.order)).toEqual([0, 1, 2, 3]);
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
