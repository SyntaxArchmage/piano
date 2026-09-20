import { describe, expect, it } from "vitest";
import { canonicalTranscriptText } from "../../packages/harness/src/canonical-transcript.js";

// The evidence analyzers speak one canonical transcript dialect:
// {"type":"message","message":{"role","content","usage"},"timestamp"}.
// The pi SDK session files already use it; the claude and dsh adapters
// capture native formats instead. These tests pin the adapters' boundary
// mapping — real recorded shapes from live runs, trimmed to the interesting
// parts.
describe("canonical transcript mapping", () => {
  const claudeLines = [
    '{"type":"system","subtype":"init","session_id":"s1","tools":["Bash","Read"],"model":"m"}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"listing"},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}],"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100,"cache_creation_input_tokens":2}},"timestamp":"2026-09-05T14:43:27.097Z","session_id":"s1"}',
    '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"total 56\\n"}]},"timestamp":"2026-09-05T14:43:27.644Z","session_id":"s1"}',
    '{"type":"result","subtype":"success","result":"done","total_cost_usd":0.1}',
  ];

  function records(text: string): Array<Record<string, unknown>> {
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it("rewrites claude stream-json into canonical message records", () => {
    const mapped = records(canonicalTranscriptText("claude", claudeLines));
    expect(mapped).toHaveLength(2);
    const [assistant, toolResult] = mapped;
    expect(assistant).toMatchObject({
      type: "message",
      timestamp: "2026-09-05T14:43:27.097Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "listing" },
          { type: "toolCall", toolCallId: "t1", name: "Bash", input: { command: "ls" } },
        ],
        usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 2 },
      },
    });
    expect(toolResult).toMatchObject({
      type: "message",
      timestamp: "2026-09-05T14:43:27.644Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", toolCallId: "t1", content: "total 56\n" }],
      },
    });
  });

  it("keeps a string user content (prompt echo) as a string message", () => {
    const mapped = records(canonicalTranscriptText("claude", [
      '{"type":"user","message":{"role":"user","content":"do the task"},"timestamp":"2026-09-05T00:00:00.000Z"}',
    ]));
    expect(mapped).toEqual([{
      type: "message",
      timestamp: "2026-09-05T00:00:00.000Z",
      message: { role: "user", content: "do the task" },
    }]);
  });

  it("drops unrecognizable claude lines without breaking later evidence", () => {
    const mapped = records(canonicalTranscriptText("claude", [
      "not json",
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}',
    ]));
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({ type: "message", message: { role: "assistant" } });
  });

  const dshEvents: Array<Record<string, unknown>> = [
    { type: "session", id: "x1", cwd: "/w" },
    { type: "user/message", time: 1788619415754, data: { content: [{ type: "text", text: "# agents.md prompt" }] } },
    {
      type: "assistant/message",
      time: 1788619417450,
      data: {
        turn: 1,
        step: 1,
        message: {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Let me start by reading" },
            { type: "tool-call", id: "call_00", name: "bash", arguments: '{"command":"ls -la"}' },
          ],
        },
        usage: { inputTokens: 5269, outputTokens: 204, cacheReadTokens: 7424 },
      },
    },
    {
      type: "tool/result",
      time: 1788619417488,
      data: {
        turn: 1,
        message: { content: [{ type: "tool-result", toolCallId: "call_00", content: [{ type: "text", text: "total 56" }] }] },
      },
    },
    { type: "turn/start", time: 1788619415000, data: {} },
  ];

  it("rewrites dsh native session events into canonical message records", () => {
    const mapped = records(canonicalTranscriptText("dsh", [], dshEvents));
    expect(mapped).toHaveLength(3);
    const [prompt, assistant, toolResult] = mapped;
    expect(prompt).toMatchObject({
      type: "message",
      timestamp: new Date(1788619415754).toISOString(),
      message: { role: "user", content: [{ type: "text", text: "# agents.md prompt" }] },
    });
    expect(assistant).toMatchObject({
      type: "message",
      timestamp: new Date(1788619417450).toISOString(),
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me start by reading" },
          { type: "toolCall", toolCallId: "call_00", name: "bash", input: { command: "ls -la" } },
        ],
        usage: { input: 5269, output: 204, cacheRead: 7424 },
      },
    });
    expect(toolResult).toMatchObject({
      type: "message",
      message: {
        role: "tool",
        content: [{ type: "tool_result", toolCallId: "call_00", content: [{ type: "text", text: "total 56" }] }],
      },
    });
  });

  it("leaves pi and pi-cli transcripts byte-identical (native resume format)", () => {
    const raw = '{"type":"agent_start"}\n{"type":"message_end","message":{"role":"assistant","content":"hi"}}\n';
    expect(canonicalTranscriptText("pi", raw.split("\n").filter((line) => line !== ""))).toBe(raw);
    expect(canonicalTranscriptText("pi-cli", raw.split("\n").filter((line) => line !== ""))).toBe(raw);
  });

  it("falls back to the raw join when a claude or dsh transcript has no canonical records", () => {
    expect(canonicalTranscriptText("claude", ["{}"])).toBe("{}\n");
    expect(canonicalTranscriptText("dsh", ["plain final text"], [])).toBe("plain final text\n");
  });
});

