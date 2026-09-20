import { Data } from "effect";

export type WorkflowPhase = "load" | "parse" | "compile" | "schedule";

export class WorkflowError extends Data.TaggedError("WorkflowError")<{
  readonly phase: WorkflowPhase;
  readonly path: string;
  readonly message: string;
}> {}

export function workflowError(
  phase: WorkflowPhase,
  path: string,
  message: string,
): WorkflowError {
  return new WorkflowError({
    phase,
    path,
    message: `workflow ${phase} failed at ${path}: ${message}`,
  });
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
