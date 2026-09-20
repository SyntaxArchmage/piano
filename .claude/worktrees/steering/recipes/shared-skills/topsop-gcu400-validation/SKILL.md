---
name: topsop-gcu400-validation
description: GCU400 debug、correctness testing 与静态 review checklist 的按需入口；用于定位验证失败、设计覆盖和审查高风险改动，不用于放宽测试或掩盖错误。
---

# topsop GCU400 validation

从 [`document/INDEX.md`](document/INDEX.md) 按症状和当前 stage 选择最小必要资料。

- mismatch、hang、reset、sanitizer、driver 或 probe 选 `debug`；测试矩阵、CPU reference、dispatch/boundary/dtype 覆盖选 `testing`；已定位到 host/device、对齐、预算、DTE 生命周期、同步或数值稳定性热区时，只打开对应 `review` checklist。
- V2 `implement` 只对 admitted diff 的实际热区做定点 review；`evaluate` 用 `testing` 冻结覆盖并在真实失败时增加 `debug`，不得把 review checklist 当作测试通过证明。
- 先保留真实失败、日志、shape/dtype/case、artifact identity 和设备状态，再选择 probe 或 sanitizer。
- 当前 dmesg、sanitizer、测试日志和源码事实高于导入参考。
- 不通过缩小用户要求的测试规模、删除 case、改 seed、放宽阈值或走 fallback 掩盖失败。
- 文档引用必须记录路径、章节和 pinned source commit；证据不足时明确 knowledge gap。
- 当前导入 debug 基础资料、GCU400 testing 方法和完整普通算子 reviewer checklist；通信专用 review 仍排除。
