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

/** Env gate (kds topsop_400.mdc item 11 — per-operator env): routing decision,
 * device/toolchain, and build credentials recorded before exploration.
 * Worker: topsop-setup-env. */
const topsopEnvReportSchemaV2 = z.object({
  status: z.enum(["ready", "blocked"]),
  target: z.object({ operator: z.string(), shape: z.string(), dtype: z.string() }),
  device: z.object({
    name: z.string(),
    architecture: z.string(),
    test_host: z.string().min(1).describe("远程测试机（ophal device --status 的 Test host: 字段，如 wsj@10.12.115.153），环境确认的关键产出"),
  }),
  toolchain: z.object({ compiler: z.string(), runtime: z.string(), profiler: z.string() }),
  build: z.object({
    so_path: z.string().min(1),
    so_mtime: z.string().optional(),
    so_commit: z.string().optional(),
  }).optional(),
  state_path: z.string().min(1).optional(),
  blocker: z.string().min(1).optional(),
}).superRefine((report, context) => {
  if (report.status === "ready" && report.blocker !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["blocker"], message: "ready env report must not carry a blocker" });
  }
  if (report.status === "blocked" && report.blocker === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["blocker"], message: "blocked env report must explain the blocker" });
  }
});

/** Explore gate (kds topsop_400.mdc stage 2 — 宏观架构设计, 禁止跳过): the source
 * call chain and the pipeline / L1 buffer / SIP allocation architecture must be
 * stated before the theory stage. Required on `ready`. Worker: topsop-explore. */
const topsopExploreReportSchemaV2 = z.object({
  status: z.enum(["ready", "blocked"]),
  call_chain: z.string().min(1).describe("Host API → OpBase → device kernel 调用链摘要，带 file:line anchors").optional(),
  architecture: z.object({
    pipeline: z.string().min(1).describe("Pipeline 阶段划分与职责：stage 数量、每阶段负责的计算/搬运、DTE trigger/wait 序列"),
    l1_buffers: z.string().min(1).describe("L1 VDMEM buffer 布局：buffer 名/大小/对齐颗粒/alias/生命周期，校验不超 896KB/SIP"),
    sip_allocation: z.string().min(1).describe("SIP 分配策略：静态均匀 / cost-model / 动态；每个 SIP 承担的工作与负载均衡方式"),
    variant_selected: z.string().min(1).describe("host dispatch 选中的主路径 kernel tier（如 dte_load kN=8/kD=2）与选择依据：kMaxDLen 对齐、VDMEM/thread、fallback 未命中的原因"),
  }).optional(),
  test_entry: z.string().min(1).describe("定位到的正式测试入口 / target case 名").optional(),
  build_target: z.string().min(1).describe("从源码/测试推导出的编译 target 名，供 theory 阶段 ophal build 使用").optional(),
  reference_ops: z.array(z.string()).describe("参考算子：cc_kernel/ 下计算模式最接近的实现").optional(),
  /** ISSUE-015 硬件常量表：idea / theory / estimate 直接读取的已知硬件常量 + 权威来源路径，
   * 禁止全盘搜索硬件定义（如 `find /` 找 `GCU_VDMEM_SIZE_PER_THREAD`）。后续 stage 从本字段注入。 */
  hardware_constants: z.object({
    l1_vdmem_bytes_per_sip: z.number().int().positive().describe("L1 VDMEM 每 SIP 容量（byte）：1.5MB / SIP = 1572864，向量数据驻留；实际上限 L1_MAX_SIZE = 1572864 - 512"),
    l1_sdmem_bytes_per_sip: z.number().int().positive().describe("L1 SDMEM 每 SIP 容量（byte）：128KB / SIP = 131072，栈 / parameter buffer / 未标 __local__ 的普通局部数组"),
    l1_imem_bytes_per_sip: z.number().int().positive().describe("L1 IMEM 每 SIP 容量（byte）：128KB / SIP = 131072，指令缓存"),
    l2_bytes_per_die: z.number().int().positive().describe("L2 每 DIE 容量（byte）：64MB / DIE = 67108864，DIE 内 SIP 共享、跨 DIE 不共享"),
    vc_budget_per_sip: z.number().int().positive().describe("每 SIP 的 VC（vector core / DTE context）预算；3-stage DTE schedule 需 6 个 private_dte context，超过预算会重触发 in-flight context"),
    tier_alignment: z.object({
      qa: z.number().int().positive().describe("QA 对齐颗粒（byte）：512，1D 计算流默认"),
      da: z.number().int().positive().describe("DA 对齐颗粒（byte）：256，1D 计算流 shape ≤256 byte 时可降级"),
      va: z.number().int().positive().describe("VA 对齐颗粒（byte）：128"),
    }),
    sources: z.array(z.string().min(1)).describe("硬件常量的权威来源文件路径（gcu300 skill 文档 / 源码头文件），agent 直接引用，禁止全盘搜索"),
  }).optional(),
  /** ISSUE-018 跨层结构探索盲区：同类算子 DTE 搬移策略 / 官方实现验证过的机制候选，供 idea
   * 作为跨层候选源。只当可达性参考，不读官方 diff、不复制机制。 */
  external_mechanism_candidates: z.array(z.object({
    mechanism: z.string().min(1).describe("外部实现采用的机制描述，如 '官方用 block-shared local DTE 搬 gamma'"),
    source: z.string().min(1).describe("候选来源：官方实现 / 参考算子 / 同类算子的 DTE 搬运策略"),
    present_in_source: z.boolean().describe("该机制是否已存在于当前源码"),
  })).optional(),
  blocker: z.string().min(1).optional(),
}).superRefine((report, context) => {
  if (report.status === "ready" && report.blocker !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["blocker"], message: "ready explore report must not carry a blocker" });
  }
  if (report.status === "ready" && report.call_chain === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["call_chain"], message: "ready explore report must include the source call chain" });
  }
  if (report.status === "ready" && report.architecture === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["architecture"], message: "ready explore report must include the architecture design (pipeline / l1_buffers / sip_allocation)" });
  }
  if (report.status === "blocked" && report.blocker === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["blocker"], message: "blocked explore report must explain the blocker" });
  }
});

