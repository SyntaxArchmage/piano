import {
  applyRunStatusRecord,
  type RunStatus,
  type WorkflowTransition,
} from "../../packages/orchestrator/src/index.js";

/** Fold transitions the way a writer does, for tests that need a run state
 * without a run directory. Every fixture must carry its transition kind. */
export function foldStatus(records: readonly object[]): RunStatus | undefined {
  return records.reduce<RunStatus | undefined>(
    (status, record) => applyRunStatusRecord(status, record as WorkflowTransition),
    undefined,
  );
}
