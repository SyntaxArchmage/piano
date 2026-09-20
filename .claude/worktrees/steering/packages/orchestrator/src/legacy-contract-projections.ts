import {
  projectContractProjections,
  WorkerContractValidationError,
  type ContractName,
  type ContractProjection,
  type ContractProjectionDeclaration,
} from "@piano/contract";

/** Deprecated named-contract compatibility data. Canonical workers own the
 * source of truth in recipes/<worker>/contract.json; this table remains only
 * for old workflow stages that still carry `validate: "..."` and therefore do
 * not load a worker contract. Keep it exhaustive so a newly added legacy ID
 * cannot silently lose all handoff projections. */
const LEGACY_PROJECTIONS: Readonly<Record<ContractName, readonly ContractProjectionDeclaration[]>> = {
  "text-response": [],
  "profile-report": [
    { id: "workflow.status", pointer: "/status", format: "string", required: false },
  ],
  "optimization-proposal": [
    { id: "workflow.map-items", pointer: "/strategies", format: "json", required: true },
  ],
  "cuda-preparation-report": [
    { id: "workflow.status", pointer: "/status", format: "string", required: true },
  ],
  "topsop-implementation-report": [
    { id: "workflow.status", pointer: "/status", format: "string", required: true },
    { id: "workflow.block-scope", pointer: "/block_scope", format: "string", required: false },
    { id: "workspace.changed-files", pointer: "/changed_files", format: "string-list", required: false },
    { id: "build.target", pointer: "/compile/target", format: "string", required: false },
    { id: "change.summary", pointer: "/diff_summary", format: "string", required: false },
  ],
  "topsop-round-result": [
    { id: "round.decision", pointer: "/decision", format: "string", required: true },
    { id: "round.hypothesis", pointer: "/hypothesis", format: "string", required: true },
    // BLOCKED legacy rounds still require decision and hypothesis, but omit
    // the conditional measurement groups below.
    { id: "profile.kernel-latency-us", pointer: "/profile/kernel_latency_us", format: "number", required: false },
    { id: "profile.llc-rw-bandwidth-gbps", pointer: "/profile/llc_rw_sum_gbps", format: "number", required: false },
    { id: "round.regression-pp", pointer: "/regression_pp", format: "number", required: false },
    { id: "verification.passed", pointer: "/verification/verify_passed", format: "boolean", required: false },
  ],
  "cuda-round-result": [
    { id: "round.materialization-v1", pointer: "", format: "json", required: true },
    { id: "round.iteration", pointer: "/iteration", format: "number", required: true },
    { id: "round.decision", pointer: "/decision", format: "string", required: true },
    { id: "round.candidate", pointer: "/candidate", format: "json", required: true },
    { id: "round.current-best", pointer: "/current_best", format: "json", required: true },
    { id: "round.verification", pointer: "/verification", format: "json", required: true },
    { id: "round.promotion", pointer: "/promotion", format: "json", required: true },
    { id: "round.records", pointer: "/records", format: "json", required: true },
    { id: "verification.passed", pointer: "/verification/verify_passed", format: "boolean", required: true },
    { id: "benchmark.evidence", pointer: "/benchmark", format: "json", required: false },
  ],
  "benchmark-evidence": [
    { id: "benchmark.evidence", pointer: "", format: "json", required: true },
  ],
  "implementation-record": [],
  "tournament-results": [],
  "verification-report": [],
  "topsop-profile-report": [
    { id: "workflow.status", pointer: "/status", format: "string", required: false },
    { id: "profile.kernel-latency-us", pointer: "/metrics/kernel_latency_us", format: "number", required: false },
    { id: "profile.llc-rw-bandwidth-gbps", pointer: "/metrics/llc_rw_sum_gbps", format: "number", required: false },
  ],
  "topsop-env-report": [
    { id: "workflow.status", pointer: "/status", format: "string", required: true },
  ],
  "topsop-explore-report": [
    { id: "workflow.status", pointer: "/status", format: "string", required: true },
  ],
  "topsop-theory-report": [
    { id: "workflow.status", pointer: "/status", format: "string", required: false },
  ],
  "topsop-asm-report": [
    { id: "workflow.status", pointer: "/status", format: "string", required: true },
  ],
  "summary-report": [
    { id: "progress-record.path", pointer: "/progress_record/file_path", format: "string", required: false },
  ],
};

export function legacyContractProjectionDeclarations(
  contractId: ContractName,
): readonly ContractProjectionDeclaration[];
export function legacyContractProjectionDeclarations(
  contractId: string,
): readonly ContractProjectionDeclaration[];
export function legacyContractProjectionDeclarations(
  contractId: string,
): readonly ContractProjectionDeclaration[] {
  if (!Object.prototype.hasOwnProperty.call(LEGACY_PROJECTIONS, contractId)) {
    throw new WorkerContractValidationError({
      contract: contractId,
      message: `unknown legacy contract "${contractId}"; named validators are deprecated and must be a known ContractName`,
    });
  }
  return LEGACY_PROJECTIONS[contractId as ContractName];
}

/** Project legacy payloads through the same package-owned core used by
 * validate:true worker contracts. Optional declarations preserve legacy
 * conditional payloads, notably BLOCKED topsop rounds. */
export function projectLegacyContractProjections(
  contractId: ContractName,
  payload: unknown,
): readonly ContractProjection[];
export function projectLegacyContractProjections(
  contractId: string,
  payload: unknown,
): readonly ContractProjection[];
export function projectLegacyContractProjections(
  contractId: string,
  payload: unknown,
): readonly ContractProjection[] {
  const result = projectContractProjections(contractId, legacyContractProjectionDeclarations(contractId), payload);
  if (result instanceof WorkerContractValidationError) throw result;
  return result;
}
