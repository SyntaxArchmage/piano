---
name: topsop-v2-summary
description: Topsop tuning V2 的总是可表达终态收尾；汇总结果、验证最终状态并释放资源。
---

# Topsop V2 summary

## Pre-loop blocked fast path

若 accepted characterize result 为 `status=blocked` 且不存在任何 tune invocation/receipt：

1. 直接使用 characterize 的 accepted-result ref 和原始 `failure`，不得重新读取 prepare result、state、Git、源码、artifact 或其他 run 来复核根因。
2. 固定报告 `scheduled=attempted=measured=replans=kept=discarded=failed=0`，保留 `target_measured=10`。
3. 仅检查并释放当前 execution 明确拥有的 lease；若上游 fast path 未修改 workspace，不运行 Git diff/restore。
4. 输出 `status=completed`、`outcome=blocked`；全路径最多 4 个有界 tool batches，禁止读取 routing manifest/canonical corpus。
5. `result.json` 是最后一次写操作；写完立即返回，不执行 schema、digest、文件存在性或其他 post-write 验证。

其他成功、已进入 loop、设备中断或候选失败场景继续执行下述正常汇总流程。

1. 读取 baseline bundle 和 loop 最终 receipt；没有进入 loop 时保留上游 failure，而不是制造第二个 blocker。
2. 从 baseline 继承 `startup_mode`，并从最终 V2 state 和 immutable artifact snapshot 重新计算最终 identity/digest；workspace identity 必须来自 `topsop-v2-workspace-identity.py`。不得把 mutable build output 当作唯一恢复证据，也不得另写 workspace digest 算法。
3. 区分 `improved`、`no_improvement`、`blocked`、`interrupted`；无提升是正常完成。
4. `rounds.scheduled` 统计实际进入的 loop 轮次，`attempted` 统计产生 candidate 的轮次，`measured` 只统计 evaluate 产生有效观测的 candidate，`replans` 取 analyze 的最大 replan generation；同时报告 `target_measured=10`。
5. KEEP 数量为零时 final metric 等于 baseline；不得伪造 final verification。outcome 为 improved 时必须沿最终 promotion 的 `target_validation_ref` 读取同一 accepted evaluation，输出 candidate id、完整 target measurements 和 profile evidence；目标未达成仍可诚实报告 improved，但 next action 必须说明剩余 gap。
6. 若 mission 要求进展记录，只追加一条包含 protocol version、workload fingerprint、baseline/final、evidence refs 和 next action 的 JSON。
7. 尝试释放 `.piano-run.lock`；若锁不属于本 run，不删除并记录 cleanup failure。
8. 返回 `status=completed`；cleanup 的局部失败写入结构化字段。

## Tournament runs

存在 `tune.race` 时，从当前 run 的已验收 result JSON 汇总所有 lane，并把 lane 数、真实 measurement 数和 promotion 次数分开报告。最终性能和 artifact 仍以 promotion receipt 与 durable current-best 为准。
