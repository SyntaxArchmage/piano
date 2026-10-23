import { buildReport } from "../src/scorer.js";
import type { CaseResult } from "../src/types.js";

/** One completed case, minimal but shaped like a real one: every suite that
 * needs a `CaseResult` literal reads this, so a change to `trace` or
 * `artifact` moves once instead of once per test file. */
export function caseFixture(value: number, overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    caseId: "tuning-case",
    trial: 1,
    group: "g",
    tags: [],
    status: "completed",
    workspaceDir: "/tmp/ws",
    trace: {
      complete: true,
      issues: [],
      messages: { count: 2, rounds: 1 },
      tokens: { count: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
      tools: { count: 1, failures: 0, names: [], totalDurationMs: 0 },
      duration: { count: 0, totalMs: 0, maxMs: 0 },
      benchmarks: [],
      stages: [],
    },
    artifact: { verified: true, value },
    metric: { name: "tflops", direction: "higher" },
    ...overrides,
  };
}

/** A persisted `report.json` body holding exactly these cases. */
export function reportFixture(runSetId: string, cases: readonly CaseResult[]): string {
  return JSON.stringify(buildReport(runSetId, "2026-08-25T00:00:00.000Z", [...cases]));
}