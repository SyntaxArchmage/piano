import { describe, expect, it } from "vitest";
import {
  admitWinner,
  betterByDirection,
  selectWinner,
  type SelectionBranch,
  type SelectionReferee,
} from "../../packages/orchestrator/src/selection.js";

function branch(index: number, overrides: Partial<SelectionBranch> = {}): SelectionBranch {
  return { key: `slot-${index}`, index, accepted: true, ...overrides };
}

const HIGHER: SelectionReferee = { name: "step", unit: "count", direction: "higher" };
const LOWER: SelectionReferee = { name: "latency", unit: "ms", direction: "lower" };

function metric(best: number, name = HIGHER.name, unit = HIGHER.unit, direction: "higher" | "lower" = HIGHER.direction) {
  return { name, unit, direction, best };
}

describe("selection decision core", () => {
  it("orders best by direction", () => {
    expect(betterByDirection(2, 1, "higher")).toBe(true);
    expect(betterByDirection(1, 2, "higher")).toBe(false);
    expect(betterByDirection(2, 1, "lower")).toBe(false);
    expect(betterByDirection(1, 2, "lower")).toBe(true);
  });

  it("picks the higher of two matching metrics", () => {
    const outcome = selectWinner(
      [
        branch(0, { metric: metric(10) }),
        branch(1, { metric: metric(20) }),
      ],
      HIGHER,
    );
    expect(outcome).toEqual({
      kind: "selected",
      winnerKey: "slot-1",
      runnerUpKeys: ["slot-0"],
    });
  });

  it("honors direction: lower is better for latency", () => {
    const outcome = selectWinner(
      [
        branch(0, { metric: metric(5, "latency", "ms", "lower") }),
        branch(1, { metric: metric(2, "latency", "ms", "lower") }),
      ],
      LOWER,
    );
    expect(outcome).toEqual({
      kind: "selected",
      winnerKey: "slot-1",
      runnerUpKeys: ["slot-0"],
    });
  });

  it("breaks best ties on the lowest fan index", () => {
    const outcome = selectWinner(
      [
        branch(0, { metric: metric(7) }),
        branch(1, { metric: metric(7) }),
        branch(2, { metric: metric(3) }),
      ],
      HIGHER,
    );
    expect(outcome).toEqual({
      kind: "selected",
      winnerKey: "slot-0",
      runnerUpKeys: ["slot-1", "slot-2"],
    });
  });

  it("excludes an accepted branch that never reached an accepted exit carrying a metric", () => {
    // slot-1 has the numerically best metric but is not accepted: excluded.
    const outcome = selectWinner(
      [
        branch(0, { metric: metric(1) }),
        branch(1, { accepted: false, metric: metric(99) }),
      ],
      HIGHER,
    );
    expect(outcome).toEqual({ kind: "selected", winnerKey: "slot-0", runnerUpKeys: [] });
  });

  it("reports not-accepted when no branch carries any metric", () => {
    const outcome = selectWinner([branch(0), branch(1)], HIGHER);
    expect(outcome).toEqual({
      kind: "no-winner",
      rejection: { reason: "not-accepted", detail: expect.any(String) },
    });
  });

  it("reports no-matching-metric when every metric has a different identity", () => {
    const outcome = selectWinner(
      [branch(0, { metric: metric(5, "other", "unit", "higher") })],
      HIGHER,
    );
    expect(outcome.kind).toBe("no-winner");
    if (outcome.kind === "no-winner") {
      expect(outcome.rejection.reason).toBe("no-matching-metric");
    }
  });

  it("admits only a strict improvement over the prior repetition's incumbent", () => {
    const branches = [
      branch(0, { metric: metric(8) }),
      branch(1, { metric: metric(9) }),
    ];
    const outcome = selectWinner(branches, HIGHER);

    expect(admitWinner(outcome, branches, HIGHER)).toMatchObject({
      kind: "admitted",
      winner: { key: "slot-1", metric: { best: 9 } },
    });
    expect(admitWinner(outcome, branches, HIGHER, {
      key: "prior-slot",
      metric: metric(9),
    })).toMatchObject({
      kind: "regressed",
      incumbent: { key: "prior-slot", metric: { best: 9 } },
    });
    expect(admitWinner(outcome, branches, HIGHER, {
      key: "prior-slot",
      metric: metric(7),
    })).toMatchObject({
      kind: "admitted",
      winner: { key: "slot-1", metric: { best: 9 } },
    });
  });

  it("uses lower-is-better direction when guarding a repeated tournament", () => {
    const branches = [branch(0, { metric: metric(2, "latency", "ms", "lower") })];
    const outcome = selectWinner(branches, LOWER);

    expect(admitWinner(outcome, branches, LOWER, {
      key: "prior-slot",
      metric: metric(3, "latency", "ms", "lower"),
    })?.kind).toBe("admitted");
    expect(admitWinner(outcome, branches, LOWER, {
      key: "prior-slot",
      metric: metric(1, "latency", "ms", "lower"),
    })?.kind).toBe("regressed");
  });

  it("rejects a repeated tournament when the referee identity changes", () => {
    const branches = [branch(0, { metric: metric(2, "latency", "ms", "lower") })];
    const outcome = selectWinner(branches, LOWER);

    for (const incumbentMetric of [
      metric(100, "throughput", "ms", "lower"),
      metric(100, "latency", "items/s", "lower"),
      metric(100, "latency", "ms", "higher"),
    ]) {
      expect(admitWinner(outcome, branches, LOWER, {
        key: "prior-slot",
        metric: incumbentMetric,
      })).toMatchObject({
        kind: "rejected",
        reason: "metric-identity-changed",
        incumbent: { key: "prior-slot" },
        detail: expect.stringContaining("does not match incumbent"),
      });
    }
  });
});
