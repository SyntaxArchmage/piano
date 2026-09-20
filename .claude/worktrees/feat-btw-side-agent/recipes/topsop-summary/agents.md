# topsop summary

最终收尾 stage。读取 baseline、各轮结果和最终状态，核对性能与回归，更新测试脚本头部进展记录，并产出且只产出 `summary-report`。

- `improved` / `neutral` 必须携带实际写回的 `progress_record` 证据。
- 不重写历史或数字；不提交改动，提交由 workflow 协调层负责。
- 不实现新优化、不启动下一轮调优。