/** Theory-ceiling gate (kds topsop_400.mdc stages 1+5): baseline build +
 * correctness + profile evidence, and the roofline theory ceiling from the LLC
 * balance rule — RD/WR ≤ 3 AND WR/RD ≤ 3 (both > 0) → balanced (3000 GB/s),
 * otherwise one-directional (2500 GB/s). Required on `ready`.
 * Worker: topsop-estimate. */
const topsopTheoryReportSchemaV2 = z.object({
  /** `timing-only` is a truthful fallback when hardware counters are not
   * available. `blocked` carries the real reason the theory pass could not
   * produce a baseline. */
  status: z.enum(["ready", "timing-only", "blocked"]).optional(),
  target_operator: z.string(),
  shape: z.string().optional(),
  baseline: z.object({
    kernel_source: z.string().min(1),
    build: z.object({
      so_path: z.string().min(1),
      so_mtime: z.string().optional(),
      so_commit: z.string().optional(),
    }),
    correctness: z.object({
      target_case_passed: z.boolean(),
      full_regression_passed: z.boolean(),
      passed_count: z.number().int().min(0).optional(),
      total_count: z.number().int().min(0).optional(),
    }).optional(),
    profile: z.object({
      kernel_latency_us: z.number().finite().optional(),
      llc_read_bandwidth_gbps: z.number().finite().optional(),
      llc_write_bandwidth_gbps: z.number().finite().optional(),
      llc_rw_sum_gbps: z.number().finite().optional(),
      llc_read_bytes: z.number().int().min(0).optional(),
      llc_write_bytes: z.number().int().min(0).optional(),
      sip_1d_efficiency: z.number().min(0).max(1).optional(),
      vpd_bottleneck: z.string().optional(),
    }).optional(),
  }).optional(),
  theory: z.object({
    read_write_balanced: z.boolean(),
    bandwidth_limit_gbps: z.number().finite().positive(),
    theory_min_us: z.number().finite().positive(),
    bandwidth_utilization: z.number().min(0).max(1),
  }).optional(),
  blocker: z.string().min(1).optional(),
}).superRefine((report, context) => {
  const status = report.status ?? "ready";
  if (status === "blocked") {
    if (report.blocker === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["blocker"], message: "blocked theory report must explain the blocker" });
    }
    return;
  }
  if (status === "ready" && report.baseline === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["baseline"], message: "ready theory report must include baseline evidence" });
  }
  if (status === "ready" && report.theory === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["theory"], message: "ready theory report must include the roofline theory ceiling from the LLC balance rule" });
  }
  if (status === "ready" && report.theory !== undefined) {
    const p = report.baseline?.profile;
    const read = p?.llc_read_bandwidth_gbps;
    const write = p?.llc_write_bandwidth_gbps;
    if (read !== undefined && write !== undefined && read > 0 && write > 0) {
      const balanced = read / write <= 3 && write / read <= 3;
      const expectedLimit = balanced ? 3000 : 2500;
      if (report.theory.read_write_balanced !== balanced) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["theory", "read_write_balanced"], message: `read_write_balanced must follow the LLC rule: RD/WR≤3 AND WR/RD≤3 → ${balanced}` });
      }
      if (report.theory.bandwidth_limit_gbps !== expectedLimit) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["theory", "bandwidth_limit_gbps"], message: `bandwidth_limit_gbps must be ${expectedLimit} under the LLC balance rule` });
      }
      if (p?.llc_rw_sum_gbps !== undefined) {
        const expectedUtil = Math.min(p.llc_rw_sum_gbps / expectedLimit, 1);
        if (Math.abs(report.theory.bandwidth_utilization - expectedUtil) > 0.02) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["theory", "bandwidth_utilization"], message: `bandwidth_utilization must equal llc_rw_sum / bandwidth_limit (${expectedUtil.toFixed(3)} ±0.02)` });
        }
      }
      if (p?.llc_read_bytes !== undefined && p.llc_write_bytes !== undefined) {
        const bytes = p.llc_read_bytes + p.llc_write_bytes;
        const expectedMinUs = bytes / (expectedLimit * 1e3);
        if (Math.abs(report.theory.theory_min_us - expectedMinUs) > expectedMinUs * 0.03) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["theory", "theory_min_us"], message: `theory_min_us must equal (read_bytes + write_bytes) / bandwidth_limit (${expectedMinUs.toFixed(2)} us ±3%)` });
        }
      }
    }
  }
});

