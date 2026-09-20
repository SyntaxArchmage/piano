# Reviewer 11 — DTE 跨循环 event trace

本 reviewer 负责审查两层及以上嵌套循环中 DTE event / `*_valid` flag / mailbox notify 跨迭代复用时，trigger / wait / drain 是否在所有循环边界和条件分支下闭合。

加载 `gcu400-dte` skill：DTE 生命周期硬规则（旧 event 完成后才可重新 config、event 单次消费、buffer 在 event 完成前不复用、DTE wait 之后才能 SIP load 对应 buffer）统一在此维护。

## 触发条件

target 出现两层及以上嵌套循环 + DTE event / `*_valid` flag 跨迭代复用 + 双 / 三缓冲 ping/pong / 三层嵌套（外层 `for T/f_l2` + 中层 `while chunk` + 内层 `for d0`）时执行。

## 跨循环层级 event 生命周期 trace（强制）

不要只扫当前循环层闭合就过——event / `*_valid` flag 可能由外层循环驱动，漏 wait 会穿越到下一轮复用点。

术语约定：

- **wait（等空 / drain）**：等到这条 DTE context 上已经发出的搬运全部落地。落地的标志通常是 `event.wait()` 返回，或对应的 `*_valid` 标志位被置 0
- **wait 点 / drain 点**：实际执行 `event.wait()`（或 `*_valid = 0`）的代码位置
- **条件保护（guard）**：把一段代码用 `if (...)` 包起来，让它只在某些条件下执行。"drain 被 guard 起来"指 wait 点写在了某个 `if (...)` 分支里、不是无条件执行

trace 步骤：

- 列出该 context / event（含所有 `*_valid` 布尔 flag）：
  - 所有把 flag 置 1（trigger）的代码位置
  - 所有把 flag 置 0（也就是执行 wait 完成等空）的代码位置
- 对每一层循环边界（inner `}` 到 outer 下一次迭代开始）做穿越分析：
  - 从某个 trigger 点出发，沿代码顺序走到下一次"任何 SIP 写该 buffer / 下一次同 context trigger"，中间每一条候选 wait 路径是否必然被命中
  - 候选 wait 写在 `if (...)` 里时（即被条件 guard），列出所有能让该 `if` 分支不进入、但 flag 仍为 1 的路径
- 若存在任一路径使 flag 穿越循环边界仍为 1，且下一轮首次写入前没等到 wait，按 `Major` 以上处理；若下一次写入是 SIP 直接 store，同时伴随 DTE 未 wait，默认 `Blocker`，因为这违反"先 `wait` 再重配 / 复用同一 DTE context"的硬规则
- 当 wait 点被 optional / 路径条件 guard（`is_normalize` / `is_first_*` / `is_last_chunk` 之类）时，需要给出证据说明其他条件下 flag 保证已为 0；证据缺失时按上条处理

## 典型高发点

命中以下模式时默认执行上面的 trace：

- 外层 `for f_l2 / kv_block_idx` + 中层 `while chunk_begin` + 内层 `for d0 / k_inner` 的三层嵌套
- `*_valid` flag 在 inner 末尾 `trigger`、在 inner 入口 wait，但 wait 写在 `if (is_first_*)` 这种分支里
- `is_normalize` / `params.is_*` 分支里独占某个 wait，需要确认非 normalize / 其他分支是否还能到达该 wait
- 双 / 三缓冲 stage 时间线里，存在"前轮 DTE 写回 L3 / 本轮 GEMM L1 store"交界
- `kv_stage_idx % kv_stage` 这种 stage 索引跨迭代复用，且 stage size 大于 2 时尤其易出问题

## 输出要求

evidence 附 `(context, event 或 *_valid flag, 外层循环变量, 条件分支)` 四元组；四元组不同的漏 wait 即使看起来是同一问题也各自成条 finding，不合并。

每个命中的热区一张 `mandatory_trace_tables`，schema：

```
(context, event/flag, 外层循环变量, 条件分支, trigger 行号, drain 行号, drain 是否 guard, guard 不进入时 flag 为 0 的依据)
```

任一列留空 / `N/A` / `unknown` / `todo` 默认按 `Major` 报；满足强制规则锚点条件（下一次写入是 SIP 直接 store + DTE 未 wait）时升 `Blocker`。

表末附 `coverage_proof`：`grep` 命令 + 计数结果，证明本表已穷尽该热区区间内所有跨迭代复用对象的 context / event / flag / 分支组合。

## 不接受的免 drain 论据

下列论据不能作为"漏 drain 安全"的证据：

- "代码太长 / 看起来合理 / 测试覆盖到此路径"
- "opposite ping/pong 隔离"——ping/pong 的 buffer 隔离不等于 DTE context 隔离；同一 context 的 trigger / wait 必须按 context 单独对账
- "前轮已 wait 过对应 mailbox"——mailbox notify 与 DTE event 是不同语义，不能互相替代

## 防误报

- inner trigger / inner wait 在同一层循环内闭合，且无跨迭代复用，不必 trace 跨循环
- 单缓冲（stage = 1）下，每轮入口 wait + 出口 wait 都明确时，跨循环 trace 退化为单层
