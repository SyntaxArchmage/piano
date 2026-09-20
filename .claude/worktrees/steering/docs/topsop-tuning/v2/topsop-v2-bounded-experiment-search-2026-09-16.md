# Topsop Tuning V2：有界实验搜索与成功终止设计记录

- 日期：2026-09-16
- 状态：已实施
- Piano commit：`1ee916bd3165e28f1f26f6213a51a7768838288a`
- 主要证据 session：`/home/wsj/.piano/runs/20260915T171142-6b90e4`
- 适用范围：`topsop-tuning-v2.yml`、V2 analyze/promote/summary worker，以及通用 loop runtime

## 1. 背景与问题

V2 workflow 原先使用固定次数 loop。把 `iterations` 增大可以提供更多优化机会，但原实现把三个不同概念混在了一起：

1. **调度预算**：workflow 最多允许进入多少轮；
2. **候选尝试数**：analyze 实际提出了多少个可实施 candidate；
3. **真实测量数**：多少 candidate 完成了 evaluate 并产生有效性能观测。

固定轮数本身不能保证产生相同数量的优化实验。更严重的是，worker 已经判断收敛后，Piano 没有成功终止 loop 的通用语义，只能继续执行：

```text
analyze=converged
  -> implement=skipped
  -> evaluate=skipped
  -> promote=terminal
  -> 下一固定轮重复同一链路
```

因此，提高 `iterations` 会同时放大空转成本，却不一定扩大有效搜索空间。

## 2. 运行证据

### 2.1 Session 状态

证据 session：

```text
/home/wsj/.piano/runs/20260915T171142-6b90e4
```

停止时 `progress.json` 为：

```json
{
  "status": "running",
  "plannedStages": 123,
  "completedStages": 94,
  "acceptedStages": 94,
  "remainingStages": 29,
  "current": {
    "invocationId": "tune.analyze@tune/iter-23",
    "iteration": 23
  }
}
```

123 个计划 stage 来自：

```text
prepare + characterize + 30 * (analyze + implement + evaluate + promote) + summary
= 1 + 1 + 30 * 4 + 1
= 123
```

### 2.2 实际候选与结果

本次 session 只有 iteration 0～3 产生了真实 candidate measurement：

| Iteration | Candidate | Median latency | Decision |
|---:|---|---:|---|
| 0 | `iter0-row-exact-n-partition` | 124.616667 us | DISCARD |
| 1 | `iter1-async-input1-prefetch` | 120.738333 us | KEEP |
| 2 | `iter2-residual-prefetch-pipeline` | 120.806667 us | DISCARD |
| 3 | `iter3-residual-global-load` | 141.166667 us | DISCARD |

Session baseline 是 123.73 us。iteration 1 相对 baseline 提升约 2.42%，并成为 revision 1 的 current-best：

- Topsop commit：`37a069def169c68e880cb2047777068d8a6b6912`
- artifact SHA-256：`0102f8f7bafddfffd1d259758dc4f2ba0165897ca9cc48769eca0d09e91957a5`

iteration 4 的 analyze 返回 `converged`。其判断同时引用了本次四轮实验和 durable history 中之前已经证伪的机制。这说明 durable history 对防止重复试验有价值，但也暴露出“历史机制数量”与“本次真实测量数量”没有被分别表达。

### 2.3 空转证据

iteration 4 已经进入正常收敛路径；iteration 5～22 仍继续生成 `converged/skipped/skipped/terminal` 结果。按 `progress.jsonl` 中同轮首尾 accepted timestamp 计算：

- iteration 5～22 共执行 18 个空转轮次；
- 每轮 accepted-stage span 约 0.73～1.18 分钟；
- 仅这些轮次的 span 合计约 16 分钟，尚未包含相邻轮次之间的模型启动间隔；
- session 最终在 iteration 23 analyze 期间退出，summary 没有执行，snapshot 仍显示 29 个 stage 未完成。

这不是 correctness 问题，而是调度语义和 worker 收敛协议之间缺少闭环。

### 2.4 原策略的搜索局限

旧 analyze 规则同时要求：

- 每轮一个 candidate；
- 单变量；
- 不重试 durable history 中已经证伪的 mechanism；
- 没有可行候选时立即 `converged`。

“单变量”容易被模型误解为“单文件、单常量、小改动”。当局部 DTE 调度候选耗尽后，worker 缺少明确要求去检查其他优化类别，也没有结构化字段证明它完成过 expanded 或 structural replan。因此，较早收敛可能只是局部邻域耗尽，并不等价于全局候选空间充分搜索。

