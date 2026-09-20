// Canonical worker-contract APIs are declared below. The named registry is
// retained only as a deprecated compatibility boundary for old workflows.

import { z } from "zod";
import {
  CONTRACT_SCHEMAS,
  isContractName,
  knownContractNames,
  validationGuidance,
  VALIDATION_EXAMPLES,
  type ContractName,
  type ContractPayload,
} from "./schemas.js";

export {
  benchmarkMetricV1Schema,
  compileWorkerContract,
  validateWorkerContract,
  workerContractGuidance,
  workerContractManifestSchema,
  ContractValidationError as WorkerContractValidationError,
  WorkerContractLoadError,
  type BenchmarkMetricV1,
  type CompiledWorkerContract,
  type ContractMetric,
  type ContractProjection,
  type ContractProjectionDeclaration,
  projectContractProjections,
  type ProjectionFormat,
  type WorkerContractManifest,
  type WorkerContractValidationResult,
  type WorkerMetricOutput,
} from "./worker-contract.js";

/**
 * @deprecated Compatibility-only named validators. New workers must declare
 * their contract in recipes/<worker>/contract.json and use validate: true.
 */
export {
  CONTRACT_SCHEMAS,
  isContractName,
  knownContractNames,
  validationGuidance,
  VALIDATION_EXAMPLES,
  type ContractName,
  type ContractPayload,
};

export {
  isUnsafeWorkspaceRelativePath,
} from "./workspace-path.js";

/** @deprecated Error type for the named-validator compatibility adapter. */
export class ContractValidationError extends Error {
  readonly _tag = "ContractValidationError" as const;
  readonly contract: string;

  constructor(details: { readonly contract: string; readonly message: string }) {
    super(details.message);
    this.name = "ContractValidationError";
    this.contract = details.contract;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** @deprecated Result type for the named-validator compatibility adapter. */
export type ContractValidationResult<N extends ContractName> =
  | { readonly success: true; readonly value: ContractPayload<N> }
  | { readonly success: false; readonly error: ContractValidationError };

/**
 * @deprecated Validate `payload` against the named predefined schema. New
 * workflows must use `validateWorkerContract` with a worker-owned contract.
 *
 * Returns a plain
 * discriminated result: typed payload on success, or a
 * `ContractValidationError` on failure. The historical package/type names
 * are private implementation compatibility; workflow DSL calls this
 * `validate`. */
export function validateContract<N extends ContractName>(
  name: N,
  payload: unknown,
): ContractValidationResult<N> {
  if (!isContractName(name)) {
    return {
      success: false,
      error: new ContractValidationError({
        contract: String(name),
        message: `unknown validator "${String(name)}" (known: ${knownContractNames().join(", ")})`,
      }),
    };
  }
  const schema = CONTRACT_SCHEMAS[name] as z.ZodType<unknown>;
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return {
      success: false,
      error: new ContractValidationError({
        contract: name,
        message: `validation result failed validator "${name}": ${issues}`,
      }),
    };
  }
  return { success: true, value: result.data as ContractPayload<N> };
}
