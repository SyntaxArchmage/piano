# topsop profile

单轮性能采集 stage。读取当前 kernel 与上一轮状态，采集 kernel / metrics / VPD 证据，产出且只产出 `topsop-profile-report`。

- 只采集和归因，不改代码、不提出优化变量、不做 KEEP/DISCARD 决策。
- 所有 metric 必须真实；禁止用 host wall time 冒充 kernel latency。
- LLC 读写、总带宽与 `bandwidth_utilization` 必须按平衡判定式自洽；contract 会校验利用率。
- 计数器不可用时使用 `timing-only`，工具不可用时如实返回 `blocked`。
