import { describe, expect, it } from "vitest";
import {
  isContractName,
  knownContractNames,
  validateContract,
} from "../src/index.js";

describe("contract predefined schemas", () => {
  it("knows the default text-response contract", () => {
    expect(isContractName("text-response")).toBe(true);
    expect(knownContractNames()).toContain("text-response");
  });

  it("rejects unknown names", () => {
    expect(isContractName("nope")).toBe(false);
    expect(isContractName(undefined)).toBe(false);
  });
});

describe("validateContract", () => {
  it("accepts a valid text-response payload as a plain result", () => {
    const result = validateContract("text-response", { text: "hello" });
    expect(result).toEqual({ success: true, value: { text: "hello" } });
  });

  it("rejects a malformed text-response payload as a plain error result", () => {
    const result = validateContract("text-response", { text: 42 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatchObject({
        _tag: "ContractValidationError",
        name: "ContractValidationError",
        contract: "text-response",
      });
    }
  });

  it("rejects an unknown contract name", () => {
    const result = validateContract(
      "no-such-contract" as "text-response", { text: "x" },
    );
    expect(result.success).toBe(false);
  });

  it("accepts a consistent failed verification report as evidence", () => {
    const result = validateContract("verification-report", {
      artifact: "candidate.py",
      compile: { passed: false, exit_code: 1, stderr: "syntax error" },
      run: { passed: false, exit_code: 1 },
      numeric_check: { passed: false },
      verdict: "fail",
      failure_details: "compile failed",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a verification report whose verdict contradicts its evidence", () => {
    const result = validateContract("verification-report", {
      artifact: "candidate.py",
      compile: { passed: false, exit_code: 1 },
      run: { passed: true, exit_code: 0 },
      numeric_check: { passed: true },
      verdict: "pass",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a verification report whose command pass flags contradict exit codes", () => {
    const result = validateContract("verification-report", {
      artifact: "candidate.py",
      compile: { passed: true, exit_code: 1 },
      run: { passed: false, exit_code: 0 },
      numeric_check: { passed: true },
      verdict: "fail",
    });
    expect(result.success).toBe(false);
  });
});

describe("topsop-asm-report (ISSUE-011)", () => {
  it("is a known contract name", () => {
    expect(isContractName("topsop-asm-report")).toBe(true);
  });

  it("accepts a full asm report with all optional evidence fields", () => {
    const result = validateContract("topsop-asm-report", {
      status: "ready",
      target_operator: "topssglAddAddRmsNorm",
      asm_source: "lib/op/.../add_add_rms_norm_dte_load_impl.h",
      assembly_bottleneck_points: [
        { type: "slot", description: "VLIW slots half idle", evidence: "3 of 6 slots issue" },
        { type: "pipeline_stall", description: "DTE wait drains compute", evidence: "mailbox wait per tile" },
      ],
      slot_utilization: 0.5,
      bank_conflict: { detected: false },
      register_pressure: 40,
      estimated_cycles: 159685,
      analysis: "scheduling, not bandwidth",
      raw_path: "asm/iter-002/current-best.s",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a minimal ready report with only analysis", () => {
    const result = validateContract("topsop-asm-report", {
      status: "ready",
      target_operator: "topssglAddAddRmsNorm",
      analysis: "inner loop slot-bound",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a blocked report without a blocker", () => {
    const result = validateContract("topsop-asm-report", {
      status: "blocked",
      target_operator: "topssglAddAddRmsNorm",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a blocked report with a blocker", () => {
    const result = validateContract("topsop-asm-report", {
      status: "blocked",
      target_operator: "topssglAddAddRmsNorm",
      blocker: "ophal asm failed: compile_commands.json missing",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a ready report with neither analysis nor bottleneck points", () => {
    const result = validateContract("topsop-asm-report", {
      status: "ready",
      target_operator: "topssglAddAddRmsNorm",
      asm_source: "lib/op/.../add_add_rms_norm_dte_load_impl.h",
    });
    expect(result.success).toBe(false);
  });
});

describe("topsop-round-result asm_report (ISSUE-011)", () => {
  const baseRound = {
    iteration: 2,
    variable: "pass2-pass1-row-interleave-2deep",
    hypothesis: "interleave pass2 over pass1 to hide DTE wait",
    decision: "DISCARD",
    candidate: { path: "lib/op/.../add_add_rms_norm_dte_load_impl.h" },
    current_best: { path: "lib/op/.../add_add_rms_norm_dte_load_impl.h" },
    verification: { compile_passed: true, verify_passed: true, report_path: "reports/verify.json" },
    profile: {
      kernel_latency_us: 159.88,
      llc_read_bandwidth_gbps: 1318.68,
      llc_write_bandwidth_gbps: 1265.66,
      llc_rw_sum_gbps: 2584.34,
      sip_1d_efficiency: 0.34,
      profile_path: "profiles/iter-002/kernel.json",
    },
    regression_pp: -3.2,
    promotion: { promoted: false, resulting_best: { path: "lib/op/.../add_add_rms_norm_dte_load_impl.h" }, reason: "boundary regression, check asm" },
    next_variable: "reduce DTE wait slots",
    records: { round_path: "rounds/iter-002.json", state_path: "state/tuning-state.json" },
  };

  it("accepts a boundary measured round carrying asm_report", () => {
    const result = validateContract("topsop-round-result", {
      ...baseRound,
      asm_report: {
        status: "ready",
        target_operator: "topssglAddAddRmsNorm",
        analysis: "VLIW slot-bound, not bandwidth",
        estimated_cycles: 159685,
      },
    });
    expect(result.success).toBe(true);
  });

  it("still accepts a round with no asm_report (default round unaffected)", () => {
    const result = validateContract("topsop-round-result", baseRound);
    expect(result.success).toBe(true);
  });

  it("rejects a failed round carrying asm_report", () => {
    const result = validateContract("topsop-round-result", {
      ...baseRound,
      decision: "COMPILE_FAIL",
      verification: { compile_passed: false, verify_passed: false },
      profile: undefined,
      regression_pp: undefined,
      asm_report: {
        status: "ready",
        target_operator: "topssglAddAddRmsNorm",
        analysis: "should not appear on failed round",
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("summary-report progress_record (ISSUE-012)", () => {
  const progressRecord = {
    file_path: "topsop/test/unit/sgl/sgl_add_add_rms_norm_test.cc",
    current_status: "stable",
    entry: "R12: iter-2 2-deep interleave KEEP 158.50us / 2588.51 GB/s | evidence: 20260829T073054-0a60d1 | next: none",
  };

  it("accepts an improved summary carrying a valid progress_record", () => {
    const result = validateContract("summary-report", {
      run_id: "20260829T073054-0a60d1",
      summary: "target met via bandwidth leg",
      outcome: "improved",
      ranking: ["iter-2"],
      winner: "iter-2",
      progress_record: progressRecord,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an improved summary without progress_record", () => {
    const result = validateContract("summary-report", {
      run_id: "run-id",
      summary: "improved but no proof of progress-record write-back",
      outcome: "improved",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a neutral summary without progress_record", () => {
    const result = validateContract("summary-report", {
      run_id: "run-id",
      summary: "neutral and no write-back proof",
      outcome: "neutral",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a regressed summary without progress_record (not forced)", () => {
    const result = validateContract("summary-report", {
      run_id: "run-id",
      summary: "regressed run, no write-back",
      outcome: "regressed",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an improved summary with an invalid current_status", () => {
    const result = validateContract("summary-report", {
      run_id: "run-id",
      summary: "invalid status value",
      outcome: "improved",
      progress_record: { ...progressRecord, current_status: "exp" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a progress_record carried on an outcome-less summary (optional field)", () => {
    const result = validateContract("summary-report", {
      run_id: "run-id",
      summary: "summary with write-back proof, outcome not declared",
      progress_record: progressRecord,
    });
    expect(result.success).toBe(true);
  });
});

describe("topsop-implementation-report changed_files (ISSUE-017)", () => {
  const baseImpl = {
    status: "compiled",
    variable: "pass2-pass1-row-interleave-2deep",
    diff_summary: "interleave pass2 over pass1; kernel + bench updated",
    compile: { passed: true, target: "topssglAddAddRmsNorm", so_commit: "90487eb6fa", so_mtime: "2026-08-31T00:00:00Z" },
  };

  it("accepts a compiled implementation carrying a non-empty changed_files", () => {
    const result = validateContract("topsop-implementation-report", {
      ...baseImpl,
      changed_files: [
        "topsop/lib/kernel/cc_kernel/sgl/add_add_rms_norm/add_add_rms_norm_kernel.tops",
        "topsop/lib/kernel/cc_kernel/sgl/add_add_rms_norm/add_add_rms_norm_host.tops",
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a compiled implementation without changed_files", () => {
    const result = validateContract("topsop-implementation-report", baseImpl);
    expect(result.success).toBe(false);
  });

  it("rejects a compiled implementation with an empty changed_files list", () => {
    const result = validateContract("topsop-implementation-report", {
      ...baseImpl,
      changed_files: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a changed_files path that escapes the workspace", () => {
    const result = validateContract("topsop-implementation-report", {
      ...baseImpl,
      changed_files: ["topsop/lib/kernel/ok.tops", "../outside.tops"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an absolute changed_files path", () => {
    const result = validateContract("topsop-implementation-report", {
      ...baseImpl,
      changed_files: ["/absolute/outside.tops"],
    });
    expect(result.success).toBe(false);
  });

  it("allows a blocked implementation to omit changed_files", () => {
    const result = validateContract("topsop-implementation-report", {
      status: "blocked",
      variable: "r7-dte-3-level-pipeline",
      diff_summary: "DTE 3-level pipeline violates hardware contract",
      compile: { passed: false, target: "topssglAddAddRmsNorm" },
      blocker: "DTE 3-level pipeline violates hardware contract",
      block_scope: "iteration",
    });
    expect(result.success).toBe(true);
  });
});

describe("optimization-proposal variable_type + rechecked_premises (ISSUE-014)", () => {
  const baseProposal = {
    strategies: [{
      id: "structural-candidate",
      bottleneck: "compute",
      technique: "double-buffer the DTE load to hide wait",
      rationale: "hide DTE wait under compute after pass merge",
      predicted_speedup: 1.2,
      risk_level: "medium",
      falsification_criterion: "latency unchanged → wait not the bottleneck",
      mechanism_over_config: true,
      variable_type: "structural",
    }],
  };
  const recheck = [{
    premise: "read rate ~1.1 TB/s is a DTE/L3 hard ceiling",
    invalidated: true,
    evidence: "F32MIX remove re-widening flips VPD to COMPUTE_BOUND at 1234.94 GB/s",
  }];

  it("accepts a structural round carrying rechecked_premises", () => {
    const result = validateContract("optimization-proposal", {
      ...baseProposal,
      rechecked_premises: recheck,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a structural round missing rechecked_premises", () => {
    const result = validateContract("optimization-proposal", baseProposal);
    expect(result.success).toBe(false);
  });

  it("rejects a structural round with empty rechecked_premises", () => {
    const result = validateContract("optimization-proposal", {
      ...baseProposal,
      rechecked_premises: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a config round without rechecked_premises (not forced)", () => {
    const result = validateContract("optimization-proposal", {
      strategies: [{
        ...baseProposal.strategies[0],
        variable_type: "config",
        mechanism_over_config: false,
      }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a config round carrying rechecked_premises (optional, e.g. right after a structural round)", () => {
    const result = validateContract("optimization-proposal", {
      strategies: [{
        ...baseProposal.strategies[0],
        variable_type: "config",
        mechanism_over_config: false,
      }],
      rechecked_premises: recheck,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a strategy without variable_type (field optional)", () => {
    const result = validateContract("optimization-proposal", {
      strategies: [{
        ...baseProposal.strategies[0],
        variable_type: undefined,
      }],
    });
    expect(result.success).toBe(true);
  });
});

describe("topsop-round-result variable_type (ISSUE-014)", () => {
  const baseRound = {
    iteration: 3,
    variable: "double-buffer-dte",
    hypothesis: "hide DTE wait under compute",
    decision: "KEEP",
    candidate: { path: "lib/op/.../add_add_rms_norm_dte_load_impl.h" },
    current_best: { path: "lib/op/.../add_add_rms_norm_dte_load_impl.h" },
    verification: { compile_passed: true, verify_passed: true },
    profile: {
      kernel_latency_us: 150.0,
      llc_rw_sum_gbps: 2600.0,
      profile_path: "profiles/iter-003/kernel.json",
    },
    regression_pp: 2.5,
    promotion: { promoted: true, resulting_best: { path: "lib/op/.../add_add_rms_norm_dte_load_impl.h" }, reason: "keep" },
    next_variable: null,
    records: { round_path: "rounds/iter-003.json", state_path: "state/tuning-state.json" },
  };

  it("accepts a round carrying variable_type = structural", () => {
    const result = validateContract("topsop-round-result", {
      ...baseRound,
      variable_type: "structural",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a round with no variable_type (optional)", () => {
    const result = validateContract("topsop-round-result", baseRound);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid variable_type value", () => {
    const result = validateContract("topsop-round-result", {
      ...baseRound,
      variable_type: "mechanism",
    });
    expect(result.success).toBe(false);
  });
});

describe("topsop-explore-report hardware_constants + external_mechanism_candidates (ISSUE-015/018)", () => {
  const baseExplore = {
    status: "ready",
    call_chain: "topsatenAddAddRmsNorm → op_sgl_add_add_rms_norm.cc → add_add_rms_norm_dte_load_impl.h",
    architecture: {
      pipeline: "2-stage DTE load + compute",
      l1_buffers: "x1/x2/rms at 512B-aligned __local__, 3 × 64KB in 896KB/SIP",
      sip_allocation: "static even across 24 SIPs",
      variant_selected: "dte_load kN=8/kD=2, kMaxDLen-aligned",
    },
    test_entry: "topsop/test/unit/sgl/sgl_add_add_rms_norm_test",
    build_target: "kernel_normalize_sgl_add_add_rms_norm",
  };

  it("accepts a ready report carrying hardware_constants", () => {
    const result = validateContract("topsop-explore-report", {
      ...baseExplore,
      hardware_constants: {
        l1_vdmem_bytes_per_sip: 1572864,
        l1_sdmem_bytes_per_sip: 131072,
        l1_imem_bytes_per_sip: 131072,
        l2_bytes_per_die: 67108864,
        vc_budget_per_sip: 11,
        tier_alignment: { qa: 512, da: 256, va: 128 },
        sources: ["CLAUDE.md §8", ".claude/skills/gcu300-isa-ref/document/isa32_arch_state.md"],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects hardware_constants without sources (来源路径必须提供，禁止全盘搜索)", () => {
    const result = validateContract("topsop-explore-report", {
      ...baseExplore,
      hardware_constants: {
        l1_vdmem_bytes_per_sip: 1572864,
        l1_sdmem_bytes_per_sip: 131072,
        l1_imem_bytes_per_sip: 131072,
        l2_bytes_per_die: 67108864,
        vc_budget_per_sip: 11,
        tier_alignment: { qa: 512, da: 256, va: 128 },
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a ready report without hardware_constants (optional field)", () => {
    const result = validateContract("topsop-explore-report", baseExplore);
    expect(result.success).toBe(true);
  });

  it("accepts external_mechanism_candidates listing a mechanism absent from current source", () => {
    const result = validateContract("topsop-explore-report", {
      ...baseExplore,
      external_mechanism_candidates: [{
        mechanism: "官方用 block-shared local DTE 搬 gamma",
        source: "官方实现 eb8b65cc5e",
        present_in_source: false,
      }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an external_mechanism_candidate missing present_in_source", () => {
    const result = validateContract("topsop-explore-report", {
      ...baseExplore,
      external_mechanism_candidates: [{
        mechanism: "官方用 block-shared local DTE 搬 gamma",
        source: "官方实现 eb8b65cc5e",
      }],
    });
    expect(result.success).toBe(false);
  });
});
