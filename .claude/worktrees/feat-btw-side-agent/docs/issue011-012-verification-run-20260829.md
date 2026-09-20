# ISSUE-011/012 Acceptance Run — 20260829T111032-f0088a

验证 ISSUE-011（measure 内按需 `ophal asm` + `topsop-asm-report`）与 ISSUE-012
（summary 强制 `progress_record` 写回）的 Run 层验收记录。结论摘要见
`ISSUES.md` 对应段；本文档保留完整 run 证据，供后续审计。

## Run meta

| 项 | 值 |
|:--|:--|
| run id | `20260829T111032-f0088a` |
| workflow | `recipes/workflows/topsop-tuning.yml`（`iterations: 8`）|
| baseline | `de8a8a39ce`（R2 F32MIX）|
| workspace | worktree `$HOME/topsop-iss012-verify`（clean checkout，主仓库未动）|
| ophal config | worktree 独立（repo_root/build_dir 指向自身，build 放 export 内 `$HOME/build/iss012-verify`）|
| 进程 | piano.mjs pid 4141198，约 2h12m 完成 |
| 结果 | **38/44 stages，iter-6/7 连续 blocked → earlyStop，`status: completed`** |

## 逐轮结果

| 轮 | implement 变量 | status | measure | regression_pp | latency (us) / LLC r+w (GB/s) | 备注 |
|:--|:--|:--|:--|:--|:--|:--|
| iter-0 | R4 pass2-pass1 2-deep row interleave | compiled | **KEEP** | +5.78 | 158.68 / 2590.74 | 首个被接受优化；mission 达成 |
| iter-1 | R5 residual-LSU-offload + 3-deep prefetch | compiled | DISCARD | −57.46 | 475.72 / 866.94 | 明确回退 |
| iter-2 | R6 DTE flat rank-1 slice config | compiled | **KEEP** | +0.59 | 159.41 / 2608.28 | |
| iter-3 | R7 SUBTHREAD_NUM 2→1, kN=16 | compiled | DISCARD | −2.64 | 162.11 / 2529.06 | 边界数值但归因清晰（coarser kN=16 伤带宽）|
| iter-4 | dte-issue-before-wait-convergence-probe | **blocked** (iteration) | — | — | — | 提案合法性声明对 R6 代码不成立；被吸收 |
| iter-5 | R8 `<8,1>` tier config control | compiled | **KEEP** | +0.07 | 157.78 / 2610.37 | 最终 winner |
| iter-6 | convergence 声明 | **blocked** (iteration) | — | — | — | 无 kernel change |
| iter-7 | convergence 声明 | **blocked** (iteration) | — | — | — | 连续第 2 轮 no-op → **earlyStop** |

iter-4/6/7 blocked 均带 `block_scope: iteration` 被 loop 吸收（ISSUE-010 机制复现，
对照原 run 同类全局终止）。verify 5/8 + measure 5/8（blocked 轮无 verify/measure）。

## 验收标准核对

### ISSUE-012（Run 层）✅

1. **summary 携带可验证 `progress_record`** ✅ — `outcome: improved`，progress_record
   三字段齐全：`file_path=topsop/test/system/torch/normalize/topssgl_add_add_rms_norm_perf_test.cc`、
   `current_status=stable`、`entry=R8 ...`（含命令 + shape + Avg/Min/Max）。
2. **头部进展记录确实新增 R<n> 条目** ✅ — worktree 测试脚本头部第 34 行
   `Current status: stable`，第 93-96+ 行新增 R8 完整条目；worktree HEAD = `773a2599b4`
   （R8 winner），仅 perf_test.cc 未提交改动（符合 Non-goal：不 commit topsop 改动）。
3. **契约强制生效** ✅ — improved summary 缺 progress_record 会被拒绝（unit 已证），
   真实 run 中 agent 正确携带了合法 progress_record。

### ISSUE-011（Run 层）⚠️ 负向通过，正向未实证

1. **无边界模糊轮 → 不触发 asm** ✅ — 8 轮中 5 个 measure 决策（iter-0/1/2/3/5）
   全部归因清晰，0 次 `ophal asm` 触发，0 个 `asm_report`。iter-3（−2.64）是边界
   数值轮但决策不模糊（promotion 明确归因 "coarser kN=16 top-tier scheduling hurt
   bandwidth"，回退远低于回退线），SKILL 设计"边界**且**模糊 / 无法归因才触发"，
   agent 正确跳过。
2. **边界模糊 / 无法归因轮触发 asm 的正向路径本次未出现** ⚠️ — 本次 run 未产生
   "KEEP/DISCARD 模糊或 device 指标无法归因"的轮次，asm 触发分支未被真实 run 实证。
   Run 层正向验收留待后续 run（构造模糊归因场景或等自然出现）。

## Final state（summary 原文核心）

> baseline 170.95us / 2417.33 GB/s -> final R8 157.78us / 2610.37 GB/s (util 0.870,
> 1D_eff 34.79%)。**MAIN GOAL MET: LLC r+w 2.61 TB/s >= 2.5 TB/s (104.4%)**。1D-eff
> 80% 未达（34.79%）：数学不可达——固定 ~55.0us 1D work 在满 roofline 3000 GB/s 下
> 1D eff 上限 40%。Gain path: R2 → R4 (+5.78pp) → R6 (+0.59pp) → R8 (+0.07pp)；
> R5/R7 DISCARD。Close-out 全量回归 29/29 PASSED（perf 1/1 + S1 23/23 + S2 5/5，全
> diff 0）+ K-ASAN clean。VPD 仍 DTE_BOUND —— memory-path 硬件天花板，loop 判
> CONVERGED（rule 6 valid：增益机制全在源码；rule 7：两条 LLC leg 都饱和）。

## 附带观察

- **ISSUE-010 机制复现**：iter-4/6/7 blocked（iteration scope）被吸收 + earlyStop
  （连续 2 轮 no-op）收敛关闭，未走全局终止路径。
- **explore 阶段人工干预**：explore agent 发起 `find / -name topscc_types.h` 全盘
  搜索跑 21 分钟未结束，阻塞 run；kill 子进程后 explore 恢复。暴露探索类 bash 命令
  无 timeout 的缺口（CLAUDE.md timeout 纪律只覆盖测试命令），值得后续 ISSUE。

## 环境与凭证保护

- 主仓库 `$HOME/topsop`：HEAD `de8a8a39ce` 未动，用户未提交改动保留。
- worktree：HEAD `773a2599b4`（R8 winner），仅 perf_test.cc 进展记录被 loop 修改
  + evidence 目录 untracked；未 commit 任何 topsop 改动。
- 已提交 piano 仓库（本次 session）：`68bb80e` … `54be6e9`（ISSUE-010/011/012 全链）。
