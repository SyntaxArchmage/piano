import { randomBytes } from "node:crypto";
import { TraceFlags, type SpanContext } from "@opentelemetry/api";
import { createTraceId, startObservation, type LangfuseObservation } from "@langfuse/tracing";
import { Effect } from "effect";
import type { WorkflowObservation, WorkflowObservationExport } from "@piano/trajectory";
import {
  mapWorkflowObservation,
  type LangfuseAction,
} from "./map-workflow-observation.js";

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
    case "event": {
      startObservation(
        action.name,
        {
          ...(action.output === undefined ? {} : { output: action.output }),
          metadata: action.metadata,
        },
        { asType: "event", parentSpanContext: parentContext(action, handles, traceId) },
      );
      return;
    }
  }
}

/** Build the Langfuse export sink for one run.
 *
 * Asynchronous because `createTraceId` derives the deterministic trace id.
 * Export is best-effort: a mapping or SDK failure is dropped and never
 * touches the run. */
export async function createLangfuseObservationExport(
  runId: string,
): Promise<WorkflowObservationExport> {
  const traceId = await createTraceId(runId);
  const handles = new Map<string, LangfuseObservation>();
  return {
    id: "langfuse",
    export: (observation: WorkflowObservation) =>
      Effect.sync(() => {
        try {
          for (const action of mapWorkflowObservation(observation)) {
            applyAction(action, handles, traceId);
          }
        } catch {
          // Export never fails the run or the local evidence.
        }
      }),
  };
}
