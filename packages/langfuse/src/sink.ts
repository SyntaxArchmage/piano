import { randomBytes } from "node:crypto";
import { TraceFlags, type SpanContext } from "@opentelemetry/api";
import {
  createTraceId,
  startObservation,
  type LangfuseObservation,
} from "@langfuse/tracing";
import type { ObservationOp } from "@piano/logging";
import { startRefineFields } from "@piano/logging";
import type { LangfuseConfig } from "./config.js";
import { flushLangfuse } from "./runtime.js";
import { mapAcceptedScoresFromMetrics, postLangfuseScores, stageAcceptedFacts } from "./scores.js";

/** Synthetic remote parent that pins a deterministic trace id.
 *
 * `startObservation` derives the trace from the parent context, so a root
 * observation is created under a remote parent carrying `createTraceId(runId)`.
 * Every top-level observation of one Piano run shares that trace. */
function rootParent(traceId: string): SpanContext {
  return {
    traceId,
    spanId: randomBytes(8).toString("hex"),
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true,
  };
}

function parentContext(
  parent: string | undefined,
  handles: ReadonlyMap<string, LangfuseObservation>,
  traceId: string,
): SpanContext {
  const observation = parent === undefined ? undefined : handles.get(parent);
  return observation === undefined ? rootParent(traceId) : observation.otelSpan.spanContext();
}

function startObservationFor(
  op: Extract<ObservationOp, { op: "start" | "emit" }>,
  parentSpanContext: SpanContext,
): LangfuseObservation {
  const attributes = {
    ...startRefineFields(op),
    metadata: op.metadata ?? {},
    ...("output" in op && op.output !== undefined ? { output: op.output } : {}),
    ...("usageDetails" in op && op.usageDetails !== undefined ? { usageDetails: op.usageDetails } : {}),
    ...("level" in op && op.level !== undefined ? { level: op.level } : {}),
    ...("statusMessage" in op && op.statusMessage !== undefined ? { statusMessage: op.statusMessage } : {}),
  };
  if (op.type === "agent") {
    return startObservation(op.name, attributes, { asType: "agent", parentSpanContext });
  }
  if (op.type === "tool") {
    return startObservation(op.name, attributes, { asType: "tool", parentSpanContext });
  }
  if (op.type === "generation") {
    return startObservation(op.name, attributes, { asType: "generation", parentSpanContext });
  }
  if (op.type === "event") {
    return startObservation(op.name, attributes, { asType: "event", parentSpanContext });
  }
  return startObservation(op.name, attributes, { parentSpanContext });
}

function applyOp(
  op: ObservationOp,
  handles: Map<string, LangfuseObservation>,
  traceId: string,
): void {
  if (op.op === "start") {
    // The handle is the identity: a second `start` opens no second span, so
    // dual mapper emission cannot double-count. It may still fill in payload
    // the first open lacked (`startRefineFields`).
    const open = handles.get(op.handle);
    if (open !== undefined) {
      const refine = startRefineFields(op);
      if (refine.input !== undefined || refine.model !== undefined) {
        open.updateOtelSpanAttributes(refine);
      }
      return;
    }
    handles.set(op.handle, startObservationFor(op, parentContext(op.parent, handles, traceId)));
    return;
  }
  if (op.op === "emit") {
    // A point fact: open and close in one op. `event` auto-ends in the SDK;
    // `generation` is ended explicitly so its usage lands before export.
    const observation = startObservationFor(op, parentContext(op.parent, handles, traceId));
    if (op.type === "generation") observation.end();
    return;
  }
  const observation = handles.get(op.handle);
  if (observation === undefined) return;
  observation.updateOtelSpanAttributes({
    ...(op.output === undefined ? {} : { output: op.output }),
    ...(op.level === undefined ? {} : { level: op.level }),
    ...(op.statusMessage === undefined ? {} : { statusMessage: op.statusMessage }),
    ...(op.usageDetails === undefined ? {} : { usageDetails: op.usageDetails }),
    metadata: op.metadata ?? {},
  });
  if (op.op === "end") {
    observation.end();
    handles.delete(op.handle);
  }
}

/** The Langfuse side of one run: one sink for already-mapped observation ops.
 *
 * Sinks never translate. The caller maps once (workflow observations and agent
 * events both arrive as `ObservationOp`) and fans the same ops out to every
 * sink, so the local stream and this export can never diverge. */
export interface LangfuseExport {
  readonly onOps: (ops: readonly ObservationOp[]) => void;
  /** Push pending spans now. Never rejects: a flush gap is an evidence gap,
   * never a run failure. */
  readonly flush: () => Promise<void>;
}

/** Build the Langfuse export sink for one run.
 *
 * Asynchronous because `createTraceId` derives the deterministic trace id.
 * Export is best-effort: a mapping or SDK failure is dropped and never
 * touches the run. When `config` is present, accepted stage metrics also
 * become Langfuse scores through the public API. */
export async function createLangfuseExport(
  runId: string,
  config?: LangfuseConfig,
): Promise<LangfuseExport> {
  const traceId = await createTraceId(runId);
  const handles = new Map<string, LangfuseObservation>();

  return {
    onOps: (ops: readonly ObservationOp[]) => {
      try {
        for (const op of ops) {
          applyOp(op, handles, traceId);
          if (config !== undefined && op.op === "emit" && op.name === "stage.accepted") {
            const { metrics, identity } = stageAcceptedFacts(op);
            // Fire-and-forget: a score gap never fails the run.
            void postLangfuseScores(config, mapAcceptedScoresFromMetrics(metrics, traceId, identity))
              .catch(() => undefined);
          }
        }
      } catch {
        // Export never fails the run or the local evidence.
      }
    },
    flush: () => flushLangfuse().catch(() => undefined),
  };
}
