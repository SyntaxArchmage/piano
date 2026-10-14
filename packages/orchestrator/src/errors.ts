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

/** A caller-supplied implementation of an injected interface ended in a defect
 * — a rejected `Effect.promise`, a synchronous throw — instead of the failure
 * its contract declares. It carries the raw defect so the boundary that
 * catches it can report what actually happened, and it stays a distinct type
 * so a defect never reads as an ordinary failure of the injected work. */
export class ImplementationDefectError extends Data.TaggedError("ImplementationDefectError")<{
  readonly message: string;
  readonly defect: unknown;
}> {}

export function implementationDefect(defect: unknown): ImplementationDefectError {
  return new ImplementationDefectError({
    message: `injected implementation ended in a defect: ${errorMessage(defect)}`,
    defect,
  });
}
