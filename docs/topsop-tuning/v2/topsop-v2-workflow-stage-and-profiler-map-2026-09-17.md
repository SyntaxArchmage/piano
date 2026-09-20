# TopSOP tuning V2 workflow stage 与 profiler 调用图

日期：2026-09-17

本文记录当前 TopSOP tuning V2 串行与 tournament workflow 的主要数据流、profiler 调用位置，以及各 stage 的职责边界。本文描述的是 recipe/worker 当前约定；大型日志、samples、profile dump 和推导过程均写入 evidence 文件，handoff 只传递摘要、稳定 identity、绝对路径与 SHA-256。

## 一、串行 V2 主流程

当前串行 workflow 定义在 `recipes/workflows/topsop-tuning-v2.yml`：

```text
用户 Prompt
   │
   ▼
prepare
   │ prepared.json
   ▼
characterize ────── 建立 baseline、基线 profile 和理论上界
   │ baseline.json
   ▼
┌──────────────────── tune loop ────────────────────┐
│                                                  │
│ analyze                                          │
│   │ candidate-plan.json                          │
│   ▼                                              │
│ implement                                        │
│   │ candidate-artifact.json                      │
│   ▼                                              │
│ evaluate ───── correctness + timing              │
│   │             └─ 显著提升时才执行 target profile
│   │ evaluation.json                              │
│   ▼                                              │
│ promote ─────── KEEP / DISCARD / CONVERGED       │
│   │ promotion.json                               │
│   └──────────── feedback 到下一轮 analyze ───────┘
│
▼
summary
```

当前 YAML 中串行 tune loop 的最大调度轮数是 5。每轮最多产生一个 candidate；如果 analyze 给出有证据的收敛结论，则 implement/evaluate 传播 `skipped`，promote 产生 `CONVERGED` 并终止 loop。

大对象不会通过 loop handoff 反复复制：

- prepare 拥有规范化后的 spec、benchmark suite 和源码入口；
- characterize 拥有 baseline、profile 和 theory；
- analyze 拥有 candidate plan；
- implement 拥有 candidate artifact 和 workspace transition；
- evaluate 拥有 correctness、timing 和 target profile 观测；
- promote 拥有 durable state transition；
- summary 只汇总上述已验收结果。

## 二、profiler 调用位置

当前 V2 没有独立的 profiler stage，也没有在 workflow YAML 中声明专用 profiler tool。实际 benchmark、OPHAL metrics 和 VPD 采集由获得 `bash` 权限的 worker 按 workspace 配置执行。

需要区分两类操作：

- **timing benchmark**：获取 latency samples，并计算 median/MAD；
- **profile/metrics/VPD**：获取 LLC 带宽、1D/2D 利用率、kernel 指标等更详细的硬件观测。

### 2.1 Characterize：无条件建立基线 profile

在正常 ready 路径中，`topsop-v2-characterize` 执行：

1. 从 current-best 源码重新构建 artifact；
2. 获取仅覆盖当前命令的短时 device lease；
3. 对 primary 和全部 correctness guards 执行正确性验证；
4. 对 primary warmup，并采集至少 5 个 timing samples；
5. 计算 baseline median 和 MAD；
6. 采集 kernel profile、metrics 和 VPD；
7. 冻结 session 内的最小提升门槛：

   ```text
   minimum_improvement = max(0.5% × baseline median, 3 × MAD)
   ```

8. 根据 shape、dtype、数据移动量、硬件常量和 profile 证据估算 memory、1D 和 2D 理论上界；
9. 建立或刷新 current-best 的不可变 artifact snapshot 和 V2 durable state。

因此，characterize 是每个正常 session 的第一次完整 profile，也是后续 analyze 的基线性能事实来源。

如果 prepare 已返回 `blocked`，characterize 走 upstream-blocked fast path，不构建、不申请设备、不测试、不 profile，也不估算理论上界，只传播原始 failure。

### 2.2 Evaluate：先 timing，过门槛后再执行 target profile

每个成功构建的 candidate 进入 `topsop-v2-evaluate` 后，依次执行：

1. 验证 candidate artifact、diff、base revision、comparison base 和 runtime identity；
2. 获取短时 device lease；
3. 执行 primary 和全部 guards 的 correctness；
4. correctness 全部通过后，按 baseline 相同配置采集至少 5 个 timing samples；
5. 重新计算 candidate median，并与当前 incumbent 的 `comparison_base.metric_median` 比较；
6. 使用 characterize 冻结的 `minimum_improvement` 判断候选是否显著变快。

后续 profile 是条件性的：

```text
candidate timing
      │
      ├─ 未越过 minimum_improvement
      │     └─ 不运行 target profile
      │        eligible=false
      │
      └─ 越过 minimum_improvement
            └─ 对同一 artifact、runtime identity 和 primary case
               采集 TuningSpec.targets 中的所有目标指标
```

例如任务声明 LLC 读写带宽或 1D 计算率目标时，evaluate 只有在 candidate latency 已经越过噪声门槛后，才追加对应 target profile。

