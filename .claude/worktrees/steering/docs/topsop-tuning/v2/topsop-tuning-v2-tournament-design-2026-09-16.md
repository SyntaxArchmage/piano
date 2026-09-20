# Topsop Tuning V2 Tournament 设计记录（2026-09-16）

## 状态

- 实现状态：已生成，待真实端到端验证
- 代码提交：待本批改动确认后统一提交
- 基础版本：`recipes/workflows/topsop-tuning-v2.yml`
- 新入口：`recipes/workflows/topsop-tuning-v2-tournament.yml`
- Piano 框架改动：无

## 原因

串行 V2 每轮只探索一个 candidate，容易因单次分析偏差连续停留在局部邻域。Tournament 版本希望每轮并列探索三个不同方向，再用真实测量选择 winner。

第一版草案复制了 analyze、implement、evaluate、promote、summary 五个 worker。复核后认为这种隔离过度：这些 worker 的核心职责和 contract 链与串行 V2 相同，复制会造成 GCU400 知识、验证规则和 durable-state 语义长期漂移。

最终方案只增加一个 tournament partition worker，其余阶段复用标准 V2 worker，并以向后兼容的上下文规则支持 tournament。

## Workflow

```text
prepare                         # 复用 topsop-v2-prepare
  -> characterize              # 复用 topsop-v2-characterize
  -> loop
       -> partition             # 新增：生成三个搜索方向
       -> race[3 lanes]
            -> analyze          # 复用 topsop-v2-analyze
            -> implement        # 复用 topsop-v2-implement
            -> evaluate         # 复用 topsop-v2-evaluate
       -> promote               # 复用 topsop-v2-promote
  -> summary                    # 复用 topsop-v2-summary
```

Loop 继续以 `promote` 为 feedback 和 exit。五轮、每轮三个 lane，最多产生十五个真实 candidate measurement。

## Worker 调整记录

### 新增 `topsop-v2-tournament-partition`

**理由**

Piano tournament 需要上游 contract 提供 `workflow.map-items` 数组，而标准 V2 analyze 只负责生成一个完整 candidate plan。

**改动**

- 从 baseline、上一轮 receipt、当前 run result 和 durable history 生成三个互不重复的 lane mandate。
- Lane 只规定搜索类别、关注瓶颈和应规避的 mechanism，不预先替代 analyze 选择具体实现。
- 输出 `/lanes` 作为 `workflow.map-items`。
- 状态不一致时输出全局 BLOCKED 和空数组，不生成占位 lane。

**Commit ID**：待本批改动提交。

### 复用并增强 `topsop-v2-analyze`

**理由**

每个 tournament lane 最终仍然只需要一个标准 V2 candidate plan，没有必要复制 analyze worker 和 contract。

**改动**

- 检测到 `map-item.json` 时，校验 `partition.lanes` mandate，并将其作为搜索边界。
- 输出仍为原有 `topsop-v2-candidate-plan`。
- 串行模式没有 map item，原行为不变。

**Commit ID**：待本批改动提交。

### 复用并增强 `topsop-v2-implement`

**理由**

Analyze 仍输出标准 candidate plan，所以 implement contract 无需分叉；只需在 map-slot 中加强隔离。

**改动**

- `consumer.workspace.kind=map-slot` 时，将该 slot cwd 作为唯一源码根。
- 要求 lane-private build root 或等价隔离证明。
- 候选 artifact 固化到 invocation-owned evidence，避免后续 lane 覆盖。
- 串行 workspace 行为不变。

**Commit ID**：待本批改动提交。

### 复用并增强 `topsop-v2-evaluate`

**理由**

Tournament exit 必须有唯一 `benchmark/v1` metric；标准 V2 evaluation 已拥有完整的真实样本和 median，无需复制评估逻辑。

**改动**

- 在原 contract 中增加唯一 `referee` metric。
- `referee` 将真实 `benchmark.median` 映射为单值样本，winner 因此按 median 而不是偶然最小 sample 排序。
- 普通 evaluate 仍只读；仅 `$consolidate/...` continuation 可应用冻结 winner delta。
- Tournament workflow 单独为 evaluate 提供 `edit`；串行 workflow 的工具权限不变。

**Commit ID**：待本批改动提交。

### 复用并增强 `topsop-v2-promote`

**理由**

Tournament 已在 region exit 选择并合并 winner，后续仍是标准 V2 KEEP/DISCARD、commit、artifact snapshot 和 state CAS。

**改动**

- 单个 race evaluation 视为 orchestrator 已选 winner，不重新选择。
- 多个 evaluation 表示 no-winner：全部来自 analyze convergence 时结束 loop；否则保持 current-best 并记录聚合失败。
- Contract 与 receipt id 不变。

**Commit ID**：待本批改动提交。

### 复用并增强 `topsop-v2-summary`

**理由**

最终事实源仍是 baseline、promotion receipt 和 durable current-best；只需增加 tournament 统计口径。

**改动**

- 从已验收 result JSON 汇总所有 lane。
- 区分 planned、built、measured、winner、KEEP/DISCARD 和 failure，避免只统计 winner。
- Contract 不变。

**Commit ID**：待本批改动提交。

## Knowledge routing

Tournament does not fork the V2 knowledge corpus. `partition` and all reused V2
workers receive their own stage-local `topsop-v2-knowledge-router` and read the
same canonical `recipes/shared-skills/` snapshot. Partition may use one
signature-matched historical optimization case only to form distinct lane
hypotheses; each lane must still prove applicability from current source and
can only win through current benchmark evidence.

## 选择与隔离语义

1. Partition 根据当前 current-best 和历史给出三个互补搜索边界。
2. 每个 lane 在隔离 workspace 内运行完整的标准 V2 analyze、implement、evaluate。
3. 三个 lane 设置 `parallel: false`，避免共享 GCU 上的性能污染。
4. 每个有效 evaluation 把真实 median latency 投影为唯一 referee metric。
5. Piano 在 race exit 选择最低 median 的 lane，并调用 winner evaluate actor 合并冻结 source delta。
6. 标准 V2 promote 再根据 frozen threshold 决定 KEEP/DISCARD，并原子更新 Git、artifact snapshot 和 durable state。

## 已知限制与验证计划

- 该 recipe 仍不能与另一个使用相同 checkout、build root 或 GCU 的 session 安全并行。
- `parallel: false` 只串行化同一 tournament 内的 lane，不是跨 session device lease。
- 真实 smoke test 应在当前 session 结束后进行，重点验证：
  1. map item 是否正确限制每个 analyze lane；
  2. slot source/build/artifact 是否真正隔离；
  3. 三个 lane 的设备测试是否严格串行；
  4. referee 是否按 median 选择正确 winner；
  5. consolidation 后 parent diff 是否等于 winner frozen delta；
  6. promote 的 commit、artifact snapshot 和 state CAS 是否完整；
  7. 全部 lane convergence 或无 metric 时能否安全结束或进入下一轮。
