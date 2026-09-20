import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileWorkerContract,
  knownContractNames,
  validateContract,
  validateWorkerContract,
  type ContractName,
  type ContractProjectionDeclaration,
} from "@piano/contract";
import {
  legacyContractProjectionDeclarations,
  projectLegacyContractProjections,
} from "../../packages/orchestrator/src/legacy-contract-projections.js";

const implementation = (changedFile: string): unknown => ({
  status: "compiled",
  variable: "historical-variable",
  diff_summary: "historical change",
  changed_files: [changedFile],
  compile: {
    passed: true,
    target: "historical-target",
    so_commit: "abc123",
    so_mtime: "2026-08-31T00:00:00Z",
  },
});

/** Frozen migration oracle. This is intentionally duplicated in the test:
 * neither the adapter nor a worker declaration may define the expected
 * projection surface for the other. */
const FROZEN_PROJECTION_ORACLE: Readonly<Record<string, readonly ContractProjectionDeclaration[]>> = {
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

const FROZEN_TOPSOP_ROUND_ACCEPTED = {
  iteration: 1,
  variable: "SUBTHREAD_NUM 2->1",
  variable_type: "config",
  hypothesis: "64KB transfer recovers read bandwidth",
  decision: "KEEP",
  candidate: { path: "lib/op/kernel.h" },
  current_best: { path: "lib/op/kernel.h" },
  verification: { compile_passed: true, verify_passed: true, report_path: "reports/verify.json" },
  profile: { kernel_latency_us: 186.05, llc_rw_sum_gbps: 2189.97, profile_path: "profiles/iter-001/kernel.json" },
  regression_pp: 9.98,
  promotion: { promoted: true, resulting_best: { path: "lib/op/kernel.h" }, reason: "candidate improved" },
  next_variable: null,
  records: { round_path: "rounds/iter-001.json", state_path: "state/tuning-state.json" },
} as const;

const FROZEN_TOPSOP_ROUND_BLOCKED = (() => {
  const blocked = structuredClone(FROZEN_TOPSOP_ROUND_ACCEPTED) as Record<string, unknown>;
  blocked.decision = "BLOCKED";
  blocked.blocker = "profiling device unavailable";
  delete blocked.verification;
  delete blocked.profile;
  delete blocked.regression_pp;
  blocked.promotion = { promoted: false, resulting_best: { path: "lib/op/kernel.h" }, reason: "no device" };
  return blocked;
})();

const FROZEN_TOPSOP_ROUND_COMPILE_FAIL = (() => {
  const failed = structuredClone(FROZEN_TOPSOP_ROUND_ACCEPTED) as Record<string, unknown>;
  failed.decision = "COMPILE_FAIL";
  failed.verification = { compile_passed: false, verify_passed: false, diagnostics_path: "reports/compile.json" };
  failed.promotion = { promoted: false, resulting_best: { path: "lib/op/kernel.h" }, reason: "compile failed" };
  delete failed.profile;
  delete failed.regression_pp;
  return failed;
})();

const FROZEN_TOPSOP_ROUND_VERIFY_FAIL = (() => {
  const failed = structuredClone(FROZEN_TOPSOP_ROUND_ACCEPTED) as Record<string, unknown>;
  failed.decision = "VERIFY_FAIL";
  failed.verification = { compile_passed: true, verify_passed: false, report_path: "reports/verify.json" };
  failed.promotion = { promoted: false, resulting_best: { path: "lib/op/kernel.h" }, reason: "verification failed" };
  delete failed.profile;
  delete failed.regression_pp;
  return failed;
})();

const FROZEN_TOPSOP_ROUND_DISCARD = (() => {
  const discarded = structuredClone(FROZEN_TOPSOP_ROUND_ACCEPTED) as Record<string, unknown>;
  discarded.decision = "DISCARD";
  discarded.regression_pp = 0;
  discarded.promotion = { promoted: false, resulting_best: { path: "lib/op/kernel.h" }, reason: "candidate did not improve" };
  return discarded;
})();

const FROZEN_TOPSOP_ROUND_CONVERGED = (() => {
  const converged = structuredClone(FROZEN_TOPSOP_ROUND_ACCEPTED) as Record<string, unknown>;
  converged.decision = "CONVERGED";
  converged.next_variable = null;
  converged.regression_pp = 0;
  converged.promotion = { promoted: false, resulting_best: { path: "lib/op/kernel.h" }, reason: "no further variable" };
  return converged;
})();

/** Small, frozen branch corpus for the legacy IDs that are now reused by
 * worker-owned contract.json files. These are intentionally hand-authored
 * boundary records, rather than generated from the current builtin schemas. */
const FROZEN_CONDITIONAL_CORPUS: ReadonlyArray<readonly [
  id: ContractName,
  label: string,
  payload: unknown,
]> = [
  ["profile-report", "ready", {
    status: "ready",
    target_operator: "kernel",
    device: { name: "GPU", architecture: "arch" },
    metrics: { compute_utilization: 0.5, memory_bandwidth_utilization: 0.5, achieved_occupancy: 0.5, launch_overhead: 1 },
    bottlenecks: [{ type: "memory", description: "bandwidth", evidence: "measured" }],
    analysis: "ready profile",
  }],
  ["profile-report", "blocked", {
    status: "blocked",
    target_operator: "kernel",
    device: { name: "GPU", architecture: "arch" },
    analysis: "device unavailable",
    blocker: "device unavailable",
  }],
  ["cuda-preparation-report", "ready", {
    status: "ready",
    target: { operator: "gemm", shape: "1x1", dtype: "f16" },
    device: { name: "GPU", architecture: "sm" },
    toolchain: { compiler: "cc", runtime: "rt", profiler: "prof" },
    baseline: { custom_kernel: { path: "kernel.cu" } },
    current_best: { path: "kernel.cu" },
    state_path: "state.json",
  }],
  ["cuda-preparation-report", "blocked", {
    status: "blocked",
    target: { operator: "gemm", shape: "1x1", dtype: "f16" },
    device: { name: "GPU", architecture: "sm" },
    toolchain: { compiler: "cc", runtime: "rt", profiler: "prof" },
    blocker: "no device",
  }],
  ["optimization-proposal", "config", {
    strategies: [{
      id: "candidate",
      bottleneck: "memory",
      technique: "tile",
      rationale: "reduce traffic",
      predicted_speedup: 1.1,
      risk_level: "low",
      variable_type: "config",
    }],
  }],
  ["optimization-proposal", "structural with premise recheck", {
    strategies: [{
      id: "candidate",
      bottleneck: "memory",
      technique: "pipeline",
      rationale: "overlap transfer",
      predicted_speedup: 1.1,
      risk_level: "medium",
      variable_type: "structural",
    }],
    rechecked_premises: [{ premise: "memory is the ceiling", invalidated: false, evidence: "baseline profile" }],
  }],
  ["verification-report", "pass", {
    artifact: "kernel.py",
    compile: { passed: true, exit_code: 0 },
    run: { passed: true, exit_code: 0 },
    numeric_check: { passed: true },
    verdict: "pass",
  }],
  ["verification-report", "fail", {
    artifact: "kernel.py",
    compile: { passed: false, exit_code: 1 },
    run: { passed: true, exit_code: 0 },
    numeric_check: { passed: false },
    verdict: "fail",
    failure_details: "compile failed",
  }],
  ["topsop-env-report", "ready", {
    status: "ready",
    target: { operator: "kernel", shape: "1x1", dtype: "bf16" },
    device: { name: "GCU", architecture: "GCU400", test_host: "host" },
    toolchain: { compiler: "cc", runtime: "rt", profiler: "prof" },
    build: { so_path: "build/lib.so" },
    state_path: "state.json",
  }],
  ["topsop-env-report", "blocked", {
    status: "blocked",
    target: { operator: "kernel", shape: "1x1", dtype: "bf16" },
    device: { name: "GCU", architecture: "GCU400", test_host: "host" },
    toolchain: { compiler: "cc", runtime: "rt", profiler: "prof" },
    blocker: "no compiler",
  }],
  ["topsop-explore-report", "ready", {
    status: "ready",
    call_chain: "host -> kernel",
    architecture: { pipeline: "load/compute", l1_buffers: "x/y", sip_allocation: "static", variant_selected: "default" },
  }],
  ["topsop-explore-report", "blocked", { status: "blocked", blocker: "source unavailable" }],
  ["topsop-theory-report", "ready", {
    status: "ready",
    target_operator: "kernel",
    baseline: { kernel_source: "kernel.h", build: { so_path: "build/lib.so" } },
    theory: { read_write_balanced: true, bandwidth_limit_gbps: 3000, theory_min_us: 1, bandwidth_utilization: 0.5 },
  }],
  ["topsop-theory-report", "blocked", { status: "blocked", target_operator: "kernel", blocker: "no baseline" }],
  ["topsop-profile-report", "ready", {
    status: "ready",
    target_operator: "kernel",
    device: { name: "GCU", architecture: "GCU400" },
    metrics: { kernel_latency_us: 1, llc_rw_sum_gbps: 2, sip_1d_efficiency: 0.5 },
    analysis: "profile",
  }],
  ["topsop-profile-report", "blocked", {
    status: "blocked",
    target_operator: "kernel",
    device: { name: "GCU", architecture: "GCU400" },
    metrics: { kernel_latency_us: 1 },
    analysis: "blocked",
    blocker: "no profiler",
  }],
  ["topsop-implementation-report", "compiled", {
    status: "compiled",
    variable: "tile-size",
    diff_summary: "changed tile size",
    changed_files: ["kernel.h"],
    compile: { passed: true, target: "kernel" },
  }],
  ["topsop-implementation-report", "compile_failed", {
    status: "compile_failed",
    variable: "tile-size",
    diff_summary: "compile failed",
    compile: { passed: false, target: "kernel" },
  }],
  ["topsop-implementation-report", "blocked", {
    status: "blocked",
    variable: "tile-size",
    diff_summary: "device unavailable",
    compile: { passed: false, target: "kernel" },
    blocker: "device unavailable",
    block_scope: "iteration",
  }],
  ["topsop-round-result", "accepted", FROZEN_TOPSOP_ROUND_ACCEPTED],
  ["topsop-round-result", "blocked", FROZEN_TOPSOP_ROUND_BLOCKED],
  ["topsop-round-result", "compile_failed", FROZEN_TOPSOP_ROUND_COMPILE_FAIL],
  ["topsop-round-result", "verify_failed", FROZEN_TOPSOP_ROUND_VERIFY_FAIL],
  ["topsop-round-result", "discard", FROZEN_TOPSOP_ROUND_DISCARD],
  ["topsop-round-result", "converged", FROZEN_TOPSOP_ROUND_CONVERGED],
  ["summary-report", "improved with progress", {
    run_id: "run-id",
    summary: "improved",
    outcome: "improved",
    progress_record: { file_path: "test.py", current_status: "optimizing", entry: "R1: improved" },
  }],
  ["summary-report", "neutral with progress", {
    run_id: "run-id",
    summary: "neutral",
    outcome: "neutral",
    progress_record: { file_path: "test.py", current_status: "stable", entry: "R1: neutral" },
  }],
  ["summary-report", "regressed without progress", {
    run_id: "run-id",
    summary: "regressed",
    outcome: "regressed",
  }],
];

async function contractsById(): Promise<Map<string, Array<{ worker: string; contract: ReturnType<typeof compileWorkerContract> }>>> {
  const recipes = join(process.cwd(), "recipes");
  const entries = await readdir(recipes, { withFileTypes: true });
  const groups = new Map<string, Array<{ worker: string; contract: ReturnType<typeof compileWorkerContract> }>>();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(recipes, entry.name, "contract.json");
    try {
      const contract = compileWorkerContract(await readFile(path, "utf8"), path);
      const group = groups.get(contract.manifest.id) ?? [];
      group.push({ worker: entry.name, contract });
      groups.set(contract.manifest.id, group);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return groups;
}

describe("deprecated named-contract projections", () => {
  it("exhaustively declares every legacy ContractName and rejects unknown IDs", () => {
    for (const id of knownContractNames()) {
      expect(legacyContractProjectionDeclarations(id), `${id} must have explicit compatibility data`).toBeDefined();
    }
    expect(() => legacyContractProjectionDeclarations("not-a-contract"))
      .toThrow(/unknown legacy contract/);
    expect(() => projectLegacyContractProjections("not-a-contract", {}))
      .toThrow(/unknown legacy contract/);
  });

  it("checks the legacy adapter against a frozen projection oracle", () => {
    for (const [id, expected] of Object.entries(FROZEN_PROJECTION_ORACLE)) {
      expect(legacyContractProjectionDeclarations(id), `${id} adapter declaration`).toEqual(expected);
    }
  });

  it("checks every same-ID worker declaration against the frozen oracle", async () => {
    const groups = await contractsById();
    let compared = 0;
    for (const [id, expected] of Object.entries(FROZEN_PROJECTION_ORACLE)) {
      for (const { worker, contract } of groups.get(id) ?? []) {
        compared += 1;
        expect(contract.manifest.outputs.projections, `${worker} (${id}) declaration`).toEqual(expected);
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("checks accepted, blocked, and optional projection values independently", async () => {
    const groups = await contractsById();
    const cases: ReadonlyArray<readonly [id: string, payload: unknown, expected: unknown[]]> = [
      ["topsop-round-result", FROZEN_TOPSOP_ROUND_ACCEPTED, [
        { id: "round.decision", pointer: "/decision", format: "string", value: "KEEP" },
        { id: "round.hypothesis", pointer: "/hypothesis", format: "string", value: "64KB transfer recovers read bandwidth" },
        { id: "profile.kernel-latency-us", pointer: "/profile/kernel_latency_us", format: "number", value: 186.05 },
        { id: "profile.llc-rw-bandwidth-gbps", pointer: "/profile/llc_rw_sum_gbps", format: "number", value: 2189.97 },
        { id: "round.regression-pp", pointer: "/regression_pp", format: "number", value: 9.98 },
        { id: "verification.passed", pointer: "/verification/verify_passed", format: "boolean", value: true },
      ]],
      ["topsop-round-result", FROZEN_TOPSOP_ROUND_BLOCKED, [
        { id: "round.decision", pointer: "/decision", format: "string", value: "BLOCKED" },
        { id: "round.hypothesis", pointer: "/hypothesis", format: "string", value: "64KB transfer recovers read bandwidth" },
      ]],
      ["topsop-implementation-report", implementation("lib/op/kernel.h"), [
        { id: "workflow.status", pointer: "/status", format: "string", value: "compiled" },
        { id: "workspace.changed-files", pointer: "/changed_files", format: "string-list", value: ["lib/op/kernel.h"] },
        { id: "build.target", pointer: "/compile/target", format: "string", value: "historical-target" },
        { id: "change.summary", pointer: "/diff_summary", format: "string", value: "historical change" },
      ]],
      ["summary-report", { run_id: "run-id", summary: "done" }, []],
    ];

    for (const [id, payload, expected] of cases) {
      const adapter = projectLegacyContractProjections(id, payload);
      expect(adapter, `${id} adapter values`).toEqual(expected);
      for (const { worker, contract } of groups.get(id) ?? []) {
        const result = validateWorkerContract(contract, structuredClone(payload));
        expect(result.success, `${worker} must accept ${id} projection case`).toBe(true);
        if (result.success) expect(result.projections, `${worker} ${id} values`).toEqual(expected);
      }
    }
  });

  it("keeps the frozen conditional corpus equivalent across legacy and worker contracts", async () => {
    const groups = await contractsById();
    for (const [id, label, payload] of FROZEN_CONDITIONAL_CORPUS) {
      const legacyResult = validateContract(id, structuredClone(payload));
      expect(legacyResult.success, `${id} ${label}: frozen legacy case`).toBe(true);
      const workers = groups.get(id) ?? [];
      expect(workers.length, `${id} ${label}: worker contract exists`).toBeGreaterThan(0);
      const expectedProjections = projectLegacyContractProjections(id, structuredClone(payload));
      for (const { worker, contract } of workers) {
        const workerResult = validateWorkerContract(contract, structuredClone(payload));
        expect(workerResult.success, `${worker} ${id} ${label}`).toBe(true);
        if (workerResult.success && legacyResult.success) {
          expect(workerResult.value, `${worker} ${id} ${label}: normalized payload`).toEqual(legacyResult.value);
          expect(workerResult.projections, `${worker} ${id} ${label}: projections`).toEqual(expectedProjections);
        }
      }
    }
  });

  it.each([
    "C:relative.tops",
    "a/./b.tops",
    "a//b.tops",
    "a\\..\\b.tops",
    "file\0name.tops",
  ])("does not narrow the historical changed_files acceptance set for %j", (changedFile) => {
    const validated = validateContract("topsop-implementation-report", implementation(changedFile));
    expect(validated.success).toBe(true);
    if (!validated.success) return;

    expect(projectLegacyContractProjections("topsop-implementation-report", validated.value))
      .toContainEqual({
        id: "workspace.changed-files",
        pointer: "/changed_files",
        format: "string-list",
        value: [changedFile],
      });
  });
});