## 3. 设计目标

本次调整遵循以下原则：

1. `iterations` 表示最大预算，而不是固定实验配额；
2. 明确追踪本次 session 的真实 measurement 数；
3. 局部候选耗尽后必须扩大搜索范围；
4. 允许一个因果 mechanism 对多个文件做协调修改；
5. 收敛必须有证据，但不得为了凑次数制造低质量候选；
6. 正常收敛后应立即结束 loop 并继续 summary；
7. 调度控制必须来自 worker contract projection，不能解析任意业务 payload；
8. V1 workflow/worker 保持不变；
9. Piano 框架改动保持通用、最小，不引入 Topsop case-specific 逻辑。

## 4. 实施方案

### 4.1 30 轮最大预算，10 次真实测量目标

`recipes/workflows/topsop-tuning-v2.yml` 使用：

```yaml
iterations: 30
```

其语义是最大调度预算。`topsop-v2-analyze` 以当前 session 完成 10 次真实 candidate measurement 为目标，但 10 不是硬配额：

- compile failure 不计入 measurement；
- implement/evaluate skipped 不计入 measurement；
- convergence round 不计入 measurement；
- previous durable session 的历史只用于去重，不计入当前 session measurement。

### 4.2 分层搜索与结构化重规划

Analyze 维护以下六类搜索空间：

1. `data_movement_overlap`
2. `tiling_partitioning`
3. `storage_layout`
4. `compute_codegen`
5. `launch_specialization`
6. `fusion_algorithm`

搜索模式依次为：

```text
focused -> expanded -> structural
```

- `focused`：沿当前 profile 和瓶颈的直接邻域提出候选；
- `expanded`：当前邻域耗尽后检查尚未测试的类别；
- `structural`：局部机制均不足时重新审视数据流、计算拆分、launch specialization 或算法结构。

“一个 candidate”现在定义为一个可证伪的因果 mechanism，而不是只能修改一个常量或一个文件。只要修改共享同一个因果链、验证标准和 rollback boundary，就允许协调式多文件改动。

### 4.3 Analyze contract 的搜索进度

`topsop-v2-candidate-plan` 新增 `search_progress`：

- `target_experiments = 10`
- `measured_experiments`
- `replan_generation`
- `mode = focused | expanded | structural`
- 六类 `category_coverage`
- evidence references

每类 coverage 必须是：

```text
untried | active | tested | exhausted | infeasible
```

Candidate 还必须声明所属 `category`。

当 measurement 少于 10 时，`converged` 的 contract 要求：

- `mode=structural`；
- 六类全部为 `exhausted` 或 `infeasible`；
- `replan_performed=true`；
- 明确记录 `unresolved_target_gap`。

Schema 负责约束可机器校验的状态，worker 文档负责要求这些状态必须由 evidence 支持。

### 4.4 通用成功终止投影

Piano runtime 新增保留投影：

```text
workflow.loop-control = stop
```

控制规则：

1. 只读取 loop 声明的 `feedback` stage 的 contract projections；
2. 任意 `resultPayload.next_action`、文本或非 contract 字段都没有调度权限；
3. 当前 iteration 的 feedback 和可选 round commit 完成后才退出；
4. 退出是正常成功路径，不标记为 blocked；
5. loop 的 boundary 仍是最后一个完整 iteration，后续 summary 正常接收它。

该机制是 worker-neutral 的，不包含 Topsop operator、硬件或状态格式知识。

### 4.5 Promote 使用独立控制字段

`topsop-v2-promote` contract 新增：

```json
{
  "loop_control": "continue | stop"
}
```

状态约束为：

| Promote status | Decision | `next_action` | `loop_control` |
|---|---|---|---|
| promoted | KEEP | continue | continue |
| restored | DISCARD | continue | continue |
| terminal | CONVERGED | stop | stop |
| blocked | BLOCKED | stop | continue |

`next_action` 面向业务和人工处置；`loop_control` 专门用于调度。二者分离是必要的，因为 iteration-scoped block 的人工建议可以是 stop/fix，但它不能被误判成成功收敛。Global block 仍由现有 `workflow.status` 和 `workflow.block-scope` 逻辑终止。

Promote 将 `/loop_control` 投影为 `workflow.loop-control`。

### 4.6 提前终止后的 progress

固定 loop 初始仍按最大预算生成 denominator，便于运行开始时展示最大计划量。收到合法 stop projection 后，runtime 记录该 region 实际完成的 iteration 数。后续 stage（通常是 summary）写 progress 时重新计算有效计划：

```text
有效 loop stage 数 = 已完成 iteration 数 * 每轮 stage 数
```

