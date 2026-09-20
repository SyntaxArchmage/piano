import { describe, expect, it } from "vitest";
import {
  canonicalTranscriptText,
  mergeCanonicalTranscript,
} from "../../packages/harness/src/canonical-transcript.js";

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

  it("rewrites Codex completed items and turn usage into canonical records", () => {
    const mapped = records(canonicalTranscriptText("codex", [
      JSON.stringify({ type: "thread.started", thread_id: "01a09107-44cb-7290-aea6-dbd3fab5d196" }),
      JSON.stringify({ type: "item.completed", item: { type: "command_execution", id: "cmd-1", command: "ls", aggregated_output: "file.cu" } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 5 } }),
    ], [], "finish the task"));
    expect(mapped).toHaveLength(4);
    expect(mapped[0]).toMatchObject({ type: "message", message: { role: "user", content: "finish the task" } });
    expect(mapped[1]).toMatchObject({
      type: "message",
      message: { role: "assistant", content: [{ type: "toolCall", toolCallId: "cmd-1", name: "bash", input: { command: "ls" } }] },
    });
    expect(mapped[2]).toMatchObject({
      type: "message",
      message: { role: "tool", content: [{ type: "tool_result", toolCallId: "cmd-1", content: "file.cu" }] },
    });
    expect(mapped[3]).toMatchObject({
      type: "message",
      message: { role: "assistant", content: "done", usage: { input: 10, output: 5, cacheRead: 4 } },
    });
  });

  it("converts pi stdout into audit records, keeping the persisted messages and dropping pi's own session header", () => {
    const raw = [
      JSON.stringify({ type: "session", version: 3, id: "01a0a75b-121a-7e39-b60b-d298167530fa", timestamp: "2026-09-15T23:15:58.618Z", cwd: "/tmp/probe" }),
      JSON.stringify({ type: "agent_start" }),
      JSON.stringify({ type: "turn_start" }),
      JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1789514158675 } }),
      JSON.stringify({ type: "message_end", message: { role: "assistant", content: "hello", usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5 } } }),
      JSON.stringify({ type: "agent_settled" }),
    ];
    for (const harness of ["pi", "pi-cli"] as const) {
      const lines = canonicalTranscriptText(harness, raw).trimEnd().split("\n");
      // Two persisted messages. The session header pi emitted is NOT here: it
      // describes pi's own session file, and copying it would make this audit
      // trail look like a second session file on the same conversation.
      expect(lines).toHaveLength(2);
      const first = JSON.parse(lines[0]!) as Record<string, unknown>;
      const second = JSON.parse(lines[1]!) as Record<string, unknown>;
      expect(first).toMatchObject({ type: "message", message: { role: "user" } });
      expect(first.timestamp).toBe(new Date(1789514158675).toISOString());
      expect(second).toMatchObject({
        type: "message",
        message: { role: "assistant", content: "hello", usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 } },
      });
      // No session-file furniture: no parentId chain and no minted entry ids,
      // because nothing here is loaded as a session.
      expect(first.parentId).toBeUndefined();
      expect(first.id).toBeUndefined();
      expect(second.parentId).toBeUndefined();
    }
  });

  it("keeps only the roles pi persists, with no synthesised header when the stream has none", () => {
    const raw = [
      JSON.stringify({ type: "agent_start" }),
      JSON.stringify({ type: "message_end", message: { role: "user", content: "go" } }),
      JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
      // pi does not persist this role, so it is dropped from the audit trail.
      JSON.stringify({ type: "message_end", message: { role: "assistantPlus", content: "extra" } }),
    ];
    const lines = canonicalTranscriptText("pi", raw).trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    // Every record is a canonical message. Nothing is invented to make the
    // stream look like a session — a header here would be authored by Piano,
    // and pi's own file is the only session this conversation has.
    expect(records.map((record) => record.type)).toEqual(["message", "message"]);
    expect(records.map((record) => (record.message as { role?: string }).role)).toEqual(["user", "assistant"]);
  });

  it("falls back to the raw join when a claude, dsh, or pi transcript has no canonical records", () => {
    expect(canonicalTranscriptText("claude", ["{}"])).toBe("{}\n");
    expect(canonicalTranscriptText("dsh", ["plain final text"], [])).toBe("plain final text\n");
    // Nothing maps — no header, no persisted message — so the raw stream stays.
    const raw = '{"type":"agent_start"}\n{"type":"message_end","message":{"role":"assistantPlus"}}';
    expect(canonicalTranscriptText("pi-cli", raw.split("\n"))).toBe(raw + "\n");
  });
});

