---
name: topsop-profile
description: 为当前 topsop tuning 轮采集 kernel、LLC、效率和 VPD 证据并形成严格自洽的 profile report。
---

# topsop profile

1. **读注入上下文**：读取 target case、build 凭证、当前 kernel、current-best 状态和上一轮 measure 反馈；不得把上一轮结果当作本轮实测。
2. **真实采集**：分别运行 `ophal profile --arch 400 --mode kernel|metrics|vpd --filter <TargetCase>`，采集 kernel latency、LLC 读写带宽、1D/2D efficiency 和 VPD 瓶颈，保留原始 profile 路径。禁止编造 metric，禁止用 host wall time 代替 kernel latency。
3. **单位自洽**：`llc_read_bytes` / `llc_write_bytes` 必须取整（计数器即使输出 `209808384.0` 也要写成 JSON integer）。交叉检查 `(llc_read_bytes + llc_write_bytes) / kernel_latency_us * 1e-3 ≈ llc_rw_sum_gbps`。
4. **带宽利用率**：当 read / write 与 write / read 均不超过 3 且两者都大于 0 时，上限为 3000 GB/s；否则为 2500。填写 `bandwidth_utilization=min(llc_rw_sum_gbps/limit,1)`；contract 会校验 ±0.02 的一致性。
5. **硬件常量纪律（ISSUE-015）**：归因 VC / VDMEM / L1 预算时，只使用 explore 注入的硬件常量及来源；`kMaxDLen` 从目标 kernel 源码推导。禁止通过全盘搜索猜硬件定义。
6. **返回报告**：返回且只返回 `topsop-profile-report`。完整 counters 用 `ready`；计数器不可用但 timing 有效用 `timing-only`；工具不可用用 `blocked` 并填写真实 blocker（可写 `tools_unavailable_<reason>`）。

所有 `ophal profile` 等 bash 命令必须显式用 `timeout <N>s` 包裹。文件定位优先使用原生 `find` / `grep` / `ls` 工具；bash 搜索只能从 workspace 内窄目录开始并限制深度，禁止 `find /`、递归 `$HOME` 或搜索无关 worktree。超时后缩小范围重试；仍不可用就如实 blocked。本 worker 只采集与归因，不改代码、不提案、不做 KEEP/DISCARD。
