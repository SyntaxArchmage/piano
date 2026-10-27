import { randomBytes } from "node:crypto";
import { TraceFlags, type SpanContext } from "@opentelemetry/api";
import {
  createTraceId,
  startObservation,
  type LangfuseObservation,
} from "@langfuse/tracing";
import { Effect } from "effect";
import type { AgentEvent } from "@piano/harness";
import type { WorkflowObservation, WorkflowObservationExport } from "@piano/trajectory";
import type { LangfuseConfig } from "./config.js";
import {
  advanceAgentEventContext,
  mapAgentEvent,
  type AgentEventExportContext,
} from "./map-agent-event.js";
import {
  mapWorkflowObservation,
  type LangfuseAction,
} from "./map-workflow-observation.js";
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
  action: Extract<LangfuseAction, { parentHandle?: string }>,
  handles: ReadonlyMap<string, LangfuseObservation>,
  traceId: string,
): SpanContext {
  const parent = action.parentHandle === undefined ? undefined : handles.get(action.parentHandle);
  return parent === undefined ? rootParent(traceId) : parent.otelSpan.spanContext();
}

function startObservationFor(
  action: Extract<LangfuseAction, { action: "start" }>,
  parentSpanContext: SpanContext,
): LangfuseObservation {
  const attributes = {
    ...(action.input === undefined ? {} : { input: action.input }),
    metadata: action.metadata,
  };
  if (action.type === "agent") {
    return startObservation(action.name, attributes, { asType: "agent", parentSpanContext });
  }
  if (action.type === "tool") {
    return startObservation(action.name, attributes, { asType: "tool", parentSpanContext });
  }
  return startObservation(action.name, attributes, { parentSpanContext });
}

function emitObservationFor(
  action: Extract<LangfuseAction, { action: "emit" }>,
  parentSpanContext: SpanContext,
): void {
  const attributes = {
    ...(action.input === undefined ? {} : { input: action.input }),
    ...(action.output === undefined ? {} : { output: action.output }),
    ...(action.model === undefined ? {} : { model: action.model }),
    ...(action.usageDetails === undefined ? {} : { usageDetails: action.usageDetails }),
    metadata: action.metadata,
  };
  if (action.type === "generation") {
    startObservation(action.name, attributes, { asType: "generation", parentSpanContext }).end();
    return;
  }
  startObservation(action.name, attributes, { asType: "event", parentSpanContext });
}

function applyAction(
  action: LangfuseAction,
  handles: Map<string, LangfuseObservation>,
  traceId: string,
): void {
  switch (action.action) {
    case "start": {
      handles.set(
        action.handle,
        startObservationFor(action, parentContext(action, handles, traceId)),
      );
      return;
    }
    case "update": {
      handles.get(action.handle)?.updateOtelSpanAttributes({ metadata: action.metadata });
      return;
    }
    case "end": {
      const observation = handles.get(action.handle);
      if (observation === undefined) return;
      observation.updateOtelSpanAttributes({
        ...(action.output === undefined ? {} : { output: action.output }),
        metadata: action.metadata ?? {},
        ...(action.level === undefined ? {} : { level: action.level }),
        ...(action.statusMessage === undefined ? {} : { statusMessage: action.statusMessage }),
      });
      observation.end();
      handles.delete(action.handle);
      return;
    }
    case "emit": {
      emitObservationFor(action, parentContext(action, handles, traceId));
      return;
    }
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

  const apply = (actions: readonly LangfuseAction[]): void => {
    for (const action of actions) applyAction(action, handles, traceId);
  };

  return {
    observation: {
      id: "langfuse",
      export: (observation: WorkflowObservation) =>
        Effect.sync(() => {
          try {
            apply(mapWorkflowObservation(observation));
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
        apply(mapAgentEvent(event, eventContext));
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
