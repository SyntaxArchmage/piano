---
name: topsop-theory
description: 建立 topsop baseline，验证正确性，采集性能证据并按 LLC 平衡规则计算 roofline 理论上限。
---

# topsop theory

1. **读注入上下文**：读取 setup-env / explore handoff，确认目标算子、target case、build target、源码调用链、host dispatch 选中的 kernel variant 和硬件常量。
2. **复用或构建 baseline**：先检查 setup-env 的 `so_path` / `so_mtime` / `so_commit`。产物存在且新鲜（mtime 晚于目标源码最后改动）时直接复用并保留凭证；缺失或过期时运行 `ophal build --arch 400 --target <target>`，构建后记录真实凭证。禁止无条件重编，避免工作区未提交改动与产物不一致。
3. **正确性**：经正式 `ophal test` 入口先跑 target case，再跑完整回归，记录 passed / total 和 gold-vs-real diff 证据。
4. **真实 profile**：分别运行 `ophal profile --arch 400 --mode kernel|metrics|vpd --filter <TargetCase>`，采集 kernel latency、LLC 读写带宽、1D efficiency 和 VPD 瓶颈，保留原始输出路径。禁止编造 metric，禁止用 host wall time 代替 kernel latency。
5. **单位自洽**：`llc_read_bytes` / `llc_write_bytes` 必须取整。交叉检查 `(llc_read_bytes + llc_write_bytes) / kernel_latency_us * 1e-3 ≈ llc_rw_sum_gbps`；bytes / us 转 GB/s 的 `1e-3` 不可漏掉。
6. **理论上限**：当 LLC read / write 与 write / read 均不超过 3 且两者都大于 0 时，`read_write_balanced=true`、`bandwidth_limit_gbps=3000`；否则为 false、上限 2500。计算 `theory_min_us=(llc_read_bytes+llc_write_bytes)/(bandwidth_limit_gbps*1e3)` 和 `bandwidth_utilization=min(llc_rw_sum_gbps/bandwidth_limit_gbps,1)`。contract 会校验平衡判定、上限以及 ±0.02 / ±3% 数值关系。
7. **硬件常量纪律（ISSUE-015）**：VC / VDMEM / L1 分析只使用 explore 注入的常量及其来源。已知量包括 L1 VDMEM 1.5MB/SIP（`L1_MAX_SIZE = 1572864 - 512`）、SDMEM 128KB/SIP、IMEM 128KB/SIP、L2 64MB/DIE、VC 预算 11/SIP、tier 对齐 QA 512B / DA 256B / VA 128B。`kMaxDLen` 是 per-operator 常量，必须从目标 kernel 源码推导，不能从手册猜。
8. **返回报告**：返回且只返回 `topsop-theory-report`。完整证据用 `ready`；硬件计数器不可用但 timing 有效时用 `timing-only`；无法建立 baseline 时用 `blocked` 并填写真实 blocker（工具不可用可写 `tools_unavailable_<reason>`）。

所有 `ophal build` / `ophal test` / `ophal profile` 等 bash 命令必须显式用 `timeout <N>s` 包裹。文件定位优先使用原生 `find` / `grep` / `ls` 工具；bash 搜索只能从 workspace 内窄目录开始并限制深度，禁止 `find /`、递归 `$HOME` 或搜索无关 worktree。超时后缩小范围重试；仍不可用就如实 blocked，不猜路径。本 worker 只采集和估算，不修改代码、不提出优化变量。
