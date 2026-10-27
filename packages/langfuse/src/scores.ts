import type { WorkflowObservation } from "@piano/trajectory";
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

/** Map each accepted benchmark metric to a Langfuse numeric score.
 *
 * The score value is the metric's `best` — the number a tournament referee
 * already ranks by. Unit, direction, and the raw pointer stay in metadata so
 * a reader can join the score back to `eval-metrics/benchmark.jsonl`. */
export function mapAcceptedScores(
  observation: Extract<WorkflowObservation, { type: "stage_accepted" }>,
  traceId: string,
): readonly LangfuseScoreRequest[] {
  return observation.metrics.map(({ pointer, value }) => ({
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
      invocationId: observation.context.invocationId,
      stageId: observation.context.stageId,
      attempt: observation.context.attempt,
      ...(observation.context.iteration === undefined ? {} : { iteration: observation.context.iteration }),
    },
  }));
}

/** POST scores to the Langfuse public API. Best-effort: the caller swallows
 * every failure so a score gap never fails a run. */
export async function postLangfuseScores(
  config: LangfuseConfig,
  scores: readonly LangfuseScoreRequest[],
): Promise<void> {
  if (scores.length === 0) return;
  const auth = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64");
  await fetch(new URL("/api/public/scores", config.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(scores),
  });
}
