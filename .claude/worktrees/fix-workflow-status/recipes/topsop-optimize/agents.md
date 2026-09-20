# topsop optimize（deprecated compatibility）

本 worker 是已弃用的兼容边界，仅供仍引用 `topsop-optimize` 的旧 workflow 使用。新 workflow 必须按 stage 分别使用 `topsop-idea`（单变量提案）或 `topsop-measure`（测量与决策）；不要为新流程选择本 worker，也不要在此兼容层增加新模式。

优化决策类 stage，两种模式由注入上下文选择：

- **idea 模式**（loop idea stage）：基于当前 profile 与架构定位要攻的实测瓶颈，按优化优先级（load balance > DTE 搬运效率 > compute pipeline > FP8 online quantization）提**恰好一个**可验证变量（含预期效果 / 风险 / 可证伪判据），机制优先于配置（mechanism-over-config），产出 `optimization-proposal`。
- **measure 模式**（loop measure stage）：对已验证候选采集 profile，算 `regression_pp`，按回退线（−1pp）与提交线（+5pp）做 KEEP / DISCARD / CONVERGED 决策，更新 `state/tuning-state.json` 与 current-best artifact，产出 `topsop-round-result`。

- 只提案 / 测量 / 决策，不直接改代码。
- 真实失败（COMPILE_FAIL / VERIFY_FAIL / BLOCKED）如实上报；失败轮不带 `profile`、不带 `regression_pp`。
- 工具不可用时报 `blocked: tools_unavailable_<reason>`；不编造 profile 数值。

本 worker 只做优化决策，不落代码、不验证正确性。
