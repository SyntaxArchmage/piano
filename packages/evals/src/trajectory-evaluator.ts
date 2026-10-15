/**
 * Trajectory evaluator (A4) — folds a run's persisted event stream
 * (transcript JSONL + trajectory/trace) into structured metrics for scoring.
 *
 * Mirrors the established `analyzeTranscript` contract (total tokens, message count,
 * rounds, tool calls) but reads run artifacts produced by
 * `/orchestrator` (usable without a heavy orchestrator dependency).
 */

import { readFile } from "node:fs/promises";
import { Effect } from "effect";
import { Data } from "effect";
import type { AgentEvent, AgentUsage } from "@piano/harness";
import { parseTrajectory } from "@piano/logging";
import type { TrajectoryMetrics } from "./types.js";

export class TrajectoryEvalError extends Data.TaggedError("TrajectoryEvalError")<{
  readonly path: string;
  readonly message: string;
}> {}

const ZERO_METRICS: TrajectoryMetrics = {
  messageCount: 0,
  assistantMessageCount: 0,
  rounds: 0,
  toolCallCount: 0,
  toolNames: [],
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
};

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function usageTokens(usage: AgentUsage | undefined): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
} {
  if (usage === undefined) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const input = numberValue(usage.input);
  const output = numberValue(usage.output);
  const cacheRead = numberValue(usage.cacheRead);
  const cacheWrite = numberValue(usage.cacheWrite);
  const total = usage.totalTokens !== undefined
    ? numberValue(usage.totalTokens)
    : input + output + cacheRead + cacheWrite;
  return { input, output, cacheRead, cacheWrite, total };
}

/**
 * Fold a raw event stream into trajectory metrics.
 *
 * @param events The raw `AgentEvent[]` persisted by the CLI to the trajectory
 * stream (`trajectory.jsonl`).
 */
export function evaluateTrajectory(events: readonly AgentEvent[]): TrajectoryMetrics {
  const metrics: TrajectoryMetrics = { ...ZERO_METRICS };
  const toolNames = new Set<string>();
  let assistantTurns = 0;

  for (const event of events) {
    switch (event.type) {
      case "message_end": {
        metrics.messageCount += 1;
        // role defaults to assistant for messages without an explicit role.
        const role = event.message.role ?? "assistant";
        if (role === "assistant") {
          metrics.assistantMessageCount += 1;
          assistantTurns += 1;
        }
        break;
      }
      case "turn_end": {
        metrics.rounds += 1;
        break;
      }
      case "usage": {
        const tokens = usageTokens(event.usage);
        // The harness emits cumulative usage snapshots. Taking their maxima
        // avoids counting the same turn repeatedly when the UI/log stream
        // republishes an unchanged snapshot.
        metrics.inputTokens = Math.max(metrics.inputTokens, tokens.input);
        metrics.outputTokens = Math.max(metrics.outputTokens, tokens.output);
        metrics.cacheReadTokens = Math.max(metrics.cacheReadTokens, tokens.cacheRead);
        metrics.cacheWriteTokens = Math.max(metrics.cacheWriteTokens, tokens.cacheWrite);
        metrics.totalTokens = Math.max(metrics.totalTokens, tokens.total);
        break;
      }
      case "tool_execution_start": {
        metrics.toolCallCount += 1;
        toolNames.add(event.toolName);
        break;
      }
      default:
        break;
    }
  }

  // Rounds also derivable from assistant turns when turn_end is absent.
  if (metrics.rounds === 0 && assistantTurns > 0) metrics.rounds = assistantTurns;
  metrics.toolNames = [...toolNames];
  return metrics;
}

/**
 * Load a persisted event stream and evaluate trajectory metrics.
 *
 * Prefers the run's append-only trajectory stream, then its document, then a
 * plain JSONL transcript (one event object per line). `parseTrajectory` refuses
 * anything that is not a trajectory record, so a transcript of bare events
 * falls through to the last form rather than folding into a run.
 */
export function evaluateTrajectoryFile(
  path: string,
): Effect.Effect<TrajectoryMetrics, TrajectoryEvalError> {
  return Effect.tryPromise({
    try: async () => {
      const stream = await readFile(path, "utf8").catch(() => undefined);
      const trajectory = parseTrajectory(stream);
      if (trajectory !== undefined) return evaluateTrajectory(trajectory.events as AgentEvent[]);
      // Not a run's trajectory at all. The plain forms below are the old
      // contract on the file the caller named.
      const raw = stream ?? "";
      const trimmed = raw.trim();
      if (trimmed === "") return ZERO_METRICS;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        // Multiple JSONL frames are not one valid JSON document; parse them
        // below as independent records.
        parsed = undefined;
      }
      if (Array.isArray(parsed)) {
        const events = parsed;
        return evaluateTrajectory(events as AgentEvent[]);
      }
      if (typeof parsed === "object" && parsed !== null) {
        const document = parsed as { events?: unknown; type?: unknown };
        if (Array.isArray(document.events)) {
          return evaluateTrajectory(document.events as AgentEvent[]);
        }
        if (typeof document.type === "string") {
          return evaluateTrajectory([parsed as AgentEvent]);
        }
        throw new Error("trajectory input must contain an events array");
      }
      // JSONL transcript: one event per line.
      const events = trimmed
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
          const event = JSON.parse(line) as unknown;
          if (
            typeof event !== "object"
            || event === null
            || Array.isArray(event)
            || typeof (event as { type?: unknown }).type !== "string"
          ) {
            throw new Error("JSONL event must be an object with a string type");
          }
          return event as AgentEvent;
        });
      return evaluateTrajectory(events);
    },
    catch: (cause) => new TrajectoryEvalError({
      path,
      message: cause instanceof Error ? cause.message : String(cause),
    }),
  });
}
