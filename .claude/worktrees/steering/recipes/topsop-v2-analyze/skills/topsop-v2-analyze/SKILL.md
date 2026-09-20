---
name: topsop-v2-analyze
description: 将诊断、假设和准入合并为一个 evidence-bound 单因果机制候选计划，并管理跨轮搜索覆盖与重规划。
---

# Topsop V2 analyze

1. 校验 baseline bundle；首轮使用其 startup revision/current-best 和 baseline metric，后续轮以 promotion receipt 的 resulting current-best 及其 accepted evaluation candidate median 为唯一基线。把 revision、artifact digest/identity 和 median 固化为 candidate `comparison_base`；后续 worker 只能传播该 binding，不能自行选择比较基线。
2. 从已校验的 state path 读取 candidate history，只提取机制、观测结论和本次 run 的真实 measurement 数，不复制完整历史 narrative；跨 session 历史用于去重，不计入本次 `measured_experiments`。
3. 以 10 次真实 candidate measurement 为目标、30 轮为最大预算，维护六类搜索 coverage：data movement/overlap、tiling/partitioning、storage/layout、compute/codegen、launch specialization、fusion/algorithm。
4. 按需读取 profile/VPD/source anchors。先做 focused search；局部邻域无候选时切换 expanded search 覆盖未测试类别；仍无候选时执行 structural replan。
5. 每轮只选择一个可证伪的因果 mechanism。它可以要求协调式多文件修改，但不得组合多个无共同因果链的独立变量；计划必须含 category、base artifact identity/revision、共同因果链、edit scope、expected effect、risk、falsification criterion 和 evidence refs。
6. 为该 mechanism 建立 `implementation_constraints`：逐条记录 constraint id、kind、expected fact 与证据。必须覆盖所有决定实现是否合法的候选特定约束；例如 DTE 方案要写 context 数/VC 上限，存储方案要写容量与对齐，launch 方案要写 block/thread/dispatch 约束。通用口号不算约束。
7. 候选必须能在当前源码和硬件约束下实施；纯猜测、重复已证伪机制或仅改名重试的方案不得进入 implement。
8. 若多个候选都成立，按证据强度、预期收益、风险、验证成本排序，只输出第一名；其余只写入小型候选索引 evidence，不进入 handoff。
9. candidate id 必须在当前 workload/state revision 下唯一。
10. 每轮写出 `search_progress`，其中本次 run 的 measurement 计数、replan generation、mode、六类 coverage 都必须可由 evidence 复核。
11. 证据不足但可补测时返回 iteration-scope failure。未达到 10 次真实测量时，只有六类均有证据为 `exhausted/infeasible` 且 structural replan 已完成才可返回 `converged`；10 是搜索目标，不得为凑次数发明候选。

本 worker 不修改源码，也不承诺一定提升。

## Tournament lane

存在 `map-item.json` 时，先校验其中 `over=partition.lanes`，再把 lane mandate 作为本轮搜索边界。命令执行器经有界复测仍不可用时只返回 iteration-scoped、retryable 的 `executor_unavailable`，不得把单 actor/tool-session 故障扩大为 global block。仍输出标准 `topsop-v2-candidate-plan`，因此 implement/evaluate 链与串行 V2 完全一致。若 mandate 覆盖的机制均已证伪或不可实施，返回真实 `converged`，不要跨 lane 重复其他候选。