因此成功终止后的最终 snapshot 满足：

```text
plannedStages == completedStages
remainingStages == 0
```

不会把未执行的预算轮次显示为未完成工作。

### 4.7 Summary 统计拆分

`topsop-v2-final-summary.rounds` 现在分别记录：

- `scheduled`：实际进入的 loop 轮数；
- `attempted`：产生 candidate 的轮数；
- `measured`：evaluate 产生有效观测的 candidate 数；
- `target_measured`：固定为 10；
- `replans`：本次 run 最大 replan generation；
- `kept`、`discarded`、`failed`。

这避免再用一个含义模糊的 `attempted` 同时代表调度、实现和测量。

## 5. 未采用的方案

### 5.1 把 loop 固定为 10 轮

未采用。十轮调度不等于十次真实测量；compile failure、candidate-local block 或 convergence 都会减少真实实验数，也无法为重规划保留余量。

### 5.2 强制必须完成 10 次 measurement

未采用。硬性配额会诱导 worker 重命名已经证伪的 mechanism、提出没有证据的低质量 candidate，或在硬件约束已证明不可行后继续浪费设备时间。

### 5.3 继续传播 no-op 到第 30 轮

未采用。它保证固定 stage 数，但消耗模型时间、扩大 session context，并使 progress 和“实际工作量”脱节。

### 5.4 直接解析 `next_action=stop`

未采用。任意业务字段不应隐式拥有控制流权限；不同 worker 对 `next_action` 的含义也可能不同。独立 contract projection 提供了明确、可审计的 capability boundary。

### 5.5 为 Topsop 增加专用 workflow key

未采用。成功结束有界 loop 是通用需求，不应在 Piano DSL 中引入 Topsop-specific key。当前方案只增加一个通用 projection convention。

## 6. 修改范围

核心文件：

- `packages/orchestrator/src/workflow-execution.ts`
- `recipes/workflows/topsop-tuning-v2.yml`
- `recipes/topsop-v2-analyze/agents.md`
- `recipes/topsop-v2-analyze/contract.json`
- `recipes/topsop-v2-analyze/skills/topsop-v2-analyze/SKILL.md`
- `recipes/topsop-v2-promote/agents.md`
- `recipes/topsop-v2-promote/contract.json`
- `recipes/topsop-v2-promote/skills/topsop-v2-promote/SKILL.md`
- `recipes/topsop-v2-summary/agents.md`
- `recipes/topsop-v2-summary/contract.json`
- `recipes/topsop-v2-summary/skills/topsop-v2-summary/SKILL.md`
- `docs/topsop-tuning/v2/topsop-tuning-v2-design.md`

测试文件：

- `tests/workflow/workflow-end.test.ts`
- `tests/workflow/topsop-v2-compatibility.test.ts`
- `tests/workflow/topsop-v2-contracts.test.ts`
- `tests/workflow/topsop-v2-scenarios.test.ts`

## 7. 验证结果

实施 commit 前完成以下验证：

- focused V2 和 generic workflow tests：7 files、160 tests 全部通过；
- `npm run typecheck` 通过；
- affected files ESLint 通过；
- `git diff --check` 通过。

新增的 generic regression 使用一个三轮 fixed loop，feedback worker 第一轮投影 `workflow.loop-control=stop`，验证：

1. 只执行第一轮；
2. summary 仍执行；
3. stage 顺序为 `seed -> propose -> report -> summary`；
4. 最终 progress 为 4 planned / 4 completed / 0 remaining。

## 8. 兼容性与后续验证

- V1 `topsop-tuning.yml` 和所有 V1 worker 未修改；
- 未增加 Topsop-specific DSL key；
- 未改变没有声明 `workflow.loop-control` 的现有 loop；
- V2 contract 发生了有意的协议升级，旧 V2 worker 输出若缺少新增字段会被 validation 拒绝，而不是静默采用错误语义；
- 本文所列 session 是改动前的问题证据，不是改动后的端到端验收结果。

下一次真实 V2 end-to-end 应重点确认：

1. analyze 每轮正确增加当前 run 的 `measured_experiments`；
2. local candidate 耗尽后确实进入 expanded/structural replan；
3. `terminal/CONVERGED` 后不再产生下一 iteration；
4. summary 的 scheduled/attempted/measured/replans 计数与 evidence 一致；
5. 最终 progress 的 remaining stages 为 0。

## 9. 提交

实现提交：

```text
1ee916bd3165e28f1f26f6213a51a7768838288a
feat(topsop): bound v2 experiment search
```
