# topsop v2 promote

开始工作前阅读 Piano 已注入的 workflow-local skills：`topsop-v2-command-safety`、`topsop-v2-evidence-protocol`、`topsop-v2-knowledge-router`、`topsop-v2-promote`。这些目录不属于 DSH 全局 skill catalog；禁止调用 `skill` 工具按名称加载。仅可按 knowledge router 给出的绝对路径读取 canonical shared corpus；禁止搜索其他目录或同名 skill。

根据一个 `topsop-v2-candidate-evaluation` 原子完成 KEEP/DISCARD/CONVERGED，并生成下一轮唯一 feedback。

- 合并 V1 decision 与 commit-round 的事务职责，避免“已决定但尚未恢复/提交”的中间状态。
- 只有 `eligible=true` 且 evaluation 的 `comparison_base` 与当前 durable revision/artifact 完全一致、由 `comparison_base.metric_median` 和 candidate median 重新计算的 improvement 越过冻结的 `max(0.5%×初始 median, 3×MAD)` 门槛，并且 `target_validation` 与 prepare 声明的目标集合逐项一致、全部已观测并绑定同一 candidate artifact/runtime identity 时才能 KEEP。任一缺失或不一致必须 DISCARD，不能仅凭 latency 提升提交，也不能信任 worker 自报的不一致 improvement。目标是否已经达标用于终态/下一步判断，但不替代冻结的增量 latency 门槛。
- KEEP 提交候选源码，将候选 artifact 复制到按新 revision/digest 命名的不可变 snapshot，并更新 V2 durable state；receipt 必须引用 accepted evaluation 中的 `/target_validation`。
- rejected/compile-failed candidate 必须恢复到 current-best，并验证源码、artifact 和 state 一致。
- promotion 使用 state revision 与 state SHA-256 双重 compare-and-swap；冲突为 run-scope failure。提交或恢复完成后必须调用 recipe-owned `topsop-v2-workspace-identity.py`，把其 canonical `workspace_diff_digest` 绑定到 state/current-best/receipt；禁止使用裸 `git diff` digest 或另写算法。
- 只操作 V2 state namespace，不读取或写入 V1 durable state。
- receipt 必须同时证明 Git、artifact 和 state 的最终状态。

- 只校验业务事实、路径、identity 和 digest；写完 evidence 与 `result.json` 后立即结束。不得自行运行 JSON Schema、`compileWorkerContract`、临时 TypeScript 校验脚本、Piano CLI，也不得搜索 transcript 来验证 contract；正式 schema/projection 校验由 Piano orchestrator 在返回后执行。

产出且只产出 `topsop-v2-promotion-receipt`。

若 evaluate 因正常收敛而 `skipped`，验证 incumbent 未变化后返回 `terminal/CONVERGED` 和 `next_action=stop` 与 `loop_control=stop`。后者由 contract 投影为 `workflow.loop-control`，Piano 在本轮完成后立即结束 loop 并进入 summary；不得再传播空转轮次。

## Tournament fan-in mode

若 `race` handoff 只有一个 evaluation，它是 Piano 已按唯一 referee 选出并完成源码 consolidation 的 winner；不得重新选择 lane，必须先核对 parent delta 与 winner artifact，再执行原有 KEEP/DISCARD transaction。

若 `race` handoff 包含多个 evaluation，表示没有 lane 产生可用 referee：

- 全部因 analyze convergence 而 skipped 时，验证 incumbent 未变化并返回 `terminal/CONVERGED`。
- 否则不得从失败 lane 中自行挑 winner；验证 parent/current-best 未变化，将所有 lane result ref 写入聚合 evidence，并返回 `restored/DISCARD` 继续下一轮。
- `source_ref` 使用一个真实输入 evaluation，聚合 evidence 保存完整 fan-in 列表。
