# TopSOP tuning V2

V2 是与 V1 并存的新 workflow/worker/contract 体系，包括串行和 tournament 两种 recipe。

## 总体设计

- [`topsop-tuning-v2-design.md`](topsop-tuning-v2-design.md)：V2 总体架构、stage ownership、durable continuation 和兼容边界。
- [`topsop-tuning-v2-knowledge-routing-2026-09-16.md`](topsop-tuning-v2-knowledge-routing-2026-09-16.md)：GCU400 canonical knowledge routing。
- [`topsop-tuning-v2-tournament-design-2026-09-16.md`](topsop-tuning-v2-tournament-design-2026-09-16.md)：三 lane tournament 结构、隔离和 fan-in 语义。

## 搜索与执行策略

- [`topsop-v2-bounded-experiment-search-2026-09-16.md`](topsop-v2-bounded-experiment-search-2026-09-16.md)：有界实验搜索、replan 和正常收敛。
- [`topsop-v2-implement-build-latency-2026-09-16.md`](topsop-v2-implement-build-latency-2026-09-16.md)：implement 长耗时与 build 生命周期。
- [`topsop-v2-cumulative-improvement-threshold-2026-09-17.md`](topsop-v2-cumulative-improvement-threshold-2026-09-17.md)：噪声显著的小幅累积提升策略。

## 状态、证据与失败处理

- [`topsop-v2-canonical-workspace-identity-2026-09-16.md`](topsop-v2-canonical-workspace-identity-2026-09-16.md)：workspace/state canonical identity。
- [`topsop-v2-preloop-blocked-fast-path-2026-09-16.md`](topsop-v2-preloop-blocked-fast-path-2026-09-16.md)：pre-loop blocked 快速传播。
- [`topsop-v2-plan-conformance-and-target-evidence-gates-2026-09-16.md`](topsop-v2-plan-conformance-and-target-evidence-gates-2026-09-16.md)：candidate plan 与目标指标证据门禁。
- [`topsop-v2-lane-failure-and-comparison-binding-2026-09-17.md`](topsop-v2-lane-failure-and-comparison-binding-2026-09-17.md)：lane 故障隔离与 incumbent metric binding。
- [`topsop-v2-tournament-referee-fixture-2026-09-17.md`](topsop-v2-tournament-referee-fixture-2026-09-17.md)：tournament referee fixture 回归。

每次 V2 worker 调整都应在对应主题文档中记录原因、具体改动、验证结果和 implementation commit ID。
