import type { EvalCase } from "./types.js";

export interface EvalRunCell {
  readonly kase: EvalCase;
  readonly trial: number;
}

export function expandEvalRunCells(cases: readonly EvalCase[], trials: number): EvalRunCell[] {
  return cases.flatMap((kase) =>
    Array.from({ length: trials }, (_, index) => ({ kase, trial: index + 1 })));
}