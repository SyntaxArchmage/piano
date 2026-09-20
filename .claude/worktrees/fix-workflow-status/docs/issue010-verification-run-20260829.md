# ISSUE-010 Acceptance Run — 20260829T073054-0a60d1

验证 ISSUE-010（loop 吸收 hypothesis-scoped blocked 轮 + 收敛 earlyStop）的
8 轮 Run 验收记录。结论摘要与验收标准核对见 `ISSUES.md` ISSUE-010 段；
本文档保留完整 run 证据，供后续审计。

## Run meta

| 项 | 值 |
|:--|:--|
| run id | `20260829T073054-0a60d1` |
| workflow | `recipes/workflows/topsop-tuning.yml`（`iterations: 8`）|
| baseline | branch `perf/addaddrmsnorm-pingpong-r1-20260828` @ `de8a8a39ce` |
| workspace | worktree `$HOME/topsop-iss010-verify`（clean checkout，隔离主仓库）|
| ophal config | worktree 独立 `ophal_config.json`（repo_root/build_dir 指向自身，build 放 export 内 `$HOME/build/iss010-verify`）|
| 进程 | piano.mjs pid 3901833，约 2 小时完成 |
| 结果 | **35/44 stages，earlyStop 提前收敛，`status: completed`，`outcome: improved`** |

启动前修复：recipes 硬编码 `$HOME/topsop` → 注入 workspace 路径
（commit `68bb80e`），否则 worktree 隔离失效、setup-env 读主仓库配置。

## 逐轮结果

| 轮 | implement 变量 | status | measure | regression_pp | latency (us) | 备注 |
|:--|:--|:--|:--|:--|:--|:--|
| iter-0 | residual-vld-off-dte | compiled | DISCARD | −15.44 | 211.16 | residual 移出 DTE 管线退化；verify 1/1+23/23+K-ASAN clean |
| iter-1 | SUBTHREAD_NUM 2→1 | compiled | DISCARD | −1.43 | 172.77 | 恰好压契约阈值外（KEEP 拒绝 ≤−1）|
| iter-2 | **pass2-pass1-row-interleave-2deep** | compiled | **KEEP** | **+5.63** | **159.88** | 首个被接受优化；达 mission 带宽目标 |
| iter-3 | pass2-pass1-row-interleave-3deep | compiled | DISCARD | −26.78 | 230.79 | KEEP 方向深化失败（寄存器/流水深度冲突）|
| iter-4 | f32mix-fma-square-accumulate | compiled | DISCARD | +0.19 | 158.91 | 收益 <1pp 判为噪声；回滚 9e8e39f00a |
| iter-5 | none-this-round（收敛评估）| **blocked** `block_scope: iteration` | — | — | — | 无新变量；被吸收，loop 继续 |
| iter-6 | none-this-round（收敛评估再确认）| **blocked** `block_scope: iteration` | — | — | — | 连续第 2 个 no-op → **earlyStop** |

iter-0..4 全 compiled（0 compile_failed），verify 每轮 target 1/1 + 全量回归 23/23 +
K-ASAN clean + max_error 0.0。

## 与原 run（20260829T043046-b71dc0）对照

| 维度 | 原 run | 新 run（本验收）|
|:--|:--|:--|
| 终止点 | iter-4 blocked（r7 dte-3deep-buffer-kn4，无 block_scope）→ **27/44 直接终止** | iter-5/6 blocked 带 `iteration` 作用域被吸收 → **35/44 正常收敛关闭** |
| blocked 处理 | 全局终止 | 吸收为 no-op 轮 + blocked 报告传下一轮防重提 |
| 收敛 | 无（被迫终止）| earlyStop（consecutiveNoop=2）|
| blocked 变量重提 | — | r7 未被重提；r3/r5/r6 方向被干净起点自然覆盖（compiled/DISCARD），r4 未现 |

## 验收标准核对

1. **loop 达预算或连续 K 轮 no-op 提前收敛** ✅ — 35/44，iter-5/6 连续 blocked 触发 earlyStop
2. **blocked 轮记录在 evidence** ✅ — result.json 带 block_scope + 完整 blocker；summary 逐轮列出
3. **无 blocked 变量重提** ✅ — r7（原 run 唯一 blocked 变量）未重提
4. **summary 正常关闭带完整 round evidence** ✅ — outcome improved，7 轮变量/决策/数值全在
5. **Regression（2-round 反馈传播）** ✅ — unit 57/57 全过（workflow-execution 27 / loop-map 10 / workflow 20）

## Final state（summary 原文）

> topssglAddAddRmsNorm [16384,2048] BF16 (GCU400): target MET via the 'either'
> criterion's bandwidth leg. Final (current-best R6 2-deep commit 9e8e39f00a,
> profile iter-011): kernel latency 158.50us avg (min 157.84 / max 159.74),
> LLC r+w 2588.51 GB/s = 103.5% of the 2500 GB/s target (READ 1321.05 + WRITE
> 1267.46), bandwidth_utilization 0.8628, 1D eff 34.64%, VPD DTE_BOUND. vs
> baseline (R2 F32MIX de8a8a39ce): latency 171.46->158.50us (-7.6%), LLC r+w
> 2415.39->2588.51 GB/s (+7.2%), bw_util 0.8051->0.8628 (+5.77pp) - improved.
> 1D leg NOT met (34.64% < 80%): gated by the same data-arrival wall - 411MB
> volume moving at ~2600 GB/s = 86.6% of the 3000 GB/s balanced roofline,
> compute busy 0%. Converged value 2583-2597 GB/s across three consecutive
> entry profiles within noise (iter-4 159.25us/2597.08, iter-5
> 158.34us/2583.32, iter-6 158.50us/2588.51). All remaining lever classes
> falsified/exhausted (residual routing, <16,1> transfer shape, 3-deep register
> spill, FMA fusion zero-gain, 3-buffer L1 infeasible, load balance uniform,
> 12B/elem write volume semantically fixed, FP8 N/A for bf16); iter-5/iter-6
> blocked as convergence assessments (no source change). Final state
> verification: HEAD = 9e8e39f00a with no tracked modifications; last kernel
> change iter-4 (FMA, DISCARDed and reverted); R6/iter-2 verify full regression
> 24/24 total. Progress record updated in perf_test.cc header: Current status
> -> stable, R4-R10 + Final entries. No commits made (left in workspace).

## 附加收益（非 ISSUE-010 范围）

- iter-2 `pass2-pass1-row-interleave-2deep` KEEP：latency 171.46→158.50us（−7.6%），
  LLC r+w 2588.51 GB/s = **103.5% 达成 mission 2.5TB/s 带宽目标**
- 收敛判定可靠：连续三轮 entry profile 噪声内（159.25/158.34/158.50us），
  bandwidth leg 达 roofline 86.6%（DTE_BOUND），1D leg（80%）未达且被证伪为数据到达墙
- loop 自动写回进展记录（perf_test.cc header `Current status → stable`，R4-R10 + Final）

## 环境与凭证保护

- 主仓库 `$HOME/topsop`：HEAD `de8a8a39ce` 未动，用户 3 处未提交改动保留
- worktree：HEAD `9e8e39f00a`（iter-2 的 KEEP commit），仅 perf_test.cc 进展记录被
  loop 修改 + evidence 目录 untracked
- 未 commit 任何 topsop 改动（符合 ISSUE-010 Non-goal："do not commit leftover
  topsop kernel/progress-record changes from the working tree"）
- 已提交 piano 仓库：`68bb80e`（recipe 路径参数化）+ `233dd5a`（验收记录）
