---
name: topsop-summary
description: 核对 topsop 最终性能与回归结果，写回进展记录并形成最终 summary report。
---

# topsop summary

1. **读完整 handoff**：读取最终状态、baseline、所有 round 记录和 loop 边界注入的最后一轮 profile，不能只依据最后一句 narrative。
2. **核对最终数值**：对照目标检查 kernel latency、LLC r+w、1D/2D efficiency 和 `bandwidth_utilization`，明确达到、未达到或无法测量，并给出真实原因与收敛值。
3. **验证最终状态**：最后一轮修改过 kernel 时重跑完整回归（sanitizer + 随机压力），否则引用最后一次已验证计数。优化收尾必须覆盖全量回归，不能把仅 smoke 或未验证状态总结为成功。
4. **写回进展记录（ISSUE-012）**：更新测试脚本头部 `Current status`（完成时 `stable`，仍有后续计划时 `optimizing`），并且每次只追加一条 `R<n>`，内容包含命令、shape、Avg/Min/Max、证据和 next action。
5. **可验证 handover**：`outcome` 为 `improved` 或 `neutral` 时，`progress_record` 必须给出实际写回的 `file_path`、真实 `current_status` 和新增 `entry`；写回不可验证时不得伪造。`regressed` / `unmeasured` / `write_only` 不强制该字段。
6. **返回报告**：返回且只返回 `summary-report`，不启动新优化轮。

优先使用 handoff 已给出的测试脚本和 report 路径。必须搜索时使用原生 `find` / `grep` / `ls`；bash 搜索只能从目标测试目录或 workspace 内窄目录开始，并带 `timeout` 与深度限制。所有测试、profile、grep 等 bash 命令都必须显式使用 `timeout <N>s`。禁止 `find /`、递归 `$HOME`、搜索无关 worktree 或无界搜索；超时后缩小范围，仍找不到就如实报告。

本 worker 不重写历史或数字，不提交改动；kernel / host / test / 进展记录改动留在工作区，由 workflow 协调层决定提交。