/** Profile evidence for the topsop/GCU400 flow: kernel latency and LLC
 * read/write bandwidth are the primary metrics; 1D efficiency and the VPD
 * bottleneck label explain why the kernel sits where it does. */
const topsopProfileReportSchemaV2 = z.object({
  /** `timing-only` is a truthful fallback when hardware counters are not
   * available. `blocked` carries the real reason a profile could not run. */
  status: z.enum(["ready", "timing-only", "blocked"]).optional(),
  target_operator: z.string(),
  shape: z.string().optional(),
  device: z.object({ name: z.string(), architecture: z.string() }),
  metrics: z.object({
    kernel_latency_us: z.number().finite(),
    llc_read_bandwidth_gbps: z.number().finite().optional(),
    llc_write_bandwidth_gbps: z.number().finite().optional(),
    llc_rw_sum_gbps: z.number().finite().optional(),
    sip_1d_efficiency: z.number().min(0).max(1).optional(),
    sip_2d_efficiency: z.number().min(0).max(1).optional(),
    llc_read_bytes: z.number().int().min(0).optional(),
    llc_write_bytes: z.number().int().min(0).optional(),
    /** llc_rw_sum / bandwidth-limit (LLC balance rule: RD/WR≤3 AND WR/RD≤3 →
     * 3000 GB/s, else 2500 GB/s), clamped to 1. */
    bandwidth_utilization: z.number().min(0).max(1).optional(),
  }),
  vpd: z.object({
    duration_cycles: z.number().int().min(0).optional(),
    bottleneck: z.enum(["DTE_BOUND", "COMPUTE_BOUND", "UNKNOWN"]).optional(),
    diagnostic: z.string().optional(),
  }).optional(),
  self_consistency: z.object({
    implied_bandwidth_gbps: z.number().finite().optional(),
    consistent: z.boolean().optional(),
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
  if (status === "ready" && report.metrics.sip_1d_efficiency === undefined && report.metrics.sip_2d_efficiency === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["metrics", "sip_1d_efficiency"], message: "ready topsop profile must include 1D or 2D efficiency" });
  }
  if (status === "ready" && report.metrics.llc_rw_sum_gbps === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["metrics", "llc_rw_sum_gbps"], message: "ready topsop profile must include llc_rw_sum_gbps (LLC read+write sum)" });
  }
  if (status === "ready") {
    const { llc_read_bandwidth_gbps: read, llc_write_bandwidth_gbps: write, llc_rw_sum_gbps: rw, bandwidth_utilization: util } = report.metrics;
    if (read !== undefined && write !== undefined && read > 0 && write > 0 && rw !== undefined) {
      const limit = read / write <= 3 && write / read <= 3 ? 3000 : 2500;
      if (util !== undefined) {
        const expectedUtil = Math.min(rw / limit, 1);
        if (Math.abs(util - expectedUtil) > 0.02) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["metrics", "bandwidth_utilization"], message: `bandwidth_utilization must equal llc_rw_sum / bandwidth-limit (${expectedUtil.toFixed(3)} ±0.02 under the LLC balance rule)` });
        }
      }
    }
  }
});

