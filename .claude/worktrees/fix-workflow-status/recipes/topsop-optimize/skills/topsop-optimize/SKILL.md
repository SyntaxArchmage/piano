---
name: topsop-optimize
description: "[DEPRECATED COMPATIBILITY] 仅兼容旧 workflow；新流程应分别使用 topsop-idea 或 topsop-measure。"
---

# topsop optimize（deprecated compatibility）

> **兼容边界：** 本 skill 仅服务于仍选择 `topsop-optimize` 的旧 workflow。新 workflow 必须让 idea stage 使用 `topsop-idea`，让 measure stage 使用 `topsop-measure`。兼容期内保留下面两种旧模式及原有报告形状，但不在这里扩展新行为。

两种模式由注入上下文选择：

- **idea 模式**（loop idea stage）：提案恰好一个可测试变量。
- **measure 模式**（loop measure stage）：对已验证候选采集 profile，KEEP / DISCARD / CONVERGED 收轮。

## idea 模式

1. **读注入上下文**：当前 profile（LLC r+w、latency、1D eff、VPD 瓶颈、`bandwidth_utilization`）、当前最佳状态、上一轮 decision + variable + **variable_type**（structural / config）、上一轮 measure 的 `asm_report`（若有，codegen 层汇编证据）。VC / VDMEM 预算分析用注入的硬件常量表（explore `hardware_constants`：L1 三区容量 / L2 / VC 预算 / tier 对齐颗粒 + 来源路径），**禁止全盘搜索硬件定义**（如 `find /` 找 `GCU_VDMEM_SIZE_PER_THREAD`）；`kMaxDLen` 从目标算子 kernel 源码推导（per-operator 常量，如 `kMaxDUnit * kDUnit` / `cc_kernel::AlignDown(...)`），不从手册猜。
2. **前提失效检查（ISSUE-014）**：注入上下文显示上一轮（或本 run 内）变量是 `structural`（buffer 数 / 流水线深度 / 搬运机制 / fusion chain 变化）时，列出被该结构影响、必须重新检验的旧判别（如"某路径是硬上限"、"计算非瓶颈"、"读速率饱和"、"tier 对齐不可降"），逐条做最小判别实验或对照当前 profile 重新检验，把结论写进 `rechecked_premises: [{premise, invalidated, evidence}]`。本轮提案变量是 `structural` 时该字段强制携带（契约拒绝缺失），并把变量类型写进 `strategies[].variable_type`。无结构改动的连续 config 轮不触发。
3. **定位实测瓶颈**：要攻的是读路径 / 写路径 / 搬运量 / VC-context 预算 / buffer-pipeline 深度 / codegen 层（VLIW slot、bank conflict、寄存器压力、指令调度）。上一轮有 `asm_report` 时，先用它归因——汇编证据直接指出 slot 浪费 / stall / bank conflict，指导本轮选更精准的变量，不要忽略 codegen 层证据只做参数扫描。按优化优先级：load balance > DTE 搬运效率 > compute pipeline > FP8 online quantization。
4. **提案恰好一个变量**：每个变量写明改动内容、针对的瓶颈、预期效果、风险、可证伪判据（什么证据能证明本轮假设不成立）。可证伪判据写进 `strategies[].falsification_criterion`；该改动是"复现已记录机制的结构本身"而非"调 config"写进 `strategies[].mechanism_over_config`；变量类型（structural / config）写进 `strategies[].variable_type`——契约只保留已声明字段，这三项必须落在对应字段里，不能写在自由文本中。
5. **保持变量多样性**：连续只做 macro 级 config 调整后，优先选结构性改动（pipeline 深度、buffer 数、DTE 搬运 shape），不要再来一次参数扫描。
6. **机制优先于配置（mechanism-over-config）**：查注入的 tuning 记录 / 进展记录 / **explore 的 `external_mechanism_candidates`** 找历史收益点与外部机制候选，区分**机制**（结构性改动）与它最终收敛到的 **config 数值**。若机制已被记录**或官方实现验证过**（含 explore 输出的 `external_mechanism_candidates` 中 `present_in_source: false` 的机制）但当前源码里**不含**该机制，本轮第一个候选就是它——提案实现该结构本身（ISSUE-018）。只做 config 变体不能复现该机制的收益。外部机制只当可达性参考，不读官方 diff、不复制机制。
7. **记录中的"CONVERGED / 硬件天花板"结论只在机制确实存在于源码时才是有效证据**：若源码缺该机制，视该结论为失效，不能引用为天花板。
8. 证据指向硬件天花板**且**记录归因的机制确实在源码里时，如实说明——下一轮 measure 就可以据此判 `CONVERGED`。
9. **纯发现（pure discovery）**：mission 指名已知最优的 anchor commit 时，只把它当可达性参考（其数值标记目标），不读其 diff、不复制其机制。
10. **返回** `optimization-proposal`。

