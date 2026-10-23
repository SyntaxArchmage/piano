import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  appendEvalHistory,
  compareHistoryVariants,
  evalBaselinePath,
  evalHistoryPath,
  readEvalHistory,
  readBaseline,
  recordBaseline,
} from "../src/history.js";
import { historyEntryFromResult } from "../src/evidence.js";
import type { CaseResult } from "../src/types.js";

function result(variant: string): CaseResult {
  return {
    caseId: "case-a",
    runSetId: `run-${variant}`,
    trial: 1,
    group: "agentic",
    tags: ["correctness"],
    variant,
    status: "completed",
    workspaceDir: "/tmp/workspace",
    runDir: "/tmp/run",
    baseline: { value: 1, rawOutput: "1", passed: true },
    artifact: { verified: true, value: 2 },
    scorecard: {
      caseId: "case-a",
      correctness: 1,
      execution: 1,
      evidence: 1,
      performance: 1,
      quality: 1,
      judgeBacked: false,
      judges: [],
      accepted: true,
      timing: { wallClockMs: 10, stageTotalMs: 10, maxStageMs: 10, completedStageCount: 1 },
    },
  };
}

describe(" eval history", () => {
  it("appends and reads immutable run rows and pins a baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-history-"));
    const first = result("baseline");
    const second = result("candidate");
    await Effect.runPromise(appendEvalHistory(root, historyEntryFromResult(first, "run-1", "2026-01-01T00:00:00.000Z")).pipe(Effect.provide(NodeFileSystem.layer)));
    await Effect.runPromise(recordBaseline(root, second, "run-2", "2026-01-02T00:00:00.000Z").pipe(Effect.provide(NodeFileSystem.layer)));
    const entries = await Effect.runPromise(readEvalHistory(root, "case-a").pipe(Effect.provide(NodeFileSystem.layer)));

    expect(entries.map((entry) => entry.kind)).toEqual(["run", "baseline"]);
    expect(entries[0]?.variant).toBe("baseline");
    expect(entries[1]?.baseline?.value).toBe(1);
    expect((await Effect.runPromise(readBaseline(root, "case-a").pipe(Effect.provide(NodeFileSystem.layer))))?.value).toBe(1);
    expect((await readdir(join(root, "case-a"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(evalHistoryPath(root, "case-a")).toContain("history.jsonl");
    expect(evalBaselinePath(root, "case-a")).toContain("baseline.json");
  });

  it("compares variants from persisted history", () => {
    const entries = [
      historyEntryFromResult(result("a"), "run-a", "2026-01-01T00:00:00.000Z"),
      historyEntryFromResult(result("b"), "run-b", "2026-01-01T00:00:01.000Z"),
    ];
    const comparison = compareHistoryVariants("case-a", entries);
    expect(comparison?.variants.map((variant) => variant.variant)).toEqual(["a", "b"]);
    expect(comparison?.variants[0]?.acceptedRate).toBe(1);
  });

  it("rejects a benchmark measurement with a non-finite value", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-history-invalid-"));
    const entry = historyEntryFromResult(result("candidate"), "run-1");
    if (entry.baseline === undefined) throw new Error("expected a baseline");
    await Effect.runPromise(appendEvalHistory(root, {
      ...entry,
      baseline: { ...entry.baseline, value: Number.POSITIVE_INFINITY },
    }).pipe(Effect.provide(NodeFileSystem.layer)));

    const exit = await Effect.runPromiseExit(readEvalHistory(root, "case-a").pipe(Effect.provide(NodeFileSystem.layer)));
    expect(exit._tag).toBe("Failure");
  });
});
