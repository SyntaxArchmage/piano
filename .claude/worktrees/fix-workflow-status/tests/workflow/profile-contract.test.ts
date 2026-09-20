import { describe, expect, it } from "vitest";
import { validateContract } from "../../packages/contract/src/index.js";

describe(" profile result contract", () => {
  it("accepts timing-only evidence without inventing hardware counters", () => {
    const result = validateContract("profile-report", {
      status: "timing-only",
      target_operator: "kernel.py:run",
      device: { name: "GPU", architecture: "sm_86" },
      metrics: { memory_bandwidth_utilization: 0.2, launch_overhead: 1.5 },
      bottlenecks: [{ type: "memory", description: "derived timing", evidence: "elapsed=1.5ms" }],
      analysis: "Nsight Compute was unavailable; only timing-derived bandwidth is reported.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a ready profile that omits hardware metrics", () => {
    const result = validateContract("profile-report", {
      status: "ready",
      target_operator: "kernel.py:run",
      device: { name: "GPU", architecture: "sm_86" },
      metrics: { memory_bandwidth_utilization: 0.2 },
      bottlenecks: [{ type: "memory", description: "derived timing", evidence: "elapsed=1.5ms" }],
      analysis: "missing counters",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a blocked profile only with an explicit blocker", () => {
    const result = validateContract("profile-report", {
      status: "blocked",
      target_operator: "kernel.py:run",
      device: { name: "unknown", architecture: "unknown" },
      analysis: "CUDA unavailable",
      blocker: "CUDA is not available",
    });
    expect(result.success).toBe(true);
  });
});
