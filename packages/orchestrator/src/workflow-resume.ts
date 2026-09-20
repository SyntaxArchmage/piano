// Read actor continuation state from resume.json — the canonical state file
// written by the orchestrator after each accepted prompt.  This replaces the
// previous approach of scanning progress.jsonl line-by-line, giving O(1)
// resume load and exact IDs with no reconstruction.

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type { AgentContinuation } from "@piano/harness";
import { type WorkflowError } from "./errors.js";
import { readResumeState } from "./resume-state.js";

/** One actor's carried-over state: the complete record resume.json holds for
 * it. The identity fields are part of it because the orchestrator writes its
 * whole actor table back on every prompt — an actor projected down to its
 * `turns` alone would be dropped by that write, and the conversation behind it
 * silently abandoned.
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
  readonly promptIndex: number;
  /** Keyed by `workflowActorKey`, hence only valid for `id`. */
  readonly actors: ReadonlyMap<string, WorkflowActorContinuation>;
}

/** Read the actor continuation table for a run from resume.json.
 * Returns `undefined` when the file does not exist (fresh run or legacy run
 * without a state file), allowing callers to start workers fresh. */
export function readWorkflowExecutionContinuation(
  runDir: string,
  _executionId: string,
): Effect.Effect<WorkflowExecutionContinuation | undefined, WorkflowError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const state = yield* readResumeState(runDir);
    if (state === undefined) return undefined;
    const actors = new Map<string, WorkflowActorContinuation>();
    for (const [actorKey, actor] of Object.entries(state.actors)) {
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
    return actors.size === 0 ? undefined : {
      id: state.executionId,
      promptIndex: state.promptIndex,
      actors,
    };
  });
}
