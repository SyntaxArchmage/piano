// Legacy code-first contract payload schemas for historical workflows.
//
// A historical workflow stage may declare `validate` by name. Each name maps
// 1:1 to a predefined zod schema here. New stages use `validate: true` and a
// worker-local contract.json instead. A stage that declares `validate` writes
// the JSON result path supplied by the orchestrator for that invocation; the
// orchestrator validates the result against the named schema.
//
// A stage without `validate` just returns its text. Handoff records are written
// separately by the orchestrator and are not agent-owned validation output.
//
// The tuning-role schemas keep the payload shape and business invariants
// required by the artifact contracts without requiring an external contract
// version field.

import { z } from "zod";

/** Historical acceptance predicate for the deprecated named contract.
 * Workspace-boundary safety belongs to winner-commit/workspace validation;
 * this deliberately preserves the pre-migration contract's acceptance set. */
function unsafeChangedFilePath(path: string): boolean {
  if (path.trim() === "" || path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return true;
  return path.split("/").some((segment) => segment === "..");
}

const verificationReportSchema = z.object({
  artifact: z.string(),
  compile: z.object({
    passed: z.boolean(),
    exit_code: z.number().int(),
    stderr: z.string().optional(),
  }),
  run: z.object({
    passed: z.boolean(),
    exit_code: z.number().int(),
    output: z.string().optional(),
  }),
  numeric_check: z.object({
    passed: z.boolean(),
    tolerance: z.number().positive().optional(),
    max_error: z.number().min(0).optional(),
  }),
  verdict: z.enum(["pass", "fail"]),
  failure_details: z.string().optional(),
}).superRefine((report, context) => {
  for (const [name, step] of [["compile", report.compile], ["run", report.run]] as const) {
    const expectedPassed = step.exit_code === 0;
    if (step.passed !== expectedPassed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name, "passed"],
        message: `must be ${expectedPassed} when exit_code is ${step.exit_code}`,
      });
    }
  }
  const passed = report.compile.passed && report.run.passed && report.numeric_check.passed;
  const expectedVerdict = passed ? "pass" : "fail";
  if (report.verdict !== expectedVerdict) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["verdict"],
      message: `must be "${expectedVerdict}" when compile, run, and numeric_check passed are ${passed}`,
    });
  }
});

const artifactRefSchema = z.object({
  path: z.string().min(1),
  digest: z.string().min(1).optional(),
});

const benchmarkEvidenceSchema = z.object({
  metric: z.string().min(1),
  direction: z.enum(["higher", "lower"]),
  samples: z.array(z.number().finite()).min(1),
  best: z.number().finite(),
  median: z.number().finite(),
  runs: z.number().int().min(1),
  warmup: z.number().int().min(0),
  raw_path: z.string().min(1).optional(),
});

/** Setup is a typed gate: a tuning loop may only claim readiness when the
 * device, toolchain, seed, and current-best state are all recorded. */
const cudaPreparationReportSchema = z.object({
  status: z.enum(["ready", "blocked"]),
  target: z.object({ operator: z.string(), shape: z.string(), dtype: z.string() }),
  device: z.object({ name: z.string(), architecture: z.string() }),
  toolchain: z.object({ compiler: z.string(), runtime: z.string(), profiler: z.string() }),
  baseline: z.object({
    custom_kernel: artifactRefSchema,
    reference_metric: z.number().finite().optional(),
    custom_metric: z.number().finite().optional(),
  }).optional(),
  current_best: artifactRefSchema.optional(),
  state_path: z.string().min(1).optional(),
  blocker: z.string().min(1).optional(),
}).superRefine((report, context) => {
  if (report.status === "ready" && report.blocker !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["blocker"], message: "ready preparation must not carry a blocker" });
  }
  if (report.status === "ready" && (report.baseline === undefined || report.current_best === undefined || report.state_path === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "ready preparation must include baseline, current_best, and state_path" });
  }
  if (report.status === "blocked" && report.blocker === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["blocker"], message: "blocked preparation must explain the blocker" });
  }
});

