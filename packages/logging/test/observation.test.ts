import { describe, expect, it } from "vitest";
import {
  foldObservationOps,
  foldObservationStream,
  parseObservationOp,
  parseObservationOps,
  stringifyObservationOp,
  withoutDeltas,
  type ObservationOp,
} from "../src/observation.js";

const T0 = "2026-10-28T10:00:00.000Z";
const HANDLE = "attempt:measure@loop/iter-1:1";

function start(over: Partial<Extract<ObservationOp, { op: "start" }>> = {}): Extract<ObservationOp, { op: "start" }> {
  return {
    version: 1,
    timestamp: T0,
    handle: HANDLE,
    op: "start",
    type: "agent",
    name: "stage.attempt:loop.measure",
    ...over,
  };
}

function update(over: Partial<Extract<ObservationOp, { op: "update" }>> = {}): Extract<ObservationOp, { op: "update" }> {
  return { version: 1, timestamp: T0, handle: HANDLE, op: "update", ...over };
}

function end(over: Partial<Extract<ObservationOp, { op: "end" }>> = {}): Extract<ObservationOp, { op: "end" }> {
  return { version: 1, timestamp: T0, handle: HANDLE, op: "end", ...over };
}

function emit(over: Partial<Extract<ObservationOp, { op: "emit" }>> = {}): Extract<ObservationOp, { op: "emit" }> {
  return {
    version: 1,
    timestamp: T0,
    handle: "accepted:measure@loop/iter-1:1",
    op: "emit",
    type: "event",
    name: "stage.accepted",
    parent: HANDLE,
    ...over,
  };
}

describe("parseObservationOp", () => {
  it("round-trips every op kind", () => {
    const ops: ObservationOp[] = [
      start({ input: { stageId: "loop.measure" }, metadata: { attempt: 1 } }),
      update({ usageDetails: { input: 60, output: 40, total: 100 } }),
      end({ output: { outcome: "accepted" }, level: "DEFAULT", statusMessage: "accepted" }),
      end({ name: "assistant.message", output: { role: "assistant", text: "done" } }),
      emit({ output: { result: 12 }, level: "DEFAULT" }),
    ];
    for (const op of ops) {
      expect(parseObservationOp(stringifyObservationOp(op))).toEqual(op);
    }
  });

  it("drops blank, torn, and shapeless lines", () => {
    expect(parseObservationOp("")).toBeUndefined();
    expect(parseObservationOp("{")).toBeUndefined();
    expect(parseObservationOp("[]")).toBeUndefined();
    expect(parseObservationOp(JSON.stringify({ version: 1, timestamp: "t", handle: "h", op: "start" }))).toBeUndefined();
    expect(parseObservationOp(JSON.stringify({ version: 1, timestamp: "t", handle: "h", op: "nope" }))).toBeUndefined();
    expect(parseObservationOp(JSON.stringify({ version: 2, timestamp: "t", handle: "h", op: "end" }))).toBeUndefined();
  });

  it("refuses an emit that names a span kind", () => {
    expect(parseObservationOp(stringifyObservationOp(emit({ type: "agent" as "event" })))).toBeUndefined();
  });
});

describe("foldObservationOps", () => {
  it("nests children under their parent and closes an ended node", () => {
    const tree = foldObservationOps([
      start(),
      start({
        handle: "tool:call-1",
        type: "tool",
        name: "bash",
        parent: HANDLE,
        timestamp: "2026-10-28T10:00:00.500Z",
      }),
      update({ usageDetails: { total: 100 } }),
      end({ handle: "tool:call-1", level: "ERROR", statusMessage: "tool failed", timestamp: "2026-10-28T10:00:01.500Z" }),
      end({ output: { outcome: "failed" }, level: "ERROR", statusMessage: "failed", timestamp: "2026-10-28T10:00:02.000Z" }),
    ]);

    expect(tree).toHaveLength(1);
    const attempt = tree[0]!;
    expect(attempt).toMatchObject({
      type: "agent",
      name: "stage.attempt:loop.measure",
      endTime: "2026-10-28T10:00:02.000Z",
      usageDetails: { total: 100 },
      level: "ERROR",
      statusMessage: "failed",
      output: { outcome: "failed" },
    });
    expect(attempt.children).toHaveLength(1);
    expect(attempt.children[0]).toMatchObject({
      type: "tool",
      name: "bash",
      parent: HANDLE,
      endTime: "2026-10-28T10:00:01.500Z",
      level: "ERROR",
    });
  });

  it("closes an emit at its own timestamp and keeps it under its parent", () => {
    const tree = foldObservationOps([start(), emit()]);
    expect(tree).toHaveLength(1);
    const accepted = tree[0]?.children[0];
    expect(accepted).toMatchObject({
      type: "event",
      name: "stage.accepted",
      startTime: T0,
      endTime: T0,
      parent: HANDLE,
    });
  });

  it("keeps an unfinished node open and drops ops that name no live handle", () => {
    const tree = foldObservationOps([
      start(),
      end({ handle: "ghost", output: 1 }),
      update({ output: { partial: true } }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.endTime).toBeUndefined();
    expect(tree[0]?.output).toEqual({ partial: true });
    expect(tree[0]?.children).toEqual([]);
  });

  it("takes the first open as the fact and merges later updates", () => {
    const tree = foldObservationOps([
      start({ metadata: { a: 1 } }),
      start({ metadata: { a: 99, b: 2 } }),
      update({ metadata: { b: 3 } }),
    ]);
    expect(tree[0]).toMatchObject({ metadata: { a: 1, b: 3 } });
    expect(tree).toHaveLength(1);
  });

  it("refines an open node's payload from a re-reported start", () => {
    const tree = foldObservationOps([
      start({ handle: "tool:c1", type: "tool", name: "Read", input: {}, metadata: { toolCallId: "c1" } }),
      start({ handle: "tool:c1", type: "tool", name: "Read", input: { path: "a.ts" } }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.input).toEqual({ path: "a.ts" });
    expect(tree[0]?.metadata).toEqual({ toolCallId: "c1" });
  });

  it("promotes an orphan to a root instead of losing it", () => {
    const tree = foldObservationOps([
      start({ handle: "child", type: "generation", name: "agent.message", parent: "missing" }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.handle).toBe("child");
  });
});

describe("foldObservationStream", () => {
  it("folds a whole JSONL stream and drops the lines it cannot read", () => {
    const raw = [
      stringifyObservationOp(start()),
      "{ torn",
      stringifyObservationOp(emit()),
      "",
    ].join("\n");
    expect(parseObservationOps(raw)).toHaveLength(2);
    const tree = foldObservationStream(raw);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.name).toBe("stage.accepted");
  });
});

describe("withoutDeltas", () => {
  it("keeps durable updates and drops the chat's text-delta stream", () => {
    const kept: ObservationOp[] = [];
    const sink = withoutDeltas((ops) => kept.push(...ops));
    sink([
      start(),
      update({ output: { delta: "partial" } }),
      update({ usageDetails: { input: 60, output: 40, total: 100 } }),
      end({ name: "assistant.message", output: { role: "assistant", text: "done" } }),
    ]);
    expect(kept.map((op) => op.op)).toEqual(["start", "update", "end"]);
    expect(kept[1]).toMatchObject({ usageDetails: { input: 60 } });
  });

  it("calls the wrapped sink not at all when only deltas arrive", () => {
    let calls = 0;
    const sink = withoutDeltas(() => { calls += 1; });
    sink([update({ output: { delta: "a" } }), update({ output: { delta: "b" } })]);
    expect(calls).toBe(0);
  });
});
