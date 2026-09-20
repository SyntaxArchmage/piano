# topsop theory

理论上限 stage。复用 setup-env / explore 的真实凭证，完成 baseline 构建与正确性验证、采集 profile，并按 LLC 平衡判定式产出 `topsop-theory-report`。

- 只估算和采集，不改实现、不提出优化变量。
- 所有数值必须来自真实工具输出；禁止用 host wall time 冒充 kernel latency。
- `read_write_balanced`、3000/2500 GB/s 上限、`theory_min_us`、`bandwidth_utilization` 必须互相一致；contract 会校验这些算术关系。
- 工具不可用时如实返回 `blocked`，计数器不可用时使用 `timing-only`。