/** One complete tuning iteration. Benchmark evidence is optional only for a
 * truthful compile/verify/blocker outcome; it is forbidden on those failures. */
const cudaRoundResultSchema = z.object({
  iteration: z.number().int().min(0),
  decision: z.enum(["KEEP", "DISCARD", "COMPILE_FAIL", "VERIFY_FAIL", "BLOCKED"]),
  candidate: artifactRefSchema,
  current_best: artifactRefSchema,
  verification: z.object({
    compile_passed: z.boolean(),
    verify_passed: z.boolean(),
    report_path: z.string().min(1).optional(),
    diagnostics_path: z.string().min(1).optional(),
  }),
  benchmark: benchmarkEvidenceSchema.optional(),
  promotion: z.object({
    promoted: z.boolean(),
    resulting_best: artifactRefSchema,
    reason: z.string().min(1),
  }),
  records: z.object({
    round_path: z.string().min(1),
    state_path: z.string().min(1),
    profile_path: z.string().min(1).optional(),
  }),
}).superRefine((round, context) => {
  const compileFailed = !round.verification.compile_passed;
  const verifyFailed = round.verification.compile_passed && !round.verification.verify_passed;
  const expected = compileFailed
    ? "COMPILE_FAIL"
    : verifyFailed
      ? "VERIFY_FAIL"
      : round.decision;
  if (compileFailed && round.decision !== "COMPILE_FAIL") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["decision"], message: "compile failure must use COMPILE_FAIL" });
  }
  if (verifyFailed && round.decision !== "VERIFY_FAIL") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["decision"], message: "verification failure must use VERIFY_FAIL" });
  }
  if ((compileFailed || verifyFailed || round.decision === "BLOCKED") && round.benchmark !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["benchmark"], message: "failed or blocked rounds must not claim benchmark samples" });
  }
  if (!compileFailed && !verifyFailed && round.decision !== "BLOCKED" && round.benchmark === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["benchmark"], message: "measured KEEP/DISCARD rounds require real benchmark evidence" });
  }
  if (round.decision === "KEEP" && !round.promotion.promoted) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["promotion", "promoted"], message: "KEEP must promote the candidate" });
  }
  if (round.decision !== "KEEP" && round.promotion.promoted) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["promotion", "promoted"], message: `${expected} or DISCARD must not promote a candidate` });
  }
});

/** Implementation gate: the single variable applied to the candidate source
 * and its compile result. The correctness gate is the separate
 * `verification-report`. */
const implementationReportSchema = z.object({
  status: z.enum(["compiled", "compile_failed", "blocked"]),
  variable: z.string().min(1).describe("本轮唯一改动变量"),
  diff_summary: z.string().min(1).describe("改动摘要：改了哪些文件、怎么改"),
  /** 本轮实际新增 / 修改的源码文件（kernel / host / test），相对 workspace 根的
   * 相对路径。compiled 轮必填非空——协调层 auto-commit（ISSUE-017）用它判定
   * 每轮 KEEP 要 commit 哪些 winner 文件；blocked / compile_failed 轮不产生
   * commit，可省略。 */
  changed_files: z.array(z.string().min(1)).optional().describe("本轮改动文件清单（相对路径）"),
  compile: z.object({
    passed: z.boolean(),
    target: z.string().min(1),
    so_commit: z.string().optional(),
    so_mtime: z.string().optional(),
    diagnostics_path: z.string().min(1).optional(),
  }),
  blocker: z.string().min(1).optional(),
  /** 分类 blocked 的失效范围：`global`=前置失效（设备/工具链不可用，loop 应终止）；
   * `iteration`=本假设不可实现（loop 应吸收本轮并继续）。缺省视为 `global`。 */
  block_scope: z.enum(["global", "iteration"]).optional(),
}).superRefine((impl, context) => {
  if (impl.status === "compiled" && !impl.compile.passed) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["compile", "passed"], message: "compiled implementation must report compile.passed true" });
  }
  if (impl.status === "compile_failed" && impl.compile.passed) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["compile", "passed"], message: "compile_failed implementation must report compile.passed false" });
  }
  if (impl.status === "blocked" && impl.blocker === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["blocker"], message: "blocked implementation must explain the blocker" });
  }
  if (impl.status !== "blocked" && impl.block_scope !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["block_scope"], message: "block_scope only applies to blocked implementations" });
  }
  if (impl.status === "compiled" && (impl.changed_files === undefined || impl.changed_files.length === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["changed_files"], message: "compiled implementation must report the non-empty changed_files it applied this round" });
  }
  if (impl.changed_files !== undefined) {
    for (const [index, path] of impl.changed_files.entries()) {
      if (unsafeChangedFilePath(path)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["changed_files", index], message: "changed_files paths must be workspace-relative and must not escape the workspace" });
      }
    }
  }
});

