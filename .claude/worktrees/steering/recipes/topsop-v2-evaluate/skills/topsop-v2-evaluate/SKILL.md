---
name: topsop-v2-evaluate
description: 对 candidate artifact 统一执行完整 correctness 与 artifact-bound 性能比较。
---

# Topsop V2 evaluate

1. 校验 candidate artifact、candidate id、base artifact、workload fingerprint 和 benchmark suite；同时验证 implement `comparison_base` 与 base artifact digest/identity 及 state revision 一致。
2. 获取短时 device lease，逐 case 核对 runtime identity。
3. 运行 primary + 全部 guards 的 correctness；任何 guard 失败均拒绝候选。
4. correctness 全通过后，按 baseline 相同配置采集 primary 至少 5 个 timing samples。
5. 使用 `comparison_base.metric_median` 作为唯一 incumbent 值计算 signed/relative improvement，并把同一 `comparison_base` 写入 evaluation；不得从 characterize 初始 baseline、其他 lane 或自由文本重新选择比较值，也不得把 bandwidth/efficiency 替代主 metric。
6. 先用 baseline 按 `max(0.5%×median, 3×MAD)` 冻结的 `minimum_improvement` 判断候选是否越过 latency 噪声门槛；不要在本轮重新发明或放宽阈值。比较始终相对当前 `comparison_base`，因此多个各自过门槛的小幅收益可以累积。
7. 只有越过门槛的候选才追加 candidate-bound target profile：使用相同 primary case、artifact digest 和 runtime identity，逐项观测 prepare `spec.targets`。`target_validation.measurements` 必须与声明目标完整对应；空 targets 使用 `targets_declared=false` 和空数组。
8. target profile 缺失/失败最多重试一次。仍不完整时保留 benchmark 观测但设置 `comparison.eligible=false`，reason 写明 `target_metrics_unavailable`；不得输出可供 KEEP 的不完整 evidence。目标值是否 `met` 只描述任务完成度，不替代 latency promotion threshold。
9. 原始日志、samples 和 target profile 写入 evidence，handoff 只返回摘要与 digest。

本 worker 不修改源码、不恢复 workspace、不提交。

若 implementation 为 `skipped`，传播 `status=skipped`；若为 `compile_failed`，返回带恢复要求的 `rejected`，不得运行设备命令。

## Tournament mode

Tournament lane 的有效 measurement 必须输出唯一 `referee` metric。命令执行器经有界复测仍不可用时返回 iteration-scoped、retryable 的 `executor_unavailable`，使当前 lane 无 referee 而其他健康 lane 仍可完成选择。把已由真实 samples 重算出的 `benchmark.median` 映射为单值 `benchmark/v1`（`samples=[median]`），使 winner 按 median latency 而不是偶然最小 sample 排序。失败或 skipped lane 不输出 metric。仅 `$consolidate/...` continuation 可以按冻结 delta 修改 parent workspace。