// The eval matrix runs each claude/dsh cell in serial and tournament shape.
// The analyzers count canonical `type:"message"` records, so the mapping must
// preserve the one-record-per-turn structure of every recorded live shape.
describe("matrix cell transcripts", () => {
  function records(text: string): Array<Record<string, unknown>> {
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  function claudeSerialLines(turns: number, extraUser = 0): string[] {
    const lines = ['{"type":"system","subtype":"init","session_id":"s"}'];
    for (let i = 0; i < turns; i += 1) {
      lines.push(`{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t${i}","name":"Bash","input":{"command":"x"}}],"usage":{"input_tokens":10,"output_tokens":5}},"timestamp":"2026-09-0${5 + i}.000Z"}`);
      lines.push(`{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t${i}","content":"ok"}]},"timestamp":"2026-09-0${5 + i}.001Z"}`);
    }
    for (let i = 0; i < extraUser; i += 1) {
      lines.push(`{"type":"user","message":{"role":"user","content":"injected prompt ${i}"},"timestamp":"2026-09-05T00:0${i}:00.000Z"}`);
    }
    lines.push('{"type":"result","subtype":"success","result":"done"}');
    return lines;
  }

  function dshEvents(turns: number, opts: { toolResults: number; userMessages: number }): Array<Record<string, unknown>> {
    const events: Array<Record<string, unknown>> = [{ type: "session", id: "x" }];
    for (let i = 0; i < opts.userMessages; i += 1) {
      events.push({ type: "user/message", time: 1788619415754 + i, data: { content: [{ type: "text", text: `prompt ${i}` }] } });
    }
    for (let i = 0; i < turns; i += 1) {
      events.push({
        type: "assistant/message", time: 1788619417450 + i,
        data: { message: { role: "assistant", content: [{ type: "reasoning", text: "think" }, { type: "tool-call", id: `c${i}`, name: "bash", arguments: '{"command":"x"}' }] }, usage: { inputTokens: 50, outputTokens: 5 } },
      });
    }
    for (let i = 0; i < opts.toolResults; i += 1) {
      events.push({ type: "tool/result", time: 1788619417488 + i, data: { message: { content: [{ type: "tool-result", toolCallId: `c${i}`, content: [{ type: "text", text: "out" }] }] } } });
    }
    return events;
  }

  // Recorded live shapes (scripts/evals artifacts, trimmed to counts):
  // claude serial: 11 assistant + 10 user turns; tournament: 14 + 13 + 10 prompt echoes.
  it("maps the claude serial cell transcript (one message per record)", () => {
    const mapped = records(canonicalTranscriptText("claude", claudeSerialLines(11, 0)));
    expect(mapped).toHaveLength(22);
    expect(mapped.every((r) => r.type === "message")).toBe(true);
  });

  it("maps the claude tournament cell transcript", () => {
    const mapped = records(canonicalTranscriptText("claude", claudeSerialLines(14, 10)));
    expect(mapped).toHaveLength(38);
    expect(mapped.filter((r) => (r.message as Record<string, unknown>).role === "user")).toHaveLength(24);
  });

  // dsh serial: 36 assistant turns (300 events incl. foreign types); tournament: 63 message events.
  it("maps the dsh serial cell transcript", () => {
    const mapped = records(canonicalTranscriptText("dsh", [], dshEvents(36, { toolResults: 36, userMessages: 2 })));
    expect(mapped).toHaveLength(74);
  });

  it("maps the dsh tournament cell transcript", () => {
    const mapped = records(canonicalTranscriptText("dsh", [], dshEvents(21, { toolResults: 21, userMessages: 21 })));
    expect(mapped).toHaveLength(63);
  });
});
