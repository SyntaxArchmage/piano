# tune loop 双轮验证记录（topsop add_add_rms_norm）

目标：验证 `topsop-tuning-2round.yml`（iterations: 2）下每个 stage 的契约执行 + **feedback 跨轮传递**。

运行基线：

- topsop 分支：`perf/addaddrmsnorm-pingpong-r1-20260828` @ `5036ac87c1`（R1 双缓冲已 commit，工作区干净）
- mission：`$HOME/orch/mission-topssgl-addaddrmsnorm.txt`（[16384,2048] BF16，LLC r+w ≥ 2.5TB/s 或 1D ≥ 80%）
- 启动：从 `$HOME/topsop` cwd 运行（避免 cwd 漂移 → ophal 配置解析错）
- 理论前置：实测 183.87us vs 理论 137.03us（利用率 75%，VPD COMPUTE_BOUND）——optimize 有 ~25% 空间

## 判定标准

| 维度 | 通过条件 |
|---|---|
| 每个 stage 契约 | stage 的 validate schema 通过、handoff 内容非空且字段齐全 |
| 串行链 | setup-env → explore → theory → loop(profile→idea→implement→verify→measure) → summary 顺序执行 |
| **feedback 跨轮传递** | 第 2 轮 profile 的 `inputs` 含第 1 轮 measure 的 `decision`（loop `feedback: measure`，`[...inputs, ...priorFeedback]`），且 profile 实际引用它 |
| 收敛/退出 | measure 发出 `CONVERGED` + `next_variable: null`，或 summary 正常综合收敛结论 |

## Stage 验证记录

### setup-env
- [x] env report schema 通过
- [x] device / test_host / build 凭证（so_path / so_mtime / so_commit）真实有效
- [x] evidence：`status: ready`；device `Enflame L600 DEV0 / GCU400`；test_host `wsj@10.12.115.153`（正确 config，无 cwd 漂移）；build `so_path=$HOME/build/lib/libkernel_normalize_sgl_add_add_rms_norm.so`、`so_commit=5036ac87c1`（= R1 分支 HEAD，正确）、`so_mtime=2026-08-28 16:29:27 +0800`

### explore
- [x] explore report schema 通过（call_chain / architecture 必填）
- [x] 未发生路径误导 / 无谓下钻（收敛边界生效）
- [x] evidence：`status: ready`；call_chain 977B；architecture 四字段全含 `variant_selected`；build_target `kernel_normalize_sgl_add_add_rms_norm`（mtime 16:29:27, HEAD 5036ac87c1 R1 ping-pong, same-source verified）；test_entry `AddAddRmsNormPerfTest.BF16N16384D2048` + S2 unit seam

### theory
- [x] theory report schema 通过（read_write_balanced / bandwidth_limit_gbps / theory_min_us / bandwidth_utilization）
- [x] 复用 setup-env 新鲜凭证（未无条件重编）
- [x] evidence：`status: ready`；**复用 build 凭证**（so mtime 16:29:27 > 全部源码 ≤18:44，worktree clean @ HEAD 5036ac87c1，未重建 .so，仅刷新 stale perf binary）；正确性 24/24（目标 1/1 diff 0.0 + S1 回归 23/23 + S2 5/5）；baseline profile kernel **183.87us** / LLC r+w **2253.92 GB/s** / 1D 33.52% / VPD **COMPUTE_BOUND**（注意：VPD 已从 R1 记录的 DTE_BOUND 翻转为 COMPUTE_BOUND——瓶颈转移到计算侧）；roofline read/write ratio 1.04 → **3000 GB/s** 上限，theory_min_us **137.03us**，util 0.7513

### loop round 1（iter-0）
#### profile
- [x] profile report schema 通过（kernel latency / LLC r+w / bandwidth_utilization）
- [x] 数值与 R1 基线可对比（~184us / ~2253 GB/s）
- [x] evidence：见 iter-1 profile 注入的 theory handoff——baseline 183.87us / 2253.92 GB/s / VPD COMPUTE_BOUND

#### idea
- [x] optimization-proposal schema 通过（单变量、可落地）
- [x] proposal 基于 profile 的 gap
- [x] evidence：strategy `f32mix-square-accumulate-pass1`（去掉 pass-1 冗余 bf16→fp32 re-widen，12→11 ops/chunk）；rationale 基于 COMPUTE_BOUND 证据（compute 365.8% busy vs CDTE 313.67%）并 **invalidate 旧 next-variable**（SUBTHREAD_NUM 2→1 基于已证伪的 DTE_BOUND 假设）；含 falsification_criterion（±1.5% 噪声带内 → 假设失败 → 转向 DTE/wait leg）；`mechanism_over_config: true`

#### implement
- [x] implementation report schema 通过
- [x] 改动单变量、落点正确、build 成功（sanitizer 先行）
- [x] evidence：`status: compiled`；variable F32MIX（vsqusum += vx*vx 替换 cvt+vmul+vadd）；**sanitizer 先行**（ophal build --sanitizer address 18:11:48 成功）+ normal build（18:16:20）；asm 证明 `m.mop.cvt.rne.bf16f32`+`m.mop.mac.f32`（2 ops）→ `m.mop.mac.bf16`（1 op）