目标 profile 必须满足：

- 覆盖 prepare 声明的全部 target；
- 每个 target 记录 metric、operator、target value、observed value、是否达标和 evidence reference；
- profile 与 candidate artifact digest、runtime identity 绑定；
- 失败或缺项最多进行一次有界重试；
- 重试后仍不完整时保留真实 timing，但设置 `eligible=false` 和 `target_metrics_unavailable`，不能进入 KEEP。

目标是否已经达到不替代 latency promotion threshold：候选必须先相对当前 incumbent 获得超过噪声门槛的提升，才有资格进入后续 KEEP 判断。

### 2.3 各 stage 的 profiler 行为

| Stage | Timing | Profile/metrics/VPD | 说明 |
| --- | --- | --- | --- |
| `prepare` | 否 | 否 | 规范化任务、准备 case、定位源码和构建入口 |
| `characterize` | 是 | 是，正常路径必需 | 建立 baseline、硬件画像和理论上界 |
| `analyze` | 否 | 否 | 读取已有 baseline/profile，设计候选 |
| `implement` | 否 | 否 | 修改源码并构建 candidate artifact |
| `evaluate` | 是 | 条件执行 | timing 过门槛后才采集目标指标 |
| `promote` | 否 | 否 | KEEP/DISCARD/CONVERGED 和 durable transaction |
| `summary` | 否 | 否 | 汇总已有证据并清理资源 |
| `partition` | 否 | 否 | tournament 搜索空间分区 |

整体策略是：**基线阶段完整 profile 一次；候选阶段先使用 latency 筛选，只有显著变快的候选才追加成本更高的 target profile。**

## 三、各 stage 主要职责

### 3.1 Prepare

Worker：`topsop-v2-prepare`

主要职责：

- 作为 V2 唯一的用户 mission 解析者，生成规范化 `TuningSpec`；
- 校验 architecture 为 GCU400；
- 明确 operator、shape、dtype、variant、scaling mode 和其他影响 dispatch 的字段；
- 为每个 workload 建立独立 runtime case，选择一个 primary，其余作为 correctness guards；
- 定位 API、dispatch、kernel、测试和 CMake/build 入口；
- 必要时只在正式测试目录中从 seed fixture 物化目标 benchmark case；
- 使用 `topsop-v2-workspace-identity.py` 建立 canonical workspace identity；
- 检查独立的 `topsop-v2` durable state 是否能够严格 continue。

职责边界：

- 不修改 operator、host dispatch 或 kernel；
- 不执行性能优化；
- 不等待设备长期空闲；
- 不 profile；
- 不估算理论上界；
- 不自动删除、迁移或修复不兼容 durable state。

输出：`topsop-v2-prepared-workspace`。

### 3.2 Characterize

Worker：`topsop-v2-characterize`

主要职责：

- 从 current-best 源码重新构建；
- 运行 primary 和 guards correctness；
- 采集 baseline timing samples、median 和 MAD；
- 采集 kernel profile、metrics 和 VPD；
- 计算 memory、1D 和 2D theory ceilings；
- 冻结 session 内的 acceptance threshold；
- 保存 current-best immutable artifact snapshot；
- 初始化或 CAS 刷新 V2 durable state，但不产生一次 promotion。

职责边界：不修改测试、operator 或 kernel，不改变 durable winner 的源码身份。

输出：`topsop-v2-baseline-bundle`。

### 3.3 Analyze

Worker：`topsop-v2-analyze`

主要职责：

- 合并 V1 diagnose、hypothesis 和 idea 的职责；
- 消费 baseline/profile/theory、上一轮 promotion receipt、durable history 和按需读取的源码证据；
- 每轮最多提出一个可证伪的 candidate mechanism；
- 维护以下搜索类别的结构化 coverage：
  - `data_movement_overlap`
  - `tiling_partitioning`
  - `storage_layout`
  - `compute_codegen`
  - `launch_specialization`
  - `fusion_algorithm`
- 明确 category、mechanism、single causal variable、edit scope、expected effect、risk 和 falsification criterion；
- 把 DTE、L1/L2、launch geometry、layout/alignment、barrier/mailbox 和指令约束写成可验证的 `implementation_constraints`；
- 避免重试已被证伪的 mechanism，局部搜索耗尽后执行 expanded 或 structural replan。

职责边界：只读，不改代码、不构建、不测量。

输出：`topsop-v2-candidate-plan`。

### 3.4 Implement

Worker：`topsop-v2-implement`

主要职责：

- 验证 current-best artifact、state revision 和 canonical workspace identity；
- 将 candidate plan 固化为 conformance ledger；
- 只实现 candidate 声明的单一因果 mechanism；
- 确保所有修改落在声明的 edit scope；
- 逐项验证 implementation constraints；
- 只在 plan conformance 全部成立后执行正式 build；
- 保存 changed files、diff digest、build log、artifact digest 和 restore point。