## measure 模式

1. **读注入上下文**：候选的 `verification-report`、当前最佳 baseline 数值、上一轮 decision。
2. **只 profile 已验证候选**：`ophal profile --arch 400 --mode {kernel,metrics,vpd}`，filter 到目标 case。保留原始 profile 路径。
3. **算 `regression_pp` 并决策**：`regression_pp = (candidate bandwidth_utilization − current-best bandwidth_utilization) × 100`（current-best 取注入的当前最佳状态里携带的值；正 = 提升）。然后判 KEEP / DISCARD / CONVERGED（真实失败判 COMPILE_FAIL / VERIFY_FAIL / BLOCKED）。契约硬校验：KEEP 不允许 `regression_pp ≤ −1`（回退线，>1pp 利用率回退是回退风险）；DISCARD 不允许 `regression_pp ≥ 5`（提交线，≥5pp 利用率提升应保留）。
4. **按需汇编归因（ISSUE-011）**：当决策处于边界（`regression_pp` 在 ±1~5 之间，KEEP/DISCARD 模糊）或 device 指标无法归因瓶颈（如"搬运不是瓶颈、1D eff 已高但 latency 不降"）时，对当前最佳 kernel 跑 `ophal asm --arch 400`，产出 `topsop-asm-report`（`assembly_bottleneck_points` / `slot_utilization` / `bank_conflict` / `register_pressure` / `estimated_cycles` 全部可选），附到 round-result 的 `asm_report` 字段，作为下一轮 idea 的注入上下文。**边界清晰 / 可归因轮不跑 asm**（`ophal asm` 依赖 `build/compile_commands.json` 且成本高，不适合每轮强制）；不触发就不携带 `asm_report`。
5. **状态所有权**：`topsop-round-result` 不会触发协调层的内建 promotion 路径。KEEP 必须**自己**更新 `state/tuning-state.json` 与 current-best artifact；DISCARD 恢复 / 保持它们不变；把实际写到的路径报在 `records.round_path` / `records.state_path`。`ophal asm` 是只读诊断，不改源码，不改变状态所有权规则。
6. **profile 字段纪律**：只有 KEEP / DISCARD / CONVERGED 且候选已验证的轮带 `profile` 对象（真实测到的数值）。VERIFY_FAIL / COMPILE_FAIL / BLOCKED 轮必须**整体省略** `profile` 字段；失败 / blocked 轮必须省略 `regression_pp`，且同样禁止携带 `asm_report`。
7. **返回** `topsop-round-result`：把本轮变量的类型写进 `variable_type`（structural / config，从本轮的 optimization-proposal `strategies[].variable_type` 读取）——它是下一轮 idea 判断是否触发前提失效检查的注入上下文。

## bash 命令必须显式设置 timeout，禁止全盘 find（ISSUE-013）

`ophal profile` / `ophal asm` 等采集命令**必须用 `timeout <N>s` 包裹**（如 `timeout 1200s ophal profile --arch 400 ...`、`timeout 600s ophal asm ...`）——pi-sdk 的 bash 工具没有默认超时，失控命令会无限期阻塞整个 run（实测：run `20260901T071737-744d78` implement 的 `find /` 空转 9+ 分钟才被人工 kill）。读 tuning 记录 / round 文件优先用原生 `find` / `grep` / `ls` 工具（glob、cwd 相对、限 1000 条）；bash 里的 `find` 只用于 workspace 之外路径且必须带 `timeout`，从 `<workspace>` 窄范围起搜（加 `-maxdepth`），**禁止 `find /` 与递归 `$HOME`**；找不到按真实 blocker 报 `blocked`，不猜路径、不回退 `find /`。

idea 模式不编辑代码；measure 模式绝不改源码来美化数字。