/** One complete tuning round: the single variable changed, the verification
 * gate, before/after profile evidence, and the decision that drives the next
 * round. CONVERGED closes the loop with no further candidate. */
const roundResultSchema = z.object({
  iteration: z.number().int().min(0),
  variable: z.string().min(1),
  /** ISSUE-014：本轮变量的类型——structural = 结构性改动（buffer 数 / 流水线深度 / 搬运机制 /
   * fusion chain 变化）；config = 数值调整。作为下一轮 idea 判断是否触发前提失效检查的注入上下文。 */
  variable_type: z.enum(["structural", "config"]).optional(),
  hypothesis: z.string().min(1),
  decision: z.enum(["KEEP", "DISCARD", "CONVERGED", "COMPILE_FAIL", "VERIFY_FAIL", "BLOCKED"]),
  candidate: artifactRefSchema,
  current_best: artifactRefSchema,
  verification: z.object({
    compile_passed: z.boolean(),
    verify_passed: z.boolean(),
    report_path: z.string().min(1).optional(),
    diagnostics_path: z.string().min(1).optional(),
  }).optional(),
  profile: z.object({
    kernel_latency_us: z.number().finite(),
    llc_read_bandwidth_gbps: z.number().finite().optional(),
    llc_write_bandwidth_gbps: z.number().finite().optional(),
    llc_rw_sum_gbps: z.number().finite(),
    profile_path: z.string().min(1).optional(),
  }).optional(),
  /** Utilization change vs the baseline / current-best, in percentage points
   * (positive = improvement). Enforces the rollback line (>1pp regression must
   * not KEEP) and the promotion line (≥5pp gain should not DISCARD). Required
   * on measured rounds, forbidden on failed/blocked ones. */
  regression_pp: z.number().finite().optional(),
  promotion: z.object({
    promoted: z.boolean(),
    resulting_best: artifactRefSchema,
    reason: z.string().min(1),
  }),
  next_variable: z.string().nullable(),
  blocker: z.string().min(1).optional(),
  records: z.object({
    round_path: z.string().min(1),
    state_path: z.string().min(1),
  }),
}).superRefine((round, context) => {
  if (round.decision === "BLOCKED" && round.blocker === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["blocker"], message: "BLOCKED rounds must explain the blocker" });
  }
  const verification = round.verification;
  if (round.decision !== "BLOCKED" && verification === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["verification"], message: "non-BLOCKED rounds must report verification (compile_passed / verify_passed)" });
  }
  const compileFailed = verification !== undefined && !verification.compile_passed;
  const verifyFailed = verification !== undefined && verification.compile_passed && !verification.verify_passed;
  if (compileFailed && round.decision !== "COMPILE_FAIL") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["decision"], message: "compile failure must use COMPILE_FAIL" });
  }
  if (verifyFailed && round.decision !== "VERIFY_FAIL") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["decision"], message: "verification failure must use VERIFY_FAIL" });
  }
  if ((compileFailed || verifyFailed || round.decision === "BLOCKED") && round.profile !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["profile"], message: "failed or blocked rounds must not claim profile evidence" });
  }
  if (!compileFailed && !verifyFailed && round.decision !== "BLOCKED" && round.profile === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["profile"], message: "measured KEEP/DISCARD/CONVERGED rounds require real profile evidence" });
  }
  if (round.decision === "KEEP" && !round.promotion.promoted) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["promotion", "promoted"], message: "KEEP must promote the candidate" });
  }
  if (round.decision !== "KEEP" && round.promotion.promoted) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["promotion", "promoted"], message: `${round.decision} must not promote a candidate` });
  }
  if (round.decision === "CONVERGED" && round.next_variable !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["next_variable"], message: "CONVERGED rounds must set next_variable to null" });
  }
  const measured = !compileFailed && !verifyFailed && round.decision !== "BLOCKED";
  if (measured && round.regression_pp === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["regression_pp"], message: "measured KEEP/DISCARD/CONVERGED rounds must report regression_pp (utilization change vs baseline/current-best, in pp)" });
  }
  if (!measured && round.regression_pp !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["regression_pp"], message: "failed or blocked rounds must not carry regression_pp" });
  }
  if (round.decision === "KEEP" && round.regression_pp !== undefined && round.regression_pp <= -1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["regression_pp"], message: "KEEP requires regression_pp > -1 (a >1pp utilization regression is a rollback risk)" });
  }
  if (round.decision === "DISCARD" && round.regression_pp !== undefined && round.regression_pp >= 5) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["regression_pp"], message: "DISCARD must not have regression_pp >= 5 (a >=5pp utilization gain should be kept)" });
  }
});

