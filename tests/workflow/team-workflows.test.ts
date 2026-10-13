import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { compileWorkflow, parseWorkflow } from "../../packages/orchestrator/src/index.js";

/**
 * The team workflow family: one graph shape (architect -> developer
 * tournament -> review-and-fix) shipped once per harness. The files must stay
 * siblings — same workers, same handoffs, same metric-bearing tournament
 * exit — and differ only in harness-native tool names.
 */
const TEAMS = [
  {
    file: "team-claude.yml",
    harness: "claude",
    architectTools: ["Read", "Bash", "Edit", "Write", "Glob", "Grep", "WebSearch"],
    laneTools: ["Read", "Bash", "Edit", "Write", "Glob", "Grep"],
  },
  {
    file: "team-pi.yml",
    harness: "pi",
    architectTools: ["read", "bash", "edit", "write", "find", "grep", "ls", "web_search", "discuss"],
    laneTools: ["read", "bash", "edit", "write", "find", "grep", "ls"],
  },
  {
    file: "team-dsh.yml",
    harness: "dsh",
    architectTools: ["read", "bash", "edit", "write", "glob", "grep", "web_search", "ask_user_question"],
    laneTools: ["read", "bash", "edit", "write", "glob", "grep"],
  },
] as const;

function run<A, E>(effect: Effect.Effect<A, E, never>): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect);
}

describe("team workflow family", () => {
  for (const team of TEAMS) {
    it(`ships ${team.file} with the shared three-step shape on ${team.harness}`, async () => {
      const path = join(process.cwd(), "recipes", "workflows", team.file);
      const source = await readFile(path, "utf8");
      const parsed = await run(parseWorkflow(source, path));
      expect(Exit.isSuccess(parsed)).toBe(true);
      if (!Exit.isSuccess(parsed)) return;
      const compiled = await run(compileWorkflow(parsed.value, path));
      expect(Exit.isSuccess(compiled)).toBe(true);
      if (!Exit.isSuccess(compiled)) return;

      expect(compiled.value.name).toBe(team.file.replace(/\.yml$/, ""));
      expect(compiled.value.regions.map((region) => region.name)).toEqual(["candidates"]);
      expect(compiled.value.stages.map((stage) => stage.stage.name)).toEqual([
        "architect",
        "implement",
        "review",
      ]);

      const byName = new Map(compiled.value.stages.map((stage) => [stage.stage.name, stage.stage]));
      const architect = byName.get("architect");
      const implement = byName.get("implement");
      const review = byName.get("review");
      expect(architect).toMatchObject({
        worker: "coding-architect",
        harness: team.harness,
        tools: [...team.architectTools],
        validate: true,
      });
      expect(implement).toMatchObject({
        worker: "coding-developer",
        harness: team.harness,
        tools: [...team.laneTools],
        validate: true,
      });
      expect(review).toMatchObject({
        worker: "coding-reviewer",
        harness: team.harness,
        tools: [...team.laneTools],
        validate: true,
      });

      // The tournament stays metric-bearing: lanes implement only, and the
      // region exit is the lane's own coding-candidate result.
      const region = compiled.value.regions[0];
      expect(region).toMatchObject({
        kind: "map",
        over: "architect.implementation_plan",
        count: 2,
        entry: "implement",
        exit: "implement",
      });
    });
  }
});
