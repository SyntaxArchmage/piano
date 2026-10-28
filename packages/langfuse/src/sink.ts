import { randomBytes } from "node:crypto";
import { TraceFlags, type SpanContext } from "@opentelemetry/api";
import {
  createTraceId,
  startObservation,
  type LangfuseObservation,
} from "@langfuse/tracing";
import { Effect } from "effect";
import type { AgentEvent } from "@piano/harness";
import type { ObservationOp } from "@piano/logging";
import type { WorkflowObservation, WorkflowObservationExport } from "@piano/trajectory";
import type { LangfuseConfig } from "./config.js";
import {
  advanceAgentEventContext,
  mapAgentEvent,
  type AgentEventExportContext,
} from "./map-agent-event.js";
import { mapWorkflowObservation } from "./map-workflow-observation.js";
import { mapAcceptedScores, postLangfuseScores } from "./scores.js";

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
    ...(op.input === undefined ? {} : { input: op.input }),
    ...(op.model === undefined ? {} : { model: op.model }),
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

/** The two export seams of one run, sharing one Langfuse trace and one handle
 * map so agent messages nest under their stage attempt. */
export interface LangfuseExport {
  readonly observation: WorkflowObservationExport;
  readonly onAgentEvent: (event: AgentEvent) => void;
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
  let eventContext: AgentEventExportContext = { sequence: 0 };

  const apply = (ops: readonly ObservationOp[]): void => {
    for (const op of ops) applyOp(op, handles, traceId);
  };

  return {
    observation: {
      id: "langfuse",
      export: (observation: WorkflowObservation) =>
        Effect.sync(() => {
          try {
            apply(mapWorkflowObservation(observation, new Date().toISOString()));
            if (config !== undefined && observation.type === "stage_accepted") {
              const scores = mapAcceptedScores(observation, traceId);
              // Fire-and-forget: a score gap never fails the run.
              void postLangfuseScores(config, scores).catch(() => undefined);
            }
          } catch {
            // Export never fails the run or the local evidence.
          }
        }),
    },
    onAgentEvent: (event: AgentEvent) => {
      try {
        apply(mapAgentEvent(event, eventContext, new Date().toISOString()));
        eventContext = advanceAgentEventContext(event, eventContext);
      } catch {
        // Export never fails the run or the local evidence.
      }
    },
  };
}

/** Observation-only sink. Kept for callers that have no agent-event stream. */
export async function createLangfuseObservationExport(
  runId: string,
  config?: LangfuseConfig,
): Promise<WorkflowObservationExport> {
  return (await createLangfuseExport(runId, config)).observation;
}
