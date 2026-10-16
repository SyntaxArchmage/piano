import { describe, expect, it } from "vitest";
import { expandDshStorageRecord } from "../../packages/harness/src/dsh-session-storage.js";

// Shapes captured field-by-field from a real installed-dsh 0.1.5
// `session.v3.jsonl.zstd` artifact: v3 embeds the step's packed delta members
// inside its `assistant/message` record (`data.stream`), member-level
// `time0/index/dt/texts|args` with no `seq0` and no `data` wrapper. v0/v1
// wrote packed rows top-level instead; sessions with that shape remain on
// disk, so both must expand.

function v3Message(stream: readonly unknown[]): Record<string, unknown> {
  return {
    type: "assistant/message",
    seq: 45,
    time: 1791968820656,
    data: {
      turn: 1,
      step: 5,
      message: { role: "assistant", content: [{ type: "text", text: "one two three" }] },
      usage: { inputTokens: 22430, outputTokens: 1831 },
      stream,
    },
  };
}

function chunks(events: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return events
    .filter((event) => event.type === "assistant/chunk")
    .map((event) => (event.data as { chunk: Record<string, unknown> }).chunk);
}

describe("expandDshStorageRecord", () => {
  it("expands v3 data.stream text-chunks into deltas ahead of the message", () => {
    const events = expandDshStorageRecord(v3Message([
      { type: "chunk", time: 1, chunk: { type: "block-start", index: 0, blockType: "text" } },
      { type: "text-chunks", time0: 100, index: 0, dt: [10, 20], texts: ["one", " two", " three"] },
    ]));
    const expanded = events.filter((event) => event.type === "assistant/chunk");
    expect(chunks(expanded).map((chunk) => chunk.type)).toEqual(["text-delta", "text-delta", "text-delta"]);
    expect(chunks(expanded).map((chunk) => chunk.text)).toEqual(["one", " two", " three"]);
    expect(expanded.map((event) => event.time)).toEqual([100, 110, 130]);
    expect(expanded.every((event) => event.seq === undefined)).toBe(true);
    // The parent message survives and stays last: deltas animate, message_end dedupes.
    expect(events.at(-1)?.type).toBe("assistant/message");
    expect(events).toHaveLength(4);
  });

  it("expands v3 reasoning and tool-call members without leaking them into text", () => {
    const events = expandDshStorageRecord(v3Message([
      { type: "reasoning-chunks", time0: 50, index: 0, dt: [5], texts: ["think", "ing"] },
      { type: "tool-call-chunks", time0: 60, index: 1, dt: [0], id: "call_1", name: "bash", args: ["ls ", "-la"] },
    ]));
    const expanded = chunks(events);
    expect(expanded.map((chunk) => chunk.type)).toEqual([
      "reasoning-delta", "reasoning-delta", "tool-call-delta", "tool-call-delta",
    ]);
    expect(expanded[2]).toMatchObject({ id: "call_1", name: "bash", argumentsDelta: "ls " });
    expect(expanded.some((chunk) => chunk.type === "text-delta")).toBe(false);
  });

  it("skips malformed v3 members but never drops the parent record", () => {
    const events = expandDshStorageRecord(v3Message([
      { type: "text-chunks", time0: 1, index: 0, dt: [1], texts: ["ok"] }, // dt must be texts.length - 1
      { type: "text-chunks", time0: 2, index: 0, dt: [], texts: ["fine"] },
      { type: "tool-call-chunks", time0: 3, index: 1, dt: [], args: ["x"] }, // no id
    ]));
    expect(chunks(events).map((chunk) => chunk.text)).toEqual(["fine"]);
    expect(events.at(-1)?.type).toBe("assistant/message");
  });

  it("still expands legacy v0/v1 top-level packed rows", () => {
    const events = expandDshStorageRecord({
      type: "text-chunks",
      seq0: 7,
      time0: 100,
      data: { turn: 1, step: 2, index: 0, dt: [3], texts: ["a", "b"] },
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "assistant/chunk", seq: 7, time: 100 });
    expect(events[1]).toMatchObject({ seq: 8, time: 103 });
    expect(chunks(events).map((chunk) => chunk.text)).toEqual(["a", "b"]);
  });

  it("passes records without a stream through untouched", () => {
    const message = { type: "assistant/message", seq: 3, data: { turn: 1, step: 1, message: {} } };
    expect(expandDshStorageRecord(message)).toEqual([message]);
    const turnStart = { type: "turn/start", seq: 1, data: { turn: 1 } };
    expect(expandDshStorageRecord(turnStart)).toEqual([turnStart]);
  });
});