职责边界：

- 不改变 frozen benchmark identity；
- 不顺手重构或实现第二种机制；
- 不运行完整 correctness 或 profile；
- 不做 KEEP/DISCARD；
- 不 commit。

输出：`topsop-v2-candidate-artifact`。

### 3.5 Evaluate

Worker：`topsop-v2-evaluate`

主要职责：

- 校验 candidate artifact、diff、comparison base 和 runtime identity；
- 运行 primary 与全部 guards correctness；
- correctness 通过后采集 primary timing；
- 相对当前 incumbent 计算 improvement；
- 判断是否越过 characterize 冻结的噪声门槛；
- 对越过门槛的候选采集全部 target metrics；
- 输出与 candidate artifact 绑定的纯观测结果。

职责边界：不更新 durable state，不执行 KEEP/DISCARD，普通 evaluate turn 不修改源码。

输出：`topsop-v2-candidate-evaluation`。

### 3.6 Promote

Worker：`topsop-v2-promote`

主要职责：

- 重新验证 evaluation 的 comparison base、提升幅度和 target evidence；
- 原子执行 `KEEP`、`DISCARD` 或 `CONVERGED`；
- KEEP 时提交候选源码、保存 immutable artifact snapshot、增加 durable revision 并更新 current-best；
- DISCARD 时恢复 current-best，并验证源码、artifact 和 state 一致；
- 使用 state revision 和 state SHA-256 执行 compare-and-swap；
- 生成下一轮唯一 feedback。

输出：`topsop-v2-promotion-receipt`。

### 3.7 Summary

Worker：`topsop-v2-summary`

主要职责：

- 以 baseline bundle 和最后一个 promotion receipt 为性能和状态来源；
- 报告 final artifact、state revision、baseline/final latency 和目标指标；
- 分开统计 scheduled rounds、attempted candidates、measured candidates、replan 和 KEEP/DISCARD；
- 更新结构化进展记录；
- 必要时做安全恢复并释放 workspace lease。

职责边界：不重新执行优化、测量或 profile，不重新解释上游失败。

输出：`topsop-v2-final-summary`。

## 四、Tournament 版本的流程差异

Tournament workflow 定义在 `recipes/workflows/topsop-tuning-v2-tournament.yml`：

```text
prepare
   │
   ▼
characterize ───────────── 完整 baseline profile 一次
   │
   ▼
┌──────────────────── 每轮 ─────────────────────┐
│                                              │
│ partition                                    │
│   ├─ lane 0: analyze → implement → evaluate │
│   ├─ lane 1: analyze → implement → evaluate │
│   └─ lane 2: analyze → implement → evaluate │
│                          │                   │
│                          ▼                   │
│                选择唯一 referee winner       │
│                          │                   │
│                          ▼                   │
│                       promote                │
└──────────────────────────────────────────────┘
   │
   ▼
summary
```

### 4.1 Partition

`topsop-v2-tournament-partition` 根据 baseline、上一轮 promotion receipt、durable history 和当前 run 已验收的 lane 结果，把搜索空间划分为三个互不重复的 mandate：

- 三个 lane 从同一个 current-best revision 出发；
- 优先覆盖不同搜索类别；
- 不把同一参数的三个取值伪装成三个独立方向；
- partition 只规定搜索边界，不预先发明具体代码修改；
- 不修改源码、不构建、不测量、不 profile。

### 4.2 Lane 执行

每个 lane 复用普通 V2 worker：

```text
analyze → implement → evaluate
```

差异在于：

- analyze 必须遵守对应 lane mandate；
- implement 在独立 map-slot workspace 中修改源码，并使用 lane-private build root 或等价隔离；
- evaluate 的 correctness、timing 和条件式 target profile 规则与串行 V2 相同；
- 一个 lane 的执行器失败只淘汰当前 lane，不应阻断其他 lane。

当前 `parallel: false`，因此三个 lane 虽然拥有隔离 workspace，但构建、设备测量和 profile 按顺序执行，避免竞争共享 GCU 设备和构建产物。

### 4.3 Referee 与 consolidation

有效的 tournament evaluation 会将真实 `benchmark.median` 映射为单值 referee metric：

```text
name: kernel_latency_median_us
direction: lower
samples: [median]
```

完整真实 samples 仍保存在 evaluation evidence 中；referee 仅供 tournament 按 median latency 选择唯一 winner，避免以偶然最小 sample 排序。

Piano 选出 winner 后，会发起 consolidation continuation，将冻结的 winner delta 应用到 tournament parent workspace。普通 evaluate turn 保持只读，只有该 consolidation turn 可以执行这一受限修改。随后由 promote 对 winner 执行正常的 KEEP/DISCARD transaction。

如果所有 lane 都没有可用 referee：

- 全部因为正常 convergence 而 skipped：promote 返回 `CONVERGED`；
- 否则不从失败 lane 中强行选择 winner，恢复/验证 incumbent 后返回 `DISCARD`，并由下一轮重新规划。
