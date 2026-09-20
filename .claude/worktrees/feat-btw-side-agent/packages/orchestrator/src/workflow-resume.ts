// Read actor continuation state from resume.json — the canonical state file
// written by the orchestrator after each accepted prompt.  This replaces the
// previous approach of scanning progress.jsonl line-by-line, giving O(1)
// resume load and exact IDs with no reconstruction.

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type { AgentContinuation } from "@piano/harness";
import { type WorkflowError } from "./errors.js";
import { readResumeState } from "./resume-state.js";

/** One actor's carried-over state. `turns` keeps the pre-resume turn count so
 * the "no continuation after an earlier turn" guard stays meaningful. */
export interface WorkflowActorContinuation {
  readonly turns: number;
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
      if (actor.continuation === undefined) continue;
      actors.set(actorKey, { turns: actor.turns, continuation: actor.continuation });
    }
    return actors.size === 0 ? undefined : {
      id: state.executionId,
      promptIndex: state.promptIndex,
      actors,
    };
  });
}
