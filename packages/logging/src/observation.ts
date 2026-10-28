import { asRecord, parseJsonRecord } from "./jsonl.js";

/** The Langfuse-aligned observation contract: what a harness emits, what the
 * evidence stream appends, and what the chat area and the Langfuse export both
 * read.
 *
 * One op is one append-only fact on a handle. `start`/`update`/`end` describe a
 * span; `emit` is a born-closed point (an event or a finished generation) so
 * consumers never infer "closed" from the type name. Folds of the op stream
 * produce the observation tree; a crash leaves a started-but-never-ended node,
 * the same evidence shape a stage attempt has today.
 *
 * `AgentEvent` stays the harness dialect's current output — this is the
 * vocabulary it is being moved onto, not a replacement that deletes it. */

export const OBSERVATION_TYPES = ["agent", "tool", "generation", "span", "event"] as const;
export type ObservationType = (typeof OBSERVATION_TYPES)[number];

/** The kinds `emit` may open: a point fact, never a span. */
export const EMIT_OBSERVATION_TYPES = ["event", "generation"] as const;
export type EmitObservationType = (typeof EMIT_OBSERVATION_TYPES)[number];

export type ObservationLevel = "DEFAULT" | "WARNING" | "ERROR";

interface ObservationOpBase {
  readonly version: 1;
  readonly timestamp: string;
  readonly handle: string;
  readonly metadata?: Record<string, unknown>;
}

/** Fields an `update`/`end`/`emit` may carry onto its node. */
interface ObservationCloseFields {
  readonly output?: unknown;
  readonly level?: ObservationLevel;
  readonly statusMessage?: string;
  readonly usageDetails?: Record<string, number>;
}

export type ObservationOp =
  | (ObservationOpBase & {
    readonly op: "start";
    readonly type: ObservationType;
    readonly name: string;
    readonly parent?: string;
    readonly input?: unknown;
    readonly model?: string;
  })
  | (ObservationOpBase & ObservationCloseFields & { readonly op: "update" })
  | (ObservationOpBase & ObservationCloseFields & { readonly op: "end" })
  | (ObservationOpBase & ObservationCloseFields & {
    readonly op: "emit";
    readonly type: EmitObservationType;
    readonly name: string;
    readonly parent?: string;
    readonly input?: unknown;
    readonly model?: string;
  });

/** One node of the folded tree. `endTime` absent means the op stream never
 * closed it — a fact about the evidence, not a failure. An `emit` opens and
 * closes in one op, so its `endTime` equals its `startTime`. */
export interface ObservationNode {
  readonly handle: string;
  readonly type: ObservationType;
  readonly name: string;
  readonly startTime: string;
  readonly endTime?: string;
  readonly parent?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly model?: string;
  readonly usageDetails?: Record<string, number>;
  readonly level?: ObservationLevel;
  readonly statusMessage?: string;
  readonly metadata: Record<string, unknown>;
  readonly children: ObservationNode[];
}

function isObservationType(value: unknown): value is ObservationType {
  return typeof value === "string" && (OBSERVATION_TYPES as readonly string[]).includes(value);
}

function isEmitObservationType(value: unknown): value is EmitObservationType {
  return typeof value === "string" && (EMIT_OBSERVATION_TYPES as readonly string[]).includes(value);
}

