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
}): Omit<WorkflowProgressActorTurnRecord, "version" | "timestamp"> | undefined {
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

/** The actor table as the run's own ledger records it: one `actor-turn` row per
 * state change, newest row per actor winning. The ledger is the one record of
 * an actor's conversation state. */
export function foldActorTurns(
  records: readonly { readonly kind?: unknown }[],
): Record<string, ResumeActorState> {
  const actors: Record<string, ResumeActorState> = {};
  for (const record of records) {
    if (record.kind !== "actor-turn") continue;
    const turn = record as WorkflowProgressActorTurnRecord;
    actors[turn.actorKey] = {
      harness: turn.harness,
      sessionId: turn.sessionId,
      transcriptPath: turn.transcriptPath,
      turns: turn.turn,
      ...(turn.continuation === undefined ? {} : { continuation: turn.continuation }),
    };
  }
  return actors;
}

/** The actor table a run's evidence carries, and the prompt index it implies:
 * the ledger's `actor-turn` rows, which are the run's own record of each
 * conversation-state change. One rule, so the view (`status.json`) and the
 * continue path cannot disagree about which actors a run has. */
export function actorTableFrom(
  ledger: readonly unknown[],
): { readonly promptIndex: number; readonly actors: Readonly<Record<string, ResumeActorState>> } {
  const turns = ledger.filter(
    (record): record is WorkflowProgressActorTurnRecord =>
      typeof record === "object" && record !== null && (record as { kind?: unknown }).kind === "actor-turn",
  );
  const last = turns.at(-1);
  return {
    promptIndex: last?.jobOrdinal ?? 0,
    actors: turns.length === 0 ? {} : foldActorTurns(turns),
  };
}
