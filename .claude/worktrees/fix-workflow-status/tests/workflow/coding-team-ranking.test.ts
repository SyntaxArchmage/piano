import { describe, expect, it } from "vitest";
import { selectWinner } from "../../packages/orchestrator/src/selection.js";

describe("coding-team tournament ranking", () => {
  it("prefers fewer files then LOC when test pass rates tie", () => {
    const result = selectWinner([
      { key: "large", index: 0, accepted: true, metric: { name: "test_pass_rate", unit: "ratio", direction: "higher", best: 1 }, tieBreak: { changedFiles: 3, changedLoc: 80 } },
      { key: "small", index: 1, accepted: true, metric: { name: "test_pass_rate", unit: "ratio", direction: "higher", best: 1 }, tieBreak: { changedFiles: 1, changedLoc: 120 } },
      { key: "tiny", index: 2, accepted: true, metric: { name: "test_pass_rate", unit: "ratio", direction: "higher", best: 1 }, tieBreak: { changedFiles: 1, changedLoc: 20 } },
    ], { name: "test_pass_rate", unit: "ratio", direction: "higher" });
    expect(result).toMatchObject({ kind: "selected", winnerKey: "tiny" });
  });
});
