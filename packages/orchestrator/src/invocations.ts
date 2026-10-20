/**
 * The run's invocation evidence stream: `system-log/invocations.jsonl`.
 *
 * One NDJSON row per invocation event the orchestrator records — an
 * invocation's `invocation-started` allocation and an accepted attempt's
 * `invocation-accepted` producer evidence. The stream is the metadata home the
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

/** The envelope every invocation row carries: which run, which job, which
 * invocation, and the flat `inv-<serial>` name its evidence paths use. */
const invocationRowEnvelope = {
  version: z.literal(1),
  timestamp: z.string().min(1),
  runId: z.string().min(1),
  jobOrdinal: z.number().int().positive(),
  ref: z.string().min(1),
  invocationId: z.string().min(1),
  stageId: z.string().min(1),
};

/** The allocation record of one invocation's evidence paths: the first
 * `invocation-started` row for a (job, invocation) pair fixes its `ref`, and
 * every later attempt of that invocation reuses it. */
const invocationStartedObject = z.object({
  ...invocationRowEnvelope,
  kind: z.literal("invocation-started"),
});

const invocationAcceptedObject = z.object({
  ...invocationRowEnvelope,
  kind: z.literal("invocation-accepted"),
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

/** One invocation's allocation row: the `ref` its evidence paths use. */
export type InvocationStartedRecord = z.infer<typeof invocationStartedObject>;

/** One row of the run's invocation stream. */
export type InvocationRecord = InvocationStartedRecord | InvocationAcceptedRecord;

/** Write side: no undeclared top-level field may reach the stream. */
const invocationWriteSchema = z.union([
  invocationStartedObject.strict(),
  invocationAcceptedObject.strict(),
]);

/** Read side: a row from a newer build keeps its extra fields instead of
 * being discarded — unknown kinds and shapes drop below, not whole runs. */
const invocationReadSchema = z.union([
  invocationStartedObject.passthrough(),
  invocationAcceptedObject.passthrough(),
]);

export function invocationStreamPath(runDir: string): string {
  return join(runDir, "system-log", "invocations.jsonl");
}

/** The agent-written validation result of one attempt, flat under `results/`.
 * The `inv-<serial>` name is the invocation's evidence name, so a reader who
 * has the stream never walks a dotted stage id and a slash-joined instance. */
export function invocationResultPath(runDir: string, ref: string, attempt: number): string {
  return join(runDir, "results", `${ref}-attempt-${attempt}.json`);
}

/** The directory of orchestrator-written context files injected into one
 * invocation (handoff payloads, map item), flat under `context/`. */
export function invocationContextDir(runDir: string, ref: string): string {
  return join(runDir, "context", ref);
}

/** Append one record to the run's invocation stream. A row its schema refuses
 * is a writer bug and fails the write — evidence that does not fit its
 * contract must not land half-understood. */
export function appendInvocationRecord(
  runDir: string,
  record: InvocationRecord,
): Effect.Effect<void, WorkflowError, FileSystem.FileSystem> {
  const path = invocationStreamPath(runDir);
  return Effect.gen(function* () {
    const line = yield* Effect.try({
      try: () => `${JSON.stringify(invocationWriteSchema.parse(record))}\n`,
      catch: (cause) => workflowError("schedule", path, `invocation record rejected: ${errorMessage(cause)}`),
    });
    const fileSystem = yield* FileSystem.FileSystem;
    yield* appendJsonlLine(fileSystem, path, line, (step, cause) =>
      workflowError("schedule", path, `${step}: ${errorMessage(cause)}`));
  });
}

/** The stream's rows this build understands, oldest first. Blank, torn,
 * shapeless and unknown rows drop: one bad line must not take a reader away
 * from the evidence that is there. */
export function parseInvocationRecords(raw: string | undefined): readonly InvocationRecord[] {
  const rows: InvocationRecord[] = [];
  for (const record of parseRunStreamLines<unknown>(raw)) {
    const parsed = invocationReadSchema.safeParse(record);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

/** The flat evidence name of one invocation: `inv-<serial>`, a run-wide
 * serial. The first start of a (job, invocation) pair allocates it and records
 * it on the stream, so every later attempt and every rebuild reuse the same
 * paths, and a `/restart`'s new job gets its own name instead of overwriting
 * the abandoned one's files. */
export function recordInvocationStart(
  runDir: string,
  identity: {
    readonly runId: string;
    readonly jobOrdinal: number;
    readonly invocationId: string;
    readonly stageId: string;
    readonly attempt?: number;
  },
): Effect.Effect<string, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const raw = yield* fileSystem.readFileString(invocationStreamPath(runDir)).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    const rows = parseInvocationRecords(raw);
    const prior = rows.find((row) =>
      row.jobOrdinal === identity.jobOrdinal && row.invocationId === identity.invocationId);
    if (prior !== undefined) return prior.ref;
    const ref = nextInvocationRef(rows);
    yield* appendInvocationRecord(runDir, {
      version: 1,
      kind: "invocation-started",
      timestamp: new Date().toISOString(),
      runId: identity.runId,
      jobOrdinal: identity.jobOrdinal,
      ref,
      invocationId: identity.invocationId,
      stageId: identity.stageId,
      ...(identity.attempt === undefined ? {} : { attempt: identity.attempt }),
    });
    return ref;
  });
}

/** One past the highest serial the stream already names, as the next
 * `inv-<serial>`. */
function nextInvocationRef(rows: readonly InvocationRecord[]): string {
  const highest = rows.reduce((max, row) => {
    const serial = /^inv-(\d+)$/.exec(row.ref)?.[1];
    return serial === undefined ? max : Math.max(max, Number(serial));
  }, 0);
  return `inv-${String(highest + 1).padStart(4, "0")}`;
}