// A resumed dsh session hands back its whole event list every turn, so the
// payload is the conversation rather than this turn's delta. Folding it into
// what is stored is what keeps the file equal to the conversation: appending a
// snapshot instead is how a ten-turn actor accumulated 84% repeated records.
describe("canonical transcript folding", () => {
  const turn = (n: number, text: string): string =>
    JSON.stringify({ type: "message", timestamp: `T${n}`, message: { role: "assistant", content: text } }) + "\n";
  const ask = (n: number, text: string): string =>
    JSON.stringify({ type: "message", timestamp: `Q${n}`, message: { role: "user", content: text } }) + "\n";

  it("replaces a stored transcript the produced one already holds", () => {
    // The shape a resumed dsh turn really produces: everything already stored,
    // then this turn's records.
    const stored = ask(1, "first") + turn(1, "one");
    const produced = stored + ask(2, "second") + turn(2, "two");

    expect(mergeCanonicalTranscript(stored, produced)).toBe(produced);
    // The stored records survive exactly once, so nothing was lost either.
    expect(mergeCanonicalTranscript(stored, produced).split("Q1")).toHaveLength(2);
  });

  it("converges: folding the same payload again changes nothing", () => {
    // What makes a retry safe. A resumed dsh turn re-sends the whole session, so
    // the second fold must be a no-op rather than another copy.
    const stored = ask(1, "first") + turn(1, "one");
    const produced = stored + ask(2, "second") + turn(2, "two");
    const once = mergeCanonicalTranscript(stored, produced);

    expect(once).toBe(produced);
    expect(mergeCanonicalTranscript(once, produced)).toBe(once);
    // And the file is left untouched, not rewritten with identical bytes.
    expect(mergeCanonicalTranscript(produced, produced)).toBe(produced);
  });

  it("repairs a transcript that already accumulated repeats", () => {
    // B1 ++ B2 ++ B3 as an appending writer left it: 6 records for 3 turns.
    const b1 = ask(1, "first") + turn(1, "one");
    const b2 = b1 + ask(2, "second") + turn(2, "two");
    const b3 = b2 + ask(3, "third") + turn(3, "three");
    const accumulated = b1 + b2 + b3;

    expect(mergeCanonicalTranscript(accumulated, b3)).toBe(b3);
  });

  it("appends when the produced transcript does not hold what is stored", () => {
    // A per-turn payload, and the byte-for-byte append a caller that reads this
    // file back (pi-cli's `--session`) already relies on.
    const stored = ask(1, "first") + turn(1, "one");
    const produced = ask(2, "second") + turn(2, "two");

    expect(mergeCanonicalTranscript(stored, produced)).toBe(stored + produced);
  });

  it("handles the ends: nothing stored, and nothing produced", () => {
    const produced = ask(1, "first") + turn(1, "one");

    expect(mergeCanonicalTranscript("", produced)).toBe(produced);
    // An attempt that produced no records leaves the stored transcript alone.
    expect(mergeCanonicalTranscript(produced, "")).toBe(produced);
    expect(mergeCanonicalTranscript("", "")).toBe("");
  });

  it("does not mistake a shared record for a repeated conversation", () => {
    // Per-turn payloads legitimately share framing records with earlier turns.
    // Only a payload holding *every* stored record supersedes it.
    const shared = turn(0, "framing");
    const stored = shared + turn(1, "one");
    const produced = shared + turn(2, "two");

    expect(mergeCanonicalTranscript(stored, produced)).toBe(stored + produced);
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