function isObservationLevel(value: unknown): value is ObservationLevel {
  return value === "DEFAULT" || value === "WARNING" || value === "ERROR";
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function closeFields(record: Record<string, unknown>): ObservationCloseFields {
  const level = record.level;
  const statusMessage = stringField(record, "statusMessage");
  const usageDetails = asRecord(record.usageDetails);
  return {
    ...(record.output === undefined ? {} : { output: record.output }),
    ...(isObservationLevel(level) ? { level } : {}),
    ...(statusMessage === undefined ? {} : { statusMessage }),
    ...(usageDetails === undefined ? {} : { usageDetails: usageDetails as Record<string, number> }),
  };
}

/** Parse one JSONL line into an op, or `undefined` for a blank, torn, or
 * shapeless line. */
export function parseObservationOp(line: string): ObservationOp | undefined {
  const record = parseJsonRecord(line);
  if (record === undefined) return undefined;
  const timestamp = stringField(record, "timestamp");
  const handle = stringField(record, "handle");
  const op = record.op;
  if (record.version !== 1 || timestamp === undefined || handle === undefined) return undefined;
  const metadata = asRecord(record.metadata);
  const base = {
    version: 1 as const,
    timestamp,
    handle,
    ...(metadata === undefined ? {} : { metadata }),
  };

  if (op === "start") {
    const type = record.type;
    const name = stringField(record, "name");
    if (!isObservationType(type) || name === undefined) return undefined;
    const parent = stringField(record, "parent");
    const model = stringField(record, "model");
    return {
      ...base,
      op,
      type,
      name,
      ...(parent === undefined ? {} : { parent }),
      ...(record.input === undefined ? {} : { input: record.input }),
      ...(model === undefined ? {} : { model }),
    };
  }

  if (op === "emit") {
    const type = record.type;
    const name = stringField(record, "name");
    if (!isEmitObservationType(type) || name === undefined) return undefined;
    const parent = stringField(record, "parent");
    const model = stringField(record, "model");
    return {
      ...base,
      op,
      type,
      name,
      ...(parent === undefined ? {} : { parent }),
      ...(record.input === undefined ? {} : { input: record.input }),
      ...(model === undefined ? {} : { model }),
      ...closeFields(record),
    };
  }

  if (op !== "update" && op !== "end") return undefined;
  return { ...base, op, ...closeFields(record) };
}

export function stringifyObservationOp(op: ObservationOp): string {
  return JSON.stringify(op);
}

/** Identity constructors. Handles are part of the vocabulary: every mapper
 * builds the same `attempt:` / `tool:` names, so a child can always find its
 * parent across streams and packages. */
export function attemptHandle(
  context: { readonly invocationId: string; readonly attempt: number },
): string {
  return `attempt:${context.invocationId}:${context.attempt}`;
}

export function toolHandle(toolCallId: string): string {
  return `tool:${toolCallId}`;
}

/** The inverse of `toolHandle`: the tool call id behind a tool handle, or
 * `undefined` when the handle names something else. */
export function toolCallIdFromHandle(handle: string): string | undefined {
  return handle.startsWith("tool:") ? handle.slice("tool:".length) : undefined;
}

/** Emit names every mapper and reader shares. A rename lands in one place. */
export function messageName(role: string): string {
  return `${role}.message`;
}

export const AGENT_ERROR_NAME = "agent.error";
export const AGENT_DONE_NAME = "agent.done";
export const STAGE_ACCEPTED_NAME = "stage.accepted";
export const SELECTION_NAME = "selection";

/** A sink receives already-mapped ops. Sinks never translate — the mappers do
 * that once — so several sinks can share one production point without each
 * re-deriving the vocabulary. */
export type ObservationOpSink = (ops: readonly ObservationOp[]) => void;

export function fanoutObservationOps(
  sinks: readonly ObservationOpSink[],
): ObservationOpSink {
  return (ops) => {
    for (const sink of sinks) sink(ops);
  };
}

/** Append ops to one JSONL stream. Best-effort by construction: a write gap is
 * an evidence gap, never a run failure. */
export function observationStreamSink(
  append: (lines: string) => void,
): ObservationOpSink {
  return (ops) => {
    if (ops.length === 0) return;
    append(ops.map((op) => `${stringifyObservationOp(op)}\n`).join(""));
  };
}

/** Every op in one JSONL stream, dropping the lines the line codec rejects. */
export function parseObservationOps(raw: string | undefined): readonly ObservationOp[] {
  const ops: ObservationOp[] = [];
  for (const line of (raw ?? "").split("\n")) {
    const op = parseObservationOp(line);
    if (op !== undefined) ops.push(op);
  }
  return ops;
}

/** `foldObservationOps ∘ parseObservationOps` — the whole-stream entry point
 * every observation-stream reader shares, matching `parseTrajectory`. */
export function foldObservationStream(raw: string | undefined): ObservationNode[] {
  return foldObservationOps(parseObservationOps(raw));
}

function closeNodeFields(
  op: Extract<ObservationOp, { op: "update" | "end" | "emit" }>,
): Partial<ObservationNode> {
  return {
    ...(op.output === undefined ? {} : { output: op.output }),
    ...(op.level === undefined ? {} : { level: op.level }),
    ...(op.statusMessage === undefined ? {} : { statusMessage: op.statusMessage }),
    ...(op.usageDetails === undefined ? {} : { usageDetails: op.usageDetails }),
  };
}

/** Fold an op stream into the forest of observation trees.
 *
 * Order is the stream's: an `update`/`end` for a handle not yet opened is
 * dropped (the evidence cannot name a parent that never opened), and a second
 * `start` on the same handle is dropped (the handle is the identity; the first
 * open is the fact). Children are linked after every op has been applied, so a
 * later `update` cannot leave a stale node under its parent. */
export function foldObservationOps(ops: readonly ObservationOp[]): ObservationNode[] {
  const nodes = new Map<string, ObservationNode>();
  for (const op of ops) {
    if (op.op === "start") {
      if (nodes.has(op.handle)) continue;
      nodes.set(op.handle, {
        handle: op.handle,
        type: op.type,
        name: op.name,
        startTime: op.timestamp,
        ...(op.parent === undefined ? {} : { parent: op.parent }),
        ...(op.input === undefined ? {} : { input: op.input }),
        ...(op.model === undefined ? {} : { model: op.model }),
        metadata: { ...(op.metadata ?? {}) },
        children: [],
      });
      continue;
    }
    if (op.op === "emit") {
      if (nodes.has(op.handle)) continue;
      nodes.set(op.handle, {
        handle: op.handle,
        type: op.type,
        name: op.name,
        startTime: op.timestamp,
        endTime: op.timestamp,
        ...(op.parent === undefined ? {} : { parent: op.parent }),
        ...(op.input === undefined ? {} : { input: op.input }),
        ...(op.model === undefined ? {} : { model: op.model }),
        metadata: { ...(op.metadata ?? {}) },
        children: [],
        ...closeNodeFields(op),
      });
      continue;
    }
    const node = nodes.get(op.handle);
    if (node === undefined) continue;
    nodes.set(op.handle, {
      ...node,
      ...closeNodeFields(op),
      metadata: { ...node.metadata, ...(op.metadata ?? {}) },
      ...(op.op === "end" ? { endTime: op.timestamp } : {}),
    });
  }

  const roots: ObservationNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent === undefined ? undefined : nodes.get(node.parent);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  return roots;
}
