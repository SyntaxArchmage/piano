import { z } from "zod";

const context = {
  version: z.literal(1),
  timestamp: z.string().datetime(),
  runId: z.string().min(1),
  invocationId: z.string().min(1),
  stageId: z.string().min(1),
  stage: z.string().min(1),
  worker: z.string().min(1),
  attempt: z.number().int().safe().min(1),
  iteration: z.number().int().safe().min(0).optional(),
  instanceId: z.string().min(1).optional(),
  mapSlot: z.number().int().safe().min(0).optional(),
  actorKey: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  transcriptPath: z.string().min(1).optional(),
};

const tokenUsageSchema = z.object({
  input: z.number().finite().min(0),
  output: z.number().finite().min(0),
  cacheRead: z.number().finite().min(0),
  cacheWrite: z.number().finite().min(0),
  total: z.number().finite().min(0),
}).strict();

const benchmarkMetricSchema = z.object({
  protocol: z.literal("benchmark/v1"),
  name: z.string().min(1),
  unit: z.string().min(1),
  direction: z.enum(["higher", "lower"]),
  samples: z.array(z.number().finite()).min(1),
  best: z.number().finite(),
  median: z.number().finite(),
  runs: z.number().int().safe().min(1),
  warmup: z.number().int().safe().min(0),
  rawPath: z.string().min(1).optional(),
}).strict();

const contractReferenceSchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  snapshotPath: z.string().min(1),
}).strict();

export const benchmarkRecordSchema = z.object({
  ...context,
  kind: z.literal("benchmark"),
  metric: benchmarkMetricSchema,
  pointer: z.string(),
  contract: contractReferenceSchema,
}).strict();

export const durationRecordSchema = z.object({
  ...context,
  kind: z.literal("duration"),
  outcome: z.enum(["accepted", "validation_failed", "signoff_rejected", "failed", "cancelled"]),
  durationMs: z.number().finite().min(0),
}).strict();

export const tokenUsageRecordSchema = z.object({
  ...context,
  kind: z.literal("token_usage"),
  reported: tokenUsageSchema,
  delta: tokenUsageSchema,
  reset: z.boolean(),
  outcome: z.enum(["accepted", "validation_failed", "signoff_rejected", "failed", "cancelled"]),
}).strict();

export const toolCallRecordSchema = z.object({
  ...context,
  kind: z.literal("tool_call"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  durationMs: z.number().finite().min(0).optional(),
}).strict();

const selectionRefereeSchema = z.object({
  name: z.string().min(1),
  unit: z.string().min(1),
  direction: z.enum(["higher", "lower"]),
}).strict();

export const selectionCarryingSchema = z.object({
  kind: z.enum(["git-merged", "worker-consolidated", "admitted-not-carried", "carry-failed"]),
  commit: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  sourceState: z.enum(["known", "unknown"]).optional(),
  externalEvidenceRoot: z.string().min(1).optional(),
}).strict();

/** Selection observations are region-level, not tied to one stage attempt, so
 * they carry their own context rather than the per-attempt TrajectoryRecordContext. */
export const selectionRecordSchema = z.object({
  type: z.literal("selection"),
  runId: z.string().min(1),
  timestamp: z.string().datetime(),
  referee: selectionRefereeSchema.optional(),
  outcome: z.enum(["merged", "no-winner", "metricless", "carried"]),
  winnerKey: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  skipped: z.string().min(1).optional(),
  carrying: selectionCarryingSchema.optional(),
}).strict();

