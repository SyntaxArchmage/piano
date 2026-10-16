// The trajectory stream is a run's trajectory: one record per write, appended
// and never rewritten. Folding those records is the only way to see the run, so
// the fold has to describe it completely — including the cumulative event
// counts replay slices on, which no single record can measure for itself.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  foldTrajectoryStream,
  parseTrajectory,
  trajectoryStreamPath,
  TrajectoryWriter,
  type TrajectoryStreamRecord,
} from "../../packages/logging/src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A usage snapshot for one stage or actor. Pi emits these repeatedly while a
 * turn streams, so the ledger keeps one slot per key holding the latest. */
function usage(invocationId: string, totalTokens: number) {
  return { type: "usage", workflow: { invocationId }, usage: { totalTokens } };
}

describe("the trajectory stream", () => {
  it("folds into the run the writer recorded, turn by turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-stream-"));
    roots.push(root);
    const path = trajectoryStreamPath(root);
    const writer = new TrajectoryWriter("run-1", path);
    const base = {
      status: "completed" as const,
      promptLength: 5,
      sessionId: "sess-1",
      transcriptPath: "/runs/run-1/transcript.jsonl",
    };
    const write = (document: Parameters<TrajectoryWriter["write"]>[0]) =>
      Effect.runPromise(writer.write(document).pipe(Effect.provide(NodeContext.layer)));

    await write({ ...base, prompt: "first", events: [usage("a@root", 10), { type: "tool_execution_end", toolCallId: "t1" }] });
    // A second turn repeats a's snapshot: across turns the ledger keeps one
    // slot for it, holding the later value, in the position it first took.
    await write({ ...base, prompt: "second", events: [usage("a@root", 30), usage("b@root", 7)] });
    await Effect.runPromise(writer.rename("my run").pipe(Effect.provide(NodeContext.layer)));
    await write({ ...base, prompt: "third", status: "cancelled", events: [] });

    const records = (await readFile(path, "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as TrajectoryStreamRecord);

    const folded = foldTrajectoryStream(records);

    expect(folded?.turns?.map((turn) => turn.prompt)).toEqual(["first", "second", "third"]);
    // Three slots: a's (latest snapshot, first position), b's, and the tool
    // execution from the first turn.
    expect(folded?.events).toHaveLength(3);
    expect(folded?.name).toBe("my run");
    expect(folded?.status).toBe("cancelled");
    // The counts are cumulative over the merged ledger, so the last turn's is
    // the ledger's length — the invariant replay slices on.
    expect(folded?.turns?.map((turn) => turn.eventCount)).toEqual([2, 3, 3]);
  });

  it("folds a run from its stream alone", () => {
    const record = {
      version: 1 as const,
      runId: "run-1",
      timestamp: "2026-09-02T00:00:00.000Z",
      status: "cancelled" as const,
      promptLength: 5,
      prompt: "only",
      events: [{ type: "tool_execution_end", toolCallId: "t1" }],
    };

    const folded = parseTrajectory(`${JSON.stringify(record)}\n`);

    expect(folded?.turns?.map((turn) => turn.prompt)).toEqual(["only"]);
    expect(folded?.status).toBe("cancelled");
    expect(folded).toEqual(foldTrajectoryStream([record as unknown as TrajectoryStreamRecord]));
  });

  it("has no run for a stream that never said how it ended", () => {
    expect(parseTrajectory("")).toBeUndefined();
    expect(parseTrajectory(`${JSON.stringify({ version: 1, runId: "run-1", events: [] })}\n`)).toBeUndefined();
  });

  it("leaves every earlier record alone as the run goes on", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-append-"));
    roots.push(root);
    const path = trajectoryStreamPath(root);
    const writer = new TrajectoryWriter("run-1", path);
    const document = { status: "completed" as const, promptLength: 1, events: [] };
    const write = () => Effect.runPromise(writer.write(document).pipe(Effect.provide(NodeContext.layer)));

    await write();
    const firstLine = (await readFile(path, "utf8")).trim();
    await write();
    const lines = (await readFile(path, "utf8")).trim().split("\n");

    // A write costs its own record, not a rewrite of the run so far: the line
    // that was already there is the same bytes it was.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(firstLine);
  });
});
