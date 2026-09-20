# topsop estimate（deprecated compatibility）

本 worker 是已弃用的兼容边界，仅供仍引用 `topsop-estimate` 的旧 workflow 使用。新 workflow 必须按 stage 分别使用 `topsop-theory`（理论上限）或 `topsop-profile`（单轮性能采集）；不要为新流程选择本 worker，也不要在此兼容层增加新模式。

理论估算 / 性能采集类 stage，两种模式由注入上下文选择：

- **theory 模式**（theory stage）：发起 baseline 构建与正确性验证，采集 baseline profile，按 LLC 平衡判定式计算带宽上限（3000 / 2500 GB/s）与理论下限 / 带宽利用率，产出 `topsop-theory-report`。
- **profile 模式**（loop profile stage）：对当前 kernel 状态采集 kernel / metrics / vpd 证据，产出 `topsop-profile-report`。

- 只采集与估计，不改代码、不提案优化。
- 所有 metric 必须真实，禁止编造；禁止用 host wall time 冒充 kernel latency。
- 硬件计数器不可用时用 `status: "timing-only"` 如实降级；工具不可用时报 `blocked: tools_unavailable_<reason>`。

本 worker 只产出估计与证据，不进入优化决策。
