/**
 * The run's invocation evidence stream: `system-log/invocations.jsonl`.
 *
 * One NDJSON row per invocation event the orchestrator records — an accepted
 * attempt's producer evidence first. The stream is the metadata home the
 * per-invocation `handoff/record.json` documents used to be: append-only
 * evidence, validated on write by the schemas here and read back tolerantly
 * (a torn or unknown row drops, the same contract every run stream keeps).
 *
 * It is evidence, not state: nothing here folds `status.json`, and the state
 * document answers "how is this run doing" alone.
 */

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import { join } from "node:path";
import { appendJsonlLine, parseRunStreamLines } from "@piano/logging";
import { z } from "zod";
import type { ContractMetric, ContractProjection } from "@piano/contract";
import { errorMessage, workflowError, type WorkflowError } from "./errors.js";
import type { WorkflowWorkspaceBinding } from "./workspace.js";

const workspaceBindingSchema = z.custom<WorkflowWorkspaceBinding>(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value),
);

const metricListSchema = z.custom<readonly ContractMetric[]>((value) => Array.isArray(value));
const projectionListSchema = z.custom<readonly ContractProjection[]>((value) => Array.isArray(value));

const contractReferenceSchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
  digest: z.string().min(1),
  snapshotPath: z.string().min(1),
});

const resultReferenceSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().startsWith("sha256:"),
  trust: z.enum(["worker", "orchestrator-materialized"]),
});

const invocationAcceptedObject = z.object({
  version: z.literal(1),
  kind: z.literal("invocation-accepted"),
  timestamp: z.string().min(1),
  runId: z.string().min(1),
  jobOrdinal: z.number().int().positive(),
  invocationId: z.string().min(1),
  stageId: z.string().min(1),
  stage: z.string().min(1),
  worker: z.string().min(1),
  instanceId: z.string().min(1).optional(),
  attempt: z.number().int().positive().optional(),
  actorKey: z.string().min(1).optional(),
  sessionId: z.string().min(1),
  transcriptPath: z.string().min(1),
  text: z.string(),
  workspace: workspaceBindingSchema,
  resultPath: z.string().min(1).optional(),
  result: resultReferenceSchema.optional(),
  metrics: metricListSchema.optional(),
  projections: projectionListSchema.optional(),
  contract: contractReferenceSchema.optional(),
  requestedModel: z.string().optional(),
  requestedThinkingLevel: z.string().optional(),
  model: z.string().optional(),
  thinkingLevel: z.string().optional(),
});

/** One accepted attempt's row. The `result` pin is the payload's only claim:
 * the payload itself stays in its result file, verified by `sha256`, so the
 * stream never holds a second or third copy of a worker's JSON. */
export type InvocationAcceptedRecord = z.infer<typeof invocationAcceptedObject>;

/** Write side: no undeclared top-level field may reach the stream. */
const invocationWriteSchema = invocationAcceptedObject.strict();

/** Read side: a row from a newer build keeps its extra fields instead of
 * being discarded — unknown kinds and shapes drop below, not whole runs. */
const invocationReadSchema = invocationAcceptedObject.passthrough();

export function invocationStreamPath(runDir: string): string {
  return join(runDir, "system-log", "invocations.jsonl");
}

/** Append one record to the run's invocation stream, after its schema has
 * passed. A row that does not match is a writer bug and fails the write —
 * evidence that does not fit its contract must not land half-understood. */
export function appendInvocationRecord(
  runDir: string,
  record: InvocationAcceptedRecord,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  const path = invocationStreamPath(runDir);
  return Effect.gen(function* () {
    const parsed = invocationWriteSchema.safeParse(record);
    if (!parsed.success) {
      return yield* Effect.fail(workflowError(
        "schedule",
        path,
        `invocation record does not match its schema: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ")}`,
      ));
    }
    const line = yield* Effect.try({
      try: () => `${JSON.stringify(parsed.data)}\n`,
      catch: (cause) => workflowError("schedule", path, `serialize: ${errorMessage(cause)}`),
    });
    const fileSystem = yield* FileSystem.FileSystem;
    yield* appendJsonlLine(fileSystem, path, line, (step, cause) =>
      workflowError("schedule", path, `${step}: ${errorMessage(cause)}`));
  });
}

/** The stream's accepted rows this build understands, oldest first. Blank,
 * torn, shapeless and unknown rows drop: one bad line must not take a reader
 * away from the evidence that is there. */
export function parseInvocationRecords(raw: string | undefined): readonly InvocationAcceptedRecord[] {
  const rows: InvocationAcceptedRecord[] = [];
  for (const record of parseRunStreamLines<unknown>(raw)) {
    const parsed = invocationReadSchema.safeParse(record);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}
