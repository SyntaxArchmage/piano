# tune loop 8 轮 run 验证记录（topsop add_add_rms_norm）

目标：验证 `topsop-tuning.yml`（iterations: 8）下每个 stage 的契约执行、feedback 跨轮传递、以及 **提前终止行为**（blocked）。

运行基线：

- topsop 分支：`perf/addaddrmsnorm-pingpong-r1-20260828` @ `de8a8a39ce`（R2 F32MIX 已 commit，工作区干净）
- mission：`$HOME/orch/mission-topssgl-addaddrmsnorm.txt`（[16384,2048] BF16，LLC r+w ≥ 2.5TB/s 或 1D ≥ 80%）
- 启动：从 `$HOME/topsop` cwd 运行（`TSX_TSCONFIG_PATH` 让 tsx 解析 piano workspace 包）
- 命令：`tsx packages/cli/src/main.ts --workflow recipes/workflows/topsop-tuning.yml --json -p "$(cat mission...)"`
- run_id：`20260829T043046-b71dc0`（2026-08-29 04:30:47 UTC 启动，06:21 UTC 结束，~1h50m）
- 产物：`$HOME/.piano/runs/20260829T043046-b71dc0/` （当时的 stdout 转储未入库，可从 run 目录 `log.jsonl` 复原）

## 执行概要（诚实汇报）

**配置 8 轮（44 planned stages），实际 5 轮（27 accepted stages），loop 在 iter-4 因 implement `blocked` 提前终止**。
这是收敛行为而非故障：r7 变量（DTE 3 级流水线）违反硬件契约（private_dte context 同时只能跑一个操作，retrigger in-flight context 会 device fault；需 6 个 context > per-SIP VC budget 11），无法实现 → 继续循环已无合法变量。
5 轮中 2 轮（iter-0/1）compile_failed 被 implement 自行 revert 为 no-op，只有 2 轮产生真实候选（iter-2 r5 KEEP、iter-3 r6 DISCARD）。

## 判定标准

| 维度 | 通过条件 | 结论 |
|---|---|---|
| 每个 stage 契约 | 27 个 accepted stage 全部过 validate schema | ✅ |
| 串行链 | setup-env → explore → theory → loop → summary 顺序执行 | ✅ |
| feedback 跨轮传递 | iter-N profile inputs 含 iter-(N-1) measure decision | ✅ 4 个边界全确认 |
| 提前终止 | blocked → loop `stopped: true` → summary 正常综合 | ✅ |
| 收敛/退出 | summary 发出明确 outcome + 收敛结论 | ✅ outcome=`improved`（enum），语义含 target NOT reached |

## Stage 验证记录

### setup-env（1/1）
- [x] `status: ready`；cwd `$HOME/topsop`（无漂移）；build 凭证复用 R2 基线（`de8a8a39ce`）

### explore（1/1）
- [x] `status: ready`；call_chain / architecture 必填齐全；build_target `kernel_normalize_sgl_add_add_rms_norm`

### theory（1/1）
- [x] `status: ready`；read_write_balanced / bandwidth_limit_gbps / theory_min_us / bandwidth_utilization 字段齐全；复用 setup-env 凭证未重编

### loop iter-0（r3-f32mix-fma-square-accum）
- profile：`status: ready`；baseline 数值与 R2 可比（~171us / ~2420 GB/s）
- idea：strategies 含 `r3-f32mix-fma-square-accum`（bottleneck: compute，Fuse pass-1 square 进单个 F32MIX FMA）
- implement：**compile_failed**（dtu-link `R_DTU_ADDR16_LO_ICALL`）→ **fully reverted**
- verify：`verdict: pass`（verify 还原后的 R2 baseline）
- measure：`decision: KEEP`、`promoted: True`、regression_pp -0.4（noise 级，re-measure 还原基线）
  - **schema gate 生效**：attempt 1 因契约硬校验"**KEEP 必须 `promotion.promoted = true`**"被拒 → repair → attempt 2 通过

### loop iter-1（r4-raw-mop-mac-bf16-da-fused-square）
- profile：`status: ready`；inputs 含 `tune.measure@tune/iter-0`（**feedback 传递确认**）
- idea：proposal 基于 iter-0 反馈
- implement：**compile_failed** → fully reverted
- verify：`verdict: pass`
- measure：`decision: KEEP`、regression_pp +0.06（noise）

### loop iter-2（r5-row-software-pipeline-pass2-over-pass1）
- profile：`status: ready`；inputs 含 `tune.measure@tune/iter-1`
- implement：**compiled**（1-lag software pipeline，pass2(row kn-1) merged with pass1(row kn)）
- verify：`verdict: pass`（diff 0.0 + 回归 23/23）
- measure：`decision: KEEP`、`promoted: True`、regression_pp **+1.52** → **真实候选提升**
  - 候选：kernel **170.38us** / LLC r+w **2434.81 GB/s**（R 1244.24 + W 1190.57）/ 1D 32.29% / VPD COMPUTE_BOUND（191549 cy）

