import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@piano/harness";
import { evaluateTrajectoryFile, evaluateTrajectory } from "../src/trajectory-evaluator.js";

const events: AgentEvent[] = [
  { type: "message_end", message: { role: "user", content: "hello" } },
  { type: "message_end", message: { role: "assistant", content: "hi" } },
  { type: "turn_end", message: {}, toolResults: [] },
  { type: "usage", usage: { input: 100, output: 50, cacheRead: 25, cacheWrite: 7, totalTokens: 175 } },
  { type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: {} },
  { type: "tool_execution_start", toolCallId: "t2", toolName: "read", args: {} },
];

describe("evaluateTrajectory", () => {
  it("counts messages, rounds, tool calls, and tokens", () => {
    const metrics = evaluateTrajectory(events);
    expect(metrics.messageCount).toBe(2);
    expect(metrics.assistantMessageCount).toBe(1);
    expect(metrics.rounds).toBe(1);
    expect(metrics.toolCallCount).toBe(2);
    expect(metrics.toolNames).toContain("bash");
    expect(metrics.toolNames).toContain("read");
    expect(metrics.inputTokens).toBe(100);
    expect(metrics.outputTokens).toBe(50);
    expect(metrics.cacheReadTokens).toBe(25);
    expect(metrics.cacheWriteTokens).toBe(7);
    expect(metrics.totalTokens).toBe(175);
  });

  it("falls back to assistant message count for rounds when turn_end is absent", () => {
    const noTurns: AgentEvent[] = [
      { type: "message_end", message: { role: "assistant", content: "a" } },
      { type: "message_end", message: { role: "assistant", content: "b" } },
    ];
    const metrics = evaluateTrajectory(noTurns);
    expect(metrics.rounds).toBe(2);
  });

  it("returns zero metrics for an empty stream", () => {
    const metrics = evaluateTrajectory([]);
    expect(metrics.messageCount).toBe(0);
    expect(metrics.totalTokens).toBe(0);
    expect(metrics.toolNames).toEqual([]);
  });

  it("uses the latest cumulative usage snapshot only once", () => {
    const metrics = evaluateTrajectory([
      { type: "usage", usage: { input: 10, output: 5, cacheRead: 1, totalTokens: 16 } },
      { type: "usage", usage: { input: 20, output: 8, cacheRead: 2, totalTokens: 30 } },
      { type: "usage", usage: { input: 20, output: 8, cacheRead: 2, totalTokens: 30 } },
    ]);
    expect(metrics.totalTokens).toBe(30);
  });

  it("ignores negative usage counters when deriving totals", () => {
    const metrics = evaluateTrajectory([
      { type: "usage", usage: { input: -10, output: 5, cacheRead: -2, cacheWrite: 3 } },
    ]);

    expect(metrics).toMatchObject({
      inputTokens: 0,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 3,
      totalTokens: 8,
    });
  });

  it("reads the current CLI trajectory document shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-trajectory-"));
    const path = join(root, "trajectory.json");
    await writeFile(path, JSON.stringify({ status: "completed", events }));
    const result = await Effect.runPromise(evaluateTrajectoryFile(path));
    expect(result.totalTokens).toBe(175);
    expect(result.rounds).toBe(1);
  });

  it("reads newline-delimited AgentEvent records", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-trajectory-jsonl-"));
    const path = join(root, "trajectory.jsonl");
    await writeFile(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);

    const result = await Effect.runPromise(evaluateTrajectoryFile(path));
    expect(result).toMatchObject({
      messageCount: 2,
      assistantMessageCount: 1,
      rounds: 1,
      toolCallCount: 2,
      totalTokens: 175,
    });
  });

  it("rejects JSONL records without an event type", async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-evals-trajectory-invalid-jsonl-"));
    const path = join(root, "trajectory.jsonl");
    await writeFile(path, '{"foo":1}\n{"bar":2}\n');

    const result = await Effect.runPromiseExit(evaluateTrajectoryFile(path));
    expect(result._tag).toBe("Failure");
  });
});
