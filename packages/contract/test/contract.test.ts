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

describe("summary-report progress_record (ISSUE-012)", () => {
  const progressRecord = {
    file_path: "tests/unit/regression_test.cc",
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

describe("implementation-report changed_files (ISSUE-017)", () => {
  const baseImpl = {
    status: "compiled",
    variable: "pass2-pass1-row-interleave-2deep",
    diff_summary: "interleave pass2 over pass1; kernel + bench updated",
    compile: { passed: true, target: "gemm", so_commit: "90487eb6fa", so_mtime: "2026-08-31T00:00:00Z" },
  };

  it("accepts a compiled implementation carrying a non-empty changed_files", () => {
    const result = validateContract("implementation-report", {
      ...baseImpl,
      changed_files: [
        "src/kernel.cc",
        "src/host.cc",
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a compiled implementation without changed_files", () => {
    const result = validateContract("implementation-report", baseImpl);
    expect(result.success).toBe(false);
  });

  it("rejects a compiled implementation with an empty changed_files list", () => {
    const result = validateContract("implementation-report", {
      ...baseImpl,
      changed_files: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a changed_files path that escapes the workspace", () => {
    const result = validateContract("implementation-report", {
      ...baseImpl,
      changed_files: ["src/kernel.cc", "../outside.cc"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an absolute changed_files path", () => {
    const result = validateContract("implementation-report", {
      ...baseImpl,
      changed_files: ["/absolute/outside.cc"],
    });
    expect(result.success).toBe(false);
  });

  it("allows a blocked implementation to omit changed_files", () => {
    const result = validateContract("implementation-report", {
      status: "blocked",
      variable: "r7-three-level-pipeline",
      diff_summary: "three-level pipeline violates the hardware contract",
      compile: { passed: false, target: "gemm" },
      blocker: "three-level pipeline violates the hardware contract",
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
      technique: "double-buffer the load to hide the wait",
      rationale: "hide the transfer wait under compute after pass merge",
      predicted_speedup: 1.2,
      risk_level: "medium",
      falsification_criterion: "latency unchanged → wait not the bottleneck",
      mechanism_over_config: true,
      variable_type: "structural",
    }],
  };
  const recheck = [{
    premise: "read rate ~1.1 TB/s is an L3 hard ceiling",
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

describe("round-result variable_type (ISSUE-014)", () => {
  const baseRound = {
    iteration: 3,
    variable: "double-buffer",
    hypothesis: "hide the transfer wait under compute",
    decision: "KEEP",
    candidate: { path: "src/kernel.cc" },
    current_best: { path: "src/kernel.cc" },
    verification: { compile_passed: true, verify_passed: true },
    profile: {
      kernel_latency_us: 150.0,
      llc_rw_sum_gbps: 2600.0,
      profile_path: "profiles/iter-003/kernel.json",
    },
    regression_pp: 2.5,
    promotion: { promoted: true, resulting_best: { path: "src/kernel.cc" }, reason: "keep" },
    next_variable: null,
    records: { round_path: "rounds/iter-003.json", state_path: "state/tuning-state.json" },
  };

  it("accepts a round carrying variable_type = structural", () => {
    const result = validateContract("round-result", {
      ...baseRound,
      variable_type: "structural",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a round with no variable_type (optional)", () => {
    const result = validateContract("round-result", baseRound);
    expect(result.success).toBe(true);
  });

  it("rejects an invalid variable_type value", () => {
    const result = validateContract("round-result", {
      ...baseRound,
      variable_type: "mechanism",
    });
    expect(result.success).toBe(false);
  });
});
