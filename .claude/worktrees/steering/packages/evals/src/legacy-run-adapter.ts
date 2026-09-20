import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent } from "@piano/harness";
import { evaluateTrajectory } from "./trajectory-evaluator.js";
import type { WorkflowBenchmarkPoint, WorkflowTrajectoryEvaluation } from "./workflow-evaluator.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function benchmarkEvidence(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const hasSamples = Array.isArray(value.samples) &&
    value.samples.every((sample) => typeof sample === "number" && Number.isFinite(sample));
  const hasSummary = typeof value.best === "number" && Number.isFinite(value.best) &&
    typeof value.median === "number" && Number.isFinite(value.median) &&
    typeof value.runs === "number" && Number.isInteger(value.runs) && value.runs >= 1 &&
    typeof value.warmup === "number" && Number.isInteger(value.warmup) && value.warmup >= 0;
  return typeof value.metric === "string" &&
    (value.direction === "higher" || value.direction === "lower") && hasSamples && hasSummary
    ? value
    : undefined;
}

function hasRootBenchmarkShape(value: Record<string, unknown>): boolean {
  return ["metric", "direction", "samples", "median", "runs", "warmup"]
    .some((key) => key in value);
}

function finiteSamples(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 &&
    value.every((sample) => typeof sample === "number" && Number.isFinite(sample));
}

function benchmarkFieldIssues(value: Record<string, unknown>, label: string): string[] {
  const issues: string[] = [];
  if ("best" in value && (typeof value.best !== "number" || !Number.isFinite(value.best))) {
    issues.push(`${label}.best is not a finite number`);
  }
  if ("samples" in value && !finiteSamples(value.samples)) {
    issues.push(`${label}.samples must be a non-empty array of finite numbers`);
  }
  if ("direction" in value && value.direction !== "higher" && value.direction !== "lower") {
    issues.push(`${label}.direction must be "higher" or "lower"`);
  }
  if ("name" in value && typeof value.name !== "string") {
    issues.push(`${label}.name must be a string`);
  }
  if ("metric" in value && typeof value.metric !== "string") {
    issues.push(`${label}.metric must be a string`);
  }
  return issues;
}

interface LegacyRecords {
  readonly records: readonly Record<string, unknown>[];
  readonly issues: readonly string[];
}

interface LegacyEvents {
  readonly events: readonly AgentEvent[];
  readonly issues: readonly string[];
}

interface LegacyDuration {
  readonly score: WorkflowTrajectoryEvaluation["duration"];
  readonly issues: readonly string[];
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function progressRecords(runDir: string): LegacyRecords {
  const path = join(runDir, "progress.jsonl");
  if (!existsSync(path)) return { records: [], issues: [] };
  const records: Record<string, unknown>[] = [];
  const issues: string[] = [];
  try {
    for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
      if (line.trim() === "") continue;
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch (cause) {
        issues.push(`progress.jsonl line ${index + 1} is not JSON: ${errorMessage(cause)}`);
        continue;
      }
      if (!isRecord(value)) {
        issues.push(`progress.jsonl line ${index + 1} is not an object`);
        continue;
      }
      records.push(value);
    }
  } catch (cause) {
    issues.push(`progress.jsonl could not be read: ${errorMessage(cause)}`);
  }
  return { records, issues };
}

function legacyEvents(runDir: string): LegacyEvents {
  const path = join(runDir, "trajectory.json");
  if (!existsSync(path)) return { events: [], issues: [] };
  const events: AgentEvent[] = [];
  const issues: string[] = [];
  try {
    const document = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const rawEvents = Array.isArray(document)
      ? document
      : isRecord(document) && Array.isArray(document.events)
        ? document.events
        : undefined;
    if (rawEvents === undefined) {
      issues.push("trajectory.json must contain an events array");
      return { events, issues };
    }
    for (const [index, value] of rawEvents.entries()) {
      if (!isRecord(value)) {
        issues.push(`trajectory.json event ${index + 1} is not an object`);
        continue;
      }
      if (typeof value.type !== "string" || value.type.length === 0) {
        issues.push(`trajectory.json event ${index + 1} must have a string type`);
        continue;
      }
      // Keep the adapter's structural boundary explicit. These are the fields
      // evaluateTrajectory reads for the corresponding event types; malformed
      // known events are reported instead of being allowed to throw later.
      if (value.type === "message_end" && !isRecord(value.message)) {
        issues.push(`trajectory.json event ${index + 1} message_end has no object message`);
        continue;
      }
      if (value.type === "usage" && !isRecord(value.usage)) {
        issues.push(`trajectory.json event ${index + 1} usage has no object usage`);
        continue;
      }
      if (value.type === "tool_execution_start" && typeof value.toolName !== "string") {
        issues.push(`trajectory.json event ${index + 1} tool_execution_start has no string toolName`);
        continue;
      }
      if (value.type === "tool_execution_end" && typeof value.isError !== "boolean") {
        issues.push(`trajectory.json event ${index + 1} tool_execution_end has no boolean isError`);
        continue;
      }
      events.push(value as AgentEvent);
    }
  } catch (cause) {
    issues.push(`trajectory.json could not be read: ${errorMessage(cause)}`);
  }
  return { events, issues };
}

