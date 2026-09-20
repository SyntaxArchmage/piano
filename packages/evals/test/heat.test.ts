import { describe, expect, it } from "vitest";
import { heatCell } from "../src/heat.js";

describe(" scorecard heat cells", () => {
  it("renders missing values without a misleading color", () => {
    expect(heatCell(undefined, { min: 0, max: 1, good: "high" })).toBe("n/a");
  });

  it("colors high and low scales deterministically", () => {
    expect(heatCell(0.9, { min: 0, max: 1, good: "high" }, (value) => value.toFixed(1))).toContain("\x1b[32m0.9");
    expect(heatCell(0.1, { min: 0, max: 1, good: "low" }, (value) => value.toFixed(1))).toContain("\x1b[32m0.1");
  });

  it("supports a numeric target scale", () => {
    expect(heatCell(0.52, { min: 0, max: 1, good: 0.5 })).toContain("\x1b[32m");
    expect(heatCell(0.9, { min: 0, max: 1, good: 0.5 })).toContain("\x1b[31m");
  });
});