/** Summary/judge stage output: narrative account + optional ranking, plus the
 * per-operator progress-record write-back proof (ISSUE-012). The write-back is
 * the memory-closure half of the per-operator loop: without a field that
 * proves the test-script header progress record was updated, summary mode's
 * "update Current status / append R<n>" is only a SKILL-text soft constraint.
 * When the run improved or stayed neutral, the summary MUST carry
 * `progress_record` (file_path + current_status + one R<n> entry) so the
 * write-back is contract-verifiable. */
const summaryReportSchema = z.object({
  run_id: z.string(),
  summary: z.string(),
  outcome: z.enum(["improved", "neutral", "regressed", "unmeasured", "write_only"]).optional(),
  ranking: z.array(z.string()).optional(),
  winner: z.string().nullable().optional(),
  /** Per-operator progress-record write-back evidence: the test-script header
   * actually updated by summary mode (file exists at file_path, header
   * `Current status` = current_status, and `entry` is one newly-appended
   * `R<n>` line per the progress-record protocol). */
  progress_record: z.object({
    file_path: z.string().min(1).describe("实际更新的测试脚本头部进展记录路径"),
    current_status: z.enum(["implementing", "debugging", "optimizing", "stable"]).describe("写回的头部 Current status 值（只允许这四个值）"),
    entry: z.string().min(1).describe("新增的 R<n> 条目文本（每次只追加一条）"),
  }).optional(),
}).superRefine((report, context) => {
  if ((report.outcome === "improved" || report.outcome === "neutral") && report.progress_record === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["progress_record"],
      message: "improved/neutral summaries must prove the per-operator progress record was updated (progress_record.file_path + current_status + entry)",
    });
  }
});

