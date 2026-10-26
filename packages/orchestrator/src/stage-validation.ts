// The one validation boundary a stage payload crosses: shared by the initial
// worker result and every orchestrator-materialized replacement, so accepted
// evidence never drifts from the exact contract that admitted it.

import { validateWorkerContract } from "@piano/contract";
import type {
  ResolvedStageValidation,
  StagePayloadValidationResult,
} from "./execution-types.js";

/** One validation boundary shared by the initial worker result and every
 * orchestrator-materialized replacement. This prevents accepted evidence from
 * drifting away from the exact worker-owned contract that admitted it. */
export function validateStagePayload(
  validation: ResolvedStageValidation,
  payload: unknown,
): StagePayloadValidationResult {
  const result = validateWorkerContract(validation.contract, payload);
  return result.success
    ? {
      success: true,
      payload: {
        value: result.value,
        metrics: result.metrics,
        projections: result.projections,
      },
    }
    : result;
}
