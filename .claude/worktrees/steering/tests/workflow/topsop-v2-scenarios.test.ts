import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileWorkerContract,
  validateWorkerContract,
  type CompiledWorkerContract,
} from "../../packages/contract/src/index.js";

const ROOT = process.cwd();

async function contract(worker: string): Promise<CompiledWorkerContract> {
  const path = join(ROOT, "recipes", worker, "contract.json");
  return compileWorkerContract(await readFile(path, "utf8"), path);
}

function failure(kind: string, scope: string, retryable: boolean, code: string) {
  return {
    kind,
    scope,
    retryable,
    code,
    message: `${code} diagnostic`,
    next_action: retryable ? "retry after the condition changes" : "fix the input",
  };
}

describe("topsop tuning v2 scenario contracts", () => {
  it("accepts a missing-input prepare block and projects it as terminal", async () => {
    const compiled = await contract("topsop-v2-prepare");
    const result = validateWorkerContract(compiled, {
      protocol_version: 2,
      status: "blocked",
      failure: failure("input", "run", false, "missing_dispatch_shape"),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.projections).toContainEqual(
        expect.objectContaining({ id: "workflow.status", value: "blocked" }),
      );
    }
  });

  it("rejects benchmark materialization outside formal test trees", async () => {
    const compiled = await contract("topsop-v2-prepare");
    const payload = structuredClone(compiled.manifest.example) as {
      benchmark_suite: { source_paths: string[] };
    };
    payload.benchmark_suite.source_paths = [
      "topsop/lib/kernel/gcu400/forbidden_testcase_edit.tops",
    ];

    expect(validateWorkerContract(compiled, payload).success).toBe(false);
  });

  it("models durable startup as initialized, continued, or blocked", async () => {
    const prepared = await contract("topsop-v2-prepare");
    const initialized = structuredClone(prepared.manifest.example) as {
      state_startup: {
        mode: string;
        revision: number;
        state_sha256?: string;
      };
    };
    expect(validateWorkerContract(prepared, initialized).success).toBe(true);

    initialized.state_startup.revision = 1;
    expect(validateWorkerContract(prepared, initialized).success).toBe(false);

    const continued = structuredClone(prepared.manifest.example) as {
      state_startup: {
        mode: string;
        revision: number;
        state_sha256?: string;
      };
    };
    continued.state_startup.mode = "continued";
    continued.state_startup.revision = 3;
    continued.state_startup.state_sha256 = `sha256:${"c".repeat(64)}`;
    expect(validateWorkerContract(prepared, continued).success).toBe(true);

    delete continued.state_startup.state_sha256;
    expect(validateWorkerContract(prepared, continued).success).toBe(false);

    expect(
      validateWorkerContract(prepared, {
        protocol_version: 2,
        status: "blocked",
        failure: failure(
          "state",
          "run",
          false,
          "durable_state_incompatible",
        ),
      }).success,
    ).toBe(true);
  });

  it("allows characterization to continue from a nonzero durable revision", async () => {
    const compiled = await contract("topsop-v2-characterize");
    const continued = structuredClone(compiled.manifest.example) as {
      state: {
        startup_mode: string;
        revision: number;
        current_best: { path: string };
      };
    };
    continued.state.startup_mode = "continued";
    continued.state.revision = 3;
    expect(validateWorkerContract(compiled, continued).success).toBe(true);

    continued.state.startup_mode = "initialized";
    expect(validateWorkerContract(compiled, continued).success).toBe(false);

    continued.state.startup_mode = "continued";
    continued.state.current_best.path = "/tmp/build/libkernel_example.so";
    expect(validateWorkerContract(compiled, continued).success).toBe(false);
  });

  it("requires promoted current-best state to remain source-bound", async () => {
    const compiled = await contract("topsop-v2-promote");
    const payload = structuredClone(compiled.manifest.example) as {
      state: {
        current_best: {
          source_commit?: string;
          workspace_diff_digest?: string;
        };
      };
    };
    delete payload.state.current_best.source_commit;
    expect(validateWorkerContract(compiled, payload).success).toBe(false);
  });

  it("accepts a retryable device-busy characterization block", async () => {
    const compiled = await contract("topsop-v2-characterize");
    const example = structuredClone(compiled.manifest.example) as {
      prepared_ref: unknown;
    };
    const result = validateWorkerContract(compiled, {
      protocol_version: 2,
      status: "blocked",
      prepared_ref: example.prepared_ref,
      failure: failure("device", "run", true, "device_busy"),
    });

    expect(result.success).toBe(true);
  });

  it.each(["topsop-v2-analyze", "topsop-v2-implement", "topsop-v2-evaluate"])(
    "keeps executor_unavailable local to one iteration for %s",
    async (worker) => {
      const compiled = await contract(worker);
      const example = structuredClone(compiled.manifest.example) as {
        iteration?: number;
        baseline_ref?: unknown;
        candidate_ref?: unknown;
        candidate_id?: string;
      };
      const blocked: Record<string, unknown> = {
        protocol_version: 2,
        status: "blocked",
        block_scope: "iteration",
        failure: failure("internal", "iteration", true, "executor_unavailable"),
      };
      if (worker === "topsop-v2-analyze") {
        blocked.iteration = example.iteration;
        blocked.baseline_ref = example.baseline_ref;
      } else {
        blocked.candidate_ref = example.candidate_ref;
        if (worker === "topsop-v2-evaluate") blocked.candidate_id = example.candidate_id;
      }

      expect(validateWorkerContract(compiled, blocked).success).toBe(true);
      expect(
        validateWorkerContract(compiled, {
          ...blocked,
          block_scope: "global",
        }).success,
      ).toBe(false);
      expect(
        validateWorkerContract(compiled, {
          ...blocked,
          failure: failure("internal", "run", true, "executor_unavailable"),
        }).success,
      ).toBe(false);
    },
  );

  it("projects an iteration-scoped implementation block without widening it", async () => {
    const compiled = await contract("topsop-v2-implement");
    const example = structuredClone(compiled.manifest.example) as {
      candidate_ref: unknown;
    };
    const result = validateWorkerContract(compiled, {
      protocol_version: 2,
      status: "blocked",
      candidate_ref: example.candidate_ref,
      block_scope: "iteration",
      failure: failure(
        "source",
        "candidate",
        false,
        "hardware_contract_violation",
      ),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.projections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "workflow.status", value: "blocked" }),
          expect.objectContaining({
            id: "workflow.block-scope",
            value: "iteration",
          }),
        ]),
      );
    }
  });

  it("rejects a baseline runtime identity mismatch", async () => {
    const compiled = await contract("topsop-v2-characterize");
    const payload = structuredClone(compiled.manifest.example) as {
      baseline: {
        runtime_cases: Array<{ observed_sha256: string; matched: boolean }>;
      };
    };
    payload.baseline.runtime_cases[0]!.observed_sha256 = `sha256:${"0".repeat(64)}`;
    payload.baseline.runtime_cases[0]!.matched = false;

    expect(validateWorkerContract(compiled, payload).success).toBe(false);
  });

  it("accepts normal candidate-space convergence", async () => {
    const compiled = await contract("topsop-v2-analyze");
    const example = structuredClone(compiled.manifest.example) as {
      baseline_ref: unknown;
    };
    const result = validateWorkerContract(compiled, {
      protocol_version: 2,
      status: "converged",
      iteration: 4,
      baseline_ref: example.baseline_ref,
      search_progress: {
        target_experiments: 10,
        measured_experiments: 4,
        replan_generation: 2,
        mode: "structural",
        category_coverage: {
          data_movement_overlap: "exhausted",
          tiling_partitioning: "exhausted",
          storage_layout: "infeasible",
          compute_codegen: "exhausted",
          launch_specialization: "infeasible",
          fusion_algorithm: "exhausted",
        },
        evidence_refs: [],
      },
      convergence: {
        reason: "all evidence-backed mechanisms were falsified after structural replanning",
        exhausted_mechanisms: ["double-buffer", "tile-size"],
        replan_performed: true,
        unresolved_target_gap: "the declared throughput target remains unmet",
        evidence_refs: [],
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts compile failure and convergence no-op without candidate claims", async () => {
    const compiled = await contract("topsop-v2-implement");
    const example = structuredClone(compiled.manifest.example) as {
      candidate_ref: unknown;
      candidate_id: string;
    };

    expect(
      validateWorkerContract(compiled, {
        protocol_version: 2,
        status: "compile_failed",
        candidate_ref: example.candidate_ref,
        candidate_id: example.candidate_id,
        failure: failure("build", "candidate", false, "compile_failed"),
      }).success,
    ).toBe(true);

    const skipped = {
      protocol_version: 2,
      status: "skipped",
      candidate_ref: example.candidate_ref,
      skip_reason: "upstream analyze converged",
    };
    expect(validateWorkerContract(compiled, skipped).success).toBe(true);
    expect(
      validateWorkerContract(compiled, {
        ...skipped,
        candidate_artifact: {
          path: "/tmp/forbidden.so",
          sha256: `sha256:${"1".repeat(64)}`,
          identity: "invented",
        },
      }).success,
    ).toBe(false);
  });

  it("requires explicit candidate constraints and pre-build plan conformance", async () => {
    const analyzed = await contract("topsop-v2-analyze");
    const candidate = structuredClone(analyzed.manifest.example) as {
      candidate: { implementation_constraints?: unknown };
    };
    delete candidate.candidate.implementation_constraints;
    expect(validateWorkerContract(analyzed, candidate).success).toBe(false);

    const implemented = await contract("topsop-v2-implement");
    const built = structuredClone(implemented.manifest.example) as {
      plan_conformance?: {
        all_constraints_checked: boolean;
        checks: Array<{ matched: boolean }>;
      };
    };
    expect(validateWorkerContract(implemented, built).success).toBe(true);

    const missingLedger = structuredClone(built);
    delete missingLedger.plan_conformance;
    expect(validateWorkerContract(implemented, missingLedger).success).toBe(false);

    const unchecked = structuredClone(built);
    unchecked.plan_conformance!.all_constraints_checked = false;
    expect(validateWorkerContract(implemented, unchecked).success).toBe(false);

    const mismatched = structuredClone(built);
    mismatched.plan_conformance!.checks[0]!.matched = false;
    expect(validateWorkerContract(implemented, mismatched).success).toBe(false);
  });

  it.each([
    ["topsop-v2-analyze", "candidate"],
    ["topsop-v2-implement", "root"],
    ["topsop-v2-evaluate", "root"],
  ] as const)("requires an incumbent comparison binding in %s", async (worker, location) => {
    const compiled = await contract(worker);
    const payload = structuredClone(compiled.manifest.example) as Record<string, unknown>;
    if (location === "candidate") {
      delete (payload.candidate as Record<string, unknown>).comparison_base;
    } else {
      delete payload.comparison_base;
    }
    expect(validateWorkerContract(compiled, payload).success).toBe(false);
  });

  it("removes the legacy free-standing baseline median from evaluation comparison", async () => {
    const compiled = await contract("topsop-v2-evaluate");
    const schema = compiled.manifest.schema as {
      properties: Record<string, unknown>;
    };
    const comparison = schema.properties.comparison as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(comparison.properties).not.toHaveProperty("baseline_median");
    expect(comparison.required).not.toContain("baseline_median");
  });

  it("requires target observations before a measured candidate is KEEP-eligible", async () => {
    const compiled = await contract("topsop-v2-evaluate");
    const measured = structuredClone(compiled.manifest.example) as {
      comparison: { eligible: boolean; reason: string };
      target_validation?: {
        candidate_artifact_sha256: string;
        runtime_identity_sha256: string;
        targets_declared: boolean;
        all_declared_targets_observed: boolean;
        measurements: unknown[];
        profile_ref?: unknown;
      };
    };
    expect(validateWorkerContract(compiled, measured).success).toBe(true);

    const missingTargets = structuredClone(measured);
    delete missingTargets.target_validation;
    expect(validateWorkerContract(compiled, missingTargets).success).toBe(false);

    const unavailable = structuredClone(measured);
    unavailable.comparison.eligible = false;
    unavailable.comparison.reason = "target_metrics_unavailable";
    delete unavailable.target_validation;
    expect(validateWorkerContract(compiled, unavailable).success).toBe(true);

    const noDeclaredTargets = structuredClone(measured);
    noDeclaredTargets.target_validation = {
      candidate_artifact_sha256: `sha256:${"f".repeat(64)}`,
      runtime_identity_sha256: `sha256:${"1".repeat(64)}`,
      targets_declared: false,
      all_declared_targets_observed: true,
      measurements: [],
    };
    expect(validateWorkerContract(compiled, noDeclaredTargets).success).toBe(true);
  });

  it("keeps correctness rejection free of performance claims", async () => {
    const compiled = await contract("topsop-v2-evaluate");
    const example = structuredClone(compiled.manifest.example) as {
      candidate_ref: unknown;
      candidate_id: string;
      benchmark: unknown;
      target_validation: unknown;
    };
    const rejected = {
      protocol_version: 2,
      status: "rejected",
      candidate_ref: example.candidate_ref,
      candidate_id: example.candidate_id,
      rejection: {
        reason: "guard workload mismatch",
        evidence_refs: [],
        restore_required: true,
      },
    };

    expect(validateWorkerContract(compiled, rejected).success).toBe(true);
    expect(
      validateWorkerContract(compiled, {
        ...rejected,
        benchmark: example.benchmark,
      }).success,
    ).toBe(false);
    expect(
      validateWorkerContract(compiled, {
        ...rejected,
        target_validation: example.target_validation,
      }).success,
    ).toBe(false);
  });

  it("binds promotion status to KEEP, DISCARD, or CONVERGED", async () => {
    const compiled = await contract("topsop-v2-promote");
    const promoted = structuredClone(compiled.manifest.example) as {
      status: string;
      decision: string;
      next_action: string;
    };

    expect(validateWorkerContract(compiled, promoted).success).toBe(true);
    const missingTargetRef = structuredClone(promoted) as Record<string, unknown>;
    delete missingTargetRef.target_validation_ref;
    expect(validateWorkerContract(compiled, missingTargetRef).success).toBe(false);

    promoted.decision = "DISCARD";
    expect(validateWorkerContract(compiled, promoted).success).toBe(false);

    const terminal = structuredClone(compiled.manifest.example) as Record<
      string,
      unknown
    >;
    terminal.status = "terminal";
    terminal.decision = "CONVERGED";
    terminal.next_action = "stop";
    terminal.loop_control = "stop";
    delete terminal.candidate_id;
    const terminalResult = validateWorkerContract(compiled, terminal);
    expect(terminalResult.success).toBe(true);
    if (terminalResult.success) {
      expect(terminalResult.projections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "workflow.loop-control", value: "stop" }),
        ]),
      );
    }
  });

  it("retains final target observations in an improved summary", async () => {
    const compiled = await contract("topsop-v2-summary");
    const improved = structuredClone(compiled.manifest.example) as Record<string, unknown>;
    expect(validateWorkerContract(compiled, improved).success).toBe(true);
    delete improved.final_target_validation;
    expect(validateWorkerContract(compiled, improved).success).toBe(false);
  });

  it("requires an upstream cause for blocked or interrupted summaries", async () => {
    const compiled = await contract("topsop-v2-summary");
    const blocked = {
      protocol_version: 2,
      status: "completed",
      outcome: "blocked",
      rounds: { scheduled: 0, attempted: 0, measured: 0, target_measured: 10, replans: 0, kept: 0, discarded: 0, failed: 0 },
      cleanup: {
        lease_release_attempted: true,
        lease_released: true,
        workspace_restored: true,
        issues: [],
      },
      next_action: "retry later",
    };

    expect(validateWorkerContract(compiled, blocked).success).toBe(false);
    expect(
      validateWorkerContract(compiled, {
        ...blocked,
        upstream_failure: failure("device", "run", true, "device_busy"),
      }).success,
    ).toBe(true);
  });
});
