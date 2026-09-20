import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { logger, type Logging, type Source } from "@piano/logging";
import { eventMetadata, type AgentEvent } from "./events.js";

const EVENT_SOURCE: Source = {
  module: "harness",
  file: "event-observer.ts",
  function: "persistAgentEvents",
};

const EVENT_LOG = logger(EVENT_SOURCE, { namespace: "harness" });

/** Persist the same normalized event evidence for SDK and subprocess
 * adapters. Event payloads are delivered to the caller separately; logs keep
 * bounded metadata so token/content streams do not duplicate transcript data. */
export function persistAgentEvents(
  events: readonly AgentEvent[],
  sessionId: string,
): Effect.Effect<void, never, Logging | FileSystem.FileSystem> {
  return Effect.forEach(
    events,
    (event) => EVENT_LOG.debug("agent.event.received", {
      instance: sessionId,
      data: { sessionId, ...eventMetadata(event) },
    }).pipe(Effect.catchAll(() => Effect.void)),
    { discard: true },
  );
}
