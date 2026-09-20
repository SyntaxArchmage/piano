---
name: topsop-v2-promote
description: 将候选评估原子转换为 KEEP/DISCARD/CONVERGED，并维护 V2 current-best 与 Git 状态。
---

# Topsop V2 promote

Durable `state.json` 保持固定通用结构：`state_schema_version=1`、`protocol_version=2`、`namespace=topsop-v2`、`architecture`、`workload_fingerprint`、`workspace_root`、`revision`、`current_best{path,sha256,identity,source_commit,workspace_diff_digest}` 和 `history[]`。每次候选完成后只追加一条通用 history 记录：candidate id、mechanism、decision、resulting revision 和 evidence reference。

1. 校验 evaluation result 的 path/digest、candidate/base artifact 和 expected state revision；要求 `comparison_base` 的 revision/artifact digest/identity 等于当前 durable incumbent，并从其 `metric_median` 与 candidate median 重新计算 signed/relative improvement，并要求 signed improvement 达到 characterize 冻结的 `max(0.5%×初始 median, 3×MAD)`；禁止信任不一致的派生数字。
2. `eligible=true` 仍只是 latency 门槛通过。KEEP 前必须读取 accepted evaluation 的 `target_validation`，与 prepare `spec.targets` 按 metric/operator/value 完整对账，并确认每项证据属于同一 candidate artifact/runtime identity；targets 非空时缺 profile、缺项或 identity 不一致均转为安全 DISCARD。目标值可尚未达到，但不得尚未测量。
3. 验证通过后只提交 candidate changed files；写入 history 的 baseline median 必须来自已验证的 `comparison_base.metric_median`。提交完成后只调用 `topsop-v2-workspace-identity.py` 计算 canonical workspace identity。将候选 artifact 原子复制到 state root 下按新 revision/digest 命名的不可变 snapshot；把该 snapshot、helper `head` 和 helper `workspace_diff_digest` 写为 current-best，revision 恰好加一，并在 receipt 写入 `/target_validation` 的 result path/digest/pointer，返回 `promoted/KEEP`。
4. correctness/performance rejected 或 compile failure：恢复 candidate 改动，并从 current-best immutable snapshot 恢复 active artifact；通过同一 helper 验证恢复后的 `head/workspace_diff_digest` 与 state 完全一致，返回 `restored/DISCARD`。
5. analyze 已返回 converged 时不修改源码，验证 incumbent 后返回 `terminal/CONVERGED`。
6. 所有 state 写入先写临时文件、fsync/rename，并同时对 expected revision 和输入 state SHA-256 执行 compare-and-swap；禁止部分更新。
7. receipt 必须包含 resulting commit、artifact digest、state revision、workspace diff digest 和下一轮动作。
8. 任一恢复或一致性检查失败均返回 run-scope failure，不得继续下一轮。

`terminal/CONVERGED` 不产生新 commit、不改 state revision，并令独立的 `loop_control=stop` 产生 contract-owned `workflow.loop-control=stop`，请求 Piano 在当前完整轮次后成功结束 loop。只有该投影有调度权，普通 payload 文本不能终止 loop。

## Tournament fan-in

单个 race 输入表示 orchestrator 已选择并合并 winner，promote 只负责 threshold 与 durable transaction。多个 race 输入表示 no-winner：若全部由 analyze convergence 传播而来则终止 loop；否则保持 current-best 不变、聚合记录失败并继续。禁止在 promote 中重新按模型判断选择 lane。
