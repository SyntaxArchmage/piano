import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { listRunSetIds, readRunSetReport } from "../src/runset.js";

async function makeRunSet(root: string, id: string, body: string): Promise<void> {
  await mkdir(join(root, id), { recursive: true });
  await writeFile(join(root, id, "report.json"), body, "utf8");
}

describe("persisted eval run sets", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "piano-runset-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists only well-formed run sets that have a report, newest first", async () => {
    await makeRunSet(root, "eval-20260102T000000.000", "{}");
    await makeRunSet(root, "eval-20260103T000000.000", "{}");
    // A running eval: workspace dir exists, report is written only at the end.
    await mkdir(join(root, "eval-20260104T000000.000"), { recursive: true });
    // Scratch dirs that predate the report format must not show up.
    await makeRunSet(root, "eval-single-1787504993606", "{}");
    await makeRunSet(root, "eval-test", "{}");
    const ids = await Effect.runPromise(listRunSetIds(root).pipe(Effect.provide(NodeFileSystem.layer)));
    expect(ids).toEqual(["eval-20260103T000000.000", "eval-20260102T000000.000"]);
    // A missing root simply has no run sets.
    expect(await Effect.runPromise(listRunSetIds(join(root, "nope")).pipe(Effect.provide(NodeFileSystem.layer)))).toEqual([]);
  });

  it("reads a report and fails cleanly when absent, malformed, or unparsable", async () => {
    await makeRunSet(root, "eval-20260102T000000.000", JSON.stringify({ runSetId: "eval-20260102T000000.000", cases: [] }));
    const report = await Effect.runPromise(
      readRunSetReport(root, "eval-20260102T000000.000").pipe(Effect.provide(NodeFileSystem.layer)),
    );
    expect(report.cases).toEqual([]);
    await expect(Effect.runPromise(
      readRunSetReport(root, "eval-20260101T000000.000").pipe(Effect.provide(NodeFileSystem.layer)),
    )).rejects.toThrow(/no persisted report/);
    await makeRunSet(root, "eval-20260103T000000.000", "{not json");
    await expect(Effect.runPromise(
      readRunSetReport(root, "eval-20260103T000000.000").pipe(Effect.provide(NodeFileSystem.layer)),
    )).rejects.toThrow(/cannot parse/);
    await makeRunSet(root, "eval-20260104T000000.000", JSON.stringify({ runSetId: "x" }));
    await expect(Effect.runPromise(
      readRunSetReport(root, "eval-20260104T000000.000").pipe(Effect.provide(NodeFileSystem.layer)),
    )).rejects.toThrow(/malformed/);
  });
});
