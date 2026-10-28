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

/** Fields an `update`/`end`/`emit` may carry onto its node. `name` echoes the
 * open `start` so an incremental reader can project a row from the close
 * alone; the fold already knows the name and ignores it. */
interface ObservationCloseFields {
  readonly output?: unknown;
  readonly level?: ObservationLevel;
  readonly statusMessage?: string;
  readonly usageDetails?: Record<string, number>;
  readonly name?: string;
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
  const name = stringField(record, "name");
  return {
    ...base,
    op,
    ...(name === undefined ? {} : { name }),
    ...closeFields(record),
  };
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

/** The one shape a tool call's two ops wear, whichever producer emits them —
 * the workflow mapper for an attributed attempt, the bridge for a turn no
 * workflow observes. Callers add their own `parent` and metadata. */
export function toolCallStartOp(input: {
  readonly timestamp: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args?: unknown;
  readonly parent?: string;
  readonly metadata?: Record<string, unknown>;
}): ObservationOp {
  return {
    version: 1,
    timestamp: input.timestamp,
    handle: toolHandle(input.toolCallId),
    op: "start",
    type: "tool",
    name: input.toolName,
    ...(input.parent === undefined ? {} : { parent: input.parent }),
    ...(input.args === undefined ? {} : { input: input.args }),
    metadata: {
      ...(input.metadata ?? {}),
      toolCallId: input.toolCallId,
      toolName: input.toolName,
    },
  };
}

export function toolCallEndOp(input: {
  readonly timestamp: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly result?: unknown;
  readonly isError: boolean;
  readonly metadata?: Record<string, unknown>;
}): ObservationOp {
  return {
    version: 1,
    timestamp: input.timestamp,
    handle: toolHandle(input.toolCallId),
    op: "end",
    level: input.isError ? "ERROR" : "DEFAULT",
    ...(input.isError ? { statusMessage: "tool failed" } : {}),
    ...(input.result === undefined ? {} : { output: input.result }),
    metadata: {
      ...(input.metadata ?? {}),
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      isError: input.isError,
    },
  };
}

/** Emit names every mapper and reader shares. A rename lands in one place. */
export function messageName(role: string): string {
  return `${role}.message`;
}

export const AGENT_ERROR_NAME = "agent.error";
export const AGENT_DONE_NAME = "agent.done";
export const AGENT_USAGE_NAME = "agent.usage";
export const AGENT_CONTEXT_NAME = "agent.context";
export const AGENT_RETRY_NAME = "agent.retry";
/** An unattributed agent turn's span (the side agent). A workflow attempt's
 * span is named `stage.attempt:<stageId>` instead. */
export const AGENT_NAME = "agent";
export const STAGE_ACCEPTED_NAME = "stage.accepted";
export const SELECTION_NAME = "selection";

/** How many context files/skills a turn loaded (0 when absent). Path list
 * first, then the loaded file records. */
export function contextCounts(context: {
  readonly contextFiles?: readonly unknown[];
  readonly contextFilePaths?: readonly unknown[];
  readonly skills?: readonly unknown[];
}): { readonly files: number; readonly skills: number } {
  return {
    files: context.contextFilePaths?.length ?? context.contextFiles?.length ?? 0,
    skills: context.skills?.length ?? 0,
  };
}

/** The context facts one `agent.context` op carries. The key set is the
 * vocabulary: the producer writes these metadata keys, the reader asks for
 * them here, and neither side spells them twice. */
export interface ContextFacts {
  readonly systemPromptPath?: string;
  readonly files: number;
  readonly skills: number;
  readonly userMessageLength?: number;
}

/** Decode one `agent.context` op's facts. */
export function contextFacts(op: { readonly metadata?: Record<string, unknown> }): ContextFacts {
  const meta = op.metadata ?? {};
  const number = (key: string): number | undefined => {
    const value = meta[key];
    return typeof value === "number" ? value : undefined;
  };
  return {
    ...(typeof meta.systemPromptPath === "string" ? { systemPromptPath: meta.systemPromptPath } : {}),
    files: number("files") ?? 0,
    skills: number("skills") ?? 0,
    ...(number("userMessageLength") === undefined ? {} : { userMessageLength: number("userMessageLength") }),
  };
}

/** The one-line detail a `context` row shows. Shared by the `AgentEvent` and
 * the op path so the two ledgers cannot drift on wording. */
export function contextDetail(facts: ContextFacts): string {
  const parts: string[] = [];
  if (facts.systemPromptPath !== undefined) parts.push("sys prompt");
  if (facts.files > 0) parts.push(`${facts.files} file${facts.files === 1 ? "" : "s"}`);
  if (facts.skills > 0) parts.push(`${facts.skills} skill${facts.skills === 1 ? "" : "s"}`);
  if (facts.userMessageLength !== undefined) parts.push(`user ${facts.userMessageLength}ch`);
  return parts.join(" · ") || "loaded";
}

/** The payload a second `start` may add to a handle that is already open.
 *
 * Identity — `type`, `name`, `parent`, `metadata` — stays with the first open;
 * only the payload the first open may have lacked is refinnable. Every consumer
 * of an open handle asks this one function, so the field set cannot drift
 * between the fold, the export, and the ledger. */
export function startRefineFields(
  op: Extract<ObservationOp, { op: "start" | "emit" }>,
): { readonly input?: unknown; readonly model?: string } {
  return {
    ...(op.input === undefined ? {} : { input: op.input }),
    ...(op.model === undefined ? {} : { model: op.model }),
  };
}

/** A sink receives already-mapped ops. Sinks never translate — the mappers do
 * that once — so several sinks can share one production point without each
 * re-deriving the vocabulary. */
export type ObservationOpSink = (ops: readonly ObservationOp[]) => void;

export function fanoutObservationOps(
  sinks: readonly ObservationOpSink[],
): ObservationOpSink {
  return (ops) => {
    if (ops.length === 0) return;
    for (const sink of sinks) sink(ops);
  };
}

/** Append ops to one JSONL stream. Best-effort by construction: a write gap is
 * an evidence gap, never a run failure. `codec` defaults to the raw op; a
 * caller that wraps ops in its own envelope passes its own line encoder. */
export function observationStreamSink(
  append: (lines: string) => void,
  codec: (op: ObservationOp) => string = stringifyObservationOp,
): ObservationOpSink {
  return (ops) => {
    if (ops.length === 0) return;
    append(ops.map((op) => `${codec(op)}\n`).join(""));
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
 * `start` on the same handle opens no second node — the handle is the
 * identity, the first open is the fact. It may still fill in payload the first
 * open lacked (`startRefineFields`). A second `emit` stays dropped — a
 * born-closed point has no payload left to refine.
 * Children are linked after every op has been applied, so a later `update`
 * cannot leave a stale node under its parent. */
export function foldObservationOps(ops: readonly ObservationOp[]): ObservationNode[] {
  const nodes = new Map<string, ObservationNode>();
  for (const op of ops) {
    if (op.op === "start") {
      const open = nodes.get(op.handle);
      if (open !== undefined) {
        const refine = startRefineFields(op);
        if (refine.input === undefined && refine.model === undefined) continue;
        nodes.set(op.handle, { ...open, ...refine });
        continue;
      }
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
