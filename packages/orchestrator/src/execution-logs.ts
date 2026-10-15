// The loggers the executor's phases emit through: one Source per phase, so a
// log or trace filter can name the phase a line belongs to.
//
// Extracted verbatim from workflow-execution.ts so modules split out of the
// executor (the GPU-round materialization, the stage runner) log through the
// same instances instead of importing back into the executor.

import { logger, type Source } from "@piano/logging";

export const LOAD_SOURCE: Source = {
  module: "orchestrator",
  file: "workflow-file.ts",
  function: "loadDefaultWorkflow",
};
export const EXPLICIT_LOAD_SOURCE: Source = {
  ...LOAD_SOURCE,
  function: "loadWorkflow",
};
export const COMPILE_SOURCE: Source = {
  module: "orchestrator",
  file: "workflow.ts",
  function: "compileWorkflow",
};
export const SCHEDULE_SOURCE: Source = {
  module: "orchestrator",
  file: "workflow.ts",
  function: "scheduleWorkflow",
};
export const WORKER_SOURCE: Source = {
  module: "workers",
  file: "worker.ts",
  function: "executeWorker",
};
export const WORKFLOW_SOURCE: Source = {
  module: "orchestrator",
  file: "workflow-execution.ts",
  function: "executeWorkflow",
};
export const VALIDATE_SOURCE: Source = {
  module: "orchestrator",
  file: "workflow-execution.ts",
  function: "validateStageResult",
};
export const WORKFLOW_LOG = logger(WORKFLOW_SOURCE, { namespace: "workflow" });
export const WORKER_LOG = logger(WORKER_SOURCE, { namespace: "workflow" });