/** Predefined payload schemas, keyed by the `stage.validate` value. */
export const CONTRACT_SCHEMAS = {
  /** The default prompt-response workflow: a single textual answer. */
  "text-response": z.object({ text: z.string() }),

  /** Profile stage output: hardware + metric evidence + bottlenecks. */
  "profile-report": z.object({
    /** `timing-only` is a truthful fallback when hardware counters are not
     * available. `blocked` carries the real reason a profile could not run. */
    status: z.enum(["ready", "timing-only", "blocked"]).optional(),
    target_operator: z.string(),
    device: z.object({ name: z.string(), architecture: z.string() }),
    metrics: z.object({
      compute_utilization: z.number().min(0).max(1).optional(),
      memory_bandwidth_utilization: z.number().min(0).max(1).optional(),
      achieved_occupancy: z.number().min(0).max(1).optional(),
      launch_overhead: z.number().min(0).optional(),
    }).optional(),
    bottlenecks: z.array(z.object({
      type: z.enum(["compute", "memory", "occupancy", "launch"]),
      description: z.string(),
      evidence: z.string(),
    })).optional(),
    analysis: z.string(),
    raw_path: z.string().min(1).optional(),
    blocker: z.string().min(1).optional(),
  }).superRefine((report, context) => {
    const status = report.status ?? "ready";
    if (status === "blocked") {
      if (report.blocker === undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["blocker"], message: "blocked profile must explain the blocker" });
      }
      return;
    }
    if (report.metrics === undefined || report.bottlenecks === undefined || report.bottlenecks.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["metrics"], message: `${status} profile must include metrics and at least one bottleneck` });
      return;
    }
    if (status === "ready" && (
      report.metrics.compute_utilization === undefined ||
      report.metrics.memory_bandwidth_utilization === undefined ||
      report.metrics.achieved_occupancy === undefined ||
      report.metrics.launch_overhead === undefined
    )) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["metrics"], message: "ready profile must include all hardware metrics" });
    }
  }),

  "cuda-preparation-report": cudaPreparationReportSchema,

  /** Propose stage output: prioritized strategies (or explicit already-optimal). */
  "optimization-proposal": z.object({
    strategies: z.array(z.object({
      id: z.string(),
      bottleneck: z.string(),
      technique: z.string(),
      rationale: z.string(),
      predicted_speedup: z.number().positive(),
      risk_level: z.enum(["low", "medium", "high"]),
      conflicts_with: z.array(z.string()).optional(),
      falsification_criterion: z.string().optional().describe("本变量可证伪判据：什么证据能证明假设本轮不成立"),
      mechanism_over_config: z.boolean().optional().describe("true = 目标是实现/验证记录中的机制结构本身，而非仅调 config"),
      variable_type: z.enum(["structural", "config"]).optional().describe("ISSUE-014：本变量的类型——structural = 结构性改动（buffer 数 / 流水线深度 / 搬运机制 / fusion chain 变化）；config = 数值调整。structural 轮必须携带 rechecked_premises"),
    })).min(1),
    already_optimal: z.object({ reason: z.string() }).optional(),
    history_considered: z.array(z.string()).optional(),
    research_queries: z.array(z.string()).optional(),
    /** ISSUE-014 前提失效检查：结构改动会令"某路径是硬上限" / "计算非瓶颈" / "读速率饱和" 等
     * 旧判别失效。结构改动轮（任意 strategy 的 variable_type === "structural"）必须列出被该
     * 结构影响、重新检验过的旧判别及结论；config 轮可选。 */
    rechecked_premises: z.array(z.object({
      premise: z.string().min(1).describe("被结构改动影响、必须重新检验的旧判别"),
      invalidated: z.boolean().describe("重新检验后该判别是否失效"),
      evidence: z.string().min(1).describe("重新检验的证据（最小判别实验 / 当前 profile / 对照数据）"),
    })).optional(),
  }).superRefine((proposal, context) => {
    const structuralRound = proposal.strategies.some((s) => s.variable_type === "structural");
    if (structuralRound && (proposal.rechecked_premises === undefined || proposal.rechecked_premises.length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rechecked_premises"],
        message: "structural rounds must carry rechecked_premises (premise / invalidated / evidence) — a structural change can invalidate old premise judgments (hard ceiling / compute-not-bottleneck / read-rate-saturated)",
      });
    }
  }),

  /** Implement stage output: candidate source, baseline, strategies, compilation. */
  "implementation-record": z.object({
    candidate_source: z.string(),
    baseline: z.object({
      source: z.string(),
      performance: z.string().optional(),
    }),
    strategies_applied: z.array(z.string()).min(1),
    compilation: z.object({
      toolchain: z.string(),
      exit_code: z.number().int().optional(),
      artifacts: z.array(z.string()).optional(),
    }),
  }),

  /** Aggregate stage output: ranked candidates + winner + narrative. */
  "tournament-results": z.object({
    target_metric: z.string(),
    baseline: z.object({
      agent_id: z.literal("baseline"),
      metrics: z.record(z.number()),
      correctness_passed: z.boolean(),
    }),
    candidates: z.array(z.object({
      agent_id: z.string(),
      proposal_summary: z.string(),
      token_cost: z.number().int().min(0),
      correctness_passed: z.boolean(),
      metrics: z.record(z.number()),
      speedup_vs_baseline: z.number().nullable(),
      verdict: z.enum(["improved", "neutral", "regressed", "unmeasured"]),
    })).min(1),
    ranking: z.array(z.string()),
    winner: z.object({
      agent_id: z.string(),
      metric_value: z.number(),
      improvement_flagged: z.boolean(),
      iteration: z.number().int().min(0).optional(),
      carried_from_reference: z.boolean().optional(),
    }).nullable(),
    narrative: z.string(),
    measurement_status: z.enum(["measured", "unmeasured"]),
    metric_direction: z.enum(["higher", "lower"]),
  }),

  /** Verify stage output: programmatic verification of a written artifact. */
  "verification-report": verificationReportSchema,

  /** Bench stage output: raw benchmark samples + summary statistics. */
  "benchmark-evidence": z.object({
    metric: z.string(),
    direction: z.enum(["higher", "lower"]),
    samples: z.array(z.number()),
    best: z.number(),
    median: z.number(),
    mean: z.number().optional(),
    iqr_trimmed_mean: z.number().optional(),
    runs: z.number().int().min(1),
    warmup: z.number().int().min(0),
  }),

  "cuda-round-result": cudaRoundResultSchema,

  /** Implementation gate: single variable applied + compile result. */
  "implementation-report": implementationReportSchema,

  /** One tuning round: variable + verification + profile + decision. */
  "round-result": roundResultSchema,

  /** Summary/judge stage output: narrative account plus ranking when measured,
   * and (ISSUE-012) the per-operator progress-record write-back proof on
   * improved/neutral runs. */
  "summary-report": summaryReportSchema,
} as const;

