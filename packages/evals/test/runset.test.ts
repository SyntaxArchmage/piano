import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { listRunSetIds, readRunSetReport, reportRunSet, runSetReportPath } from "../src/runset.js";
import { caseFixture, reportFixture } from "./case-result-fixture.js";

async function makeRunSet(root: string, id: string, body: string): Promise<void> {
  await mkdir(join(root, id), { recursive: true });
  await writeFile(runSetReportPath(root, id), body, "utf8");
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

  it("fails cleanly when a report is absent, malformed, or unparsable", async () => {
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

  it("pairs a case with its own two latest runs, whatever their variant", async () => {
    const tuning = (variant: string, value: number) => caseFixture(value, {
      caseId: "tuning-case", group: "tuning", tags: ["tflops"], variant,
    });
    await makeRunSet(root, "eval-20260101T000000.000", reportFixture("eval-20260101T000000.000", [tuning("a", 10)]));
    await makeRunSet(root, "eval-20260102T000000.000", reportFixture("eval-20260102T000000.000", [tuning("b", 20)]));
    await makeRunSet(root, "eval-20260103T000000.000", reportFixture("eval-20260103T000000.000", [tuning("a", 12)]));

    const text = await Effect.runPromise(
      reportRunSet({ group: "tuning", details: false, delta: true }, root).pipe(Effect.provide(NodeFileSystem.layer)),
    );

    // The two latest records of the case: 0102 then 0103. There is no way to
    // name a different pair, and no comparison across cases.
    expect(text).toContain("eval-20260102T000000.000 → eval-20260103T000000.000 (tuning-case#1)");
    expect(text).not.toContain("eval-20260101T000000.000 → ");
  });

  it("renders missing Δ cells when a case has only one recorded run", async () => {
    const tuning = (value: number) => caseFixture(value, {
      caseId: "tuning-case", group: "tuning", tags: ["tflops"],
    });
    await makeRunSet(root, "eval-20260101T000000.000", reportFixture("eval-20260101T000000.000", [tuning(10)]));
    await makeRunSet(root, "eval-20260102T000000.000", reportFixture("eval-20260102T000000.000", [
      caseFixture(20, { caseId: "other-case", group: "tuning", tags: ["tflops"] }),
    ]));

    const text = await Effect.runPromise(
      reportRunSet({ group: "tuning", details: false, delta: true }, root).pipe(Effect.provide(NodeFileSystem.layer)),
    );

    // tuning-case has one record: `n/a` as its reference and dashes in every
    // cell. other-case's value must never become its reference.
    expect(text).toContain("n/a → eval-20260101T000000.000 (tuning-case#1)");
    expect(text).not.toContain("+10");
  });
});
