import { describe, expect, it } from "vitest";
import { expandEvalRunCells } from "../src/run-plan.js";
import type { EvalCase } from "../src/types.js";

const kase = (id: string): EvalCase => ({
  id,
  group: "develop",
  prompt: "fix",
  command: "true",
  workspace: "workspace",
  readout: { kind: "programmatic", compileCommand: "true", verifyCommand: "true" },
  tags: [{ tag: "correctness" }],
});

describe("eval run plan", () => {
  it("expands every case into stable one-based trials", () => {
    expect(expandEvalRunCells([kase("a"), kase("b")], 2).map(({ kase, trial }) => `${kase.id}#${trial}`))
      .toEqual(["a#1", "a#2", "b#1", "b#2"]);
  });

});