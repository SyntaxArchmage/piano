/**
 * Public API surface for the Piano evals system.
 *
 * The `piano evals` CLI depends on these exports:
 *   - loadCases / loadCase / runCase (driver)
 *   - evaluateTrajectory / evaluateTrajectoryFile (trajectory evaluator)
 *   - evaluateArtifact (artifact evaluator)
 *   - buildReport / formatReport (scorer + report)
 */

export * from "./types.js";
export {
  CaseConfigError,
  hasPerformanceReadout,
  parseCaseConfig,
} from "./case-config.js";
export {
  DriverError,
  DEFAULT_EVALS_ROOT,
  DEFAULT_WORKSPACE_ROOT,
  cleanWorkspaces,
  copyWorkspaceTemplate,
  findNewRunDir,
  aggregateStageTrajectories,
  listCaseDirs,
  loadCase,
  loadCases,
  runCase,
  finalizeCaseResult,
  workloadsDir,
} from "./driver.js";
export type { RunDirectoryAssociation } from "./driver.js";
export {
  analyzeTranscriptText,
  assessCaseEvidence,
  buildCaseScorecard,
  compareBenchmark,
  compareVariants,
  evaluateJudges,
  historyEntryFromResult,
  resolveAcceptancePolicy,
  summarizeTiming,
  usableBenchmarkValue,
  validateTranscriptText,
} from "./evidence.js";
export {
  DEFAULT_EVAL_HISTORY_ROOT,
  EvalHistoryError,
  appendEvalHistory,
  compareHistoryVariants,
  evalBaselinePath,
  evalHistoryPath,
  readEvalHistory,
  readBaseline,
  recordBaseline,
  runHistoryEntry,
} from "./history.js";
export {
  TrajectoryEvalError,
  evaluateTrajectoryFile,
  evaluateTrajectory,
} from "./trajectory-evaluator.js";
export {
  ArtifactEvalError,
  evaluateBaseline,
  evaluateArtifact,
} from "./artifact-evaluator.js";
export {
  buildReport,
  byGroupFilter,
  byTagReducer,
  normalizeMetric,
  reduceCaseGroup,
} from "./scorer.js";
export { formatReport, formatRunSetComparison } from "./report.js";
export { listRunSetIds, readRunSetReport } from "./runset.js";
export { heatCell } from "./heat.js";
export {
  WorkflowEvaluator,
  workflowEvaluator,
  type WorkflowBenchmarkPoint,
  type WorkflowEvaluationInput,
  type WorkflowTrajectoryEvaluation,
} from "./workflow-evaluator.js";