### loop iter-3（r6-resid-l3-direct-read-dte-offload）
- profile：`status: ready`；inputs 含 `tune.measure@tune/iter-2`
- implement：**compiled**
- verify：`verdict: pass`
- measure：`decision: DISCARD`、`promoted: False`、regression_pp **-60.58**
  - 候选：kernel 224.38us / LLC r+w 1829.03 GB/s → **1.32x 慢于 current-best** → 正确回滚（证伪链正常：候选过 verify 但被 measure 用 device-side 指标拒绝）

### loop iter-4（r7-dte-3deep-buffer-kn4）—— 提前终止点
- profile：`status: ready`；inputs 含 `tune.measure@tune/iter-3`（DISCARD）
- idea：proposal `r7-dte-3deep-buffer-kn4`（DTE 流水线 2-stage→3-stage，kBufferNum 2→3）
- implement：**blocked**（非 compile 失败，compile passed）
  - blocker：`private_dte context 同时只能跑一个操作，必须 idle 后才能 reconfig`（`tops/__tops_dte_ext.h` asserts）；3 级 schedule retrigger 上一 block 仍 in-flight 的 context → on-device fault（rc=134）；达成 2-window lead 需 6 个 context（每输入 2 个）> per-SIP VC budget 11 → **unimplementable as specified**
- verify / measure：未执行（loop 在此停止）

### summary（1/1，attempt 2 通过）
- [x] outcome=`improved`（**enum 合法值**）；`summary` 字段含完整收敛叙述
  - **schema gate 生效**：attempt 1 `outcome: "target_not_reached_converged"` 不在枚举 → repair 改为 `improved`（enum-valid），语义叙述完整保留
- 收敛结论：Final current-best = **r5 1-lag software pipeline**（170.38us avg / 2434.81 GB/s / 1D 32.29% / COMPUTE_BOUND 191549 cy）
- vs 基线 R0（215.49us / 1895.86 GB/s / 28.36%）：kernel **1.26x**、带宽 **1.28x**
- Target **NOT reached**：LLC r+w 97.4% of 2500 GB/s（gap -2.6%）；1D 32.29% vs 80%
- 收敛原因：compute-bound 墙（pass-2 归一化指令数 / VLIW packing / loop iterations，compute subthreads 340.3% busy vs CDTE 295.15%），由 r7（硬件契约 blocked）+ r6（L3-direct，-33% CDTE bytes 但 1.32x 慢）双向证明
- 最终验证走官方入口：`ophal test` @ test host `wsj@10.12.115.153`，compile exit 0（.so 14:16:51，working tree == state/current-best），target perf case 1/1 diff 0.0，回归 23/23，K-ASAN 23/23 → **24/24 total**
- 进展记录更新：`Current status: stable`，R4-R8 + Final 追加（cmd/shape/Avg-Min-Max 齐全）
- **无 commit**；r5 kernel + 进展记录改动留在工作区（等待 run coordinator）

## 机制验证

### feedback 跨轮传递（代码 + 实证）
- 代码：workflow-execution.ts loop region —— `priorFeedback = child.completed.get(region.feedback)`（measure），下一轮 inputs = `[...inputs, ...priorFeedback]`
- 实证：iter-1..4 的 `iteration.json` 的 `inputs` 分别含 `tune.measure@tune/iter-0..3`（decision + 实测 + 背景）→ **4 个跨轮边界全部确认**

### 提前终止语义（代码 + 实证）
- 代码：`for iteration 0..iterations`，`if (child.stopped === true) return { boundary, stages, stopped: true }` —— blocked 是合法终态
- 实证：iter-4 implement `status: blocked` → loop return → summary 正常执行（attempt 2 accepted）→ `run.completed` exit 0

### schema gate 拦截（2 处，均为真实错误被拦）
1. iter-0 measure attempt 1：KEEP 缺 `promotion.promoted=true` → 拒绝 → repair
2. summary attempt 1：`outcome` 非枚举值 → 拒绝 → repair 为 `improved`

### 自愈行为（compile_failed → no-op）
- iter-0/1 implement compile_failed 后 **fully revert** → measure re-measure 还原基线 → KEEP no-op（regression 在 noise 内）→ current-best 不被污染

## 产物

- run 目录：`$HOME/.piano/runs/20260829T043046-b71dc0/`（log.jsonl + progress.json + trace.jsonl + executions/）
- 29 个 result.json = 27 accepted + 2 repair attempt（iter-0 measure + summary）
- stdout 转储：未入库（run 目录 `log.jsonl` 为权威记录）
- topsop 工作区：`add_add_rms_norm_dte_load_impl.h`（r5 pipeline）+ `perf_test.cc`（+71 行进展记录）未 commit；HEAD `de8a8a39ce`

## 结论

8 轮 run 的 stage 契约、串行链、feedback 跨轮传递（4 边界）全部通过。run 未走满 8 轮——在 iter-4 因 implement `blocked`（DTE 硬件契约，变量不可实现）正确提前终止，summary 收敛为 `improved`（target 未达：带宽 97.4%）。机制亮点：schema gate 拦截 2 处真实错误、compile_failed 自愈为 no-op、证伪链（r6 过 verify 被 measure 拒）正常。与 2 轮验证相比，本轮验证了 **blocked 提前终止路径** 和 **多轮 feedback 链**，均为 2 轮 run 未覆盖的路径。