/** A known contract name (a key of the predefined schema map). */
export type ContractName = keyof typeof CONTRACT_SCHEMAS;

/** Type-guard true when `value` names a predefined contract schema. */
export function isContractName(value: unknown): value is ContractName {
  return typeof value === "string" && value in CONTRACT_SCHEMAS;
}

/** Human-readable list of known names, for compile-time error messages. */
export function knownContractNames(): readonly string[] {
  return Object.keys(CONTRACT_SCHEMAS);
}

/** The parsed payload inferred from a named schema (unknown-safe fallthrough). */
export type ContractPayload<N extends ContractName> =
  z.infer<(typeof CONTRACT_SCHEMAS)[N]>;

/** Compact accepted examples supplied to workers with a `validate` stage. They
 * are deliberately maintained beside the zod definitions so agents receive an
 * actionable shape without having to infer it from a validator name. */
export const VALIDATION_EXAMPLES: { readonly [N in ContractName]: unknown } = {
  "text-response": { text: "concise final response" },
  "profile-report": {
    status: "timing-only",
    target_operator: "kernel.py:run",
    device: { name: "GPU name", architecture: "architecture" },
    metrics: {
      memory_bandwidth_utilization: 0.5,
      launch_overhead: 1.2,
    },
    bottlenecks: [{ type: "memory", description: "what limits throughput", evidence: "measured evidence" }],
    analysis: "short analysis",
  },
  "cuda-preparation-report": {
    status: "ready",
    target: { operator: "gemm", shape: "4096x4096x4096", dtype: "f16" },
    device: { name: "NVIDIA GPU", architecture: "sm_90" },
    toolchain: { compiler: "nvcc", runtime: "CUDA 12", profiler: "ncu" },
    baseline: { custom_kernel: { path: "state/current-best.cu" }, reference_metric: 100, custom_metric: 50 },
    current_best: { path: "state/current-best.cu" },
    state_path: "state/tuning-state.json",
  },
  "optimization-proposal": {
    strategies: [{
      id: "candidate-id",
      bottleneck: "memory",
      technique: "specific change",
      rationale: "why this should help",
      predicted_speedup: 1.1,
      risk_level: "low",
      falsification_criterion: "latency unchanged within noise → hypothesis wrong",
      mechanism_over_config: false,
      variable_type: "config",
    }],
  },
  "implementation-record": {
    candidate_source: "kernel.py",
    baseline: { source: "baseline.py" },
    strategies_applied: ["candidate-id"],
    compilation: { toolchain: "python" },
  },
  "tournament-results": {
    target_metric: "tflops",
    baseline: { agent_id: "baseline", metrics: { tflops: 1 }, correctness_passed: true },
    candidates: [{
      agent_id: "candidate-id",
      proposal_summary: "what changed",
      token_cost: 0,
      correctness_passed: true,
      metrics: { tflops: 1.1 },
      speedup_vs_baseline: 1.1,
      verdict: "improved",
    }],
    ranking: ["candidate-id"],
    winner: { agent_id: "candidate-id", metric_value: 1.1, improvement_flagged: true },
    narrative: "short decision",
    measurement_status: "measured",
    metric_direction: "higher",
  },
  "verification-report": {
    artifact: "kernel.py",
    compile: { passed: true, exit_code: 0 },
    run: { passed: true, exit_code: 0 },
    numeric_check: { passed: true },
    verdict: "pass",
  },
  "benchmark-evidence": {
    metric: "tflops",
    direction: "higher",
    samples: [1, 1.1],
    best: 1.1,
    median: 1.05,
    runs: 2,
    warmup: 1,
  },
  "cuda-round-result": {
    iteration: 0,
    decision: "KEEP",
    candidate: { path: "candidates/iter-000.cu", digest: "sha256:..." },
    current_best: { path: "state/current-best.cu", digest: "sha256:..." },
    verification: { compile_passed: true, verify_passed: true, report_path: "reports/verify.json" },
    benchmark: { metric: "tflops", direction: "higher", samples: [10, 11], best: 11, median: 10.5, runs: 2, warmup: 1, raw_path: "bench/iter-000.txt" },
    promotion: { promoted: true, resulting_best: { path: "state/current-best.cu", digest: "sha256:..." }, reason: "candidate improved best" },
    records: { round_path: "rounds/iter-000.json", state_path: "state/tuning-state.json" },
  },
  "implementation-report": {
    status: "compiled",
    variable: "tile-size 32->64",
    diff_summary: "kernel.cc: widen the tile; update the host dispatch bound",
    changed_files: ["src/kernel.cc", "src/dispatch.cc"],
    compile: { passed: true, target: "kernel", so_commit: "a1b2c3d4", so_mtime: "2026-08-26 10:11:12 +0000" },
  },
  "round-result": {
    iteration: 1,
    variable: "tile-size 32->64",
    variable_type: "config",
    hypothesis: "a wider tile recovers read bandwidth",
    decision: "KEEP",
    candidate: { path: "candidates/iter-001/kernel.cc" },
    current_best: { path: "state/current-best/kernel.cc" },
    verification: { compile_passed: true, verify_passed: true, report_path: "reports/verify.json" },
    profile: { kernel_latency_us: 186.05, llc_rw_sum_gbps: 2189.97, profile_path: "profiles/iter-001/kernel.json" },
    regression_pp: 9.98,
    promotion: { promoted: true, resulting_best: { path: "candidates/iter-001/kernel.cc" }, reason: "measured improvement over the previous best" },
    next_variable: null,
    records: { round_path: "rounds/iter-001.json", state_path: "state/tuning-state.json" },
  },
  "summary-report": {
    run_id: "20260829T073054-0a60d1",
    summary: "short summary of the run outcome",
    outcome: "improved",
    ranking: ["candidate-a", "candidate-b"],
    winner: "candidate-a",
    progress_record: {
      file_path: "tests/unit/regression_test.cc",
      current_status: "stable",
      entry: "R12: iter-2 KEEP 158.50us | evidence: 20260829T073054-0a60d1 | next: none",
    },
  },
};

export function validationGuidance(name: ContractName): string {
  return JSON.stringify(VALIDATION_EXAMPLES[name], null, 2);
}
