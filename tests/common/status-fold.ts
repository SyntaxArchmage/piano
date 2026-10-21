import {
  applyRunStatusRecord,
  type RunStatus,
  type WorkflowProgressStreamRecord,
} from "../../packages/orchestrator/src/index.js";

/** Fold ledger records the way a writer does, for tests that need a run state
 * without a run directory. The cast keeps the historical kind-less accepted
 * row usable in fixtures; production records always carry their declared kind. */
export function foldStatus(records: readonly object[]): RunStatus | undefined {
  return records.reduce<RunStatus | undefined>(
    (status, record) => applyRunStatusRecord(status, record as WorkflowProgressStreamRecord),
    undefined,
  );
}
