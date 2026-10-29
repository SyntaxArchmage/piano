import type { WorkflowObservation } from "@piano/trajectory";
import { asRecord, metadataNumber, metadataString, type ObservationOp } from "@piano/logging";
import type { LangfuseConfig } from "./config.js";

/** One Langfuse score derived from an accepted stage metric. */
export interface LangfuseScoreRequest {
  readonly traceId: string;
  readonly name: string;
  readonly value: number;
  readonly dataType: "NUMERIC";
  readonly comment?: string;
  readonly metadata: Record<string, unknown>;
}

/** The metric slice an accepted stage carries: a pointer into the worker
 * payload plus the validated `benchmark/v1` value behind it. Named by the
 * producing observation so the two cannot drift. */
export type AcceptedMetric =
  Extract<WorkflowObservation, { type: "stage_accepted" }>["metrics"][number];

/** Decode one entry of a `stage.accepted` metric list. The op stream is
 * evidence, so a malformed entry is skipped rather than thrown on — one bad
 * metric must not cost the rest of the batch. */
function acceptedMetric(value: unknown): AcceptedMetric | undefined {
  const record = asRecord(value);
  const metric = asRecord(record?.value);
  if (record === undefined || metric === undefined) return undefined;
  const pointer = record.pointer;
  const { name, unit, direction, best, median, runs, warmup, samples } = metric;
  if (
    typeof pointer !== "string" ||
    typeof name !== "string" || typeof unit !== "string" ||
    (direction !== "higher" && direction !== "lower") ||
    typeof best !== "number" || typeof median !== "number" ||
    typeof runs !== "number" || typeof warmup !== "number"
  ) return undefined;
  return {
    pointer,
    value: {
      protocol: "benchmark/v1",
      name,
      unit,
      direction,
      samples: Array.isArray(samples) ? samples as number[] : [],
      best,
      median,
      runs,
      warmup,
    },
  };
}

/** The identity a score carries so a reader can join it back to the run. */
export function scoreIdentity(source: {
  readonly invocationId?: string | undefined;
  readonly stageId?: string | undefined;
  readonly attempt?: number | undefined;
  readonly iteration?: number | undefined;
}): Record<string, unknown> {
  return {
    ...(source.invocationId === undefined ? {} : { invocationId: source.invocationId }),
    ...(source.stageId === undefined ? {} : { stageId: source.stageId }),
    ...(source.attempt === undefined ? {} : { attempt: source.attempt }),
    ...(source.iteration === undefined ? {} : { iteration: source.iteration }),
  };
}

/** The facts one `stage.accepted` op carries, read once: the metrics to score,
 * and the identity a reader joins the score back to the run by. */
export function stageAcceptedFacts(op: ObservationOp): {
  readonly metrics: readonly unknown[];
  readonly identity: Record<string, unknown>;
} {
  const metrics = op.metadata?.metrics;
  return {
    metrics: Array.isArray(metrics) ? metrics : [],
    identity: scoreIdentity({
      invocationId: metadataString(op, "invocationId"),
      stageId: metadataString(op, "stageId"),
      attempt: metadataNumber(op, "attempt"),
      iteration: metadataNumber(op, "iteration"),
    }),
  };
}

/** Map each accepted benchmark metric to a Langfuse numeric score.
 *
 * The score value is the metric's `best` — the number a tournament referee
 * already ranks by. Unit, direction, and the raw pointer stay in metadata so
 * a reader can join the score back to `eval-metrics/benchmark.jsonl`.
 * Entries that do not decode as a metric are dropped. */
export function mapAcceptedScoresFromMetrics(
  metrics: readonly unknown[],
  traceId: string,
  identity: Record<string, unknown> = {},
): readonly LangfuseScoreRequest[] {
  const scores: LangfuseScoreRequest[] = [];
  for (const entry of metrics) {
    const metric = acceptedMetric(entry);
    if (metric === undefined) continue;
    const { pointer, value } = metric;
    scores.push({
      traceId,
      name: value.name,
      value: value.best,
      dataType: "NUMERIC" as const,
      comment: `best of ${value.runs} runs in ${value.unit} (${value.direction}-better)`,
      metadata: {
        pointer,
        unit: value.unit,
        direction: value.direction,
        median: value.median,
        runs: value.runs,
        warmup: value.warmup,
        ...identity,
      },
    });
  }
  return scores;
}

/** POST scores to the Langfuse public API. Best-effort: the caller swallows
 * every failure so a score gap never fails a run. */
export async function postLangfuseScores(
  config: LangfuseConfig,
  scores: readonly LangfuseScoreRequest[],
): Promise<void> {
  if (scores.length === 0) return;
  const auth = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64");
  // `new URL("/api/…", base)` drops a self-hosted path prefix (`https://host/
  // langfuse`). Join as text so the prefix the OTel exporter keeps is kept.
  await fetch(`${config.baseUrl.replace(/\/+$/, "")}/api/public/scores`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(scores),
  });
}
