// The trajectory has two on-disk forms while the readers move across: the
// document `resume` replays from, and the append-only stream that document is
// folded from. The stream has to describe the same run — including the
// cumulative event counts the writer measures against its merged array, which
// is the part a per-write record cannot compute for itself.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  foldTrajectoryStream,
  trajectoryStreamPath,
  TrajectoryWriter,
  type TrajectoryDocument,
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
  it("folds back into the document the writer produced", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-stream-"));
    roots.push(root);
    const path = join(root, "trajectory.json");
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

    const document = JSON.parse(await readFile(path, "utf8")) as TrajectoryDocument;
    const records = (await readFile(trajectoryStreamPath(path), "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as TrajectoryStreamRecord);

    const folded = foldTrajectoryStream(records);

    // Same run, described the same way — status, carried fields, event ledger
    // and the per-turn counts, down to the replayed prompt order.
    expect(folded).toEqual(document);
    expect(folded?.turns?.map((turn) => turn.prompt)).toEqual(["first", "second", "third"]);
    // Three slots: a's (latest snapshot, first position), b's, and the tool
    // execution from the first turn.
    expect(folded?.events).toHaveLength(3);
    expect(folded?.name).toBe("my run");
    // The counts are cumulative over the merged ledger, so the last turn's is
    // the ledger's length — the invariant replay slices on.
    expect(folded?.turns?.map((turn) => turn.eventCount)).toEqual([2, 3, 3]);
  });

  it("leaves every earlier record alone as the run goes on", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-trajectory-append-"));
    roots.push(root);
    const path = join(root, "trajectory.json");
    const writer = new TrajectoryWriter("run-1", path);
    const document = { status: "completed" as const, promptLength: 1, events: [] };
    const write = () => Effect.runPromise(writer.write(document).pipe(Effect.provide(NodeContext.layer)));

    await write();
    const firstLine = (await readFile(trajectoryStreamPath(path), "utf8")).trim();
    await write();
    const lines = (await readFile(trajectoryStreamPath(path), "utf8")).trim().split("\n");

    // A write costs its own record, not a rewrite of the run so far: the line
    // that was already there is the same bytes it was.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(firstLine);
  });
});