#### verify
- [x] verification report schema 通过
- [x] 目标 case + 回归通过
- [x] evidence：`verdict: pass`（attempt 2）；target `AddAddRmsNormPerfTest.BF16N16384D2048` 1/1 diff 0.000000000；回归 23/23 + K-ASAN clean 23/23；numeric max_error 0.0；tolerance 0.01
  - **重试根因（schema gate 生效）**：attempt 1 的 `tolerance` 字段写为字符串 `"S1 harness BF16 thresholds: abs 1e-2..."`，schema 要求 number → 被拒 → repair 改为 `0.01` → attempt 2 通过

#### measure
- [x] round-result schema 通过（decision: KEEP / DISCARD）
- [x] decision 与证据一致
- [x] evidence：`decision: KEEP`；候选 F32MIX 实测 **171.47us** / LLC r+w **2419.64 GB/s**（+172 GB/s, +7.66%）/ VPD **COMPUTE_BOUND**（从 DTE_BOUND 翻转）；regression_pp +17.21 >> +5 提交线 → promoted（current-best）；next_variable 指向 compute pipeline（reduce instruction count / VLIW packing）

### loop round 2（iter-1）
#### profile
- [x] **inputs 含 round 1 的 decision（feedback 传递）**
- [x] profile 数值反映 round 1 改动后的状态
- [x] evidence：iter-1 profile 注入的 `iteration.json` 的 `inputs` 含 `tune.measure@tune/iter-0`（decision KEEP + F32MIX + 171.47us/2419.64 GB/s + next_variable）**和** `theory@root`；analysis 明确 "Current kernel state = F32MIX candidate (promoted current-best)"，实测 **171.71us** / **2420.54 GB/s** / util 0.8068 / VPD COMPUTE_BOUND

#### idea
- [x] optimization-proposal schema 通过
- [x] proposal 基于 iter-0 feedback 的 next_variable
- [x] evidence：strategy `gamma-hoist-row-batched-pass2`（行-外 3 阶段 → 批量 pass-1）；rationale 明确 "after the iter-0 F32MIX square-accumulate KEEP" + 当前 COMPUTE_BOUND 349.3% busy

#### implement
- [x] implementation report schema 通过
- [x] 改动单变量、落点正确、build 成功
- [x] evidence：`status: compiled`；variable gamma-hoist-row-batched-pass2；compile.passed true；so_commit 5036ac87c1

#### verify
- [x] verification report schema 通过
- [x] 目标 case + 回归通过
- [x] evidence：`verdict: pass`；target 1/1 diff 0.000000000；回归 23/23

#### measure
- [x] round-result schema 通过
- [x] decision 与证据一致（DISCARD 因 catastrophic regression）
- [x] evidence：`decision: DISCARD`；候选 gamma-hoist 实测 **7448.33us**（vs current-best 171.47us，**43.4x 慢**）/ LLC r+w 464.49 GB/s / regression_pp -195.52 → **promotion: false** 正确回滚；kernel 恢复到 current-best F32MIX。证明 loop 证伪机制正常：候选通过 verify 但被 measure 用 device-side 指标拒绝

### summary
- [x] summary report schema 通过
- [x] 综合收敛结论 + 进展记录更新
- [x] evidence：outcome **target NOT reached**（但 R0 215.49us/1895.86 → final **171.47us/2419.64 GB/s**，latency **1.26x**、bandwidth **1.28x** +27.6%）；带宽达目标 96.8%（gap -80.36 GB/s, -3.2%），1D 32.15% vs 80%（gap 47.85pp）；why not reached：COMPUTE_BOUND（指令数/VLIW 是墙）；iter-1 DISCARD 已回滚（kernel 恢复 current-best）；进展记录更新（Current status: stable, R2/R3 entries）

## 运行命令与产物

- 命令（从 topsop cwd 启动，`TSX_TSCONFIG_PATH` 让 tsx 解析 piano workspace 包；避免 cwd 漂移）：
  ```
  cd $HOME/topsop && TSX_TSCONFIG_PATH=$HOME/orch/piano/tsconfig.json \
    $HOME/orch/piano/node_modules/.bin/tsx \
    $HOME/orch/piano/packages/cli/src/main.ts \
    --workflow $HOME/orch/piano/tests/workflow/workflows/topsop-tuning-2round.yml \
    --json -p "$(cat $HOME/orch/mission-topssgl-addaddrmsnorm.txt)"
  ```
- run_id：`20260828T093223-d67bf3`
- 产物：`$HOME/.piano/runs/20260828T093223-d67bf3/`（log.jsonl + executions/ 各 stage result）；当时的 stdout 转储未入库，可从 run 目录 `log.jsonl` 复原
- feedback 证据：iter-1 profile 的 `iteration.json` 的 `inputs` 含 `tune.measure@tune/iter-0`（decision KEEP + 实测 + next_variable）→ **传递确认**
- 启动校验：`workspaceCwd` 正确 = `$HOME/topsop`（已从启动输出确认）

## 结论

双轮验证**全部通过**。核心验证点 feedback 跨轮传递有决定性证据（iter-1 profile 注入上下文含 iter-0 measure 的 decision 且被实际引用）。loop 的 5 个 worker 契约链（profile→idea→implement→verify→measure）两轮都走通，measure 的 KEEP/DISCARD 判定与证据一致，schema gate 拦截了 verify attempt-1 的类型错误（tolerance 字符串→number）。