/** Implementation gate (kds topsop_400.mdc stage 3/6): the single variable
 * applied to the kernel / host dispatch source and its compile result.
 * Worker: topsop-implement. The correctness gate is the separate
 * `verification-report` (worker: topsop-verify). */
const topsopImplementationReportSchemaV2 = z.object({
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

/** Codegen-layer bottleneck evidence (ISSUE-011): `ophal asm` output on the
 * current-best kernel, collected on-demand by the measure worker when the
 * KEEP/DISCARD boundary is ambiguous (|regression_pp| within 1-5pp) or device
 * metrics cannot attribute the bottleneck. All evidence fields are optional:
 * rounds that do not trigger asm carry no report and existing validation is
 * unaffected. Worker: topsop-optimize (measure mode). */
const topsopAsmReportSchemaV2 = z.object({
  status: z.enum(["ready", "blocked"]),
  target_operator: z.string().describe("当前最佳 kernel 对应的算子名"),
  /** `ophal asm` 的输入来源：kernel 编译单元 / 源文件路径 */
  asm_source: z.string().min(1).describe("ophal asm 作用的编译单元 / kernel 源（如 lib/op/normalize/.../add_add_rms_norm_dte_load_impl.h）").optional(),
  assembly_bottleneck_points: z.array(z.object({
    type: z.enum(["scheduling", "bank_conflict", "register_pressure", "slot", "pipeline_stall", "other"]),
    description: z.string(),
    evidence: z.string(),
  })).describe("汇编级瓶颈点：指令调度 / bank conflict / 寄存器压力 / VLIW slot 浪费 / 流水线 stall").optional(),
  slot_utilization: z.number().min(0).max(1).describe("VLIW slot 利用率 0-1").optional(),
  bank_conflict: z.object({
    detected: z.boolean(),
    description: z.string().optional(),
  }).describe("bank conflict 检测结果").optional(),
  register_pressure: z.number().min(0).describe("寄存器压力（占用数量 / 比例）").optional(),
  estimated_cycles: z.number().min(0).describe("汇编路径估算 cycle 数").optional(),
  analysis: z.string().describe("codegen 层瓶颈归因结论").optional(),
  raw_path: z.string().min(1).describe("ophal asm 输出文件路径").optional(),
  blocker: z.string().min(1).optional(),
}).superRefine((report, context) => {
  if (report.status === "blocked") {
    if (report.blocker === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["blocker"], message: "blocked asm report must explain the blocker" });
    }
    return;
  }
  if (report.status === "ready" && report.analysis === undefined && report.assembly_bottleneck_points === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["analysis"], message: "ready asm report must include analysis or assembly_bottleneck_points" });
  }
});