function legacyDuration(runDir: string): LegacyDuration {
  const started = new Map<string, number>();
  const durations: number[] = [];
  const issues: string[] = [];
  const path = join(runDir, "log.jsonl");
  if (!existsSync(path)) {
    return { score: { count: 0, totalMs: 0, maxMs: 0 }, issues };
  }
  try {
    for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
      if (line.trim() === "") continue;
      let record: unknown;
      try {
        record = JSON.parse(line) as unknown;
      } catch (cause) {
        issues.push(`log.jsonl line ${index + 1} is not JSON: ${errorMessage(cause)}`);
        continue;
      }
      if (!isRecord(record)) {
        issues.push(`log.jsonl line ${index + 1} is not an object`);
        continue;
      }
      if (typeof record.event !== "string" || typeof record.timestamp !== "string") {
        issues.push(`log.jsonl line ${index + 1} is missing event or timestamp`);
        continue;
      }
      const attributes = isRecord(record.attributes)
        ? record.attributes
        : isRecord(record.data) ? record.data : undefined;
      const id = typeof attributes?.id === "string" ? attributes.id : undefined;
      const timestamp = Date.parse(record.timestamp);
      if (!Number.isFinite(timestamp)) {
        issues.push(`log.jsonl line ${index + 1} has an invalid timestamp`);
        continue;
      }
      if (record.event.startsWith("stage.") && id === undefined) {
        issues.push(`log.jsonl line ${index + 1} stage event has no string attributes.id`);
        continue;
      }
      if (id === undefined) continue;
      if (record.event === "stage.started") started.set(id, timestamp);
      if (record.event === "stage.completed" || record.event === "stage.failed" || record.event === "stage.cancelled") {
        const beginning = started.get(id);
        if (beginning !== undefined) durations.push(Math.max(0, timestamp - beginning));
        started.delete(id);
      }
    }
  } catch (cause) {
    issues.push(`log.jsonl could not be read: ${errorMessage(cause)}`);
  }
  return {
    score: {
      count: durations.length,
      totalMs: durations.reduce((sum, duration) => sum + duration, 0),
      maxMs: durations.length === 0 ? 0 : Math.max(...durations),
    },
    issues,
  };
}

/** The only compatibility boundary allowed to understand historical worker
 * payload conventions. New trajectory evaluation never calls this when a v1
 * trajectory index exists. */
export function evaluateLegacyRun(runDir: string): WorkflowTrajectoryEvaluation {
  const points: WorkflowBenchmarkPoint[] = [];
  const progress = progressRecords(runDir);
  const benchmarkIssues: string[] = [];
  for (const record of progress.records) {
    const payload = isRecord(record.resultPayload) ? record.resultPayload : undefined;
    const nested = payload?.benchmark;
    const nestedBenchmark = isRecord(nested) ? nested : undefined;
    if (nested !== undefined && nestedBenchmark === undefined) {
      benchmarkIssues.push("progress resultPayload.benchmark must be an object");
    }
    if (nestedBenchmark !== undefined) {
      benchmarkIssues.push(...benchmarkFieldIssues(nestedBenchmark, "progress resultPayload.benchmark"));
    }
    const rootBenchmark = payload !== undefined && nestedBenchmark === undefined && hasRootBenchmarkShape(payload)
      ? benchmarkEvidence(payload)
      : undefined;
    if (rootBenchmark === undefined && payload !== undefined && nestedBenchmark === undefined && hasRootBenchmarkShape(payload)) {
      benchmarkIssues.push("progress resultPayload is malformed benchmark evidence");
    }
    const benchmark = nestedBenchmark ?? rootBenchmark;
    const value = benchmark?.best;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const name = typeof benchmark?.name === "string"
      ? benchmark.name
      : typeof benchmark?.metric === "string"
        ? benchmark.metric
        : "benchmark";
    const decision = typeof payload?.decision === "string" ? payload.decision : undefined;
    points.push({
      name,
      ...(typeof benchmark?.unit === "string" ? { unit: benchmark.unit } : {}),
      direction: benchmark?.direction === "lower" ? "lower" : "higher",
      value,
      ...(Array.isArray(benchmark?.samples) && benchmark.samples.every((sample) => typeof sample === "number" && Number.isFinite(sample))
        ? { samples: benchmark.samples as number[] }
        : {}),
      ...(typeof record.iteration === "number" ? { iteration: record.iteration } : {}),
      ...(typeof record.invocationId === "string" ? { invocationId: record.invocationId } : {}),
      accepted: decision === undefined || decision === "KEEP" || decision === "DISCARD",
    });
  }
  const legacyTrajectory = legacyEvents(runDir);
  const duration = legacyDuration(runDir);
  let trajectory: ReturnType<typeof evaluateTrajectory>;
  const issues = [
    "run has no trajectories/index.json; evidence was reconstructed through LegacyRunAdapter",
    ...progress.issues,
    ...legacyTrajectory.issues,
    ...benchmarkIssues,
    ...duration.issues,
  ];
  try {
    trajectory = evaluateTrajectory(legacyTrajectory.events);
  } catch (cause) {
    issues.push(`trajectory.json could not be evaluated: ${errorMessage(cause)}`);
    trajectory = evaluateTrajectory([]);
  }
  const events = legacyTrajectory.events;
  const toolFailures = events.filter((event) => event.type === "tool_execution_end" && event.isError).length;
  return {
    source: "legacy",
    complete: false,
    issues,
    benchmarks: points,
    duration: duration.score,
    tokens: {
      count: trajectory.totalTokens === 0 ? 0 : 1,
      input: trajectory.inputTokens,
      output: trajectory.outputTokens,
      cacheRead: trajectory.cacheReadTokens,
      cacheWrite: trajectory.cacheWriteTokens,
      total: trajectory.totalTokens,
    },
    tools: {
      count: trajectory.toolCallCount,
      failures: toolFailures,
      names: trajectory.toolNames,
      totalDurationMs: 0,
    },
  };
}
