// The one validation boundary a stage payload crosses: shared by the initial
// worker result and every orchestrator-materialized replacement, so accepted
// evidence never drifts from the exact contract that admitted it.

import {
  ContractValidationError,
  validateContract,
  validateWorkerContract,
} from "@piano/contract";
import { errorMessage } from "./errors.js";
import type {
  ResolvedStageValidation,
  StagePayloadValidationResult,
} from "./execution-types.js";
import { projectLegacyContractProjections } from "./legacy-contract-projections.js";

/** One validation boundary shared by the initial worker result and every
 * orchestrator-materialized replacement. This prevents accepted evidence from
 * drifting away from the exact legacy or worker-owned contract that admitted
 * it in the first place. */
export function validateStagePayload(
  validation: ResolvedStageValidation,
  payload: unknown,
): StagePayloadValidationResult {
  if (validation.kind === "legacy") {
    const result = validateContract(validation.id, payload);
    if (!result.success) return result;
    try {
      return {
        success: true,
        payload: {
          value: result.value,
          metrics: [],
          projections: projectLegacyContractProjections(validation.id, result.value),
        },
      };
    } catch (cause) {
      return {
        success: false,
        error: new ContractValidationError({
          contract: validation.id,
          message: errorMessage(cause),
        }),
      };
    }
  }
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
