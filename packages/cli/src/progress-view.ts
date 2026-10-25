// Reading a run's progress for display.
//
// The run keeps one state document, `status.json`, written by the orchestrator
// as it schedules. That is the file to read; there is no second way to answer
// the question.

import { Effect } from "effect";
import { io } from "@piano/base";
import { parseRunStatus, runStatusPath } from "@piano/orchestrator";
import { parseWorkflowGraphSnapshot, type WorkflowGraphSnapshot } from "./workflow-graph.js";

/** The run's progress view.
 *
 * Missing, malformed, or concurrently replaced files must not interrupt the
 * interactive session, so every failure lands on `undefined`. */
export function readWorkflowSnapshot(runDir: string): Effect.Effect<WorkflowGraphSnapshot | undefined> {
  return Effect.gen(function* () {
    const raw = yield* io.readText(runStatusPath(runDir));
    return yield* Effect.try({
      try: () => parseWorkflowGraphSnapshot(parseRunStatus(raw)),
      catch: (cause) => cause,
    });
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
}
