import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  evalBaselinePath,
  readBaseline,
  recordBaseline,
} from "../src/baseline.js";
import type { CaseResult } from "../src/types.js";

function result(value: number): CaseResult {
  return {
    caseId: "case-a",
    runSetId: "run-1",
    trial: 1,
    group: "agentic",
    tags: ["correctness"],
    status: "completed",
    workspaceDir: "/tmp/workspace",
    runDir: "/tmp/run",
    baseline: { value, rawOutput: String(value), passed: true },
    artifact: { verified: true, value: 2 },
  };
}

describe("eval baselines", () => {
  it("pins a baseline and reads it back", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-baseline-"));
    await Effect.runPromise(recordBaseline(root, result(1), "run-2", "2026-01-02T00:00:00.000Z").pipe(Effect.provide(NodeFileSystem.layer)));

    expect((await Effect.runPromise(readBaseline(root, "case-a").pipe(Effect.provide(NodeFileSystem.layer))))?.value).toBe(1);
    expect((await readdir(join(root, "case-a"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(evalBaselinePath(root, "case-a")).toContain("baseline.json");
    // The pinned file records the run it came from, not a second ledger.
    expect(JSON.parse(await readFile(evalBaselinePath(root, "case-a"), "utf8"))).toMatchObject({
      kind: "baseline",
      runSetId: "run-2",
      recordedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("refuses a baseline that did not complete", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-baseline-invalid-"));
    const incomplete = { ...result(1), baseline: { value: 1, rawOutput: "1", passed: false } };

    await expect(Effect.runPromise(
      recordBaseline(root, incomplete, "run-1").pipe(Effect.provide(NodeFileSystem.layer)),
    )).rejects.toThrow(/cannot record a baseline/);
    expect(await Effect.runPromise(readBaseline(root, "case-a").pipe(Effect.provide(NodeFileSystem.layer)))).toBeUndefined();
  });

  it("rejects a pinned baseline file that is malformed", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-eval-baseline-malformed-"));
    await mkdir(join(root, "case-a"), { recursive: true });
    await writeFile(
      evalBaselinePath(root, "case-a"),
      JSON.stringify({ kind: "baseline", baseline: { value: 1, rawOutput: "1", passed: false } }),
      "utf8",
    );

    // A pinned file that no longer holds a usable measurement must fail the
    // replay, not silently seed it with an unusable reference.
    const exit = await Effect.runPromiseExit(readBaseline(root, "case-a").pipe(Effect.provide(NodeFileSystem.layer)));
    expect(exit._tag).toBe("Failure");
  });
});