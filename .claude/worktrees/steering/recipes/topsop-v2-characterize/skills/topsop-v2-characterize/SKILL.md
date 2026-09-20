---
name: topsop-v2-characterize
description: 基于 prepared workspace 建立 GCU400 artifact-bound baseline、profile 与理论上界。
---

# Topsop V2 characterize

## Upstream-blocked fast path

若 handoff 中唯一 accepted prepare result 为 `status=blocked`：

1. 只使用 handoff 已给出的 contract id、absolute result path、SHA-256 和结构化 `failure`；不得查看 prepare transcript。
2. 保留原始 `failure.kind/scope/retryable/code/message/next_action`，不得重新解释、扩写成另一根因或读取 workspace/state 复核。
3. 输出带 `prepared_ref` 的 blocked baseline result；不创建第二个 blocker。
4. 全路径最多 3 个有界 tool batches；禁止读取 routing manifest/canonical corpus、Git/source/build/test/device/profile/VPD。
5. 写完 `result.json` 后立即返回，不执行任何 post-write 验证命令。

只有 prepare `status=ready` 时才执行后续正常路径。

## 输入约束

- 校验 prepare result 的 contract id、absolute path 和 SHA-256。
- 校验 workload fingerprint、workspace HEAD/diff、build target 和 benchmark suite。
- 不允许用源码推断代替 runtime identity；每个 case 的 observed identity 必须与 expected identity 完全相等。

## State 边界

Durable `state.json` 的固定字段为 `state_schema_version=1`、`protocol_version=2`、`namespace=topsop-v2`、`architecture`、`workload_fingerprint`、`workspace_root`、`revision`、`current_best{path,sha256,identity,source_commit,workspace_diff_digest}` 和 `history[]`。本阶段只能初始化 state，或在 source identity 和 revision 不变时刷新重建后的 snapshot；不能提升 winner 或清空 history。

## 执行顺序

1. 校验 `state_startup`。`initialized` 只能从 revision 0 开始；`continued` 必须重新散列 state 文件，并只通过 `topsop-v2-workspace-identity.py` 复核 state schema、fingerprint、architecture、workspace root、`source_commit == helper.head` 和 `current_best.workspace_diff_digest == helper.workspace_diff_digest`。不得比较 `tracked_diff_sha256`、手写算法或枚举候选 digest；任何真实不一致返回 `durable_state_incompatible`，不自动 fresh。
2. 从 current-best 源码重新构建；禁止把历史 `.so`、timing、profile 或 correctness 当作本 session 证据。
3. 获取短时 device lease；仅覆盖当前 test/profile 命令。
4. 对全部 workloads 运行 correctness；guard 不需要性能数据。
5. 对 primary workload warmup 后采集至少 5 个 timing samples，计算 median 和 MAD。
6. 采集 kernel/metrics/VPD；缺失 counter 如实记录，不伪造。将设备工作合并为 correctness、timing、metrics/VPD 三个批次，不为探测 CLI 格式重复运行完整 workload。
7. 根据 raw samples 冻结 `minimum_improvement=max(0.5%×median, 3×MAD)`。`3×MAD` 保证改进显著高于观测噪声，`0.5%×median` 防止 MAD 偶然接近零时接纳无意义微差；该绝对阈值在 session 内保持不变。
8. 用 shape、dtype、bytes、硬件常量和 profile 证据估算 memory/1D/2D ceilings，并保留公式证据。
9. 将通过校验的 artifact 原子复制到 state root 的不可变 `artifacts/rev-<revision>/<sha256>/` 路径。`initialized` 原子创建 state；`continued` 以 prepare 的 state SHA-256 做 CAS，仅刷新同一源码 revision 的 snapshot/evidence，保留 revision 和 history。

本阶段只读源码，不做候选修改或 promotion。写完 evidence 和 `result.json` 后立即返回，不自行运行 contract validator。
