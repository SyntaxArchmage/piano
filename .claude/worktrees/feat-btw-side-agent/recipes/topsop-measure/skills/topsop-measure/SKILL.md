---
name: topsop-measure
description: 测量已验证的 topsop 候选，执行 KEEP、DISCARD、CONVERGED 或真实失败决策，并维护当前最佳状态。
---

# topsop measure

1. **读完整 handoff**：读取候选 `verification-report`、本轮唯一变量、current-best baseline 数值、上一轮 decision 和 idea 的 `variable_type`。只有已验证候选才能进入 profile。
2. **真实测量**：分别运行 `ophal profile --arch 400 --mode kernel|metrics|vpd --filter <TargetCase>`，保留原始 profile 路径；禁止编造 metric 或用 host wall time 代替 kernel latency。
3. **计算并决策**：`regression_pp=(candidate bandwidth_utilization-current-best bandwidth_utilization)*100`，current-best 必须取注入的持久状态，正数表示提升。真实失败分别使用 COMPILE_FAIL / VERIFY_FAIL / BLOCKED；正常候选使用 KEEP / DISCARD / CONVERGED。
4. **硬阈值**：contract 拒绝 `regression_pp <= -1` 的 KEEP，也拒绝 `regression_pp >= 5` 的 DISCARD。失败或 blocked 轮必须整体省略 `profile`、`regression_pp` 和 `asm_report`；只有已验证的 KEEP / DISCARD / CONVERGED 轮携带真实 profile。
5. **按需汇编归因（ISSUE-011）**：仅当 `regression_pp` 位于约 ±1–5pp 的模糊边界，或 device 指标无法归因时，才对 current-best kernel 运行 `ophal asm --arch 400`。把真实结果作为 `topsop-asm-report` 放入 `asm_report`，供下一轮 idea 使用；边界清晰时不运行，失败轮不携带。
6. **状态所有权**：KEEP 必须更新 `state/tuning-state.json` 与 current-best artifact；DISCARD 必须恢复或保持它们不变。`topsop-round-result` 不触发协调层内建 promotion，`ophal asm` 也不改变状态所有权。将实际写入路径报告在 `records.round_path` / `records.state_path`。
7. **返回报告**：返回且只返回 `topsop-round-result`，并从 idea handoff 复制本轮 `variable_type`；它会成为下一轮前提失效检查的上下文。

所有 `ophal profile` / `ophal asm` 等 bash 命令必须显式使用 `timeout <N>s`。文件定位优先使用原生 `find` / `grep` / `ls`；bash 搜索只能从 workspace 内窄目录开始并限制深度，禁止 `find /`、递归 `$HOME` 或无界搜索。超时后缩小范围重试；仍不可用就如实 blocked。本 worker 只测量、归因和维护状态，不修改 kernel 源码来美化结果。
