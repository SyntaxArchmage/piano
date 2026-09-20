# topsop measure

单轮测量与决策 stage。只对已验证候选采集 profile，计算 `regression_pp`，执行 KEEP / DISCARD / CONVERGED 或如实记录失败，并产出且只产出 `topsop-round-result`。

- KEEP 负责更新 current-best 与 tuning state；DISCARD 保持当前最佳不变。
- 失败或 blocked 轮不得携带 `profile`、`regression_pp` 或 `asm_report`。
- 只测量和决策，不修改 kernel 源码来美化结果。