/** One complete topsop tuning round: the single variable changed, the
 * verification gate, before/after profile evidence, and the decision that
 * drives the next round. CONVERGED closes the loop with no further candidate. */
const topsopRoundResultSchemaV2 = z.object({
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
    sip_1d_efficiency: z.number().min(0).max(1).optional(),
    profile_path: z.string().min(1).optional(),
  }).optional(),
  /** Utilization change vs the baseline / current-best, in percentage points
   * (positive = improvement). Enforces the topsop_400.mdc rollback line (>1pp
   * regression must not KEEP) and promotion line (≥5pp gain should not
   * DISCARD). Required on measured rounds, forbidden on failed/blocked ones. */
  regression_pp: z.number().finite().optional(),
  /** 可选 codegen 层汇编证据（ISSUE-011）：KEEP/DISCARD 边界模糊（|regression_pp|
   * 在 1~5pp 之间）或 device 指标无法归因瓶颈时，measure worker 对当前最佳 kernel
   * 跑 `ophal asm`，结果作为下一轮 idea 的注入上下文。缺省轮不携带；失败/blocked
   * 轮禁止携带。 */
  asm_report: topsopAsmReportSchemaV2.optional(),
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
  if ((compileFailed || verifyFailed || round.decision === "BLOCKED") && round.asm_report !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["asm_report"], message: "failed or blocked rounds must not carry asm_report" });
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
 * the memory-closure half of the kds per-operator loop: without a field that
 * proves the test-script header progress record was updated, summary mode's
 * "update Current status / append R<n>" is only a SKILL-text soft constraint.
 * When the run improved or stayed neutral, the summary MUST carry
 * `progress_record` (file_path + current_status + one R<n> entry) so the
 * write-back is contract-verifiable. Worker: topsop-verify (summary mode). */
