// Read actor continuation state from the run's own evidence: the ledger's
// `actor-turn` rows, which are the one record of each conversation-state
// change.

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type { AgentContinuation } from "@piano/harness";
import { type WorkflowError } from "./errors.js";
import type { ResumeActorState } from "./resume-state.js";
import { readRunStatus } from "./run-status.js";

/** One actor's carried-over state: the complete record the ledger holds for
 * it. The identity fields are part of it because the orchestrator appends a
 * row for every conversation-state change — an actor projected down to its
 * `turns` alone would lose the session the next prompt reopens.
 *
 * `continuation` is present whenever the actor is resumable at all: an entry
 * that recorded turns without one is not something this reader produces, and
 * the orchestrator refuses to resume it (see the guard in workflow-execution). */
export interface WorkflowActorContinuation {
  readonly turns: number;
  readonly harness: string;
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly continuation: AgentContinuation;
}

/** Identity and actor table of an execution that is being continued. */
export interface WorkflowExecutionContinuation {
  readonly id: string;
  readonly jobOrdinal: number;
  /** Keyed by `workflowActorKey`, hence only valid for `id`. */
  readonly actors: ReadonlyMap<string, WorkflowActorContinuation>;
}

/** Read the actor continuation table for a run from its state document, which
 * folds the ledger's `actor-turn` rows. Returns `undefined` when it holds
 * none, allowing callers to start workers fresh. */
export function readWorkflowExecutionContinuation(
  runDir: string,
  _runId: string,
): Effect.Effect<WorkflowExecutionContinuation | undefined, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const status = yield* readRunStatus(runDir);
    if (status === undefined) return undefined;
    return finish(status.runId, status.jobOrdinal, status.actors);
  });
}

function finish(
  runId: string,
  jobOrdinal: number,
  table: Record<string, ResumeActorState>,
): WorkflowExecutionContinuation | undefined {
  const actors = new Map<string, WorkflowActorContinuation>();
  for (const [actorKey, actor] of Object.entries(table)) {
    // No continuation means no way back into that conversation; the
    // orchestrator's guard, not this reader, is what tells the user.
    if (actor.continuation === undefined) continue;
    actors.set(actorKey, {
      turns: actor.turns,
      harness: actor.harness,
      sessionId: actor.sessionId,
      transcriptPath: actor.transcriptPath,
      continuation: actor.continuation,
    });
  }
  return actors.size === 0 ? undefined : { id: runId, jobOrdinal, actors };
}
