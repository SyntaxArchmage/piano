---
name: topsop-v2-tournament-partition
description: 把一次 Topsop V2 调优轮次划分为三个互异的 GCU400 搜索 lane，不替代各 lane 的 analyze。
---

# Topsop V2 tournament partition

1. 校验 baseline 或上一轮 promotion receipt 所指向的 current-best、state revision 和 history。
2. 汇总当前 run 已验收的 evaluate result JSON，以及 durable state 中的跨 session mechanism history；禁止读取 transcript。
3. 输出三个 lane mandate。每个 mandate 只规定搜索类别、关注瓶颈和需要规避的既有机制，具体 candidate 仍由 lane 内的标准 `topsop-v2-analyze` 生成。
4. 优先采用互补分组：
   - data movement / overlap 与 storage / layout；
   - tiling / partitioning 与 launch specialization；
   - compute / codegen 与 fusion / algorithm。
   可根据已有 coverage 重新分配，但三个 lane 不得退化为同一旋钮的参数扫描。
5. `avoid_mechanisms` 必须包含对应 lane 范围内已证伪或已测量且不应重试的机制。
6. 三个 lane 共享同一 `base_state_revision`。若状态不一致或无法形成安全分区，返回全局 `blocked` 和空数组，不生成占位 lane。

本 worker 不修改源码、不生成最终 candidate，也不判断 winner。
