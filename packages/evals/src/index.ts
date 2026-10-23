/**
 * Public API surface for the Piano evals system.
 *
 * The `piano evals` CLI is this package's only consumer: it parses arguments,
 * runs the live pipeline (`runEvalPipeline`) or the offline board
 * (`reportRunSet`), and prints the text the package renders. Everything else
 * in the package is internal.
 */

export { runEvalPipeline, type RunCaseFn, type RunPipelineOptions } from "./run-pipeline.js";
export { reportRunSet, type RunSetReportOptions } from "./runset.js";
export { formatReport } from "./report.js";
