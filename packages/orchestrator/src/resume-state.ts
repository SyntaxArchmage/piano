import type { AgentContinuation } from "@piano/harness";
import type { WorkflowProgressActorTurnRecord } from "./progress.js";

export interface ResumeActorState {
  readonly harness: string;
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly turns: number;
  readonly continuation?: AgentContinuation;
}

/** One `actor-turn` row from an actor's state, or `undefined` when the state
 * is not durable (no session to reopen). The one place a writer turns actor
 * state into a ledger row, so the stage path and the consolidation path cannot
 * spell the same row differently. */
export function actorTurnRow(input: {
  readonly runId: string;
  readonly jobOrdinal: number;
  readonly invocationId: string;
  readonly attempt: number;
  readonly actorKey: string;
  readonly harness: string;
  readonly worker: string;
  readonly lane: string;
  readonly state: {
    readonly harness?: string;
    readonly sessionId?: string;
    readonly transcriptPath?: string;
    readonly turns: number;
    readonly continuation?: AgentContinuation;
  };
}): Omit<WorkflowProgressActorTurnRecord, "timestamp"> | undefined {
  const { state } = input;
  if (state.harness === undefined || state.sessionId === undefined || state.transcriptPath === undefined) {
    return undefined;
  }
  return {
    kind: "actor-turn",
    runId: input.runId,
    jobOrdinal: input.jobOrdinal,
    invocationId: input.invocationId,
    attempt: input.attempt,
    actorKey: input.actorKey,
    harness: state.harness,
    worker: input.worker,
    lane: input.lane,
    sessionId: state.sessionId,
    transcriptPath: state.transcriptPath,
    turn: state.turns,
    ...(state.continuation === undefined ? {} : { continuation: state.continuation }),
  };
}
