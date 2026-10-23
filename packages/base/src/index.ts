// The repo's floor: names for the things every package has to agree on — how a
// run's directory is laid out, how a lifecycle reads, how an unknown cause is
// described, and how a file is replaced whole.
//
// Nothing here imports another `@piano/*` package. That is the point: a module
// above this one can depend on these names without also depending on the module
// that happens to write the file, so one spelling of a status or a path serves
// the writer and every reader.

export {
  actorSessionDir,
  contractSnapshotPath,
  evalMetricsDir,
  evalMetricsPath,
  invocationContextDir,
  invocationResultPath,
  invocationStreamPath,
  logStreamPath,
  runStatusPath,
  sessionsRoot,
  streamPathCandidates,
  traceStreamPath,
  trajectoryStreamPath,
  workspaceRecordPath,
  workspaceRecordRoot,
  workspaceRoot,
  workspaceStorePath,
  workspaceWorktreePath,
} from "./run-layout.js";

export {
  RUN_LIFECYCLE_STATUSES,
  type ExecutionOutcome,
  type InvocationStatus,
  type JobOutcome,
  type RunLifecycleStatus,
  type TurnOutcome,
} from "./lifecycle.js";

export { errorMessage, failureDetails, isCancellation, type FailureDetails } from "./errors.js";

export { installStagingFile, writeFileAtomic } from "./atomic-write.js";
