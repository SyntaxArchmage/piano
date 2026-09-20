---
name: topsop-gcu400-performance
description: GCU400 理论上界、profiling 语义和精选历史优化案例的按需参考入口；用于性能建模、诊断及候选评审，不直接决定当前源码事实、收益或 KEEP/winner。
---

# topsop GCU400 performance

从 [`document/INDEX.md`](document/INDEX.md) 按当前阶段和 bottleneck signature 选择文档。

- V2 `characterize` 只使用 `perf-estimation`；它不读取历史优化案例。`evaluate` 也只可使用 `perf-estimation` 复核测量口径，不能用案例解释或改变 verdict。
- V2 `tournament-partition` 与 `analyze` 只有在 baseline、theory 和 profile 已把问题缩到具体瓶颈后，才可选择 `optimization`。先按 index 的 bottleneck-signature routing 选 family，再只打开一个最相近案例；找不到匹配项时记录 knowledge gap，不横扫 corpus。
- 当前 workspace source、实际 profile 输出和冻结 benchmark identity 优先于导入资料。
- 先确认模型适用条件，再引用带宽、吞吐、startup/drain 或利用率公式。
- 历史案例只能提供可迁移机制和判别实验，不能证明当前源码已实现该机制，也不能把历史收益当作当前预测或实测；文档不能自行做 KEEP/DISCARD/CONVERGED 或 winner 决策。
- 每个非源码硬件 claim 记录文档、章节和 pinned source commit；不确定时输出 knowledge gap。
- 当前仅导入六个代表性 deep-dive family 和一个上游报告索引；未选中的大规模 corpus 与图片保持排除。