const topsopSummaryReportSchemaV2 = z.object({
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

  /** Env gate: routing + device/toolchain + build credentials (item 11). */
  "topsop-env-report": topsopEnvReportSchemaV2,

  /** Explore gate: source call chain + architecture design (stage 2). */
  "topsop-explore-report": topsopExploreReportSchemaV2,

  /** Theory-ceiling gate: baseline profile + LLC balance-rule ceiling (stage 1+5). */
  "topsop-theory-report": topsopTheoryReportSchemaV2,

  /** Profile evidence with LLC bandwidth + latency + 1D efficiency. */
  "topsop-profile-report": topsopProfileReportSchemaV2,

  /** Implementation gate: single variable applied + compile result (stage 3/6). */
  "topsop-implementation-report": topsopImplementationReportSchemaV2,

  /** One topsop tuning round: variable + verification + profile + decision. */
  "topsop-round-result": topsopRoundResultSchemaV2,

  /** Codegen-layer bottleneck evidence from `ophal asm` (ISSUE-011): optional
   * on-demand report, also nested as `round.asm_report` on boundary rounds. */
  "topsop-asm-report": topsopAsmReportSchemaV2,

  /** Summary/judge stage output: narrative account plus ranking when measured,
   * and (ISSUE-012) the per-operator progress-record write-back proof on
   * improved/neutral runs. */
  "summary-report": topsopSummaryReportSchemaV2,
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
  "topsop-env-report": {
    status: "ready",
    target: { operator: "topssglAddAddRmsNorm", shape: "[16384,2048]", dtype: "bf16" },
    device: { name: "Enflame L600 DEV0", architecture: "GCU400", test_host: "wsj@10.12.115.153" },
    toolchain: { compiler: "ophal", runtime: "topsop", profiler: "topsprof" },
    build: { so_path: "build/lib/libkernel_normalize_sgl_add_add_rms_norm.so", so_commit: "f5cc7d281b", so_mtime: "2026-08-24 16:24:43 +0800" },
    state_path: "state/tuning-state.json",
  },
  "topsop-explore-report": {
    status: "ready",
    call_chain: "topsatenAddAddRmsNorm (include/topsaten) → topsop/lib/ops/sgl/op_sgl_add_add_rms_norm.cc OpBase → cc_kernel/normalize/sgl_add_add_rms_norm/gcu400/add_add_rms_norm_dte_load_impl.h",
    architecture: {
      pipeline: "2-stage DTE load + compute: DTE copies x1/x2 to L1, compute normalizes in VACC; single DTE trigger/wait pair per tile",
      l1_buffers: "x1/x2/rms buffers at 512B-aligned __local__ slots; 3 × 64KB in 896KB/SIP; no alias; wait before re-trigger",
      sip_allocation: "static even across 24 SIPs, base + (id < extra ? 1 : 0)",
      variant_selected: "dte_load kN=8/kD=2 selected by host dispatch for the target shape",
    },
    test_entry: "topsop/test/unit/sgl/sgl_add_add_rms_norm_test",
    build_target: "kernel_normalize_sgl_add_add_rms_norm",
    reference_ops: ["cc_kernel/normalize/add_rms_norm", "cc_kernel/normalize/rms_norm_1d"],
    hardware_constants: {
      l1_vdmem_bytes_per_sip: 1572864,
      l1_sdmem_bytes_per_sip: 131072,
      l1_imem_bytes_per_sip: 131072,
      l2_bytes_per_die: 67108864,
      vc_budget_per_sip: 11,
      tier_alignment: { qa: 512, da: 256, va: 128 },
      sources: ["CLAUDE.md §8 存储层级", ".claude/skills/gcu300-isa-ref/document/isa32_arch_state.md", ".claude/skills/gcu300-dataflow/SKILL.md"],
    },
    external_mechanism_candidates: [{
      mechanism: "官方用 block-shared local DTE 搬 gamma（kernel 内共享 DTE context）",
      source: "官方实现 eb8b65cc5e",
      present_in_source: false,
    }],
  },
  "topsop-theory-report": {
    status: "ready",
    target_operator: "topssglAddAddRmsNorm",
    shape: "[16384,2048]",
    baseline: {
      kernel_source: "lib/op/normalize/sgl_add_add_rms_norm/gcu400/add_add_rms_norm_dte_load_impl.h",
      build: { so_path: "build/lib/libkernel_normalize_sgl_add_add_rms_norm.so", so_commit: "f5cc7d281b", so_mtime: "2026-08-24 16:24:43 +0800" },
      correctness: { target_case_passed: true, full_regression_passed: true, passed_count: 24, total_count: 24 },
      profile: { kernel_latency_us: 216.23, llc_read_bandwidth_gbps: 961.25, llc_write_bandwidth_gbps: 929.46, llc_rw_sum_gbps: 1890.71, llc_read_bytes: 207900000, llc_write_bytes: 200900000, sip_1d_efficiency: 0.2832, vpd_bottleneck: "DTE_BOUND" },
    },
    theory: { read_write_balanced: true, bandwidth_limit_gbps: 3000, theory_min_us: 136.27, bandwidth_utilization: 0.6302 },
  },
  "topsop-implementation-report": {
    status: "compiled",
    variable: "SUBTHREAD_NUM 2->1, kN=32",
    diff_summary: "add_add_rms_norm_dte_load_impl.h: single DTE load of 64KB/tile; SUBTHREAD_NUM 2->1; kN=32",
    changed_files: ["lib/op/normalize/sgl_add_add_rms_norm/gcu400/add_add_rms_norm_dte_load_impl.h"],
    compile: { passed: true, target: "kernel_normalize_sgl_add_add_rms_norm", so_commit: "a1b2c3d4", so_mtime: "2026-08-26 10:11:12 +0800" },
  },
  "topsop-profile-report": {
    status: "ready",
    target_operator: "topssglAddAddRmsNorm",
    shape: "[16384,2048]",
    device: { name: "Enflame L600 DEV0", architecture: "GCU400" },
    metrics: { kernel_latency_us: 186.05, llc_read_bandwidth_gbps: 1104.56, llc_write_bandwidth_gbps: 1085.41, llc_rw_sum_gbps: 2189.97, sip_1d_efficiency: 0.3275, bandwidth_utilization: 0.73 },
    vpd: { duration_cycles: 215433, bottleneck: "DTE_BOUND", diagnostic: "wait-for-mailbox dominates" },
    self_consistency: { implied_bandwidth_gbps: 2183, consistent: true },
    bottlenecks: [{ type: "memory", description: "LLC bandwidth bound", evidence: "bytes / latency ≈ measured" }],
    analysis: "read path ~1.1 TB/s + write path ~1.08 TB/s is the practical ceiling",
    raw_path: "profiles/iter-000/kernel.json",
  },
  "topsop-round-result": {
    iteration: 1,
    variable: "SUBTHREAD_NUM 2->1, kN=32",
    variable_type: "config",
    hypothesis: "64KB transfer recovers read bandwidth",
    decision: "KEEP",
    candidate: { path: "lib/op/.../add_add_rms_norm_dte_load_impl.h" },
    current_best: { path: "lib/op/.../add_add_rms_norm_dte_load_impl.h" },
    verification: { compile_passed: true, verify_passed: true, report_path: "reports/verify.json" },
    profile: { kernel_latency_us: 186.05, llc_read_bandwidth_gbps: 1104.56, llc_write_bandwidth_gbps: 1085.41, llc_rw_sum_gbps: 2189.97, sip_1d_efficiency: 0.3275, profile_path: "profiles/iter-001/kernel.json" },
    regression_pp: 9.98,
    promotion: { promoted: true, resulting_best: { path: "lib/op/.../add_add_rms_norm_dte_load_impl.h" }, reason: "null result, keep R5 config" },
    next_variable: null,
    records: { round_path: "rounds/iter-001.json", state_path: "state/tuning-state.json" },
  },
  "topsop-asm-report": {
    status: "ready",
    target_operator: "topssglAddAddRmsNorm",
    asm_source: "lib/op/normalize/sgl_add_add_rms_norm/gcu400/add_add_rms_norm_dte_load_impl.h",
    assembly_bottleneck_points: [
      { type: "slot", description: "pass-1 inner loop VLIW slots half idle", evidence: "3 of 6 slots issue per bundle" },
      { type: "pipeline_stall", description: "DTE wait drains compute pipeline", evidence: "wait on mailbox before each tile" },
    ],
    slot_utilization: 0.5,
    register_pressure: 40,
    estimated_cycles: 159685,
    analysis: "compute-side VLIW underutilized; DTE wait forces drain - scheduling, not bandwidth",
    raw_path: "asm/iter-002/current-best.s",
  },
  "summary-report": {
    run_id: "20260829T073054-0a60d1",
    summary: "short summary of the run outcome",
    outcome: "improved",
    ranking: ["candidate-a", "candidate-b"],
    winner: "candidate-a",
    progress_record: {
      file_path: "topsop/test/unit/sgl/sgl_add_add_rms_norm_test.cc",
      current_status: "stable",
      entry: "R12: iter-2 2-deep interleave KEEP 158.50us / 2588.51 GB/s | evidence: 20260829T073054-0a60d1 | next: none",
    },
  },
};

export function validationGuidance(name: ContractName): string {
  return JSON.stringify(VALIDATION_EXAMPLES[name], null, 2);
}
